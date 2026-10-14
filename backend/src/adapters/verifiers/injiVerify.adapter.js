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
      baseUrl.password
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

  /**
   * Create a presentation request using a DCQL query.
   */
  async createPresentationRequest({ clientId, dcqlQuery }) {
    console.log("VERIFY ADAPTER HIT", {
      hasClientId: Boolean(clientId),
      hasDcqlQuery: Boolean(dcqlQuery),
    });

    // Validate the DCQL query.
    if (
      !dcqlQuery ||
      typeof dcqlQuery !== "object" ||
      Array.isArray(dcqlQuery) ||
      !Array.isArray(dcqlQuery.credentials) ||
      dcqlQuery.credentials.length === 0
    ) {
      const error = new Error(
        "A valid dcqlQuery with a non-empty credentials array is required"
      );

      error.code = "INVALID_DCQL_QUERY";
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

    if (clientId !== configuredClientId) {
      const error = new Error(
        "clientId must match the configured INJI_VERIFY_CLIENT_ID"
      );

      error.code = "VERIFIER_CLIENT_ID_MISMATCH";
      error.statusCode = 400;

      throw error;
    }

    // Construct the Verify endpoint.
    const url = `${this.getBaseUrl()}/v2/vp-request`;

    console.log("SENDING INJI VERIFY REQUEST", {
      url,
      method: "POST",
    });

    try {
      const response = await axios.post(
        url,
        {
          clientId: configuredClientId,
          dcqlQuery,
        },
        {
          timeout: 15000,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      console.log("INJI VERIFY REQUEST SUCCESS", {
        status: response.status,
      });

      return response.data;
    } catch (error) {
      console.error(
        "Inji Verify HTTP status:",
        error.response?.status ?? "No HTTP response"
      );

      console.error(
        "Inji Verify error details:",
        JSON.stringify(
          error.response?.data ?? error.message,
          null,
          2
        )
      );

      throw error;
    }
  }

  /**
   * Retrieve the verification result for a transaction.
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
      `${this.getBaseUrl()}/v2/vp-results/` +
      encodeURIComponent(transactionId);

    console.log("RETRIEVING INJI VERIFY RESULT", {
      url,
      transactionId,
    });

    try {
      const response = await axios.post(
        url,
        {
          skipStatusChecks: false,
          statusCheckFilters: [],
          includeClaims: false,
        },
        {
          timeout: 15000,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      console.log("INJI VERIFY RESULT SUCCESS", {
        status: response.status,
      });

      return response.data;
    } catch (error) {
      console.error(
        "Inji Verify result HTTP status:",
        error.response?.status ?? "No HTTP response"
      );

      console.error(
        "Inji Verify result error details:",
        JSON.stringify(
          error.response?.data ?? error.message,
          null,
          2
        )
      );

      throw error;
    }
  }
}

module.exports = InjiVerifyAdapter;