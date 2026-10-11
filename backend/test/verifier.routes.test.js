const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");
const test = require("node:test");

const runServicePath = require.resolve(
  "../src/services/run.service"
);
const verifierServicePath = require.resolve(
  "../src/services/verifier.service"
);
const routePath = require.resolve(
  "../src/routes/verifier.routes"
);

let currentRun;
let exchanges;
let server;
let baseUrl;
let configuredClientId;
let createRequestCalls;
let savedRequest;

const runServiceMock = {
  getRun: () => currentRun,
  addExchange: (runId, exchange) => {
    const recordedExchange = {
      step: exchanges.length + 1,
      ...exchange
    };
    exchanges.push(recordedExchange);
    return recordedExchange;
  },
  setRunPresentationRequest: (runId, presentationRequest, clientId) => {
    savedRequest = {
      runId,
      presentationRequest,
      clientId
    };
  }
};

const verifierServiceMock = {
  getVerifierClientId: () => {
    if (!configuredClientId) {
      const error = new Error(
        "INJI_VERIFY_CLIENT_ID must be configured"
      );
      error.statusCode = 503;
      throw error;
    }
    return configuredClientId;
  },
  createPresentationRequest: async (verifierId, data) => {
    createRequestCalls.push({ verifierId, data });
    return {
      requestId: "req-mocked",
      authorizationDetails: {
        clientId: data.clientId,
        responseType: "vp_token"
      }
    };
  }
};

function mockModule(modulePath, exports) {
  const mockedModule = new Module(modulePath);
  mockedModule.filename = modulePath;
  mockedModule.loaded = true;
  mockedModule.exports = exports;
  require.cache[modulePath] = mockedModule;
}

test.before(async () => {
  const originalRunModule = require.cache[runServicePath];
  const originalVerifierModule = require.cache[verifierServicePath];

  mockModule(runServicePath, runServiceMock);
  mockModule(verifierServicePath, verifierServiceMock);
  delete require.cache[routePath];
  const verifierRoutes = require(routePath);

  if (originalRunModule) {
    require.cache[runServicePath] = originalRunModule;
  } else {
    delete require.cache[runServicePath];
  }

  if (originalVerifierModule) {
    require.cache[verifierServicePath] = originalVerifierModule;
  } else {
    delete require.cache[verifierServicePath];
  }

  const app = express();
  app.use(express.json());
  app.use("/api/verify", verifierRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
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

function resetRun() {
  currentRun = {
    runId: "RUN-VERIFY-TEST",
    scenario: {
      verifier: "inji-verify",
      presentationProtocol: "openid4vp"
    }
  };
  exchanges = [];
  createRequestCalls = [];
  savedRequest = null;
}

async function createRequest(body = {}) {
  return fetch(
    `${baseUrl}/api/verify/runs/RUN-VERIFY-TEST/request`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

test("returns a configuration error without creating a verifier request", async () => {
  resetRun();
  configuredClientId = "";

  const response = await createRequest();
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /INJI_VERIFY_CLIENT_ID/);
  assert.equal(createRequestCalls.length, 0);
  assert.equal(body.exchange.status, "FAILED");
});

test("rejects a request client ID that differs from configuration", async () => {
  resetRun();
  configuredClientId = "did:web:verify.example";

  const response = await createRequest({
    clientId: "playground"
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /must match the configured/);
  assert.equal(createRequestCalls.length, 0);
  assert.equal(body.exchange.status, "FAILED");
});

test("rejects a blank client ID supplied in the request body", async () => {
  resetRun();
  configuredClientId = "did:web:verify.example";

  const response = await createRequest({
    clientId: ""
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /must match the configured/);
  assert.equal(createRequestCalls.length, 0);
});

test("uses and persists the configured client ID unchanged", async () => {
  resetRun();
  configuredClientId = "did:web:verify.example";

  const response = await createRequest();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(createRequestCalls[0].data.clientId, configuredClientId);
  assert.equal(savedRequest.clientId, configuredClientId);
  assert.deepEqual(
    body.presentationRequest,
    savedRequest.presentationRequest
  );
  assert.equal(body.exchange.status, "SUCCESS");
});
