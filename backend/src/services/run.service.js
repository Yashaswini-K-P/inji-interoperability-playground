const crypto = require("crypto");

const runs = new Map();

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
      wallet: config.wallet
    },

    exchanges: [],
    offer: null
  };

  runs.set(runId, run);

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

  return recordedExchange;
}

function setRunOffer(runId, offer) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  run.offer = offer;

  return run;
}


function updateRunStatus(runId, status) {
  const run = runs.get(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  run.status = status;

  return run;
}

module.exports = {
  createRun,
  getRun,
  addExchange,
  updateRunStatus,
  setRunOffer
};