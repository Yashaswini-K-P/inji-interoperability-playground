const express = require("express");

const {
  getRun,
  addExchange,
  setRunPresentationRequest,
  setRunVerificationStatus,
  setRunVerificationResult,
  setRunVerificationFailure,
} = require("../services/run.service");

const {
  createPresentationRequest,
  getVerifierClientId,
  getPresentationRequestStatus,
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
  "access_denied",
  "user_cancelled",
  "invalid_request",
]);

const RESULT_RETRY_DELAYS_MS = [150, 400];

function getVerifierErrorCode(error) {
  const responseData = error.response?.data;

  if (responseData && typeof responseData === "object") {
    const code = responseData.errorCode || responseData.code;
    return typeof code === "string" ? code : null;
  }

  return null;
}

function getSafeDiagnostic(error, errorCode = getVerifierErrorCode(error)) {
  const code = errorCode || error.code || null;
  const safeCode =
    typeof code === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(code)
      ? code
      : null;

  return {
    code: safeCode,
    upstreamStatus: Number.isInteger(error.response?.status)
      ? error.response.status
      : null,
  };
}

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

function getSafeRunSummary(run) {
  if (!run) {
    return null;
  }

  return {
    runId: run.runId,
    status: run.status,
    verificationStatus: run.verificationStatus || null,
    result: run.result,
    verificationResult: run.verificationResult,
    verificationFailure: run.verificationFailure,
  };
}

function isValidVerificationResult(result, transactionId) {
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
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

function isPresentationDefinition(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "string" &&
    value.id.trim() &&
    Array.isArray(value.input_descriptors) &&
    value.input_descriptors.length > 0 &&
    value.input_descriptors.every((descriptor) =>
      descriptor &&
      typeof descriptor === "object" &&
      !Array.isArray(descriptor) &&
      typeof descriptor.id === "string" &&
      descriptor.id.trim()
    )
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function recordPresentationRequestFailure(runId, run, error, startTime, res) {
  const diagnostic = getSafeDiagnostic(error);

  setRunVerificationStatus(runId, "ERROR");
  const exchange = addExchange(runId, {
    stepName: "Presentation Request Creation",
    protocol: run.scenario.presentationProtocol || "openid4vp",
    direction: "playground-to-verifier",
    status: "FAILED",
    initiatedBy: "playground",
    durationMs: Date.now() - startTime,
    error: error.statusCode
      ? error.message
      : "Inji Verify could not create the presentation request",
    diagnostic,
  });

  const statusCode =
    error.statusCode || (error.response?.status ? 502 : 503);

  return res.status(statusCode).json({
    success: false,
    error: error.statusCode
      ? error.message
      : "Inji Verify could not create the presentation request",
    errorCode: diagnostic.code,
    diagnostic,
    exchange,
  });
}

function recordResultError(
  runId,
  eventBase,
  error,
  startTime,
  res
) {
  const errorCode = getVerifierErrorCode(error);
  const diagnostic = getSafeDiagnostic(error, errorCode);
  const durationMs = Date.now() - startTime;

  if (PENDING_RESULT_CODES.has(errorCode)) {
    setRunVerificationStatus(runId, "SUBMITTED");
    const exchange = addExchange(runId, {
      ...eventBase,
      status: "PENDING",
      durationMs,
      diagnostic,
      error: null,
    });

    return res.status(202).json({
      success: true,
      pending: true,
      result: null,
      verificationStatus: "SUBMITTED",
      run: getSafeRunSummary(getRun(runId)),
      exchange,
    });
  }

  if (REJECTED_PRESENTATION_CODES.has(errorCode)) {
    setRunVerificationFailure(runId, errorCode);
    const exchange = addExchange(runId, {
      ...eventBase,
      status: "REJECTED",
      resultStatus: "FAIL",
      durationMs,
      diagnostic,
      error: "Inji Verify rejected the submitted presentation",
    });

    return res.json({
      success: true,
      pending: false,
      result: "FAIL",
      verificationStatus: "REJECTED",
      errorCode,
      run: getSafeRunSummary(getRun(runId)),
      exchange,
    });
  }

  const exchange = addExchange(runId, {
    ...eventBase,
    status: "ERROR",
    durationMs,
    diagnostic,
    error: "Verification result is unavailable",
  });
  setRunVerificationStatus(runId, "ERROR");

  return res.status(error.response?.status || 502).json({
    success: false,
    pending: false,
    result: null,
    verificationStatus: "ERROR",
    error: "Verification result is unavailable",
    errorCode: diagnostic.code,
    diagnostic,
    run: getSafeRunSummary(getRun(runId)),
    exchange,
  });
}

router.post("/runs/:runId/request", async (req, res) => {
  const startTime = Date.now();
  const runId = req.params.runId;
  const run = getRun(runId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: `Run not found: ${runId}`,
      errorCode: "RUN_NOT_FOUND",
    });
  }

  if (run.presentationRequest) {
    return res.status(409).json({
      success: false,
      error: "This run already has a Verify request; create a new run for another presentation",
      errorCode: "PRESENTATION_REQUEST_ALREADY_EXISTS",
      requestId: run.presentationRequest.requestId,
      transactionId: run.presentationRequest.transactionId,
    });
  }

  let verifierId;
  let clientId;
  let presentationDefinition;

  try {
    verifierId = run.scenario.verifier;

    if (!verifierId) {
      const error = new Error("No verifier selected for this run");
      error.code = "VERIFIER_NOT_SELECTED";
      error.statusCode = 400;
      throw error;
    }

    clientId = getVerifierClientId(verifierId);

    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, "clientId") &&
      req.body.clientId !== clientId
    ) {
      const error = new Error(
        "clientId must match the configured INJI_VERIFY_CLIENT_ID"
      );
      error.code = "VERIFIER_CLIENT_ID_MISMATCH";
      error.statusCode = 400;
      throw error;
    }

    presentationDefinition = req.body?.presentationDefinition;
    if (!isPresentationDefinition(presentationDefinition)) {
      const error = new Error(
        "A valid presentationDefinition with a non-empty input_descriptors array is required"
      );
      error.code = "INVALID_PRESENTATION_DEFINITION";
      error.statusCode = 400;
      throw error;
    }
  } catch (error) {
    return recordPresentationRequestFailure(
      runId,
      run,
      error,
      startTime,
      res
    );
  }

  let presentationRequest;

  try {
    presentationRequest = await createPresentationRequest(
      verifierId,
      { clientId, presentationDefinition }
    );
  } catch (error) {
    return recordPresentationRequestFailure(
      runId,
      run,
      error,
      startTime,
      res
    );
  }

  setRunPresentationRequest(runId, presentationRequest, clientId);

  const exchange = addExchange(runId, {
    stepName: "Presentation Request Creation",
    protocol: run.scenario.presentationProtocol || "openid4vp",
    direction: "playground-to-verifier",
    status: "SUCCESS",
    initiatedBy: "playground",
    transactionId: presentationRequest.transactionId,
    requestId: presentationRequest.requestId,
    durationMs: Date.now() - startTime,
    error: null,
  });

  return res.json({
    success: true,
    presentationRequest,
    verificationStatus: "PENDING",
    exchange,
  });
});

router.get("/runs/:runId/result", async (req, res) => {
  const startTime = Date.now();
  const runId = req.params.runId;
  const run = getRun(runId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: `Run not found: ${runId}`,
      errorCode: "RUN_NOT_FOUND",
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
        "A correlated Verify transaction and request ID are required before retrieving a result",
      errorCode: "VERIFY_REQUEST_NOT_AVAILABLE",
    });
  }

  if (
    run.verificationStatus === "VERIFIED" ||
    run.verificationStatus === "REJECTED"
  ) {
    return res.json({
      success: true,
      pending: false,
      result: run.result || null,
      verificationStatus: run.verificationStatus,
      verificationResult: run.verificationResult,
      run: getSafeRunSummary(run),
      exchange: null,
    });
  }

  const eventBase = {
    stepName: "Verification Result Retrieval",
    protocol: run.scenario.presentationProtocol || "openid4vp",
    direction: "verifier-to-playground",
    initiatedBy: "playground",
    transactionId,
    requestId,
  };

  let requestStatus;
  try {
    requestStatus = await getPresentationRequestStatus(
      verifierId,
      { requestId }
    );
  } catch (error) {
    return recordResultError(
      runId,
      eventBase,
      error,
      startTime,
      res
    );
  }

  if (requestStatus.status === "ACTIVE") {
    setRunVerificationStatus(runId, "PENDING");
    const exchange = addExchange(runId, {
      ...eventBase,
      status: "PENDING",
      durationMs: Date.now() - startTime,
      diagnostic: {
        code: "VERIFY_REQUEST_ACTIVE",
        requestStatus: "ACTIVE",
      },
      error: null,
    });

    return res.status(202).json({
      success: true,
      pending: true,
      result: null,
      verificationStatus: "PENDING",
      run: getSafeRunSummary(getRun(runId)),
      exchange,
    });
  }

  if (requestStatus.status === "EXPIRED") {
    setRunVerificationStatus(runId, "ERROR");
    const exchange = addExchange(runId, {
      ...eventBase,
      status: "ERROR",
      durationMs: Date.now() - startTime,
      diagnostic: { code: "VERIFY_REQUEST_EXPIRED" },
      error: "The Inji Verify presentation request expired",
    });

    return res.status(410).json({
      success: false,
      pending: false,
      result: null,
      verificationStatus: "ERROR",
      error: "The Inji Verify presentation request expired; create a new run and request",
      errorCode: "VERIFY_REQUEST_EXPIRED",
      run: getSafeRunSummary(getRun(runId)),
      exchange,
    });
  }

  setRunVerificationStatus(runId, "SUBMITTED");
  const submissionExchange = addExchange(runId, {
    ...eventBase,
    stepName: "Wallet Presentation Submission",
    status: "SUBMITTED",
    durationMs: Date.now() - startTime,
    error: null,
  });

  let result;

  for (
    let attempt = 0;
    attempt <= RESULT_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      result = await getPresentationResult(verifierId, {
        transactionId,
      });
      break;
    } catch (error) {
      if (
        getVerifierErrorCode(error) !== "NO_VP_SUBMISSION" ||
        attempt === RESULT_RETRY_DELAYS_MS.length
      ) {
        return recordResultError(
          runId,
          eventBase,
          error,
          startTime,
          res
        );
      }

      await wait(RESULT_RETRY_DELAYS_MS[attempt]);
    }
  }

  if (!isValidVerificationResult(result, transactionId)) {
    setRunVerificationStatus(runId, "ERROR");
    const exchange = addExchange(runId, {
      ...eventBase,
      status: "ERROR",
      durationMs: Date.now() - startTime,
      diagnostic: { code: "INVALID_VERIFIER_RESULT" },
      error: "Inji Verify returned a malformed verification result",
    });

    return res.status(502).json({
      success: false,
      pending: false,
      result: null,
      verificationStatus: "ERROR",
      error: "Inji Verify returned a malformed verification result",
      errorCode: "INVALID_VERIFIER_RESULT",
      run: getSafeRunSummary(getRun(runId)),
      exchange,
    });
  }

  const runWithResult = setRunVerificationResult(runId, {
    transactionId,
    allChecksSuccessful: result.allChecksSuccessful,
    credentialCount: result.credentialResults.length,
  });
  const resultStatus = result.allChecksSuccessful ? "PASS" : "FAIL";
  const verificationStatus = result.allChecksSuccessful
    ? "VERIFIED"
    : "REJECTED";
  const exchange = addExchange(runId, {
    ...eventBase,
    status: verificationStatus,
    resultStatus,
    durationMs: Date.now() - startTime,
    error: null,
  });

  return res.json({
    success: true,
    pending: false,
    result: resultStatus,
    verificationStatus,
    verificationResult: runWithResult.verificationResult,
    run: getSafeRunSummary(runWithResult),
    exchange,
    submissionExchange,
  });
});

module.exports = router;
