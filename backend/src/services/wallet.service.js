const {
  getComponentById
} = require("./componentRegistry.service");

const InjiMobileAdapter = require("../adapters/wallets/injiMobile.adapter");

const walletAdapterFactories = new Map([
  ["inji-mobile", (wallet) => new InjiMobileAdapter(wallet)]
]);

function getWalletAdapter(walletId) {
  const wallet = getComponentById("wallets", walletId);

  if (!wallet) {
    throw new Error(`Unknown wallet: ${walletId}`);
  }

  const createAdapter = walletAdapterFactories.get(wallet.id);

  if (!createAdapter) {
    throw new Error(`No adapter available for wallet: ${wallet.id}`);
  }

  return createAdapter(wallet);
}

function hasWalletAdapter(walletId) {
  return walletAdapterFactories.has(walletId);
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
  hasWalletAdapter,
  getWalletInfo,
  createWalletContinuation,
  createPresentationRequestContinuation,
  createCredentialRequest
};
