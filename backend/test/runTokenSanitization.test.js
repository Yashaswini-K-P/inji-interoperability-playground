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
const accessTokenValue = "legacy-access-token-do-not-leak";
const refreshTokenValue = "legacy-refresh-token-do-not-leak";
const temporaryRunsFile = `${runsFile}.${process.pid}.tmp`;
const legacyRunData = {
  "RUN-LEGACY-TOKEN": {
    runId: "RUN-LEGACY-TOKEN",
    status: "IN_PROGRESS",
    scenario: { issuer: "inji-certify" },
    token: {
      access_token: accessTokenValue,
      refresh_token: refreshTokenValue,
      token_type: "Bearer"
    },
    exchanges: [
      {
        step: 1,
        status: "FAILED",
        error: `Upstream included ${accessTokenValue}`,
        diagnostic: {
          headers: { Authorization: `Bearer ${accessTokenValue}` }
        }
      }
    ]
  }
};
let persistedRuns;

function isRunsFile(filePath) {
  return typeof filePath === "string" &&
    path.resolve(filePath) === runsFile;
}

fs.existsSync = (filePath) =>
  isRunsFile(filePath) || originalExistsSync(filePath);
fs.readFileSync = (filePath, ...args) =>
  isRunsFile(filePath)
    ? JSON.stringify(legacyRunData)
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

test("removes legacy tokens while preserving run history and sanitizing exchange data", () => {
  const run = runService.getRun("RUN-LEGACY-TOKEN");
  const persisted = JSON.parse(persistedRuns);
  const serializedRun = JSON.stringify(run);
  const serializedFile = JSON.stringify(persisted);

  assert.equal(persistedRuns !== undefined, true);
  assert.equal(run.runId, "RUN-LEGACY-TOKEN");
  assert.equal(run.status, "IN_PROGRESS");
  assert.deepEqual(run.scenario, { issuer: "inji-certify" });
  assert.equal(Object.hasOwn(run, "token"), false);
  assert.equal(run.exchanges[0].step, 1);
  assert.equal(run.exchanges[0].status, "FAILED");
  assert.equal(
    run.exchanges[0].error,
    "Upstream included [REDACTED]"
  );
  assert.equal(
    Object.hasOwn(run.exchanges[0].diagnostic.headers, "Authorization"),
    false
  );
  for (const output of [serializedRun, serializedFile]) {
    assert.equal(output.includes(accessTokenValue), false);
    assert.equal(output.includes(refreshTokenValue), false);
  }
  assert.equal(
    Object.hasOwn(persisted["RUN-LEGACY-TOKEN"], "scenario"),
    true
  );
});

test("new runs do not initialize a persistent token field", () => {
  const run = runService.createRun({
    issuer: "inji-certify",
    credential: "FarmerCredential",
    wallet: "inji-mobile",
    verifier: "inji-verify",
    presentationProtocol: "openid4vp"
  });

  assert.equal(Object.hasOwn(run, "token"), false);
  assert.equal(Object.hasOwn(JSON.parse(persistedRuns)[run.runId], "token"), false);
});

test("exchange writes strip token values and redact them from error text", () => {
  const run = runService.createRun({
    issuer: "inji-certify",
    credential: "FarmerCredential",
    wallet: "inji-mobile",
    verifier: "inji-verify",
    presentationProtocol: "openid4vp"
  });
  const exchange = runService.addExchange(run.runId, {
    stepName: "Token Request",
    status: "FAILED",
    access_token: accessTokenValue,
    refresh_token: refreshTokenValue,
    error: `Upstream echoed ${accessTokenValue}`
  });
  const saved = JSON.parse(persistedRuns)[run.runId];
  const serialized = JSON.stringify({ exchange, saved });

  assert.equal(Object.hasOwn(exchange, "access_token"), false);
  assert.equal(Object.hasOwn(exchange, "refresh_token"), false);
  assert.equal(exchange.error, "Upstream echoed [REDACTED]");
  assert.equal(serialized.includes(accessTokenValue), false);
  assert.equal(serialized.includes(refreshTokenValue), false);
});
