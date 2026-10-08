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
      type: "openid-credential-offer"
    };
  }
}

module.exports = InjiMobileAdapter;