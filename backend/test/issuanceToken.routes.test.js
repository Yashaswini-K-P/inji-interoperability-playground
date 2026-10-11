const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");
const test = require("node:test");

const runServicePath = require.resolve("../src/services/run.service");
const issuanceServicePath = require.resolve(
  "../src/services/issuance.service"
);
const walletServicePath = require.resolve("../src/services/wallet.service");
const routePath = require.resolve("../src/routes/issuance.routes");

const accessTokenValue = "test-access-token-do-not-leak";
const refreshTokenValue = "test-refresh-token-do-not-leak";
let currentRun;
let exchanges;
let requestTokenCalls;
let requestCredentialCalls;
let walletCredentialRequestCalls;
let offerCalls;
let offerResult;
let tokenResponse;
let tokenError;
let server;
let baseUrl;

const runServiceMock = {
  getRun: () => currentRun,
  addExchange: (runId, exchange) => {
    const recordedExchange = {
      step: (currentRun.exchanges?.length || 0) + 1,
      timestamp: new Date().toISOString(),
      ...exchange
    };
    exchanges.push(recordedExchange);
    currentRun.exchanges ||= [];
    currentRun.exchanges.push(recordedExchange);
    if (recordedExchange.status === "FAILED") {
      currentRun.status = "FAILED";
    }
    return recordedExchange;
  },
  setRunOffer: (runId, offer) => {
    currentRun.offer = offer;
    return currentRun;
  }
};

const issuanceServiceMock = {
  createPreAuthorizedOfferForRun: async (...args) => {
    offerCalls.push(args);
    return offerResult;
  },
  requestToken: async (...args) => {
    requestTokenCalls.push(args);
    if (tokenError) {
      throw tokenError;
    }
    return tokenResponse;
  },
  requestCredential: async (...args) => {
    requestCredentialCalls.push(args);
    return { credential: "must-not-be-issued" };
  }
};

const walletServiceMock = {
  createCredentialRequest: async (...args) => {
    walletCredentialRequestCalls.push(args);
    throw new Error("Unexpected wallet credential request");
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
  const originalIssuanceModule = require.cache[issuanceServicePath];
  const originalWalletModule = require.cache[walletServicePath];

  mockModule(runServicePath, runServiceMock);
  mockModule(issuanceServicePath, issuanceServiceMock);
  mockModule(walletServicePath, walletServiceMock);
  delete require.cache[routePath];
  const issuanceRoutes = require(routePath);

  if (originalRunModule) {
    require.cache[runServicePath] = originalRunModule;
  } else {
    delete require.cache[runServicePath];
  }
  if (originalIssuanceModule) {
    require.cache[issuanceServicePath] = originalIssuanceModule;
  } else {
    delete require.cache[issuanceServicePath];
  }
  if (originalWalletModule) {
    require.cache[walletServicePath] = originalWalletModule;
  } else {
    delete require.cache[walletServicePath];
  }

  const app = express();
  app.use(express.json());
  app.use("/api/issuance", issuanceRoutes);
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
    runId: "RUN-TOKEN-TEST",
    status: "IN_PROGRESS",
    scenario: {
      issuer: "inji-certify",
      credential: "UniversityDegree",
      wallet: "inji-mobile"
    },
    exchanges: [{
      step: 1,
      stepName: "Run created",
      status: "SUCCESS"
    }],
    offer: null
  };
  exchanges = [];
  requestTokenCalls = [];
  requestCredentialCalls = [];
  walletCredentialRequestCalls = [];
  offerCalls = [];
  offerResult = {
    success: true,
    durationMs: 12,
    offer: {
      credential_offer_uri: "openid-credential-offer://certify/offer-1"
    }
  };
  tokenError = null;
  tokenResponse = {
    access_token: accessTokenValue,
    refresh_token: refreshTokenValue,
    token_type: "Bearer",
    expires_in: 600,
    c_nonce: "nonce-not-returned"
  };
}

async function requestRunToken(body) {
  return fetch(
    `${baseUrl}/api/issuance/runs/RUN-TOKEN-TEST/token`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

test("forwards expected token inputs and returns only safe token metadata", async () => {
  resetRun();

  const response = await requestRunToken({
    preAuthorizedCode: "pre-authorized-code",
    txCode: "1234"
  });
  const body = await response.json();
  const serialized = JSON.stringify(body);
  const persistedRun = JSON.stringify(currentRun);
  const exchangeLog = JSON.stringify(exchanges);

  assert.equal(response.status, 200);
  assert.deepEqual(requestTokenCalls, [
    [
      "inji-certify",
      {
        preAuthorizedCode: "pre-authorized-code",
        txCode: "1234"
      }
    ]
  ]);
  assert.deepEqual(body.token, {
    tokenType: "Bearer",
    expiresIn: 600,
    hasCNonce: true
  });
  for (const output of [serialized, persistedRun, exchangeLog]) {
    assert.equal(output.includes(accessTokenValue), false);
    assert.equal(output.includes(refreshTokenValue), false);
  }
  assert.equal(Object.hasOwn(currentRun, "token"), false);
  assert.equal(exchanges[0].status, "SUCCESS");
});

test("does not expose upstream token values in errors, exchanges, or logs", async () => {
  resetRun();
  tokenError = Object.assign(
    new Error(`upstream echoed ${accessTokenValue}`),
    {
      code: accessTokenValue,
      response: {
        status: 503,
        data: {
          access_token: accessTokenValue,
          refresh_token: refreshTokenValue
        }
      }
    }
  );
  const logged = [];
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  console.error = (...args) => logged.push(args.join(" "));
  console.log = (...args) => logged.push(args.join(" "));

  try {
    const response = await requestRunToken({
      preAuthorizedCode: "pre-authorized-code",
      txCode: "1234"
    });
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 502);
    assert.equal(body.error, "Token request failed");
    assert.equal(body.exchange.diagnostic.code, null);
    assert.equal(body.exchange.diagnostic.upstreamStatus, 503);
    for (const output of [serialized, JSON.stringify(exchanges), logged.join(" ")]) {
      assert.equal(output.includes(accessTokenValue), false);
      assert.equal(output.includes(refreshTokenValue), false);
    }
  } finally {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  }
});

test("rejects unsupported credential requests without changing run history", async () => {
  resetRun();

  const response = await fetch(
    `${baseUrl}/api/issuance/runs/RUN-TOKEN-TEST/credential`,
    { method: "POST" }
  );
  const body = await response.json();

  assert.equal(response.status, 501);
  assert.equal(body.errorCode, "CREDENTIAL_REQUEST_UNSUPPORTED");
  assert.equal(body.diagnostic.owner, "selected-wallet");
  assert.equal(Object.hasOwn(currentRun, "token"), false);
  assert.equal(requestTokenCalls.length, 0);
  assert.equal(exchanges.length, 0);
  assert.equal(requestCredentialCalls.length, 0);
  assert.equal(walletCredentialRequestCalls.length, 0);
  assert.equal(currentRun.status, "IN_PROGRESS");
  assert.equal(currentRun.exchanges.length, 1);
});

test("stores and reports only a Certify-created offer URI", async () => {
  resetRun();

  const response = await fetch(
    `${baseUrl}/api/issuance/runs/RUN-TOKEN-TEST/pre-authorized-offer`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issuerId: "inji-certify",
        credentialConfigurationId: "UniversityDegree",
        claims: { name: "Test Holder" },
        expiresIn: 300,
        txCode: "2468"
      })
    }
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(
    body.offer.credential_offer_uri,
    "openid-credential-offer://certify/offer-1"
  );
  assert.deepEqual(offerCalls, [[
    "RUN-TOKEN-TEST",
    "inji-certify",
    {
      credentialConfigurationId: "UniversityDegree",
      claims: { name: "Test Holder" },
      expiresIn: 300,
      txCode: "2468"
    }
  ]]);
  assert.deepEqual(currentRun.offer, {
    credentialOfferUri: "openid-credential-offer://certify/offer-1",
    type: "openid-credential-offer"
  });
  assert.equal(body.exchange.status, "SUCCESS");
  assert.equal(exchanges.length, 1);
});

test("records one safe failed exchange when Certify offer creation fails", async () => {
  resetRun();
  offerResult = {
    success: false,
    durationMs: 9,
    diagnostic: { upstreamStatus: 503 },
    error: `upstream included ${accessTokenValue}`
  };

  const response = await fetch(
    `${baseUrl}/api/issuance/runs/RUN-TOKEN-TEST/pre-authorized-offer`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issuerId: "inji-certify",
        credentialConfigurationId: "UniversityDegree"
      })
    }
  );
  const body = await response.json();
  const output = JSON.stringify({ body, run: currentRun, exchanges });

  assert.equal(response.status, 502);
  assert.equal(body.errorCode, "ISSUER_OFFER_REQUEST_FAILED");
  assert.equal(body.exchange.status, "FAILED");
  assert.equal(body.diagnostic.upstreamStatus, 503);
  assert.equal(exchanges.length, 1);
  assert.equal(output.includes(accessTokenValue), false);
  assert.equal(currentRun.offer, null);
});

test("does not call Certify or add exchanges when the run is missing", async () => {
  resetRun();
  currentRun = null;

  const response = await fetch(
    `${baseUrl}/api/issuance/runs/MISSING/pre-authorized-offer`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issuerId: "inji-certify",
        credentialConfigurationId: "UniversityDegree"
      })
    }
  );
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.errorCode, "RUN_NOT_FOUND");
  assert.equal(offerCalls.length, 0);
  assert.equal(exchanges.length, 0);
});

test("rejects a successful but unusable Certify offer response", async () => {
  resetRun();
  offerResult.offer = { id: "offer-without-uri" };

  const response = await fetch(
    `${baseUrl}/api/issuance/runs/RUN-TOKEN-TEST/pre-authorized-offer`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issuerId: "inji-certify",
        credentialConfigurationId: "UniversityDegree"
      })
    }
  );
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.errorCode, "INVALID_ISSUER_OFFER_RESPONSE");
  assert.equal(body.exchange.status, "FAILED");
  assert.equal(currentRun.offer, null);
  assert.equal(exchanges.length, 1);
});
