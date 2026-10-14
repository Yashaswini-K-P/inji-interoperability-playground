const express = require("express");

const {
  getRun,
  addExchange,
  setRunPresentationRequest,
  setRunVerificationResult,
  setRunVerificationFailure,
} = require("../services/run.service");

const {
  createPresentationRequest,
  getVerifierClientId,
  getPresentationResult,
} = require("../services/verifier.service");

const router = express.Router();

const PENDING_RESULT_CODES = new Set([
  "NO_VP_SUBMISSION",
  "RESPONSE_CODE_NOT_USED",
]);

const REJECTED_PRESENTATION_CODES = new Set([
  "INVALID_VP_TOKEN",
  "TOKEN_MATCHING_FAILED",
  "VP_WITHOUT_PROOF",
]);

/**
 * Extract the error code returned by Inji Verify.
 */
function getVerifierErrorCode(error) {
  const responseData = error.response?.data;

  if (responseData && typeof responseData === "object") {
    return responseData.errorCode || responseData.code || null;
  }

  return null;
}

/**
 * Extract the transaction ID and request ID.
 */
function getResultRequest(run) {
  const request = run.presentationRequest;
  const authorizationRequest = request?.authorizationRequest;

  return {
    transactionId:
      request?.transactionId ||
      authorizationRequest?.transactionId ||
      null,

    requestId:
      request?.requestId ||
      authorizationRequest?.requestId ||
      null,
  };
}

/**
 * Return a safe summary of the run.
 */
function getSafeRunSummary(run) {
  if (!run) {
    return null;
  }

  return {
    runId: run.runId,
    status: run.status,
    result: run.result,
    verificationResult: run.verificationResult,
    verificationFailure: run.verificationFailure,
  };
}

/**
 * Validate the result returned by Inji Verify.
 */
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
    result.credentialResults.every(
      (credentialResult) =>
        credentialResult &&
        typeof credentialResult === "object" &&
        !Array.isArray(credentialResult) &&
        typeof credentialResult.allChecksSuccessful === "boolean"
    );

  return (
    credentialResultsAreValid &&
    result.allChecksSuccessful ===
      result.credentialResults.every(
        (credentialResult) =>
          credentialResult.allChecksSuccessful
      )
  );
}

/**
 * Create a presentation request using Inji Verify.
 *
 * POST /runs/:runId/request
 */
router.post("/runs/:runId/request", async (req, res) => {
  const startTime = Date.now();
  const runId = req.params.runId;

  // Diagnostic 1: confirm that the request reaches this route.
  console.log("VERIFY ROUTE HIT", {
    runId,
    bodyKeys: Object.keys(req.body || {}),
    hasDcqlQuery: Boolean(req.body?.dcqlQuery),
    hasPresentationDefinition: Boolean(
      req.body?.presentationDefinition
    ),
  });

  try {
    // Find the selected run.
    const run = getRun(runId);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: `Run not found: ${runId}`,
      });
    }

    // Get the verifier associated with this run.
    const verifierId = run.scenario.verifier;

    if (!verifierId) {
      return res.status(400).json({
        success: false,
        error: "No verifier selected for this run",
      });
    }

    // Get the configured Inji Verify client ID.
    const clientId = getVerifierClientId(verifierId);

    // Validate the client ID if the frontend supplied one.
    if (
      Object.prototype.hasOwnProperty.call(
        req.body || {},
        "clientId"
      ) &&
      req.body.clientId !== clientId
    ) {
      const error = new Error(
        "clientId must match the configured INJI_VERIFY_CLIENT_ID"
      );

      error.statusCode = 400;
      error.code = "VERIFIER_CLIENT_ID_MISMATCH";

      throw error;
    }

    // Read the DCQL query sent by the frontend.
    const dcqlQuery = req.body?.dcqlQuery;

    // Validate the DCQL query.
    if (
      !dcqlQuery ||
      typeof dcqlQuery !== "object" ||
      Array.isArray(dcqlQuery) ||
      !Array.isArray(dcqlQuery.credentials) ||
      dcqlQuery.credentials.length === 0
    ) {
      console.error("INVALID DCQL QUERY", {
        runId,
        receivedBodyKeys: Object.keys(req.body || {}),
        hasDcqlQuery: Boolean(dcqlQuery),
      });

      return res.status(400).json({
        success: false,
        error:
          "A valid dcqlQuery with a non-empty credentials array is required. Update the frontend to send dcqlQuery instead of presentationDefinition.",
      });
    }

    // Diagnostic 2: confirm that the adapter will be called.
    console.log("VERIFY ADAPTER CALL", {
      runId,
      verifierId,
      clientId,
      credentialQueryCount: dcqlQuery.credentials.length,
    });

    // Create the presentation request through the verifier service.
    const presentationRequest =
      await createPresentationRequest(verifierId, {
        clientId,
        dcqlQuery,
      });

    // Save the request against the current run.
    setRunPresentationRequest(
      runId,
      presentationRequest,
      clientId
    );

    const durationMs = Date.now() - startTime;

    // Record the successful exchange.
    const exchange = addExchange(runId, {
      stepName: "Presentation Request Creation",
      protocol: run.scenario.presentationProtocol || "openid4vp",
      direction: "playground-to-verifier",
      status: "SUCCESS",
      initiatedBy: "playground",

      transactionId:
        presentationRequest.transactionId ||
        presentationRequest.authorizationRequest?.transactionId ||
        null,

      requestId:
        presentationRequest.requestId ||
        presentationRequest.authorizationRequest?.requestId ||
        null,

      durationMs,
      error: null,
    });

    console.log("VERIFY REQUEST SUCCESS", {
      runId,
      durationMs,
    });

    return res.json({
      success: true,
      presentationRequest,
      exchange,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Diagnostic 3: display the actual error.
    console.error("VERIFY ROUTE ERROR", {
      message: error.message,
      code: error.code || null,
      statusCode: error.statusCode || null,
      upstreamStatus: error.response?.status || null,
      upstreamDetails: error.response?.data || null,
    });

    let exchange = null;

    // Attempt to record the failed exchange.
    try {
      exchange = addExchange(runId, {
        stepName: "Presentation Request Creation",
        protocol: "openid4vp",
        direction: "playground-to-verifier",
        status: "FAILED",
        initiatedBy: "playground",
        durationMs,
        error: error.message,

        diagnostic: {
          code: error.code || null,
          upstreamStatus: error.response?.status || null,
          upstreamDetails: error.response?.data || null,
        },
      });
    } catch (recordError) {
      console.error("FAILED TO RECORD VERIFY ERROR", {
        message: recordError.message,
      });
    }

    // Return an informative error to the frontend.
    const statusCode =
      error.statusCode ||
      (error.response?.status ? 502 : 500);

    return res.status(statusCode).json({
      success: false,
      error: error.message,

      diagnostic: {
        code: error.code || null,
        upstreamStatus: error.response?.status || null,
        upstreamDetails: error.response?.data || null,
      },

      ...(exchange ? { exchange } : {}),
    });
  }
});

/**
 * Retrieve the verification result from Inji Verify.
 *
 * GET /runs/:runId/result
 */
router.get("/runs/:runId/result", async (req, res) => {
  const startTime = Date.now();
  const runId = req.params.runId;

  const run = getRun(runId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: `Run not found: ${runId}`,
    });
  }

  // Retrieve the correlated transaction and request IDs.
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
        "A correlated Verify transaction and request ID are required before retrieving a result",
    });
  }

  const eventBase = {
    stepName: "Verification Result Retrieval",
    protocol: run.scenario.presentationProtocol || "openid4vp",
    direction: "verifier-to-playground",
    initiatedBy: "playground",
    transactionId,
    requestId,
    durationMs: 0,
  };

  try {
    console.log("RETRIEVING VERIFICATION RESULT", {
      runId,
      transactionId,
      requestId,
    });

    // Fetch the result from Inji Verify.
    const result = await getPresentationResult(verifierId, {
      transactionId,
    });

    const durationMs = Date.now() - startTime;

    // Validate the verification response.
    if (!isValidVerificationResult(result, transactionId)) {
      const exchange = addExchange(runId, {
        ...eventBase,
        status: "ERROR",
        durationMs,
        error: "Inji Verify returned an invalid result response",

        diagnostic: {
          code: "INVALID_VERIFIER_RESULT",
        },
      });

      return res.status(502).json({
        success: false,
        pending: true,
        error: "Inji Verify returned an invalid result response",
        run: getSafeRunSummary(getRun(runId)),
        exchange,
      });
    }

    // Save the verification result.
    const runWithResult = setRunVerificationResult(runId, {
      transactionId,
      allChecksSuccessful: result.allChecksSuccessful,
      credentialCount: result.credentialResults.length,
    });

    const resultStatus = result.allChecksSuccessful
      ? "PASS"
      : "FAIL";

    const exchange = addExchange(runId, {
      ...eventBase,
      status: "SUCCESS",
      resultStatus,
      durationMs,
      error: null,
    });

    console.log("VERIFICATION RESULT RECEIVED", {
      runId,
      result: resultStatus,
    });

    return res.json({
      success: true,
      pending: false,
      result: resultStatus,
      verificationResult: runWithResult.verificationResult,
      run: getSafeRunSummary(runWithResult),
      exchange,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorCode = getVerifierErrorCode(error);
    const upstreamStatus = error.response?.status || null;

    console.error("VERIFY RESULT ERROR", {
      message: error.message,
      code: error.code || null,
      upstreamStatus,
      upstreamDetails: error.response?.data || null,
    });

    const errorDiagnostic = {
      code: errorCode || error.code || null,
      upstreamStatus,
    };

    // The wallet has not submitted a presentation yet.
    if (PENDING_RESULT_CODES.has(errorCode)) {
      const exchange = addExchange(runId, {
        ...eventBase,
        status: "PENDING",
        durationMs,
        diagnostic: errorDiagnostic,
        error: null,
      });

      return res.status(202).json({
        success: true,
        pending: true,
        result: null,
        run: getSafeRunSummary(getRun(runId)),
        exchange,
      });
    }

    // The verifier explicitly rejected the presentation.
    if (REJECTED_PRESENTATION_CODES.has(errorCode)) {
      setRunVerificationFailure(runId, errorCode);

      const exchange = addExchange(runId, {
        ...eventBase,
        status: "FAILED",
        durationMs,
        diagnostic: errorDiagnostic,
        error:
          "Inji Verify rejected the submitted presentation",
      });

      return res.status(200).json({
        success: true,
        pending: false,
        result: "FAIL",
        errorCode,
        run: getSafeRunSummary(getRun(runId)),
        exchange,
      });
    }

    // Handle a reported wallet-submission error.
    if (
      upstreamStatus === 404 &&
      errorCode &&
      errorCode !== "INVALID_TRANSACTION_ID"
    ) {
      const exchange = addExchange(runId, {
        ...eventBase,
        status: "FAILED",
        durationMs,
        diagnostic: errorDiagnostic,
        error: "Inji Verify reported a wallet submission error",
      });

      return res.status(409).json({
        success: false,
        pending: false,
        result: null,
        errorCode,
        run: getSafeRunSummary(getRun(runId)),
        exchange,
      });
    }

    // Handle other result-retrieval errors.
    const exchange = addExchange(runId, {
      ...eventBase,
      status: "ERROR",
      durationMs,
      diagnostic: errorDiagnostic,
      error: "Verification result is unavailable",
    });

    return res.status(502).json({
      success: false,
      pending: true,
      error: "Verification result is unavailable",
      run: getSafeRunSummary(getRun(runId)),
      exchange,
    });
  }
});

module.exports = router;