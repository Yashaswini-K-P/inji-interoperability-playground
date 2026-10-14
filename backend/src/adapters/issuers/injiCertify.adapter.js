const axios = require("axios");
const UPSTREAM_TIMEOUT_MS = 15000;

class InjiCertifyAdapter {
  constructor(config) {
    this.config = config;
  }

  async getMetadata() {
    const url = `${this.config.baseUrl}/.well-known/openid-credential-issuer`;

    const response = await axios.get(url, {
      timeout: UPSTREAM_TIMEOUT_MS
    });

    return response.data;
  }

  async getCredentials() {
    const metadata = await this.getMetadata();

    const configurations =
      metadata.credential_configurations_supported || {};

    return Object.entries(configurations).map(
      ([id, configuration]) => ({
        id,
        format: configuration.format,
        scope: configuration.scope,
        credentialDefinition:
          configuration.credential_definition || null,
        doctype: configuration.doctype || null,
        vct: configuration.vct || null,
        bindingMethods:
          configuration.cryptographic_binding_methods_supported || [],
        signingAlgorithms:
          configuration.credential_signing_alg_values_supported || [],
        proofAlgorithms:
          configuration.proof_types_supported?.jwt
            ?.proof_signing_alg_values_supported || [],
        claims: Object.keys(
          configuration.credential_definition?.credentialSubject || {}
        )
      })
    );
  }

  async createPreAuthorizedOffer({
    credentialConfigurationId,
    claims = {},
    expiresIn = 600,
    txCode
  }) {
    const url =
      `${this.config.baseUrl}/v1/certify/pre-authorized-data`;

    const requestBody = {
      credential_configuration_id: credentialConfigurationId,
      claims,
      expires_in: expiresIn
    };
    if (typeof txCode === "string" && txCode.length > 0) {
      requestBody.tx_code = txCode;
    }

    const response = await axios.post(
      url,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;
  }

  async getCredentialOffer(offerId) {
    const url =
      `${this.config.baseUrl}/v1/certify/credential-offer-data/${offerId}`;

    const response = await axios.get(url);

    const data = response.data;

    if (data.errors && data.errors.length > 0) {
      throw new Error(
        data.errors
          .map(error => error.errorMessage || error.errorCode)
          .join("; ")
      );
    }

    return data;
  }

  async requestToken({
    preAuthorizedCode,
    txCode
  }) {
    const tokenRequest = new URLSearchParams({
      grant_type:
        "urn:ietf:params:oauth:grant-type:pre-authorized_code",
      "pre-authorized_code": preAuthorizedCode
    });
    if (typeof txCode === "string" && txCode.length > 0) {
      tokenRequest.append("tx_code", txCode);
    }

    const response = await axios.post(
      `${this.config.baseUrl}/v1/certify/oauth/token`,
      tokenRequest.toString(),
      {
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
          Accept: "application/json"
        }
      }
    );

    return response.data;
  }

  async requestCredential({
    accessToken,
    format,
    credentialDefinition,
    doctype,
    vct,
    proof
  }) {
    const response = await axios.post(
      `${this.config.baseUrl}/v1/certify/issuance/credential`,
      {
        format,
        ...(credentialDefinition
          ? { credential_definition: credentialDefinition }
          : {}),
        ...(doctype ? { doctype } : {}),
        ...(vct ? { vct } : {}),
        proof
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        timeout: UPSTREAM_TIMEOUT_MS
      }
    );

    return response.data;
  }
}

module.exports = InjiCertifyAdapter;