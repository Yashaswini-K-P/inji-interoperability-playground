const axios = require("axios");

const VERIFY_API_PATH = "/v1/verify";

function isPresentationDefinition(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "string" &&
    value.id.trim() &&
    Array.isArray(value.input_descriptors) &&
    value.input_descriptors.length > 0 &&
    value.input_descriptors.every((descriptor) =>
      descriptor &&
      typeof descriptor === "object" &&
      !Array.isArray(descriptor) &&
      typeof descriptor.id === "string" &&
      descriptor.id.trim()
    )
  );
}

function isValidPresentationRequestResponse(response) {
  return Boolean(
    response &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    typeof response.requestId === "string" &&
    response.requestId.trim() &&
    typeof response.transactionId === "string" &&
    response.transactionId.trim()
  );
}

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
    if (!isPresentationDefinition(presentationDefinition)) {
      throw new Error(
        "presentationDefinition must include an id and non-empty input_descriptors with IDs"
      );
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
      `${this.getBaseUrl()}${VERIFY_API_PATH}/vp-request`;

    const response = await axios.post(url, {
      clientId: configuredClientId,
      presentationDefinition
    });

    if (!isValidPresentationRequestResponse(response?.data)) {
      const error = new Error(
        "Inji Verify returned a malformed presentation request response"
      );
      error.code = "INVALID_VERIFIER_RESPONSE";
      error.statusCode = 502;
      throw error;
    }

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
      `${this.getBaseUrl()}${VERIFY_API_PATH}/v2/vp-results/${encodeURIComponent(transactionId)}`;
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