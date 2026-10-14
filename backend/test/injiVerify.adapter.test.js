const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const axiosPath = require.resolve("axios");
const adapterPath = require.resolve(
  "../src/adapters/verifiers/injiVerify.adapter"
);
const originalAxiosModule = require.cache[axiosPath];
const axiosMock = {
  get: async () => ({ data: { status: "VP_SUBMITTED" } }),
  post: async () => ({
    data: {
      requestId: "req-mocked",
      transactionId: "txn-mocked"
    }
  })
};

require.cache[axiosPath] = new Module(axiosPath);
require.cache[axiosPath].exports = axiosMock;
delete require.cache[adapterPath];
const InjiVerifyAdapter = require(adapterPath);
delete require.cache[adapterPath];

const presentationDefinition = {
  id: "definition",
  input_descriptors: [{ id: "credential" }]
};
const presentationRequest = {
  requestId: "req-actual",
  transactionId: "txn-actual",
  requestUri: "http://verify.example/v1/verify/vp-request/req-actual"
};

if (originalAxiosModule) {
  require.cache[axiosPath] = originalAxiosModule;
} else {
  delete require.cache[axiosPath];
}

test("creates a DID-based Presentation Exchange request using Verify 0.18.2's API", async () => {
  let capturedRequest;
  axiosMock.post = async (url, body) => {
    capturedRequest = { url, body };
    return { data: presentationRequest };
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example",
    clientId: "did:web:verify.example"
  });

  const response = await adapter.createPresentationRequest({
    clientId: "did:web:verify.example",
    presentationDefinition
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
    presentationDefinition,
    acceptVPWithoutHolderProof: false,
    responseCodeValidationRequired: false
  });
  assert.deepEqual(response, presentationRequest);
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
      presentationDefinition
    }),
    {
      code: "VERIFIER_CLIENT_ID_NOT_CONFIGURED",
      statusCode: 503
    }
  );
  assert.equal(requestMade, false);
});

test("rejects a non-DID client ID for the DID-based Verify flow", async () => {
  let requestMade = false;
  axiosMock.post = async () => {
    requestMade = true;
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example",
    clientId: "verifier-client"
  });

  await assert.rejects(
    adapter.createPresentationRequest({
      clientId: "verifier-client",
      presentationDefinition
    }),
    {
      code: "VERIFIER_CLIENT_ID_NOT_DID",
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
      presentationDefinition
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
    return { data: presentationRequest };
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "https://verify.example/",
    clientId: "did:web:verify.example"
  });

  await adapter.createPresentationRequest({
    clientId: "did:web:verify.example",
    presentationDefinition
  });

  assert.equal(
    capturedUrl,
    "https://verify.example/v1/verify/vp-request"
  );
});

test("rejects a malformed presentation definition without making a request", async () => {
  let requestMade = false;
  axiosMock.post = async () => {
    requestMade = true;
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example",
    clientId: "did:web:verify.example"
  });

  await assert.rejects(
    adapter.createPresentationRequest({
      clientId: "did:web:verify.example",
      presentationDefinition: { id: "definition" }
    }),
    /presentationDefinition with a non-empty input_descriptors array/
  );
  assert.equal(requestMade, false);
});

test("rejects malformed successful Verify responses without inventing request IDs", async () => {
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example",
    clientId: "did:web:verify.example"
  });

  for (const data of [
    null,
    [],
    { requestId: "req-only" },
    { transactionId: "txn-only" },
    { requestId: "", transactionId: "txn-actual" }
  ]) {
    axiosMock.post = async () => ({ data });

    await assert.rejects(
      adapter.createPresentationRequest({
        clientId: "did:web:verify.example",
        presentationDefinition
      }),
      {
        code: "INVALID_VERIFIER_RESPONSE",
        statusCode: 502
      }
    );
  }
});

test("propagates Verify HTTP errors when creating a presentation request", async () => {
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example",
    clientId: "did:web:verify.example"
  });
  const upstreamError = Object.assign(new Error("Verify rejected request"), {
    response: {
      status: 400,
      data: { errorCode: "INVALID_PRESENTATION_DEFINITION" }
    }
  });
  axiosMock.post = async () => {
    throw upstreamError;
  };

  await assert.rejects(
    adapter.createPresentationRequest({
      clientId: "did:web:verify.example",
      presentationDefinition
    }),
    (error) => error === upstreamError
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
    "http://verify.example/v1/verify/v2/vp-results/txn-123"
  );
  assert.deepEqual(capturedRequest.body, {
    skipStatusChecks: false,
    statusCheckFilters: [],
    includeClaims: false
  });
  assert.equal(capturedRequest.config.timeout, 60000);
  assert.equal(result.allChecksSuccessful, true);
});

test("checks Verify's long-poll request status endpoint using the request ID", async () => {
  let capturedRequest;
  axiosMock.get = async (url, config) => {
    capturedRequest = { url, config };
    return { data: { status: "VP_SUBMITTED" } };
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example/v1/verify/",
    clientId: "did:web:verify.example"
  });

  const status = await adapter.getPresentationRequestStatus({
    requestId: "req/with spaces"
  });

  assert.equal(
    capturedRequest.url,
    "http://verify.example/v1/verify/vp-request/req%2Fwith%20spaces/status"
  );
  assert.equal(capturedRequest.config.timeout, 65000);
  assert.deepEqual(status, { status: "VP_SUBMITTED" });
});

test("rejects malformed Verify request status responses", async () => {
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example",
    clientId: "did:web:verify.example"
  });
  axiosMock.get = async () => ({ data: { status: "SUBMITTED" } });

  await assert.rejects(
    adapter.getPresentationRequestStatus({ requestId: "req-123" }),
    {
      code: "INVALID_VERIFIER_STATUS",
      statusCode: 502
    }
  );
});

test("encodes transaction IDs when retrieving Verify results", async () => {
  let capturedUrl;
  axiosMock.post = async (url) => {
    capturedUrl = url;
    return { data: { transactionId: "txn/with spaces" } };
  };
  const adapter = new InjiVerifyAdapter({
    baseUrl: "http://verify.example",
    clientId: "did:web:verify.example"
  });

  await adapter.getPresentationResult({
    transactionId: "txn/with spaces"
  });

  assert.equal(
    capturedUrl,
    "http://verify.example/v1/verify/v2/vp-results/txn%2Fwith%20spaces"
  );
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
