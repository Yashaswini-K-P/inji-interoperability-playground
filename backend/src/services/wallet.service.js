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

module.exports = {
  getWalletAdapter,
  getWalletInfo,
  createWalletContinuation
};