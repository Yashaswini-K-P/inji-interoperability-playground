class InjiMobileAdapter {
  constructor(config) {
    this.config = config;
  }

  async createProof({
    cNonce,
    credentialIssuer,
    algorithm = "RS256"
  }) {
    throw new Error(
      "Inji Mobile proof generation is not implemented yet"
    );
  }
}

module.exports = InjiMobileAdapter;