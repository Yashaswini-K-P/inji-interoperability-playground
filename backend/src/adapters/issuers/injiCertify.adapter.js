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
}

module.exports = InjiCertifyAdapter;