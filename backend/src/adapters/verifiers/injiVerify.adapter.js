const axios = require("axios");

const VERIFY_API_PATH = "/v1/verify";
const REQUEST_STATUS_TIMEOUT_MS = 65000;
const RESULT_TIMEOUT_MS = 60000;

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
    response.transactionId.trim() &&
    (
      (
        typeof response.requestUri === "string" &&
        response.requestUri.trim()
      ) ||
      (
        response.authorizationDetails &&
        typeof response.authorizationDetails === "object" &&
        !Array.isArray(response.authorizationDetails)
      )
    )
  );
}

class InjiVerifyAdapter {
  constructor(config) {
    this.config = config;
  }

  /**
   * Return information about the verifier.
   */
  getInfo() {
    return {
      id: this.config.id,
      name: this.config.name,
      version: this.config.version,
      clientId: this.config.clientId,
      protocols: this.config.protocols,
      capabilities: {
        createPresentationRequest: true,
        retrieveVerificationResult: true,
      },
    };
  }

  /**
   * Validate and return the configured Verify base URL.
   */
  getBaseUrl() {
    let baseUrl;

    try {
      if (
        typeof this.config.baseUrl !== "string" ||
        !this.config.baseUrl.trim()
      ) {
        throw new Error("Base URL is empty");
      }

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
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      const error = new Error(
        "INJI_VERIFY_URL must be configured as an absolute HTTP(S) URL"
      );

      error.code = "VERIFIER_URL_NOT_CONFIGURED";
      error.statusCode = 503;

      throw error;
    }

    return baseUrl.toString().replace(/\/+$/, "");
  }

  getApiBaseUrl() {
    const baseUrl = new URL(this.getBaseUrl());
    const path = baseUrl.pathname.replace(/\/+$/, "");

    if (!path.endsWith(VERIFY_API_PATH)) {
      baseUrl.pathname = `${path}${VERIFY_API_PATH}`;
    }

    return baseUrl.toString().replace(/\/+$/, "");
  }

  /**
   * Create a Presentation Exchange request using Verify's 0.18.x API.
   */
  async createPresentationRequest({ clientId, presentationDefinition }) {
    if (!isPresentationDefinition(presentationDefinition)) {
      const error = new Error(
        "A valid presentationDefinition with a non-empty input_descriptors array is required"
      );

      error.code = "INVALID_PRESENTATION_DEFINITION";
      error.statusCode = 400;

      throw error;
    }

    // Validate the configured client ID.
    const configuredClientId =
      typeof this.config.clientId === "string"
        ? this.config.clientId.trim()
        : "";

    if (!configuredClientId) {
      const error = new Error(
        "INJI_VERIFY_CLIENT_ID must be configured"
      );

      error.code = "VERIFIER_CLIENT_ID_NOT_CONFIGURED";
      error.statusCode = 503;

      throw error;
    }

    if (!configuredClientId.startsWith("did:")) {
      const error = new Error(
        "INJI_VERIFY_CLIENT_ID must be a verifier DID for a DID-based OpenID4VP request"
      );
      error.code = "VERIFIER_CLIENT_ID_NOT_DID";
      error.statusCode = 503;
      throw error;
    }

    if (clientId !== configuredClientId) {
      const error = new Error(
        "clientId must match the configured INJI_VERIFY_CLIENT_ID"
      );

      error.code = "VERIFIER_CLIENT_ID_MISMATCH";
      error.statusCode = 400;

      throw error;
    }

    const url = `${this.getApiBaseUrl()}/vp-request`;
    const requestBody = {
      clientId: configuredClientId,
      presentationDefinition,
      acceptVPWithoutHolderProof: false,
      responseCodeValidationRequired: false,
    };

    try {
      const response = await axios.post(
        url,
        requestBody,
        {
          timeout: 15000,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      if (!isValidPresentationRequestResponse(response.data)) {
        const error = new Error(
          "Inji Verify returned a malformed presentation request response"
        );
        error.code = "INVALID_VERIFIER_RESPONSE";
        error.statusCode = 502;
        throw error;
      }

      if (
        configuredClientId.startsWith("did:") &&
        typeof response.data.requestUri !== "string"
      ) {
        const error = new Error(
          "Inji Verify did not return the request URI required for a DID-based request"
        );
        error.code = "REQUEST_URI_REQUIRED";
        error.statusCode = 502;
        throw error;
      }

      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Long-poll Verify's request status endpoint, which returns ACTIVE,
   * VP_SUBMITTED, or EXPIRED.
   */
  async getPresentationRequestStatus({ requestId }) {
    if (typeof requestId !== "string" || !requestId.trim()) {
      const error = new Error("requestId is required");
      error.code = "REQUEST_ID_REQUIRED";
      error.statusCode = 400;
      throw error;
    }

    const url =
      `${this.getApiBaseUrl()}/vp-request/` +
      `${encodeURIComponent(requestId)}/status`;

    const response = await axios.get(url, {
      timeout: REQUEST_STATUS_TIMEOUT_MS,
      headers: { Accept: "application/json" },
    });

    if (
      !response.data ||
      typeof response.data !== "object" ||
      !["ACTIVE", "VP_SUBMITTED", "EXPIRED"].includes(response.data.status)
    ) {
      const error = new Error(
        "Inji Verify returned a malformed presentation request status"
      );
      error.code = "INVALID_VERIFIER_STATUS";
      error.statusCode = 502;
      throw error;
    }

    return response.data;
  }

  /**
   * Retrieve the detailed verification result for a submitted transaction.
   */
  async getPresentationResult({ transactionId }) {
    if (
      typeof transactionId !== "string" ||
      !transactionId.trim()
    ) {
      const error = new Error("transactionId is required");

      error.code = "TRANSACTION_ID_REQUIRED";
      error.statusCode = 400;

      throw error;
    }

    const url =
      `${this.getApiBaseUrl()}/v2/vp-results/` +
      encodeURIComponent(transactionId);

    try {
      const response = await axios.post(
        url,
        {
          skipStatusChecks: false,
          statusCheckFilters: [],
          includeClaims: false,
        },
        {
          timeout: RESULT_TIMEOUT_MS,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      return response.data;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = InjiVerifyAdapter;