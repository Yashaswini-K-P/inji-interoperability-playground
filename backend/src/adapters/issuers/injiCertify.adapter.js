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
}

module.exports = InjiCertifyAdapter;