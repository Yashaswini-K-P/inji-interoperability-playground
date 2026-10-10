const axios = require("axios");

class InjiVerifyAdapter {
  constructor(config) {
    this.config = config;
  }

  getInfo() {
    return {
      id: this.config.id,
      name: this.config.name,
      version: this.config.version,
      clientId: this.config.clientId,
      protocols: this.config.protocols
    };
  }

  async createPresentationRequest({
    clientId,
    presentationDefinition,
    nonce,
    transactionId
  }) {
    if (!presentationDefinition) {
      throw new Error("presentationDefinition is required");
    }

    const configuredClientId =
      this.config.clientId?.trim();

    if (!configuredClientId) {
      const error = new Error(
        "INJI_VERIFY_CLIENT_ID must be configured with the verifier client ID accepted by the selected wallet"
      );
      error.code = "VERIFIER_CLIENT_ID_NOT_CONFIGURED";
      error.statusCode = 503;
      throw error;
    }

    if (clientId !== configuredClientId) {
      throw new Error(
        "clientId must match the configured INJI_VERIFY_CLIENT_ID"
      );
    }

    const url =
      `${this.config.baseUrl}/v1/verify/vp-request`;

    const response = await axios.post(url, {
      clientId: configuredClientId,
      presentationDefinition,
      nonce,
      transactionId
    });

    return response.data;
  }
}

module.exports = InjiVerifyAdapter;