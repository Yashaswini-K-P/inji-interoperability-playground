const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
