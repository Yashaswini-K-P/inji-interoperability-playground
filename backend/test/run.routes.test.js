const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");
const test = require("node:test");

const runServicePath = require.resolve("../src/services/run.service");
const routePath = require.resolve("../src/routes/run.routes");
const originalRunService = require.cache[runServicePath];
let server;
let baseUrl;

const storedRun = {
  runId: "RUN-SECRET-TEST",
  status: "IN_PROGRESS",
  token: {
    access_token: "sensitive-access-token",
    refresh_token: "sensitive-refresh-token",
    token_type: "Bearer"
  },
  scenario: {
    wallet: "inji-mobile"
  },
  exchanges: []
};

const runServiceMock = {
  getRun: () => storedRun,
  listRuns: () => [
    {
      runId: storedRun.runId,
      status: storedRun.status,
      result: null,
      exchangeCount: storedRun.exchanges.length
    }
  ],
  createRun: () => storedRun
};

test.before(async () => {
  const mockedModule = new Module(runServicePath);
  mockedModule.filename = runServicePath;
  mockedModule.loaded = true;
  mockedModule.exports = runServiceMock;
  require.cache[runServicePath] = mockedModule;
  delete require.cache[routePath];
  const runRoutes = require(routePath);

  if (originalRunService) {
    require.cache[runServicePath] = originalRunService;
  } else {
    delete require.cache[runServicePath];
  }

  const app = express();
  app.use("/api/runs", runRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test("lists run-history summaries without exposing tokens", async () => {
  const response = await fetch(`${baseUrl}/api/runs`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.runs, [
    {
      runId: "RUN-SECRET-TEST",
      status: "IN_PROGRESS",
      result: null,
      exchangeCount: 0
    }
  ]);
  assert.equal(JSON.stringify(body).includes("sensitive-access-token"), false);
  assert.equal(JSON.stringify(body).includes("sensitive-refresh-token"), false);
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("does not expose the persisted access token in run details", async () => {
  const response = await fetch(
    `${baseUrl}/api/runs/RUN-SECRET-TEST`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.run.runId, "RUN-SECRET-TEST");
  assert.equal(Object.hasOwn(body.run, "token"), false);
  assert.equal(
    JSON.stringify(body).includes("sensitive-access-token"),
    false
  );
  assert.equal(
    JSON.stringify(body).includes("sensitive-refresh-token"),
    false
  );
  assert.equal(storedRun.token.access_token, "sensitive-access-token");
});

test("rejects caller-authored exchange events that could fake protocol success", async () => {
  const response = await fetch(
    `${baseUrl}/api/runs/RUN-SECRET-TEST/exchanges`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stepName: "Credential Received",
        componentId: "inji-mobile",
        status: "SUCCESS"
      })
    }
  );
  const body = await response.json();

  assert.equal(response.status, 405);
  assert.equal(body.errorCode, "EXCHANGE_WRITE_UNSUPPORTED");
  assert.deepEqual(storedRun.exchanges, []);
});
