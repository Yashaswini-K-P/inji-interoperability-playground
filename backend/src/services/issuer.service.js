const {
  getComponentById
} = require("./componentRegistry.service");

const InjiCertifyAdapter = require("../adapters/issuers/injiCertify.adapter");
const issuanceFlows = require("../config/issuanceFlows");

const issuerAdapterFactories = new Map([
  ["inji-certify", (issuer) => new InjiCertifyAdapter(issuer)]
]);

function getIssuerAdapter(issuerId) {
  const issuer = getComponentById("issuers", issuerId);

  if (!issuer) {
    throw new Error(`Unknown issuer: ${issuerId}`);
  }

  const createAdapter = issuerAdapterFactories.get(issuer.id);

  if (!createAdapter) {
    throw new Error(`No adapter available for issuer: ${issuer.id}`);
  }

  return createAdapter(issuer);
}

function hasIssuerAdapter(issuerId) {
  return issuerAdapterFactories.has(issuerId);
}

async function getIssuerCredentials(issuerId) {
  const adapter = getIssuerAdapter(issuerId);

  const credentials = await adapter.getCredentials();

  return credentials.map((credential) => ({
    ...credential,
    issuanceFlows: Object.values(issuanceFlows)
  }));
}
async function getCredentialConfiguration(
  issuerId,
  credentialConfigurationId
) {
  const adapter = getIssuerAdapter(issuerId);

  const credentials = await adapter.getCredentials();

  const credential = credentials.find(
    (item) => item.id === credentialConfigurationId
  );

  if (!credential) {
    throw new Error(
      `Credential configuration not found: ${credentialConfigurationId}`
    );
  }

  return credential;
}


module.exports = {
  getIssuerAdapter,
  hasIssuerAdapter,
  getIssuerCredentials,
  getCredentialConfiguration
};