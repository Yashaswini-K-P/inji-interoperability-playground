const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWalletContinuation,
  createCredentialRequest,
  getWalletInfo
} = require("../src/services/wallet.service");

test("reports the Inji Mobile adapter's implemented wallet operations", () => {
  const info = getWalletInfo("inji-mobile");

  assert.deepEqual(info.capabilities, {
    createCredentialOfferContinuation: true,
    createPresentationRequestContinuation: true,
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
  assert.equal(continuation.status, "READY");
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
