const axios = require("axios");

class InjiCertifyAdapter {
  constructor(config) {
    this.config = config;
  }

  async getMetadata() {
    const url = `${this.config.baseUrl}/.well-known/openid-credential-issuer`;

    const response = await axios.get(url);

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
    txCode = "1234"
  }) {
    const url =
      `${this.config.baseUrl}/v1/certify/pre-authorized-data`;

    const response = await axios.post(
      url,
      {
        credential_configuration_id: credentialConfigurationId,
        claims,
        expires_in: expiresIn,
        tx_code: txCode
      },
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
    const response = await axios.post(
      `${this.config.baseUrl}/v1/certify/oauth/token`,
      new URLSearchParams({
        grant_type:
          "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        "pre-authorized_code": preAuthorizedCode,
        tx_code: txCode
      }).toString(),
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
  proof
}) {
  const tokenParts = accessToken.split(".");

  if (tokenParts.length === 3) {
    const tokenPayload = JSON.parse(
      Buffer.from(tokenParts[1], "base64url").toString()
    );

    console.log("=== ACCESS TOKEN DEBUG ===");
    console.log(JSON.stringify(tokenPayload, null, 2));
    console.log("==========================");
  }

  const response = await axios.post(
    `${this.config.baseUrl}/v1/certify/issuance/credential`,
    {
      format,
      credential_definition: credentialDefinition,
      proof
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    }
  );

  return response.data;
}
}

module.exports = InjiCertifyAdapter;