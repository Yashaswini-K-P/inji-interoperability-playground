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

  return response.data;
}
}

module.exports = InjiCertifyAdapter;