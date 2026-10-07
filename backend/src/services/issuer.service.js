const {
  getComponentById
} = require("./componentRegistry.service");

const InjiCertifyAdapter = require("../adapters/issuers/injiCertify.adapter");

function getIssuerAdapter(issuerId) {
  const issuer = getComponentById("issuers", issuerId);

  if (!issuer) {
    throw new Error(`Unknown issuer: ${issuerId}`);
  }

  switch (issuer.id) {
    case "inji-certify":
      return new InjiCertifyAdapter(issuer);

    default:
      throw new Error(
        `No adapter available for issuer: ${issuer.id}`
      );
  }
}

module.exports = {
  getIssuerAdapter
};