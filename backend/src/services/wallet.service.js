const {
  getComponentById
} = require("./componentRegistry.service");

const InjiMobileAdapter = require("../adapters/wallets/injiMobile.adapter");

function getWalletAdapter(walletId) {
  const wallet = getComponentById("wallets", walletId);

  if (!wallet) {
    throw new Error(`Unknown wallet: ${walletId}`);
  }

  switch (wallet.id) {
    case "inji-mobile":
      return new InjiMobileAdapter(wallet);

    default:
      throw new Error(
        `No adapter available for wallet: ${wallet.id}`
      );
  }
}

function getWalletInfo(walletId) {
  const adapter = getWalletAdapter(walletId);

  return adapter.getInfo();
}

function createWalletContinuation(
  walletId,
  credentialOfferUri
) {
  const adapter = getWalletAdapter(walletId);

  return adapter.createCredentialOfferContinuation(
    credentialOfferUri
  );
}

function createPresentationRequestContinuation(
  walletId,
  verifierResponse,
  clientId
) {
  const adapter = getWalletAdapter(walletId);

  return adapter.createPresentationRequestContinuation(
    verifierResponse,
    clientId
  );
}

async function createCredentialRequest(
  walletId,
  data
) {
  const adapter = getWalletAdapter(walletId);

  if (typeof adapter.createCredentialRequest !== "function") {
    const error = new Error(
      `Wallet ${walletId} does not support credential request creation`
    );
    error.code = "WALLET_OPERATION_UNSUPPORTED";
    error.statusCode = 501;
    throw error;
  }

  return adapter.createCredentialRequest(data);
}

module.exports = {
  getWalletAdapter,
  getWalletInfo,
  createWalletContinuation,
  createPresentationRequestContinuation,
  createCredentialRequest
};
