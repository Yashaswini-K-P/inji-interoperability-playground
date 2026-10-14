const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const axiosPath = require.resolve("axios");
const adapterPath = require.resolve(
  "../src/adapters/issuers/injiCertify.adapter"
);
const originalAxiosModule = require.cache[axiosPath];
const accessTokenValue = "adapter-access-token-do-not-leak";
let capturedRequest;
let loggedValues;
let adapter;
const axiosMock = {
  get: async () => ({ data: {} }),
  post: async (url, body, config) => {
    capturedRequest = { url, body, config };
    return { data: { access_token: accessTokenValue } };
  }
};

require.cache[axiosPath] = new Module(axiosPath);
require.cache[axiosPath].exports = axiosMock;
delete require.cache[adapterPath];
const InjiCertifyAdapter = require(adapterPath);
delete require.cache[adapterPath];

if (originalAxiosModule) {
  require.cache[axiosPath] = originalAxiosModule;
} else {
  delete require.cache[axiosPath];
}

adapter = new InjiCertifyAdapter({
  baseUrl: "http://certify.example"
});

test("sends the pre-authorized token exchange to Certify with form-encoded inputs", async () => {
  capturedRequest = null;

  await adapter.requestToken({
    preAuthorizedCode: "pre-authorized-code",
    txCode: "1234"
  });

  assert.equal(
    capturedRequest.url,
    "http://certify.example/v1/certify/oauth/token"
  );
  assert.equal(
    capturedRequest.config.headers["Content-Type"],
    "application/x-www-form-urlencoded"
  );
  assert.equal(
    capturedRequest.config.headers.Accept,
    "application/json"
  );
  assert.deepEqual(
    Object.fromEntries(new URLSearchParams(capturedRequest.body)),
    {
      grant_type:
        "urn:ietf:params:oauth:grant-type:pre-authorized_code",
      "pre-authorized_code": "pre-authorized-code",
      tx_code: "1234"
    }
  );
});

test("does not invent a transaction code and forwards only a supplied code", async () => {
  await adapter.createPreAuthorizedOffer({
    credentialConfigurationId: "UniversityDegree"
  });
  assert.deepEqual(capturedRequest.body, {
    credential_configuration_id: "UniversityDegree",
    claims: {},
    expires_in: 600
  });

  await adapter.createPreAuthorizedOffer({
    credentialConfigurationId: "UniversityDegree",
    txCode: "2468"
  });
  assert.equal(capturedRequest.body.tx_code, "2468");

  await adapter.requestToken({
    preAuthorizedCode: "pre-authorized-code"
  });
  assert.equal(
    new URLSearchParams(capturedRequest.body).has("tx_code"),
    false
  );
});

test("does not log access tokens while using them for credential requests", async () => {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  loggedValues = [];
  console.log = (...args) => loggedValues.push(args.join(" "));
  console.error = (...args) => loggedValues.push(args.join(" "));

  try {
    await adapter.requestCredential({
      accessToken: accessTokenValue,
      format: "ldp_vc",
      credentialDefinition: { type: ["VerifiableCredential"] },
      proof: { proof_type: "jwt", jwt: "proof-not-logged" }
    });
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }

  assert.equal(
    capturedRequest.url,
    "http://certify.example/v1/certify/issuance/credential"
  );
  assert.deepEqual(capturedRequest.body, {
    format: "ldp_vc",
    credential_definition: { type: ["VerifiableCredential"] },
    proof: { proof_type: "jwt", jwt: "proof-not-logged" }
  });
  assert.equal(capturedRequest.config.timeout, 15000);
  assert.equal(
    capturedRequest.config.headers.Authorization,
    `Bearer ${accessTokenValue}`
  );
  assert.equal(
    loggedValues.some((value) =>
      value.includes(accessTokenValue) ||
      value.includes("proof-not-logged")
    ),
    false
  );
});
