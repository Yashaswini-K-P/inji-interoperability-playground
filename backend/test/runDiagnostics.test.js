const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRunDiagnostics,
  getUrlConfigurationStatus,
  getConfigurationStatus
} = require("../src/services/runDiagnostics.service");

const readiness = {
  issuer: {
    componentId: "inji-certify",
    adapter: "AVAILABLE",
    configuration: "CONFIGURED",
    connectivity: "NOT_CHECKED"
  },
  wallet: {
    componentId: "inji-mobile",
    adapter: "AVAILABLE",
    configuration: "NOT_REQUIRED",
    connectivity: "NOT_APPLICABLE"
  },
  verifier: {
    componentId: "inji-verify",
    adapter: "AVAILABLE",
    configuration: "CONFIGURED",
    connectivity: "NOT_CHECKED"
  }
};

test("classifies configuration without returning configured values", () => {
  assert.equal(getUrlConfigurationStatus(undefined), "MISSING");
  assert.equal(
    getUrlConfigurationStatus("not-a-url"),
    "INVALID"
  );
  assert.equal(
    getUrlConfigurationStatus("http://user:password@example.test"),
    "INVALID"
  );
  assert.equal(
    getUrlConfigurationStatus("https://issuer.example"),
    "CONFIGURED"
  );
  assert.equal(
    getConfigurationStatus({
      baseUrl: "CONFIGURED",
      clientId: "MISSING"
    }),
    "MISSING"
  );
  assert.equal(
    getConfigurationStatus({
      baseUrl: "INVALID",
      clientId: "MISSING"
    }),
    "INVALID"
  );
});

test("reports prepared wallet actions as pending and leaves outcomes unconfirmed", () => {
  const diagnostics = createRunDiagnostics({
    runId: "RUN-DIAGNOSTICS",
    scenario: {
      issuer: "inji-certify",
      wallet: "inji-mobile",
      verifier: "inji-verify"
    },
    offer: { credentialOfferUri: "credential_offer_uri:redacted" },
    presentationRequest: {
      authorizationRequest: { requestUri: "request-uri-not-returned" }
    },
    exchanges: [
      {
        stepName: "Wallet Handoff",
        status: "READY"
      },
      {
        stepName: "Authorization URI Generation",
        status: "READY"
      }
    ]
  }, readiness);

  assert.deepEqual(diagnostics.preparedActions, {
    credentialOffer: "PREPARED",
    issuanceWalletHandoff: "PREPARED",
    presentationRequest: "PREPARED",
    presentationWalletHandoff: "PREPARED"
  });
  assert.equal(diagnostics.connectivity.status, "NOT_CHECKED");
  assert.equal(diagnostics.issuance.credentialRequest, "UNSUPPORTED");
  assert.equal(diagnostics.issuance.credential, "NOT_CONFIRMED");
  assert.equal(diagnostics.outcome.status, "UNCONFIRMED");
  assert.deepEqual(
    diagnostics.pendingExternalActions.map(({ action }) => action),
    [
      "credential-offer-wallet-scan",
      "wallet-presentation-submission"
    ]
  );
  assert.equal(
    JSON.stringify(diagnostics).includes("credential_offer_uri:redacted"),
    false
  );
  assert.equal(
    JSON.stringify(diagnostics).includes("request-uri-not-returned"),
    false
  );
});

test("reports only a stored verifier summary as a confirmed outcome", () => {
  const diagnostics = createRunDiagnostics({
    runId: "RUN-VERIFIED",
    scenario: {
      issuer: "inji-certify",
      wallet: "inji-mobile",
      verifier: "inji-verify"
    },
    exchanges: [],
    verificationResult: {
      transactionId: "txn-authoritative",
      allChecksSuccessful: true,
      credentialCount: 1
    }
  }, readiness);

  assert.deepEqual(diagnostics.outcome, {
    status: "CONFIRMED",
    result: "PASS"
  });
  assert.deepEqual(diagnostics.pendingExternalActions, []);
});

test("does not turn a failed run into a verification FAIL without verifier evidence", () => {
  const diagnostics = createRunDiagnostics({
    runId: "RUN-PRE-VERIFY-FAIL",
    status: "FAILED",
    result: null,
    scenario: {},
    exchanges: []
  }, {
    issuer: { adapter: "UNAVAILABLE", configuration: "MISSING" },
    wallet: { adapter: "UNAVAILABLE", configuration: "NOT_REQUIRED" },
    verifier: { adapter: "UNAVAILABLE", configuration: "MISSING" }
  });

  assert.deepEqual(diagnostics.outcome, {
    status: "UNCONFIRMED",
    result: null
  });
  assert.equal(
    diagnostics.issuance.credentialRequest,
    "ADAPTER_UNAVAILABLE"
  );
  assert.equal(diagnostics.issuance.credential, "NOT_CONFIRMED");
});

test("does not echo unregistered component input or confirm malformed result data", () => {
  const diagnostics = createRunDiagnostics({
    runId: "RUN-MALFORMED",
    scenario: {
      issuer: "private-issuer-configuration",
      wallet: "private-wallet-configuration",
      verifier: "private-verifier-configuration"
    },
    exchanges: [],
    verificationResult: {
      allChecksSuccessful: false,
      credentialCount: 0
    },
    offer: {
      credentialOfferUri: "credential_offer_uri:secret"
    },
    credential: {
      rawCredential: "credential-secret"
    }
  });

  assert.deepEqual(diagnostics.components.issuer, {
    componentId: null,
    adapter: "UNAVAILABLE",
    configuration: {
      status: "NOT_REGISTERED",
      fields: {}
    },
    connectivity: "NOT_CHECKED"
  });
  assert.deepEqual(diagnostics.outcome, {
    status: "UNCONFIRMED",
    result: null
  });
  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes("private-"), false);
  assert.equal(serialized.includes("credential_offer_uri:secret"), false);
  assert.equal(serialized.includes("credential-secret"), false);
});
