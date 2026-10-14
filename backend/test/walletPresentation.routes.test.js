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
let createPlaygroundCredentialOfferHandoff;
let hasValidPlaygroundCredentialHandoffToken;
let createPresentationRequestContinuation;
let walletCallbackToken;

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
  },
  recordWalletCredentialReceipt: (runId, receiptData) => {
    if (currentRun.credentialReceipt) {
      return currentRun.credentialReceipt;
    }
    const receipt = {
      issuer: currentRun.scenario.issuer,
      wallet: currentRun.scenario.wallet,
      ...receiptData,
      receivedAt: new Date().toISOString()
    };
    currentRun.issuanceStatus = "STORED";
    currentRun.credentialReceipt = receipt;
    runServiceMock.addExchange(runId, {
      stepName: "Wallet Credential Storage",
      protocol: "OpenID4VCI",
      direction: "wallet-to-playground",
      initiatedBy: "inji-mobile",
      status: "SUCCESS",
      credentialConfigurationId: receiptData.credentialConfigurationId,
      format: receiptData.format
    });
    return receipt;
  }
};

const walletServiceMock = {
  createWalletContinuation: (walletId, offerUri) =>
    createWalletContinuation(walletId, offerUri),
  createPlaygroundCredentialOfferHandoff: (...args) =>
    createPlaygroundCredentialOfferHandoff(...args),
  hasValidPlaygroundCredentialHandoffToken: (runId, token) =>
    hasValidPlaygroundCredentialHandoffToken(runId, token),
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
  app.use(express.json());
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
      issuer: "inji-certify",
      credential: "credential-id",
      format: "vc+sd-jwt",
      verifier: "inji-verify",
      presentationProtocol: "openid4vp"
    },
    offer: {
      credentialOfferUri: "openid-credential-offer://issuer/offer-1"
    },
    exchanges: [],
    presentationRequest
  };
  walletCallbackToken = "scoped-wallet-callback-token";
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

test("builds the Inji Mobile launch URI from Verify's DID request URI", async () => {
  const verifierResponse = {
    requestId: "req-by-reference",
    transactionId: "txn-by-reference",
    requestUri:
      "https://verify.example/v1/verify/vp-request/req-by-reference"
  };
  setRun({
    verifierId: "inji-verify",
    protocol: "openid4vp",
    clientId: "did:web:verify.example",
    requestId: "req-by-reference",
    transactionId: "txn-by-reference",
    authorizationRequest: verifierResponse
  });
  createPresentationRequestContinuation = (
    walletId,
    response,
    clientId
  ) => new InjiMobileAdapter({
    id: walletId,
    name: "Inji Mobile Wallet"
  }).createPresentationRequestContinuation(response, clientId);

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/presentation`,
    { method: "POST" }
  );
  const body = await response.json();
  const qrParams = new URL(body.wallet.qrUri).searchParams;

  assert.equal(response.status, 200);
  assert.equal(qrParams.get("client_id"), "did:web:verify.example");
  assert.equal(
    qrParams.get("request_uri"),
    verifierResponse.requestUri
  );
  assert.equal(qrParams.has("nonce"), false);
  assert.equal(body.exchange.requestId, "req-by-reference");
  assert.equal(body.exchange.transactionId, "txn-by-reference");
  assert.equal(Object.hasOwn(body.exchange, "qrUri"), false);
});

test("prepares a wallet-aware offer handoff without claiming credential receipt", async () => {
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
  createPlaygroundCredentialOfferHandoff = (
    runId,
    receivedOfferUri,
    publicBaseUrl
  ) => {
    assert.equal(runId, "RUN-TEST");
    assert.equal(receivedOfferUri, offerUri);
    assert.equal(publicBaseUrl, "https://playground.example");
    return {
      qrPayload: JSON.stringify({
        type: "inji-interoperability-playground/credential-offer",
        version: 1,
        credentialOfferUri: offerUri,
        runId,
        callbackUrl:
          "https://playground.example/api/wallet/runs/RUN-TEST/issuance-outcome",
        callbackToken: walletCallbackToken
      }),
      handoffMethod: "inji-mobile-playground-offer-qr",
      callbackExpiresAt: new Date(Date.now() + 60_000).toISOString()
    };
  };
  hasValidPlaygroundCredentialHandoffToken = (runId, token) =>
    runId === "RUN-TEST" && token === walletCallbackToken;
  process.env.PLAYGROUND_PUBLIC_URL = "https://playground.example";

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/continue`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(
    body.wallet.handoffMethod,
    "inji-mobile-playground-offer-qr"
  );
  const payload = JSON.parse(body.wallet.qrPayload);
  assert.equal(payload.credentialOfferUri, offerUri);
  assert.equal(payload.runId, "RUN-TEST");
  assert.equal(
    payload.callbackUrl,
    "https://playground.example/api/wallet/runs/RUN-TEST/issuance-outcome"
  );
  assert.equal(body.wallet.qrPayload.includes(walletCallbackToken), true);
  assert.equal(body.wallet.credentialOfferUri, offerUri);
  assert.equal(body.wallet.handoffStatus, "PREPARED");
  assert.equal(body.wallet.status, "PENDING_EXTERNAL_ACTION");
  assert.equal(body.exchange.status, "PENDING_EXTERNAL_ACTION");
  assert.equal(
    body.exchange.externalAction,
    "wallet-scan-not-observed"
  );
  assert.equal(body.exchange.handoffStatus, "PREPARED");
  assert.equal(
    body.exchange.handoffMethod,
    "inji-mobile-playground-offer-qr"
  );
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

test("requires a public HTTPS backend origin for Mobile outcome callbacks", async () => {
  setRun(null);
  createPlaygroundCredentialOfferHandoff = () => {
    const error = new Error("Set PLAYGROUND_PUBLIC_URL to the HTTPS origin");
    error.code = "PLAYGROUND_PUBLIC_URL_REQUIRED";
    error.statusCode = 503;
    throw error;
  };

  const response = await fetch(
    `${baseUrl}/api/wallet/runs/RUN-TEST/continue`
  );
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.errorCode, "PLAYGROUND_PUBLIC_URL_REQUIRED");
  assert.equal(exchanges.length, 0);
  assert.equal(currentRun.status, "IN_PROGRESS");
});

test("records only an authorized, wallet-confirmed stored credential and accepts duplicate receipts idempotently", async () => {
  setRun(null);
  hasValidPlaygroundCredentialHandoffToken = (runId, token) =>
    runId === "RUN-TEST" && token === walletCallbackToken;
  const endpoint =
    `${baseUrl}/api/wallet/runs/RUN-TEST/issuance-outcome`;
  const body = {
    status: "STORED",
    credentialConfigurationId: "credential-id",
    format: "vc+sd-jwt"
  };

  const unauthorized = await fetch(endpoint, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${walletCallbackToken}`
    },
    body: JSON.stringify(body)
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.issuanceStatus, "STORED");
  assert.equal(result.credentialReceipt.credentialConfigurationId, "credential-id");
  assert.equal(currentRun.issuanceStatus, "STORED");
  assert.equal(currentRun.exchanges.length, 1);
  assert.equal(currentRun.exchanges[0].status, "SUCCESS");
  assert.equal(currentRun.exchanges[0].stepName, "Wallet Credential Storage");
  assert.equal(JSON.stringify(currentRun).includes(walletCallbackToken), false);

  const duplicate = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${walletCallbackToken}`
    },
    body: JSON.stringify(body)
  });
  const duplicateResult = await duplicate.json();
  assert.equal(duplicate.status, 200);
  assert.equal(duplicateResult.duplicate, true);
  assert.equal(currentRun.exchanges.length, 1);
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
