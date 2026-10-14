const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dataDir = path.resolve(__dirname, "../../data");
const runsFile = path.join(dataDir, "runs.json");
const issuanceTokens = new Map();
const credentialRequests = new Set();
const submittedCredentialRequests = new Set();

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(runsFile)) {
  fs.writeFileSync(runsFile, "{}", "utf8");
}

function loadRuns() {
  const data = fs.readFileSync(runsFile, "utf8");
  if (!data.trim()) {
    throw new Error(
      `Persisted run history at ${runsFile} is empty; refusing to load an empty history`
    );
  }

  try {
    const parsed = JSON.parse(data);
    validatePersistedRuns(parsed);
    let sanitized = false;

    for (const run of Object.values(parsed)) {
      sanitized = sanitizePersistedRun(run) || sanitized;
    }

    if (sanitized) {
      persistData(parsed);
    }

    return new Map(Object.entries(parsed));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Persisted run history at ${runsFile} is malformed JSON; refusing to load an empty history`
      );
    }

    throw error;
  }
}

function validatePersistedRuns(parsed) {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      `Persisted run history at ${runsFile} must be an object keyed by run ID`
    );
  }

  for (const [runId, run] of Object.entries(parsed)) {
    if (
      !run ||
      typeof run !== "object" ||
      Array.isArray(run) ||
      run.runId !== runId ||
      !Array.isArray(run.exchanges)
    ) {
      throw new Error(
        `Persisted run history at ${runsFile} contains an invalid record for ${runId}`
      );
    }
  }
}

function persistData(data) {
  const temporaryRunsFile = `${runsFile}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(
      temporaryRunsFile,
      JSON.stringify(data, null, 2),
      "utf8"
    );
    fs.renameSync(temporaryRunsFile, runsFile);
  } catch (error) {
    if (fs.existsSync(temporaryRunsFile)) {
      fs.unlinkSync(temporaryRunsFile);
    }
    throw error;
  }
}

function sanitizePersistedRun(run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    return false;
  }

  const sensitiveValues = new Set();

  function collectSensitiveValues(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");

      if (
        ["accesstoken", "refreshtoken"].includes(normalizedKey) &&
        typeof nestedValue === "string" &&
        nestedValue
      ) {
        sensitiveValues.add(nestedValue);
      }

      collectSensitiveValues(nestedValue);
    }
  }

  collectSensitiveValues(run);

  let changed = false;

  function removeSensitiveFields(value, isRunRoot = false) {
    if (!value || typeof value !== "object") {
      return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
      const isSensitiveField =
        ["accesstoken", "refreshtoken", "authorization"].includes(
          normalizedKey
        ) ||
        (isRunRoot && normalizedKey === "token");

      if (isSensitiveField) {
        delete value[key];
        changed = true;
        continue;
      }

      if (typeof nestedValue === "string") {
        let sanitizedValue = nestedValue;

        for (const sensitiveValue of sensitiveValues) {
          sanitizedValue = sanitizedValue
            .split(sensitiveValue)
            .join("[REDACTED]");
        }

        if (sanitizedValue !== nestedValue) {
          value[key] = sanitizedValue;
          changed = true;
        }
      } else {
        removeSensitiveFields(nestedValue);
      }
    }
  }

  removeSensitiveFields(run, true);

  return changed;
}

const runs = loadRuns();

function saveRuns(runCollection = runs) {
  const data = Object.fromEntries(runCollection);
  persistData(data);
}

function cloneRun(run) {
  return JSON.parse(JSON.stringify(run));
}

function commitRun(runId, updatedRun) {
  const updatedRuns = new Map(runs);
  updatedRuns.set(runId, updatedRun);
  saveRuns(updatedRuns);
  runs.set(runId, updatedRun);
  return updatedRun;
}

function createRun(config) {
  const runId = `RUN-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  issuanceTokens.delete(runId);
  credentialRequests.delete(runId);
  submittedCredentialRequests.delete(runId);

  const run = {
    runId,
    status: "IN_PROGRESS",
    createdAt: new Date().toISOString(),

    scenario: {
      issuer: config.issuer,
      credential: config.credential,
      format: config.format,
      issuanceFlow: config.issuanceFlow,
      wallet: config.wallet,
      verifier: config.verifier,
      presentationProtocol: config.presentationProtocol
    },

    exchanges: [],
    offer: null,
    presentationRequest: null,
    verificationStatus: null,
    verificationResult: null,
    result: null
  };

  const updatedRuns = new Map(runs);
  updatedRuns.set(runId, run);
  saveRuns(updatedRuns);
  runs.set(runId, run);

  return run;
}

function getRun(runId) {
  return runs.get(runId);
}

function listRuns() {
  return Array.from(runs.values())
    .map((run) => {
      const latestExchange = run.exchanges[run.exchanges.length - 1];
      const scenario = run.scenario || {};

      return {
        runId: run.runId,
        status: run.status,
        verificationStatus: run.verificationStatus || null,
        result: run.result || null,
        createdAt: run.createdAt,
        scenario: {
          issuer: scenario.issuer,
          credential: scenario.credential,
          wallet: scenario.wallet,
          verifier: scenario.verifier,
          format: scenario.format,
          issuanceFlow: scenario.issuanceFlow,
          presentationProtocol: scenario.presentationProtocol
        },
        exchangeCount: run.exchanges.length,
        latestExchange: latestExchange
          ? {
            step: latestExchange.step,
            timestamp: latestExchange.timestamp,
            componentId: latestExchange.componentId,
            protocolStep: latestExchange.protocolStep,
            status: latestExchange.status,
            error: latestExchange.error || null,
            diagnostic: latestExchange.diagnostic || null
          }
          : null
      };
    })
    .sort((left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt)
    );
}

function getExchangeComponentId(run, exchange) {
  const direction = exchange.direction || "";

  if (direction.includes("issuer")) {
    return run.scenario?.issuer || exchange.componentId || "playground";
  }

  if (direction.includes("wallet")) {
    return run.scenario?.wallet || exchange.componentId || "playground";
  }

  if (direction.includes("verifier")) {
    return run.scenario?.verifier || exchange.componentId || "playground";
  }

  return exchange.componentId || "playground";
}

function addExchange(runId, exchange) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const updatedRun = cloneRun(run);
  const recordedExchange = {
    ...exchange,
    step: updatedRun.exchanges.length + 1,
    timestamp: new Date().toISOString(),
    runId,
    componentId: getExchangeComponentId(updatedRun, exchange),
    protocolStep:
      exchange.protocolStep || exchange.stepName || "Unspecified"
  };
  sanitizePersistedRun(recordedExchange);
  updatedRun.exchanges.push(recordedExchange);

  if (recordedExchange.status === "FAILED") {
    updatedRun.status = "FAILED";
  }

  commitRun(runId, updatedRun);
  return recordedExchange;
}

function setRunOffer(runId, offer) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const updatedRun = cloneRun(run);
  updatedRun.offer = offer;
  updatedRun.issuanceStatus = null;
  updatedRun.credentialReceipt = null;
  issuanceTokens.delete(runId);
  credentialRequests.delete(runId);
  submittedCredentialRequests.delete(runId);
  return commitRun(runId, updatedRun);
}

function recordWalletCredentialReceipt(
  runId,
  { credentialConfigurationId, format }
) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (
    run.scenario?.wallet !== "inji-mobile" ||
    typeof credentialConfigurationId !== "string" ||
    !credentialConfigurationId.trim() ||
    typeof format !== "string" ||
    !format.trim()
  ) {
    throw new Error("A valid Inji Mobile credential receipt is required");
  }

  if (credentialConfigurationId !== run.scenario.credential) {
    throw new Error(
      "Credential configuration does not match the run's selected credential"
    );
  }

  if (run.scenario.format && format !== run.scenario.format) {
    throw new Error("Credential format does not match the run's format");
  }

  if (run.credentialReceipt) {
    if (
      run.credentialReceipt.credentialConfigurationId ===
        credentialConfigurationId &&
      run.credentialReceipt.format === format
    ) {
      return run.credentialReceipt;
    }
    throw new Error("A different credential receipt is already recorded");
  }

  const updatedRun = cloneRun(run);
  const receivedAt = new Date().toISOString();
  const recordedExchange = {
    step: updatedRun.exchanges.length + 1,
    timestamp: receivedAt,
    runId,
    componentId: run.scenario.wallet,
    protocolStep: "Wallet Credential Storage",
    stepName: "Wallet Credential Storage",
    protocol: "OpenID4VCI",
    direction: "wallet-to-playground",
    initiatedBy: "inji-mobile",
    status: "SUCCESS",
    credentialConfigurationId,
    format,
    durationMs: 0,
    error: null
  };

  updatedRun.issuanceStatus = "STORED";
  updatedRun.credentialReceipt = {
    issuer: run.scenario.issuer,
    wallet: run.scenario.wallet,
    credentialConfigurationId,
    format,
    receivedAt
  };
  updatedRun.exchanges.push(recordedExchange);
  commitRun(runId, updatedRun);
  return updatedRun.credentialReceipt;
}

function setRunIssuanceToken(runId, token) {
  if (!runs.has(runId)) {
    throw new Error(`Run not found: ${runId}`);
  }

  const now = Date.now();
  for (const [id, currentToken] of issuanceTokens) {
    if (currentToken.expiresAt && currentToken.expiresAt <= now) {
      issuanceTokens.delete(id);
    }
  }

  issuanceTokens.set(runId, {
    accessToken: token.accessToken,
    cNonce: token.cNonce || null,
    expiresAt: Number.isFinite(token.expiresIn) && token.expiresIn > 0
      ? now + token.expiresIn * 1000
      : null
  });
}

function clearRunIssuanceToken(runId) {
  issuanceTokens.delete(runId);
}

function getRunIssuanceToken(runId) {
  const token = issuanceTokens.get(runId);

  if (!token) {
    return null;
  }

  if (token.expiresAt && token.expiresAt <= Date.now()) {
    issuanceTokens.delete(runId);
    return null;
  }

  return { ...token };
}

function reserveRunCredentialRequest(runId) {
  if (
    credentialRequests.has(runId) ||
    submittedCredentialRequests.has(runId)
  ) {
    return false;
  }

  credentialRequests.add(runId);
  return true;
}

function releaseRunCredentialRequest(runId) {
  credentialRequests.delete(runId);
}

function completeRunCredentialRequest(runId) {
  credentialRequests.delete(runId);
  submittedCredentialRequests.add(runId);
  issuanceTokens.delete(runId);
}

function hasSubmittedRunCredentialRequest(runId) {
  return submittedCredentialRequests.has(runId);
}

function updateRunStatus(runId, status) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const updatedRun = cloneRun(run);
  updatedRun.status = status;
  return commitRun(runId, updatedRun);
}

function setRunPresentationRequest(
  runId,
  presentationRequest,
  clientId
) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (
    presentationRequest === undefined ||
    presentationRequest === null
  ) {
    throw new Error("presentationRequest is required");
  }

  if (
    typeof presentationRequest.requestId !== "string" ||
    !presentationRequest.requestId.trim() ||
    typeof presentationRequest.transactionId !== "string" ||
    !presentationRequest.transactionId.trim()
  ) {
    throw new Error(
      "presentationRequest must include Verify requestId and transactionId"
    );
  }

  const updatedRun = cloneRun(run);
  updatedRun.status = "IN_PROGRESS";
  updatedRun.verificationStatus = "PENDING";
  updatedRun.result = null;
  updatedRun.verificationResult = null;
  updatedRun.verificationFailure = null;
  const authorizationDetails =
    presentationRequest.authorizationDetails &&
    typeof presentationRequest.authorizationDetails === "object" &&
    !Array.isArray(presentationRequest.authorizationDetails)
      ? presentationRequest.authorizationDetails
      : {};
  updatedRun.presentationRequest = {
    verifierId: run.scenario.verifier,
    protocol: run.scenario.presentationProtocol || "openid4vp",
    createdAt: new Date().toISOString(),
    clientId,
    requestId:
      typeof presentationRequest.requestId === "string"
        ? presentationRequest.requestId
        : null,
    transactionId:
      typeof presentationRequest.transactionId === "string"
        ? presentationRequest.transactionId
        : null,
    requestUri:
      typeof presentationRequest.requestUri === "string"
        ? presentationRequest.requestUri
        : null,
    state:
      typeof authorizationDetails.state === "string"
        ? authorizationDetails.state
        : typeof presentationRequest.requestId === "string"
          ? presentationRequest.requestId
          : null,
    nonce:
      typeof authorizationDetails.nonce === "string"
        ? authorizationDetails.nonce
        : null,
    expiresAt: presentationRequest.expiresAt || null,
    authorizationRequest: presentationRequest
  };

  return commitRun(runId, updatedRun);
}

function setRunVerificationResult(
  runId,
  { transactionId, allChecksSuccessful, credentialCount }
) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (
    typeof transactionId !== "string" ||
    typeof allChecksSuccessful !== "boolean" ||
    !Number.isInteger(credentialCount) ||
    credentialCount < 0
  ) {
    throw new Error("A valid authoritative verification summary is required");
  }

  if (run.presentationRequest?.transactionId !== transactionId) {
    throw new Error(
      "Verification result transactionId does not match the run's Verify request"
    );
  }

  const updatedRun = cloneRun(run);
  updatedRun.verificationResult = {
    transactionId,
    allChecksSuccessful,
    credentialCount,
    retrievedAt: new Date().toISOString()
  };
  updatedRun.verificationStatus = allChecksSuccessful
    ? "VERIFIED"
    : "REJECTED";
  updatedRun.status = allChecksSuccessful ? "COMPLETED" : "FAILED";
  updatedRun.result = allChecksSuccessful ? "PASS" : "FAIL";

  return commitRun(runId, updatedRun);
}

function setRunVerificationStatus(runId, verificationStatus) {
  const allowedStatuses = new Set([
    "PENDING",
    "SUBMITTED",
    "VERIFIED",
    "REJECTED",
    "ERROR"
  ]);

  if (!allowedStatuses.has(verificationStatus)) {
    throw new Error("A valid verification lifecycle status is required");
  }

  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const updatedRun = cloneRun(run);
  updatedRun.verificationStatus = verificationStatus;

  return commitRun(runId, updatedRun);
}

function setRunVerificationFailure(runId, errorCode) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (typeof errorCode !== "string" || !errorCode.trim()) {
    throw new Error("A verifier failure code is required");
  }

  const updatedRun = cloneRun(run);
  updatedRun.verificationStatus = "REJECTED";
  updatedRun.status = "FAILED";
  updatedRun.result = "FAIL";
  updatedRun.verificationFailure = {
    code: errorCode,
    recordedAt: new Date().toISOString()
  };

  return commitRun(runId, updatedRun);
}

module.exports = {
  createRun,
  getRun,
  listRuns,
  addExchange,
  updateRunStatus,
  setRunOffer,
  recordWalletCredentialReceipt,
  setRunIssuanceToken,
  clearRunIssuanceToken,
  getRunIssuanceToken,
  reserveRunCredentialRequest,
  releaseRunCredentialRequest,
  completeRunCredentialRequest,
  hasSubmittedRunCredentialRequest,
  setRunPresentationRequest,
  setRunVerificationStatus,
  setRunVerificationResult,
  setRunVerificationFailure
};
