const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const issuerServicePath = require.resolve(
  "../src/services/issuer.service"
);
const issuanceServicePath = require.resolve(
  "../src/services/issuance.service"
);
const originalIssuerModule = require.cache[issuerServicePath];
const originalIssuanceModule = require.cache[issuanceServicePath];

let adapter;
let service;

function mockModule(modulePath, exports) {
  const mockedModule = new Module(modulePath);
  mockedModule.filename = modulePath;
  mockedModule.loaded = true;
  mockedModule.exports = exports;
  require.cache[modulePath] = mockedModule;
}

test.before(() => {
  mockModule(issuerServicePath, {
    getIssuerAdapter: () => adapter
  });
  delete require.cache[issuanceServicePath];
  service = require(issuanceServicePath);
});

test.after(() => {
  if (originalIssuerModule) {
    require.cache[issuerServicePath] = originalIssuerModule;
  } else {
    delete require.cache[issuerServicePath];
  }
  if (originalIssuanceModule) {
    require.cache[issuanceServicePath] = originalIssuanceModule;
  } else {
    delete require.cache[issuanceServicePath];
  }
});

test("forwards the requested offer configuration to the issuer adapter", async () => {
  const offer = {
    credential_offer_uri: "openid-credential-offer://certify/offer-1"
  };
  const calls = [];
  adapter = {
    createPreAuthorizedOffer: async (input) => {
      calls.push(input);
      return offer;
    }
  };
  const input = {
    credentialConfigurationId: "UniversityDegree",
    claims: { name: "Test Holder" },
    expiresIn: 300,
    txCode: "2468"
  };

  const result = await service.createPreAuthorizedOfferForRun(
    "RUN-OFFER-TEST",
    "inji-certify",
    input
  );

  assert.deepEqual(calls, [input]);
  assert.equal(result.success, true);
  assert.equal(result.offer, offer);
  assert.equal(Number.isFinite(result.durationMs), true);
});

test("returns safe diagnostics without upstream error or secret contents", async () => {
  const secret = "issuer-secret-response";
  adapter = {
    createPreAuthorizedOffer: async () => {
      throw Object.assign(
        new Error(`upstream failure contains ${secret}`),
        {
          response: {
            status: 503,
            data: { detail: secret }
          }
        }
      );
    }
  };

  const result = await service.createPreAuthorizedOfferForRun(
    "RUN-OFFER-TEST",
    "inji-certify",
    { credentialConfigurationId: "UniversityDegree" }
  );

  assert.equal(result.success, false);
  assert.deepEqual(result.diagnostic, { upstreamStatus: 503 });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(Object.hasOwn(result, "error"), false);
});
