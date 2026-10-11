const express = require("express");

const {
  getRun,
  addExchange,
  setRunPresentationRequest,
  setRunVerificationResult,
  setRunVerificationFailure
} = require("../services/run.service");

const {
  createPresentationRequest,
  getVerifierClientId,
  getPresentationResult
} = require("../services/verifier.service");

const router = express.Router();

const PENDING_RESULT_CODES = new Set([
  "NO_VP_SUBMISSION",
  "RESPONSE_CODE_NOT_USED"
]);
const REJECTED_PRESENTATION_CODES = new Set([
  "INVALID_VP_TOKEN",
  "TOKEN_MATCHING_FAILED",
  "VP_WITHOUT_PROOF"
]);

function getVerifierErrorCode(error) {
  const responseData = error.response?.data;

  if (responseData && typeof responseData === "object") {
    return responseData.errorCode || responseData.code || null;
  }

  return null;
}

function getResultRequest(run) {
  const request = run.presentationRequest;
  const response = request?.authorizationRequest;

  return {
    transactionId:
      request?.transactionId || response?.transactionId,
    requestId:
      request?.requestId || response?.requestId
  };
}

function getSafeRunSummary(run) {
  return {
    runId: run.runId,
    status: run.status,
    result: run.result,
    verificationResult: run.verificationResult,
    verificationFailure: run.verificationFailure
  };
}

function isValidVerificationResult(result, transactionId) {
  if (
    !result ||
    result.transactionId !== transactionId ||
    typeof result.allChecksSuccessful !== "boolean" ||
    !Array.isArray(result.credentialResults) ||
    result.credentialResults.length === 0
  ) {
    return false;
  }

  const credentialResultsAreValid =
    result.credentialResults.every((credentialResult) =>
      credentialResult &&
      typeof credentialResult === "object" &&
      !Array.isArray(credentialResult) &&
      typeof credentialResult.allChecksSuccessful === "boolean"
    );

  return credentialResultsAreValid &&
    result.allChecksSuccessful ===
      result.credentialResults.every(
        (credentialResult) =>
          credentialResult.allChecksSuccessful
      );
}

router.post("/runs/:runId/request", async (req, res) => {
  const startTime = Date.now();

  try {
    const run = getRun(req.params.runId);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: `Run not found: ${req.params.runId}`
      });
    }

    const verifierId = run.scenario.verifier;

    if (!verifierId) {
      return res.status(400).json({
        success: false,
        error: "No verifier selected for this run"
      });
    }

    const clientId = getVerifierClientId(verifierId);

    if (
      Object.prototype.hasOwnProperty.call(req.body, "clientId") &&
      req.body.clientId !== clientId
    ) {
      const error = new Error(
        "clientId must match the configured INJI_VERIFY_CLIENT_ID"
      );
      error.statusCode = 400;
      throw error;
    }

    const presentationDefinition =
      req.body.presentationDefinition || {
        id: "farmer-credential-request",
        input_descriptors: [
          {
            id: "farmer-credential",
            format: {
              ldp_vc: {}
            }
          }
        ]
      };

    const presentationRequest =
      await createPresentationRequest(
        verifierId,
        {
          clientId,
          presentationDefinition
        }
      );

    setRunPresentationRequest(
      req.params.runId,
      presentationRequest,
      clientId
    );

    const durationMs = Date.now() - startTime;

    const exchange = addExchange(
      req.params.runId,
      {
        stepName: "Presentation Request Creation",
        protocol: run.scenario.presentationProtocol || "openid4vp",
        direction: "playground-to-verifier",
        status: "SUCCESS",
        initiatedBy: "playground",
        transactionId: presentationRequest.transactionId || null,
        requestId: presentationRequest.requestId || null,
        durationMs,
        error: null
      }
    );

    res.json({
      success: true,
      presentationRequest,
      exchange
    });
    } catch (error) {
    const durationMs = Date.now() - startTime;

    try {
      const exchange = addExchange(
        req.params.runId,
        {
          stepName: "Presentation Request Creation",
          protocol: "openid4vp",
          direction: "playground-to-verifier",
          status: "FAILED",
          initiatedBy: "playground",
          durationMs,
          error: error.message,
          diagnostic: {
            code: error.code || null,
            upstreamStatus: error.response?.status || null
          }
        }
      );

      res.status(error.statusCode || 502).json({
        success: false,
        error: error.message,
        exchange
      });
    } catch (runError) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

router.get("/runs/:runId/result", async (req, res) => {
  const startTime = Date.now();
  const run = getRun(req.params.runId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: `Run not found: ${req.params.runId}`
    });
  }

  const { transactionId, requestId } = getResultRequest(run);
  const verifierId = run.presentationRequest?.verifierId;

  if (
    !transactionId ||
    !requestId ||
    !verifierId ||
    verifierId !== run.scenario.verifier
  ) {
    return res.status(409).json({
      success: false,
      error:
        "A correlated Verify transaction and request ID are required before retrieving a result"
    });
  }

  const eventBase = {
    stepName: "Verification Result Retrieval",
    protocol: run.scenario.presentationProtocol || "openid4vp",
    direction: "verifier-to-playground",
    initiatedBy: "playground",
    transactionId,
    requestId,
    durationMs: 0
  };

  try {
    const result = await getPresentationResult(
      verifierId,
      { transactionId }
    );
    const durationMs = Date.now() - startTime;

    if (!isValidVerificationResult(result, transactionId)) {
      const exchange = addExchange(req.params.runId, {
        ...eventBase,
        status: "ERROR",
        durationMs,
        error: "Inji Verify returned an invalid result response",
        diagnostic: { code: "INVALID_VERIFIER_RESULT" }
      });

      return res.status(502).json({
        success: false,
        pending: true,
        error: "Inji Verify returned an invalid result response",
        run: getSafeRunSummary(getRun(req.params.runId)),
        exchange
      });
    }

    const runWithResult = setRunVerificationResult(
      req.params.runId,
      {
        transactionId,
        allChecksSuccessful: result.allChecksSuccessful,
        credentialCount: result.credentialResults.length
      }
    );
    const resultStatus =
      result.allChecksSuccessful ? "PASS" : "FAIL";
    const exchange = addExchange(req.params.runId, {
      ...eventBase,
      status: "SUCCESS",
      resultStatus,
      durationMs,
      error: null
    });

    return res.json({
      success: true,
      pending: false,
      result: resultStatus,
      verificationResult: runWithResult.verificationResult,
      run: getSafeRunSummary(runWithResult),
      exchange
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorCode = getVerifierErrorCode(error);
    const upstreamStatus = error.response?.status || null;
    const errorDiagnostic = {
      code: errorCode || error.code || null,
      upstreamStatus
    };

    if (PENDING_RESULT_CODES.has(errorCode)) {
      const exchange = addExchange(req.params.runId, {
        ...eventBase,
        status: "PENDING",
        durationMs,
        diagnostic: errorDiagnostic,
        error: null
      });

      return res.status(202).json({
        success: true,
        pending: true,
        result: null,
        run: getSafeRunSummary(getRun(req.params.runId)),
        exchange
      });
    }

    if (REJECTED_PRESENTATION_CODES.has(errorCode)) {
      setRunVerificationFailure(
        req.params.runId,
        errorCode
      );
      const exchange = addExchange(req.params.runId, {
        ...eventBase,
        status: "FAILED",
        durationMs,
        diagnostic: errorDiagnostic,
        error: "Inji Verify rejected the submitted presentation"
      });

      return res.status(200).json({
        success: true,
        pending: false,
        result: "FAIL",
        errorCode,
        run: getSafeRunSummary(getRun(req.params.runId)),
        exchange
      });
    }

    if (
      upstreamStatus === 404 &&
      errorCode &&
      errorCode !== "INVALID_TRANSACTION_ID"
    ) {
      const exchange = addExchange(req.params.runId, {
        ...eventBase,
        status: "FAILED",
        durationMs,
        diagnostic: errorDiagnostic,
        error: "Inji Verify reported a wallet submission error"
      });

      return res.status(409).json({
        success: false,
        pending: false,
        result: null,
        errorCode,
        run: getRun(req.params.runId),
        exchange
      });
    }

    const exchange = addExchange(req.params.runId, {
      ...eventBase,
      status: "ERROR",
      durationMs,
      diagnostic: errorDiagnostic,
      error: "Verification result is unavailable"
    });

    return res.status(502).json({
      success: false,
      pending: true,
      error: "Verification result is unavailable",
      run: getSafeRunSummary(getRun(req.params.runId)),
      exchange
    });
  }
});

module.exports = router;