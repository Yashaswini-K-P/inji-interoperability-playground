const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const servicePath = require.resolve("../src/services/run.service");
const runsFile = path.resolve(__dirname, "../data/runs.json");
const originalModule = require.cache[servicePath];
const originalExistsSync = fs.existsSync;
const originalReadFileSync = fs.readFileSync;
const originalWriteFileSync = fs.writeFileSync;
let persistedRuns;

function isRunsFile(filePath) {
  return typeof filePath === "string" &&
    path.resolve(filePath) === runsFile;
}

fs.existsSync = (filePath) =>
  isRunsFile(filePath) || originalExistsSync(filePath);
fs.readFileSync = (filePath, ...args) =>
  isRunsFile(filePath)
    ? "{}"
    : originalReadFileSync(filePath, ...args);
fs.writeFileSync = (filePath, data, ...args) => {
  if (isRunsFile(filePath)) {
    persistedRuns = data;
    return;
  }

  return originalWriteFileSync(filePath, data, ...args);
};

delete require.cache[servicePath];
const runService = require(servicePath);

test.after(() => {
  fs.existsSync = originalExistsSync;
  fs.readFileSync = originalReadFileSync;
  fs.writeFileSync = originalWriteFileSync;

  if (originalModule) {
    require.cache[servicePath] = originalModule;
  } else {
    delete require.cache[servicePath];
  }
});

test("keeps prepared wallet handoffs in progress and marks failed steps failed", () => {
  const run = runService.createRun({
    issuer: "inji-certify",
    credential: "credential",
    wallet: "inji-mobile",
    verifier: "inji-verify",
    presentationProtocol: "openid4vp"
  });

  assert.equal(run.status, "IN_PROGRESS");

  const readyStep = runService.addExchange(run.runId, {
    stepName: "Wallet Handoff",
    protocol: "OpenID4VCI",
    status: "READY"
  });

  assert.equal(readyStep.timestamp.length > 0, true);
  assert.equal(runService.getRun(run.runId).status, "IN_PROGRESS");
  assert.equal(runService.getRun(run.runId).exchanges.length, 1);

  runService.addExchange(run.runId, {
    stepName: "Presentation Request Creation",
    status: "FAILED",
    error: "Verifier unavailable"
  });

  assert.equal(runService.getRun(run.runId).status, "FAILED");
  assert.equal(
    JSON.parse(persistedRuns)[run.runId].status,
    "FAILED"
  );
});

test("stores only the authoritative verification summary and sets the terminal PASS state", () => {
  const run = runService.createRun({
    issuer: "inji-certify",
    credential: "credential",
    wallet: "inji-mobile",
    verifier: "inji-verify",
    presentationProtocol: "openid4vp"
  });

  runService.setRunPresentationRequest(
    run.runId,
    {
      transactionId: "txn-lifecycle",
      requestId: "req-lifecycle"
    },
    "did:web:verify.example"
  );
  const resultRun = runService.setRunVerificationResult(
    run.runId,
    {
      transactionId: "txn-lifecycle",
      allChecksSuccessful: true,
      credentialCount: 1
    }
  );

  assert.equal(
    resultRun.presentationRequest.transactionId,
    "txn-lifecycle"
  );
  assert.equal(resultRun.presentationRequest.requestId, "req-lifecycle");
  assert.equal(resultRun.status, "COMPLETED");
  assert.equal(resultRun.result, "PASS");
  assert.deepEqual(
    resultRun.verificationResult,
    JSON.parse(persistedRuns)[run.runId].verificationResult
  );
});

test("stores a verifier-confirmed presentation rejection without credential data", () => {
  const run = runService.createRun({
    issuer: "inji-certify",
    credential: "credential",
    wallet: "inji-mobile",
    verifier: "inji-verify",
    presentationProtocol: "openid4vp"
  });

  const resultRun = runService.setRunVerificationFailure(
    run.runId,
    "INVALID_VP_TOKEN"
  );

  assert.equal(resultRun.status, "FAILED");
  assert.equal(resultRun.result, "FAIL");
  assert.deepEqual(resultRun.verificationFailure, {
    code: "INVALID_VP_TOKEN",
    recordedAt: resultRun.verificationFailure.recordedAt
  });
  assert.equal(
    JSON.parse(persistedRuns)[run.runId].verificationResult,
    null
  );
});
