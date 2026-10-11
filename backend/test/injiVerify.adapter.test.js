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
    adapter.getInfo().capabilities.retrieveVerificationResult,
    true
  );
  assert.equal(
    capturedRequest.url,
    "http://verify.example/v1/verify/vp-request"
  );
  assert.deepEqual(capturedRequest.body, {
    clientId: "did:web:verify.example",
    presentationDefinition: { id: "definition" }
  });
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

test("rejects an invalid verifier URL without making a request", async () => {
  let requestMade = false;
  axiosMock.post = async () => {
    requestMade = true;
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "docker://verify",
    clientId: "did:web:verify.example"
  });

  await assert.rejects(
    adapter.createPresentationRequest({
      clientId: "did:web:verify.example",
      presentationDefinition: { id: "definition" }
    }),
    {
      code: "VERIFIER_URL_NOT_CONFIGURED",
      statusCode: 503
    }
  );
  assert.equal(requestMade, false);
});

test("normalizes trailing slashes on the explicitly configured Verify URL", async () => {
  let capturedUrl;
  axiosMock.post = async (url) => {
    capturedUrl = url;
    return { data: { requestId: "req-mocked" } };
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "https://verify.example/",
    clientId: "did:web:verify.example"
  });

  await adapter.createPresentationRequest({
    clientId: "did:web:verify.example",
    presentationDefinition: { id: "definition" }
  });

  assert.equal(
    capturedUrl,
    "https://verify.example/v1/verify/vp-request"
  );
});

test("retrieves the detailed Verify result by transaction ID without requesting claims", async () => {
  let capturedRequest;
  axiosMock.post = async (url, body, config) => {
    capturedRequest = { url, body, config };
    return {
      data: {
        transactionId: "txn-123",
        allChecksSuccessful: true,
        credentialResults: []
      }
    };
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example/",
    clientId: "did:web:verify.example"
  });

  const result = await adapter.getPresentationResult({
    transactionId: "txn-123"
  });

  assert.equal(
    capturedRequest.url,
    "http://verify.example/v2/vp-results/txn-123"
  );
  assert.deepEqual(capturedRequest.body, {
    skipStatusChecks: false,
    statusCheckFilters: [],
    includeClaims: false
  });
  assert.deepEqual(capturedRequest.config, { timeout: 15000 });
  assert.equal(result.allChecksSuccessful, true);
});

test("rejects an empty result transaction ID without making a request", async () => {
  let requestMade = false;
  axiosMock.post = async () => {
    requestMade = true;
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example"
  });

  await assert.rejects(
    adapter.getPresentationResult({ transactionId: " " }),
    /transactionId is required/
  );
  assert.equal(requestMade, false);
});

test("propagates Verify pending and transport errors for route classification", async () => {
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example"
  });
  const pendingError = Object.assign(new Error("not submitted"), {
    response: {
      status: 404,
      data: { errorCode: "NO_VP_SUBMISSION" }
    }
  });
  axiosMock.post = async () => {
    throw pendingError;
  };

  await assert.rejects(
    adapter.getPresentationResult({ transactionId: "txn-123" }),
    (error) => error === pendingError
  );

  const timeoutError = Object.assign(new Error("timeout"), {
    code: "ECONNABORTED"
  });
  axiosMock.post = async () => {
    throw timeoutError;
  };

  await assert.rejects(
    adapter.getPresentationResult({ transactionId: "txn-123" }),
    (error) => error === timeoutError
  );
});
