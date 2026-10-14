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
const InjiMobileAdapter = require(
  "../src/adapters/wallets/injiMobile.adapter"
);

let currentRun;
let exchanges;
let server;
let baseUrl;
let createWalletContinuation;
let createPresentationRequestContinuation;

const runServiceMock = {
  getRun: () => currentRun,
  addExchange: (runId, exchange) => {
    const recordedExchange = {
      step: currentRun.exchanges.length + 1,
      ...exchange
    };
    exchanges.push(recordedExchange);
    currentRun.exchanges.push(recordedExchange);
    if (recordedExchange.status === "FAILED") {
      currentRun.status = "FAILED";
    }
    return recordedExchange;
  }
};

const walletServiceMock = {
  createWalletContinuation: (walletId, offerUri) =>
    createWalletContinuation(walletId, offerUri),
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
    status: "IN_PROGRESS",
    scenario: {
      wallet: "inji-mobile",
      verifier: "inji-verify",
      presentationProtocol: "openid4vp"
    },
    offer: {
      credentialOfferUri: "openid-credential-offer://issuer/offer-1"
    },
    exchanges: [],
    presentationRequest
  };
}

test("returns the unchanged verifier response and QR URI without recording it in the event", async () => {
  const verifierResponse = {
    transactionId: "txn-route-test",
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
  setRun({
    verifierId: "inji-verify",
    protocol: "openid4vp",
    clientId: "https://verify.example/rp",
    requestId: "req-route-test",
    transactionId: "txn-route-test",
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
    return new InjiMobileAdapter({
      id: walletId,
      name: "Inji Mobile Wallet"
    }).createPresentationRequestContinuation(response, clientId);
  };

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/presentation`,
    { method: "POST" }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.wallet.verifierResponse, verifierResponse);
  assert.equal(body.wallet.qrUri.startsWith("openid4vp://authorize?"), true);
  const qrParams = new URL(body.wallet.qrUri).searchParams;
  assert.equal(qrParams.get("client_id"), "https://verify.example/rp");
  assert.equal(qrParams.get("state"), "req-route-test");
  assert.equal(qrParams.get("response_type"), "vp_token");
  assert.equal(qrParams.get("response_mode"), "direct_post");
  assert.equal(
    qrParams.get("response_uri"),
    "https://verify.example/response"
  );
  assert.deepEqual(
    JSON.parse(qrParams.get("presentation_definition")),
    verifierResponse.authorizationDetails.presentationDefinition
  );
  assert.equal(body.wallet.handoffMethod, "cross-device-qr");
  assert.equal(body.wallet.status, "PENDING_EXTERNAL_ACTION");
  assert.equal(body.exchange.status, "PENDING_EXTERNAL_ACTION");
  assert.equal(body.wallet.handoffStatus, "PREPARED");
  assert.equal(
    body.exchange.stepName,
    "Authorization URI Generation"
  );
  assert.equal(body.exchange.initiatedBy, "playground");
  assert.equal(body.exchange.requestId, "req-route-test");
  assert.equal(body.exchange.transactionId, "txn-route-test");
  assert.equal(
    body.exchange.actionRequiredCode,
    "SCAN_PRESENTATION_REQUEST_IN_INJI_MOBILE"
  );
  assert.equal(
    body.exchange.actionRequired,
    "Scan the presentation request with the selected wallet"
  );
  assert.equal(
    body.exchange.externalAction,
    "wallet-scan-not-observed"
  );
  assert.equal(Object.hasOwn(body.exchange, "qrUri"), false);
  assert.equal(exchanges.length, 1);
});

test("prepares an offer handoff without claiming wallet scan or credential receipt", async () => {
  setRun(null);
  const offerUri = currentRun.offer.credentialOfferUri;
  createWalletContinuation = (walletId, receivedOfferUri) => {
    assert.equal(walletId, "inji-mobile");
    assert.equal(receivedOfferUri, offerUri);
    return {
      walletId,
      protocol: "openid4vci",
      handoffMethod: "cross-device-qr",
      qrPayload: receivedOfferUri,
      credentialOfferUri: receivedOfferUri,
      type: "openid-credential-offer",
      status: "PENDING_EXTERNAL_ACTION"
    };
  };

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/continue`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.wallet.handoffMethod, "cross-device-qr");
  assert.equal(body.wallet.qrPayload, offerUri);
  assert.equal(body.wallet.credentialOfferUri, offerUri);
  assert.equal(body.wallet.handoffStatus, "PREPARED");
  assert.equal(body.wallet.status, "PENDING_EXTERNAL_ACTION");
  assert.equal(body.exchange.status, "PENDING_EXTERNAL_ACTION");
  assert.equal(
    body.exchange.externalAction,
    "wallet-scan-not-observed"
  );
  assert.equal(body.exchange.handoffStatus, "PREPARED");
  assert.equal(body.exchange.handoffMethod, "cross-device-qr");
  assert.equal(
    body.exchange.actionRequiredCode,
    "SCAN_CREDENTIAL_OFFER_IN_INJI_MOBILE"
  );
  assert.equal(
    body.exchange.actionRequired,
    "Scan the offer with the selected wallet"
  );
  assert.equal(currentRun.status, "IN_PROGRESS");
  assert.equal(currentRun.exchanges.length, 1);
  assert.equal(
    currentRun.exchanges.some((exchange) =>
      /credential received|credential stored/i.test(exchange.stepName)
    ),
    false
  );
});

test("does not record or prepare a handoff when the run has no offer", async () => {
  setRun(null);
  currentRun.offer = null;

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/continue`
  );
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.errorCode, "CREDENTIAL_OFFER_NOT_AVAILABLE");
  assert.equal(exchanges.length, 0);
});

test("records one sanitized failure when offer handoff preparation fails", async () => {
  setRun(null);
  const secret = "wallet-error-token-secret";
  createWalletContinuation = () => {
    throw new Error(`failed with ${secret}`);
  };

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/continue`
  );
  const body = await response.json();
  const output = JSON.stringify({ body, exchanges, run: currentRun });

  assert.equal(response.status, 502);
  assert.equal(body.errorCode, "WALLET_HANDOFF_PREPARATION_FAILED");
  assert.equal(body.exchange.status, "FAILED");
  assert.equal(exchanges.length, 1);
  assert.equal(output.includes(secret), false);
  assert.equal(currentRun.status, "FAILED");
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
