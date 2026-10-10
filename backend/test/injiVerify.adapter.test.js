const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const axiosPath = require.resolve("axios");
const adapterPath = require.resolve(
  "../src/adapters/verifiers/injiVerify.adapter"
);
const originalAxiosModule = require.cache[axiosPath];
const axiosMock = {
  post: async () => ({
    data: {
      requestId: "req-mocked"
    }
  })
};

require.cache[axiosPath] = new Module(axiosPath);
require.cache[axiosPath].exports = axiosMock;
delete require.cache[adapterPath];
const InjiVerifyAdapter = require(adapterPath);
delete require.cache[adapterPath];

if (originalAxiosModule) {
  require.cache[axiosPath] = originalAxiosModule;
} else {
  delete require.cache[axiosPath];
}

test("uses the configured client ID for the real verifier request", async () => {
  let capturedRequest;
  axiosMock.post = async (url, body) => {
    capturedRequest = { url, body };
    return { data: { requestId: "req-mocked" } };
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example",
    clientId: "did:web:verify.example"
  });

  const response = await adapter.createPresentationRequest({
    clientId: "did:web:verify.example",
    presentationDefinition: { id: "definition" }
  });

  assert.equal(
    capturedRequest.url,
    "http://verify.example/v1/verify/vp-request"
  );
  assert.equal(capturedRequest.body.clientId, "did:web:verify.example");
  assert.deepEqual(response, { requestId: "req-mocked" });
});

test("rejects an unconfigured verifier client ID without making a request", async () => {
  let requestMade = false;
  axiosMock.post = async () => {
    requestMade = true;
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example"
  });

  await assert.rejects(
    adapter.createPresentationRequest({
      presentationDefinition: { id: "definition" }
    }),
    {
      code: "VERIFIER_CLIENT_ID_NOT_CONFIGURED",
      statusCode: 503
    }
  );
  assert.equal(requestMade, false);
});
