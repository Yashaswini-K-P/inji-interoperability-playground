const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dataDir = path.resolve(__dirname, "../../data");
const runsFile = path.join(dataDir, "runs.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(runsFile)) {
  fs.writeFileSync(runsFile, "{}", "utf8");
}

function loadRuns() {
  try {
    const data = fs.readFileSync(runsFile, "utf8");

    if (!data.trim()) {
      return new Map();
    }

    const parsed = JSON.parse(data);

    return new Map(Object.entries(parsed));
  } catch (error) {
    console.error("Failed to load runs:", error.message);
    return new Map();
  }
}

const runs = loadRuns();

function saveRuns() {
  const data = Object.fromEntries(runs);

  fs.writeFileSync(
    runsFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function createRun(config) {
  const runId = `RUN-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

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
    token: null,
    presentationRequest: null,
    verificationResult: null,
    result: null
  };

  runs.set(runId, run);
  saveRuns();

  return run;
}

function getRun(runId) {
  return runs.get(runId);
}

function addExchange(runId, exchange) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const recordedExchange = {
    step: run.exchanges.length + 1,
    timestamp: new Date().toISOString(),
    ...exchange
  };

  run.exchanges.push(recordedExchange);

  if (recordedExchange.status === "FAILED") {
    run.status = "FAILED";
  }

  saveRuns();

  return recordedExchange;
}

function setRunOffer(runId, offer) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  run.offer = offer;

  saveRuns();

  return run;
}

function setRunToken(runId, token) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  run.token = token;

  saveRuns();

  return run;
}

function updateRunStatus(runId, status) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  run.status = status;

  saveRuns();

  return run;
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

  run.presentationRequest = {
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
    authorizationRequest: presentationRequest
  };

  saveRuns();

  return run;
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

  run.verificationResult = {
    transactionId,
    allChecksSuccessful,
    credentialCount,
    retrievedAt: new Date().toISOString()
  };
  run.status = allChecksSuccessful ? "COMPLETED" : "FAILED";
  run.result = allChecksSuccessful ? "PASS" : "FAIL";

  saveRuns();

  return run;
}

function setRunVerificationFailure(runId, errorCode) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (typeof errorCode !== "string" || !errorCode.trim()) {
    throw new Error("A verifier failure code is required");
  }

  run.status = "FAILED";
  run.result = "FAIL";
  run.verificationFailure = {
    code: errorCode,
    recordedAt: new Date().toISOString()
  };

  saveRuns();

  return run;
}

module.exports = {
  createRun,
  getRun,
  addExchange,
  updateRunStatus,
  setRunOffer,
  setRunToken,
  setRunPresentationRequest,
  setRunVerificationResult,
  setRunVerificationFailure
};
