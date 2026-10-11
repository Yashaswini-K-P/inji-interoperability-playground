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
      protocols: this.config.protocols,
      capabilities: {
        createPresentationRequest: true,
        retrieveVerificationResult: true
      }
    };
  }

  getBaseUrl() {
    let baseUrl;

    try {
      baseUrl = new URL(this.config.baseUrl);
    } catch (cause) {
      const error = new Error(
        "INJI_VERIFY_URL must be configured as an absolute HTTP(S) URL"
      );
      error.code = "VERIFIER_URL_NOT_CONFIGURED";
      error.statusCode = 503;
      error.cause = cause;
      throw error;
    }

    if (
      !["http:", "https:"].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password
    ) {
      const error = new Error(
        "INJI_VERIFY_URL must be configured as an absolute HTTP(S) URL"
      );
      error.code = "VERIFIER_URL_NOT_CONFIGURED";
      error.statusCode = 503;
      throw error;
    }

    return this.config.baseUrl.replace(/\/+$/, "");
  }

  async createPresentationRequest({
    clientId,
    presentationDefinition
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
      `${this.getBaseUrl()}/v1/verify/vp-request`;

    const response = await axios.post(url, {
      clientId: configuredClientId,
      presentationDefinition
    });

    return response.data;
  }

  async getPresentationResult({ transactionId }) {
    if (
      typeof transactionId !== "string" ||
      !transactionId.trim()
    ) {
      throw new Error("transactionId is required");
    }

    const url =
      `${this.getBaseUrl()}/v2/vp-results/${encodeURIComponent(transactionId)}`;
    const response = await axios.post(
      url,
      {
        skipStatusChecks: false,
        statusCheckFilters: [],
        includeClaims: false
      },
      { timeout: 15000 }
    );

    return response.data;
  }
}

module.exports = InjiVerifyAdapter;