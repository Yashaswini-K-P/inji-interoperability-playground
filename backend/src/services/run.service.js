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
  return commitRun(runId, updatedRun);
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

  const updatedRun = cloneRun(run);
  updatedRun.status = "IN_PROGRESS";
  updatedRun.result = null;
  updatedRun.verificationResult = null;
  updatedRun.verificationFailure = null;
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

  const updatedRun = cloneRun(run);
  updatedRun.verificationResult = {
    transactionId,
    allChecksSuccessful,
    credentialCount,
    retrievedAt: new Date().toISOString()
  };
  updatedRun.status = allChecksSuccessful ? "COMPLETED" : "FAILED";
  updatedRun.result = allChecksSuccessful ? "PASS" : "FAIL";

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
  setRunPresentationRequest,
  setRunVerificationResult,
  setRunVerificationFailure
};
