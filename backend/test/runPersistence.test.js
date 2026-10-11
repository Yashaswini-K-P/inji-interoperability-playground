const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const servicePath = require.resolve("../src/services/run.service");
const runsFile = path.resolve(__dirname, "../data/runs.json");
const temporaryRunsFile = `${runsFile}.${process.pid}.tmp`;
const originalModule = require.cache[servicePath];
const originalExistsSync = fs.existsSync;
const originalReadFileSync = fs.readFileSync;
const originalWriteFileSync = fs.writeFileSync;
const originalRenameSync = fs.renameSync;
let persistedData = "{}";
let temporaryData;

function isRunsFile(filePath) {
  return typeof filePath === "string" &&
    path.resolve(filePath) === runsFile;
}

fs.existsSync = (filePath) =>
  isRunsFile(filePath) ||
  filePath === temporaryRunsFile ||
  originalExistsSync(filePath);
fs.readFileSync = (filePath, ...args) =>
  isRunsFile(filePath)
    ? persistedData
    : originalReadFileSync(filePath, ...args);
fs.writeFileSync = (filePath, data, ...args) => {
  if (filePath === temporaryRunsFile) {
    temporaryData = data;
    return;
  }

  return originalWriteFileSync(filePath, data, ...args);
};
fs.renameSync = (source, destination) => {
  if (source === temporaryRunsFile && isRunsFile(destination)) {
    persistedData = temporaryData;
    temporaryData = undefined;
    return;
  }

  return originalRenameSync(source, destination);
};

function reloadRunService() {
  delete require.cache[servicePath];
  return require(servicePath);
}

test.after(() => {
  fs.existsSync = originalExistsSync;
  fs.readFileSync = originalReadFileSync;
  fs.writeFileSync = originalWriteFileSync;
  fs.renameSync = originalRenameSync;

  if (originalModule) {
    require.cache[servicePath] = originalModule;
  } else {
    delete require.cache[servicePath];
  }
});

test("restores run status and structured exchange history after reload", () => {
  const firstService = reloadRunService();
  const run = firstService.createRun({
    issuer: "inji-certify",
    credential: "FarmerCredential",
    format: "ldp_vc",
    issuanceFlow: "pre-authorized",
    wallet: "inji-mobile",
    verifier: "inji-verify",
    presentationProtocol: "openid4vp"
  });

  firstService.addExchange(run.runId, {
    stepName: "Wallet Handoff",
    protocol: "OpenID4VCI",
    direction: "playground-to-wallet",
    status: "READY",
    handoffStatus: "PREPARED"
  });
  firstService.addExchange(run.runId, {
    stepName: "Verification Result Retrieval",
    protocol: "openid4vp",
    direction: "verifier-to-playground",
    status: "PENDING",
    diagnostic: {
      code: "NO_VP_SUBMISSION",
      retryable: true
    }
  });

  const restoredService = reloadRunService();
  const restoredRun = restoredService.getRun(run.runId);

  assert.equal(restoredRun.status, "IN_PROGRESS");
  assert.equal(restoredRun.result, null);
  assert.equal(restoredRun.exchanges.length, 2);
  assert.equal(restoredRun.exchanges[0].componentId, "inji-mobile");
  assert.equal(restoredRun.exchanges[0].protocolStep, "Wallet Handoff");
  assert.equal(restoredRun.exchanges[1].componentId, "inji-verify");
  assert.equal(restoredRun.exchanges[1].status, "PENDING");
  assert.deepEqual(restoredRun.exchanges[1].diagnostic, {
    code: "NO_VP_SUBMISSION",
    retryable: true
  });

  const [summary] = restoredService.listRuns();
  assert.equal(summary.runId, run.runId);
  assert.equal(summary.status, "IN_PROGRESS");
  assert.equal(summary.exchangeCount, 2);
  assert.equal(summary.latestExchange.componentId, "inji-verify");
  assert.equal(summary.latestExchange.status, "PENDING");
  assert.equal(summary.latestExchange.diagnostic.retryable, true);
});

test("refuses malformed persisted history without replacing it with empty history", () => {
  const malformedData = "{ not valid JSON";
  persistedData = malformedData;

  assert.throws(
    () => reloadRunService(),
    /malformed JSON; refusing to load an empty history/
  );
  assert.equal(persistedData, malformedData);

  const invalidRecords = JSON.stringify({
    "RUN-MISMATCH": {
      runId: "RUN-OTHER",
      exchanges: []
    }
  });
  persistedData = invalidRecords;

  assert.throws(
    () => reloadRunService(),
    /contains an invalid record for RUN-MISMATCH/
  );
  assert.equal(persistedData, invalidRecords);
});
