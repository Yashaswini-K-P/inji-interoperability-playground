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
const originalRenameSync = fs.renameSync;
const temporaryRunsFile = `${runsFile}.${process.pid}.tmp`;
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
  if (isRunsFile(filePath) || filePath === temporaryRunsFile) {
    persistedRuns = data;
    return;
  }

  return originalWriteFileSync(filePath, data, ...args);
};
fs.renameSync = (source, destination) => {
  if (source === temporaryRunsFile && isRunsFile(destination)) {
    return;
  }

  return originalRenameSync(source, destination);
};

delete require.cache[servicePath];
const runService = require(servicePath);

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

test("keeps prepared wallet handoffs in progress and marks failed steps failed", () => {
  const run = runService.createRun({
    issuer: "inji-certify",
    credential: "credential",
    wallet: "inji-mobile",
    verifier: "inji-verify",
    presentationProtocol: "openid4vp"
  });

  test("persists a correlated wallet receipt without storing credential contents", () => {
    const run = runService.createRun({
      issuer: "inji-certify",
      credential: "employee_sd_jwt",
      format: "vc+sd-jwt",
      wallet: "inji-mobile",
      verifier: "inji-verify",
      presentationProtocol: "openid4vp"
    });

    const receipt = runService.recordWalletCredentialReceipt(run.runId, {
      credentialConfigurationId: "employee_sd_jwt",
      format: "vc+sd-jwt"
    });
    const updatedRun = runService.getRun(run.runId);
    const persistedRun = JSON.parse(persistedRuns)[run.runId];

    assert.equal(receipt.issuer, "inji-certify");
    assert.equal(receipt.wallet, "inji-mobile");
    assert.equal(receipt.credentialConfigurationId, "employee_sd_jwt");
    assert.equal(updatedRun.issuanceStatus, "STORED");
    assert.equal(updatedRun.status, "IN_PROGRESS");
    assert.equal(updatedRun.exchanges[0].status, "SUCCESS");
    assert.equal(updatedRun.exchanges[0].runId, run.runId);
    assert.equal(persistedRun.issuanceStatus, "STORED");
    assert.equal(JSON.stringify(persistedRun).includes("credentialJwt"), false);
    assert.equal(JSON.stringify(persistedRun).includes("accessToken"), false);
    assert.throws(
      () =>
        runService.recordWalletCredentialReceipt(run.runId, {
          credentialConfigurationId: "different-credential",
          format: "vc+sd-jwt"
        }),
      /does not match/
    );
  });

  assert.equal(run.status, "IN_PROGRESS");
  assert.equal(run.verificationStatus, null);

  const readyStep = runService.addExchange(run.runId, {
    stepName: "Wallet Handoff",
    protocol: "OpenID4VCI",
    direction: "playground-to-wallet",
    status: "PENDING_EXTERNAL_ACTION",
    handoffStatus: "PREPARED"
  });

  assert.equal(readyStep.timestamp.length > 0, true);
  assert.equal(readyStep.runId, run.runId);
  assert.equal(readyStep.componentId, "inji-mobile");
  assert.equal(readyStep.protocolStep, "Wallet Handoff");
  assert.equal(readyStep.status, "PENDING_EXTERNAL_ACTION");
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

  runService.setRunPresentationRequest(
    run.runId,
    {
      requestId: "req-live",
      transactionId: "txn-live",
      authorizationDetails: {
        clientId: "did:web:verify.example",
        responseType: "vp_token"
      }
    },
    "did:web:verify.example"
  );
  assert.equal(
    runService.getRun(run.runId).presentationRequest.state,
    "req-live"
  );
  assert.equal(
    runService.getRun(run.runId).presentationRequest.nonce,
    null
  );
  runService.addExchange(run.runId, {
    stepName: "Presentation Request Creation",
    status: "SUCCESS",
    requestId: "req-live",
    transactionId: "txn-live"
  });

  const recoveredRun = runService.getRun(run.runId);
  const persistedRun = JSON.parse(persistedRuns)[run.runId];
  assert.equal(recoveredRun.status, "IN_PROGRESS");
  assert.equal(recoveredRun.verificationStatus, "PENDING");
  assert.equal(recoveredRun.result, null);
  assert.equal(recoveredRun.verificationResult, null);
  assert.equal(recoveredRun.exchanges.length, 3);
  assert.equal(recoveredRun.exchanges[1].status, "FAILED");
  assert.equal(recoveredRun.exchanges[2].status, "SUCCESS");
  assert.equal(recoveredRun.exchanges[2].requestId, "req-live");
  assert.equal(recoveredRun.exchanges[2].transactionId, "txn-live");
  assert.equal(persistedRun.status, "IN_PROGRESS");
  assert.equal(persistedRun.presentationRequest.requestId, "req-live");
  assert.equal(
    persistedRun.presentationRequest.transactionId,
    "txn-live"
  );
  assert.equal(persistedRun.exchanges[1].status, "FAILED");
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
  assert.throws(
    () => runService.setRunVerificationResult(run.runId, {
      transactionId: "txn-from-another-run",
      allChecksSuccessful: true,
      credentialCount: 1
    }),
    /does not match the run's Verify request/
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
  assert.equal(resultRun.verificationStatus, "VERIFIED");
  assert.equal(resultRun.result, "PASS");
  const persistedRun = JSON.parse(persistedRuns)[run.runId];
  assert.equal(
    persistedRun.presentationRequest.requestId,
    "req-lifecycle"
  );
  assert.equal(
    persistedRun.presentationRequest.transactionId,
    "txn-lifecycle"
  );
  assert.deepEqual(
    resultRun.verificationResult,
    persistedRun.verificationResult
  );
});

test("persists DID request URI, request/transaction IDs, state, nonce and run correlation", () => {
  const run = runService.createRun({
    issuer: "inji-certify",
    credential: "credential",
    wallet: "inji-mobile",
    verifier: "inji-verify",
    presentationProtocol: "openid4vp"
  });
  const request = {
    requestId: "req-correlated",
    transactionId: "txn-correlated",
    requestUri: "https://verify.example/v1/verify/vp-request/req-correlated",
    expiresAt: 1900000000000,
    authorizationDetails: {
      state: "explicit-state",
      nonce: "signed-request-nonce"
    }
  };

  const updatedRun = runService.setRunPresentationRequest(
    run.runId,
    request,
    "did:web:verify.example"
  );

  assert.equal(updatedRun.presentationRequest.requestId, "req-correlated");
  assert.equal(updatedRun.presentationRequest.transactionId, "txn-correlated");
  assert.equal(updatedRun.presentationRequest.requestUri, request.requestUri);
  assert.equal(updatedRun.presentationRequest.state, "explicit-state");
  assert.equal(updatedRun.presentationRequest.nonce, "signed-request-nonce");
  assert.equal(updatedRun.presentationRequest.expiresAt, request.expiresAt);
  assert.equal(updatedRun.presentationRequest.verifierId, "inji-verify");
  assert.equal(updatedRun.verificationStatus, "PENDING");
  const persistedRun = JSON.parse(persistedRuns)[run.runId];
  assert.equal(persistedRun.presentationRequest.transactionId, "txn-correlated");
  assert.equal(persistedRun.presentationRequest.requestUri, request.requestUri);
});

test("records verifier failures with a safe diagnostic and component identity", () => {
  const run = runService.createRun({
    issuer: "inji-certify",
    credential: "credential",
    wallet: "inji-mobile",
    verifier: "inji-verify",
    presentationProtocol: "openid4vp"
  });
  const exchange = runService.addExchange(run.runId, {
    stepName: "Verification Result Retrieval",
    protocol: "openid4vp",
    direction: "verifier-to-playground",
    status: "ERROR",
    diagnostic: {
      code: "NO_VP_SUBMISSION",
      upstreamStatus: 404,
      retryable: true
    },
    error: null
  });
  const saved = JSON.parse(persistedRuns)[run.runId].exchanges[0];

  assert.equal(exchange.runId, run.runId);
  assert.equal(exchange.componentId, "inji-verify");
  assert.equal(
    exchange.protocolStep,
    "Verification Result Retrieval"
  );
  assert.equal(exchange.status, "ERROR");
  assert.deepEqual(saved.diagnostic, {
    code: "NO_VP_SUBMISSION",
    upstreamStatus: 404,
    retryable: true
  });
  assert.equal(runService.getRun(run.runId).status, "IN_PROGRESS");
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
  assert.equal(resultRun.verificationStatus, "REJECTED");
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
