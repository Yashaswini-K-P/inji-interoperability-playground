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

  async createCredentialRequest({
    accessToken,
    cNonce,
    credentialIssuer,
    credentialConfiguration
  }) {
    if (!accessToken) {
      throw new Error("accessToken is required");
    }

    if (!cNonce) {
      throw new Error("cNonce is required");
    }

    if (!credentialIssuer) {
      throw new Error("credentialIssuer is required");
    }

    if (!credentialConfiguration) {
      throw new Error("credentialConfiguration is required");
    }

    return {
      format: credentialConfiguration.format,
      credentialConfigurationId:
        credentialConfiguration.id,
      credentialIssuer,
      cNonce,
      accessToken
    };
  }
}

module.exports = InjiMobileAdapter;