const {
  createAuthorizationRequestUri
} = require("./openid4vpQr");

class InjiMobileAdapter {
  constructor(config) {
    this.config = config;
  }

  getInfo() {
    return {
      id: this.config.id,
      name: this.config.name,
      platforms: this.config.platforms,
      protocols: this.config.protocols
    };
  }

  createCredentialOfferContinuation(credentialOfferUri) {
    if (!credentialOfferUri) {
      throw new Error("credentialOfferUri is required");
    }

    return {
      walletId: this.config.id,
      wallet: this.config.name,
      protocol: "openid4vci",
      credentialOfferUri,
      type: "openid-credential-offer",
      status: "READY"
    };
  }

  createPresentationRequestContinuation(
    verifierResponse,
    clientId
  ) {
    return {
      walletId: this.config.id,
      wallet: this.config.name,
      protocol: "openid4vp",
      handoffMethod: "cross-device-qr",
      verifierResponse,
      qrUri: createAuthorizationRequestUri(
        verifierResponse,
        clientId
      ),
      status: "READY"
    };
  }
}

module.exports = InjiMobileAdapter;