const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");
const test = require("node:test");

const runServicePath = require.resolve(
  "../src/services/run.service"
);
const walletServicePath = require.resolve(
  "../src/services/wallet.service"
);
const routePath = require.resolve(
  "../src/routes/wallet.routes"
);

let currentRun;
let exchanges;
let server;
let baseUrl;
let createPresentationRequestContinuation;

const runServiceMock = {
  getRun: () => currentRun,
  addExchange: (runId, exchange) => {
    const recordedExchange = {
      step: exchanges.length + 1,
      ...exchange
    };
    exchanges.push(recordedExchange);
    return recordedExchange;
  }
};

const walletServiceMock = {
  createWalletContinuation: () => ({}),
  createPresentationRequestContinuation: (
    walletId,
    verifierResponse,
    clientId
  ) => createPresentationRequestContinuation(
    walletId,
    verifierResponse,
    clientId
  )
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
  const originalWalletModule = require.cache[walletServicePath];

  mockModule(runServicePath, runServiceMock);
  mockModule(walletServicePath, walletServiceMock);
  delete require.cache[routePath];
  const walletRoutes = require(routePath);

  if (originalRunModule) {
    require.cache[runServicePath] = originalRunModule;
  } else {
    delete require.cache[runServicePath];
  }

  if (originalWalletModule) {
    require.cache[walletServicePath] = originalWalletModule;
  } else {
    delete require.cache[walletServicePath];
  }

  const app = express();
  app.use("/api/wallet", walletRoutes);
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

function setRun(presentationRequest) {
  exchanges = [];
  currentRun = {
    runId: "RUN-TEST",
    scenario: {
      wallet: "inji-mobile",
      verifier: "inji-verify",
      presentationProtocol: "openid4vp"
    },
    presentationRequest
  };
}

test("returns the unchanged verifier response and QR URI, recording READY", async () => {
  const verifierResponse = {
    requestId: "req-route-test",
    authorizationDetails: {
      clientId: "https://verify.example/rp",
      responseType: "vp_token",
      responseMode: "direct_post",
      nonce: "real-verifier-nonce",
      responseUri: "https://verify.example/response",
      presentationDefinition: { id: "real-definition" }
    }
  };
  const qrUri = "openid4vp://authorize?client_id=verify";
  setRun({
    verifierId: "inji-verify",
    protocol: "openid4vp",
    clientId: "https://verify.example/rp",
    authorizationRequest: verifierResponse
  });
  createPresentationRequestContinuation = (
    walletId,
    response,
    clientId
  ) => {
    assert.equal(walletId, "inji-mobile");
    assert.equal(response, verifierResponse);
    assert.equal(clientId, "https://verify.example/rp");
    return {
      walletId,
      wallet: "Inji Mobile Wallet",
      protocol: "openid4vp",
      handoffMethod: "cross-device-qr",
      verifierResponse: response,
      qrUri,
      status: "READY"
    };
  };

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/presentation`,
    { method: "POST" }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.wallet.verifierResponse, verifierResponse);
  assert.equal(body.wallet.qrUri, qrUri);
  assert.equal(body.wallet.handoffMethod, "cross-device-qr");
  assert.equal(body.wallet.status, "READY");
  assert.equal(body.exchange.status, "READY");
  assert.equal(body.exchange.qrUri, qrUri);
  assert.equal(exchanges.length, 1);
});

test("records a failed handoff when the verifier response is invalid", async () => {
  setRun({
    verifierId: "inji-verify",
    protocol: "openid4vp",
    clientId: "https://verify.example/rp",
    authorizationRequest: { requestId: "req-invalid" }
  });
  createPresentationRequestContinuation = () => {
    throw new Error("authorizationDetails or requestUri is required");
  };

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/presentation`,
    { method: "POST" }
  );
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.success, false);
  assert.equal(body.exchange.status, "FAILED");
  assert.equal(
    body.exchange.error,
    "authorizationDetails or requestUri is required"
  );
});

test("returns conflict and records failure if no verifier request exists", async () => {
  setRun(null);

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/presentation`,
    { method: "POST" }
  );
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.exchange.status, "FAILED");
  assert.equal(
    body.exchange.error,
    "Presentation request not available for this run"
  );
});
