const {
  getIssuerAdapter
} = require("./issuer.service");

async function createPreAuthorizedOffer(
  issuerId,
  {
    credentialConfigurationId,
    claims = {},
    expiresIn = 600,
    txCode = "1234"
  }
) {
  const adapter = getIssuerAdapter(issuerId);

  return adapter.createPreAuthorizedOffer({
    credentialConfigurationId,
    claims,
    expiresIn,
    txCode
  });
}


async function getCredentialOffer(
  issuerId,
  offerId
) {
  const adapter = getIssuerAdapter(issuerId);

  return adapter.getCredentialOffer(offerId);
}


module.exports = {
  createPreAuthorizedOffer,
  getCredentialOffer
};