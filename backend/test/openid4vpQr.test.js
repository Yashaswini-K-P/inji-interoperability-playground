const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAuthorizationRequestUri
} = require("../src/adapters/wallets/openid4vpQr");

const clientId = "https://verify.example/rp?tenant=one";
const presentationDefinition = {
  id: "age verification",
  input_descriptors: [
    {
      id: "identity",
      format: {
        ldp_vc: {}
      }
    }
  ]
};

test("builds an OpenID4VP QR URI from a by-value response", () => {
  const verifierResponse = {
    transactionId: "txn-real-value",
    requestId: "req-real-value",
    authorizationDetails: {
      clientId,
      responseType: "vp_token",
      responseMode: "direct_post",
      nonce: "nonce-from-verifier",
      responseUri: "https://verify.example/vp-submission/direct-post",
      presentationDefinition
    }
  };

  const qrUri = createAuthorizationRequestUri(
    verifierResponse,
    clientId
  );
  const parsedUri = new URL(qrUri);
  const params = parsedUri.searchParams;

  assert.equal(parsedUri.protocol, "openid4vp:");
  assert.equal(parsedUri.hostname, "authorize");
  assert.equal(params.get("client_id"), clientId);
  assert.equal(params.get("state"), "req-real-value");
  assert.equal(params.get("response_type"), "vp_token");
  assert.equal(params.get("response_mode"), "direct_post");
  assert.equal(params.get("nonce"), "nonce-from-verifier");
  assert.equal(
    params.get("response_uri"),
    "https://verify.example/vp-submission/direct-post"
  );
  assert.deepEqual(
    JSON.parse(params.get("presentation_definition")),
    presentationDefinition
  );
  assert.equal(params.has("client_metadata"), false);
});

test("preserves verifier-supplied client metadata", () => {
  const clientMetadata = {
    client_name: "Actual Verify instance",
    vp_formats: { "vc+sd-jwt": { alg: ["ES256"] } }
  };
  const verifierResponse = {
    requestId: "req-metadata",
    authorizationDetails: {
      clientId,
      responseType: "vp_token",
      responseMode: "direct_post",
      nonce: "nonce",
      responseUri: "https://verify.example/response",
      presentationDefinition,
      clientMetadata
    }
  };

  const params = new URL(
    createAuthorizationRequestUri(verifierResponse, clientId)
  ).searchParams;

  assert.deepEqual(
    JSON.parse(params.get("client_metadata")),
    clientMetadata
  );
});

test("rejects malformed verifier-supplied client metadata", () => {
  const verifierResponse = {
    requestId: "req-malformed-metadata",
    authorizationDetails: {
      clientId,
      responseType: "vp_token",
      responseMode: "direct_post",
      nonce: "nonce",
      responseUri: "https://verify.example/response",
      presentationDefinition,
      clientMetadata: []
    }
  };

  assert.throws(
    () => createAuthorizationRequestUri(verifierResponse, clientId),
    /authorizationDetails.clientMetadata must be an object/
  );
});

test("preserves an explicit verifier state and falls back to requestId", () => {
  const response = {
    requestId: "req-correlation",
    authorizationDetails: {
      clientId,
      responseType: "vp_token",
      responseMode: "direct_post",
      nonce: "nonce",
      state: "verifier-state",
      responseUri: "https://verify.example/response",
      presentationDefinition
    }
  };

  const params = new URL(
    createAuthorizationRequestUri(response, clientId)
  ).searchParams;

  assert.equal(params.get("state"), "verifier-state");
  delete response.authorizationDetails.state;
  const fallbackParams = new URL(
    createAuthorizationRequestUri(response, clientId)
  ).searchParams;
  assert.equal(fallbackParams.get("state"), "req-correlation");
});

test("uses a verifier-provided presentation definition URI by value", () => {
  const verifierResponse = {
    requestId: "req-by-value-uri",
    authorizationDetails: {
      clientId,
      responseType: "vp_token",
      responseMode: "direct_post",
      nonce: "verifier-nonce",
      responseUri: "https://verify.example/response",
      presentationDefinitionUri:
        "https://verify.example/definitions/age?version=1"
    }
  };

  const params = new URL(
    createAuthorizationRequestUri(verifierResponse, clientId)
  ).searchParams;

  assert.equal(
    params.get("presentation_definition_uri"),
    "https://verify.example/definitions/age?version=1"
  );
  assert.equal(params.has("presentation_definition"), false);
});

test("builds a by-reference QR URI from the verifier request URI", () => {
  const verifierResponse = {
    transactionId: "txn-reference",
    requestUri:
      "https://verify.example/vp-request/req_reference?key=value"
  };

  const qrUri = createAuthorizationRequestUri(
    verifierResponse,
    "did:web:verify.example"
  );
  const params = new URL(qrUri).searchParams;

  assert.equal(
    params.get("client_id"),
    "did:web:verify.example"
  );
  assert.equal(
    params.get("request_uri"),
    verifierResponse.requestUri
  );
  assert.deepEqual(
    Array.from(params.keys()).sort(),
    ["client_id", "request_uri"]
  );
});

test("rejects a verifier response that ambiguously includes both variants", () => {
  assert.throws(
    () => createAuthorizationRequestUri(
      {
        requestId: "req-ambiguous",
        requestUri: "https://verify.example/request",
        authorizationDetails: {}
      },
      clientId
    ),
    /either requestUri or authorizationDetails, not both/
  );
});

test("rejects missing or invalid verifier request data", () => {
  const validByValue = {
    requestId: "req-valid",
    authorizationDetails: {
      clientId,
      responseType: "vp_token",
      responseMode: "direct_post",
      nonce: "nonce",
      responseUri: "https://verify.example/response",
      presentationDefinition
    }
  };

  assert.throws(
    () => createAuthorizationRequestUri(validByValue, ""),
    /INJI_VERIFY_CLIENT_ID is required/
  );
  assert.throws(
    () => createAuthorizationRequestUri(null, clientId),
    /Verifier response must be an object/
  );
  assert.throws(
    () => createAuthorizationRequestUri(
      { ...validByValue, requestId: "" },
      clientId
    ),
    /requestId is required/
  );
  assert.throws(
    () => createAuthorizationRequestUri(
      {
        ...validByValue,
        authorizationDetails: {
          ...validByValue.authorizationDetails,
          clientId: "different-client"
        }
      },
      clientId
    ),
    /does not match INJI_VERIFY_CLIENT_ID/
  );
  assert.throws(
    () => createAuthorizationRequestUri(
      {
        requestId: "req-invalid",
        authorizationDetails: {
          ...validByValue.authorizationDetails,
          responseUri: "not-a-url"
        }
      },
      clientId
    ),
    /responseUri must be an absolute HTTP\(S\) URL/
  );
  assert.throws(
    () => createAuthorizationRequestUri(
      {
        requestId: "req-invalid",
        authorizationDetails: {
          ...validByValue.authorizationDetails,
          presentationDefinition: undefined
        }
      },
      clientId
    ),
    /must include a presentationDefinition, presentationDefinitionUri, or dcqlQuery/
  );
  assert.throws(
    () => createAuthorizationRequestUri(
      {
        requestId: "req-invalid",
        requestUri: "javascript:alert(1)"
      },
      clientId
    ),
    /requestUri must be an absolute HTTP\(S\) URL/
  );
});

test("rejects wallet endpoints that use loopback or Docker-only addresses", () => {
  const authorizationDetails = {
    clientId,
    responseType: "vp_token",
    responseMode: "direct_post",
    nonce: "nonce",
    responseUri: "https://verify.example/response",
    presentationDefinition
  };

  for (const responseUri of [
    "http://localhost:8080/response",
    "http://127.0.0.1:8080/response",
    "http://host.docker.internal:8080/response"
  ]) {
    assert.throws(
      () => createAuthorizationRequestUri(
        {
          requestId: "req-unreachable",
          authorizationDetails: {
            ...authorizationDetails,
            responseUri
          }
        },
        clientId
      ),
      /must use an address reachable by the mobile wallet/
    );
  }
});
