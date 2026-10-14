const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWalletContinuation,
  createPlaygroundCredentialOfferHandoff,
  hasValidPlaygroundCredentialHandoffToken,
  createCredentialRequest,
  getWalletInfo
} = require("../src/services/wallet.service");

test("reports the Inji Mobile adapter's implemented wallet operations", () => {
  const info = getWalletInfo("inji-mobile");

  assert.deepEqual(info.capabilities, {
    createCredentialOfferContinuation: true,
    createPresentationRequestContinuation: true,
    reportsCredentialStorage: true,
    createCredentialRequest: false
  });
});

test("prepares the Certify offer URI as the Inji Mobile QR payload", () => {
  const credentialOfferUri =
    "openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example%2Foffers%2F1";

  const continuation = createWalletContinuation(
    "inji-mobile",
    credentialOfferUri
  );

  assert.equal(continuation.handoffMethod, "cross-device-qr");
  assert.equal(continuation.qrPayload, credentialOfferUri);
  assert.equal(continuation.credentialOfferUri, credentialOfferUri);
  assert.equal(continuation.handoffStatus, "PREPARED");
  assert.equal(
    continuation.externalAction,
    "wallet-scan-not-observed"
  );
  assert.equal(continuation.status, "PENDING_EXTERNAL_ACTION");
});

test("creates an authenticated wallet callback envelope for an HTTPS public origin", () => {
  const runId = "RUN-HANDOFF-SECURE";
  const offerUri =
    "openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example%2Foffers%2Fsecure";
  const handoff = createPlaygroundCredentialOfferHandoff(
    runId,
    offerUri,
    "https://playground.example"
  );
  const envelope = JSON.parse(handoff.qrPayload);

  assert.equal(
    envelope.type,
    "inji-interoperability-playground/credential-offer"
  );
  assert.equal(envelope.version, 1);
  assert.equal(envelope.credentialOfferUri, offerUri);
  assert.equal(envelope.runId, runId);
  assert.equal(
    envelope.callbackUrl,
    `https://playground.example/api/wallet/runs/${runId}/issuance-outcome`
  );
  assert.equal(typeof envelope.callbackToken, "string");
  assert.equal(
    hasValidPlaygroundCredentialHandoffToken(
      runId,
      envelope.callbackToken
    ),
    true
  );
  assert.equal(
    hasValidPlaygroundCredentialHandoffToken(runId, "incorrect"),
    false
  );
  assert.equal(handoff.qrPayload.includes("test-access-token"), false);
});

test("requires a client-reachable HTTPS origin before creating a Mobile handoff", () => {
  assert.throws(
    () =>
      createPlaygroundCredentialOfferHandoff(
        "RUN-NO-PUBLIC-URL",
        "openid-credential-offer://issuer/offer",
        ""
      ),
    {
      code: "PLAYGROUND_PUBLIC_URL_REQUIRED",
      statusCode: 503
    }
  );
  assert.throws(
    () =>
      createPlaygroundCredentialOfferHandoff(
        "RUN-HTTP-URL",
        "openid-credential-offer://issuer/offer",
        "http://localhost:5000"
      ),
    {
      code: "PLAYGROUND_PUBLIC_URL_INVALID",
      statusCode: 503
    }
  );
});

test("returns an explicit unsupported-operation error for credential creation", async () => {
  await assert.rejects(
    createCredentialRequest("inji-mobile", {}),
    {
      code: "WALLET_OPERATION_UNSUPPORTED",
      statusCode: 501,
      message:
        "Wallet inji-mobile does not support credential request creation"
    }
  );
});
