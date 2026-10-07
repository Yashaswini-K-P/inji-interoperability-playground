const {
  getComponentById
} = require("../services/componentRegistry.service");

function validateScenario(configuration) {
  const errors = [];

  const issuer = getComponentById(
    "issuers",
    configuration.issuer
  );

  const wallet = getComponentById(
    "wallets",
    configuration.wallet
  );

  const verifier = getComponentById(
    "verifiers",
    configuration.verifier
  );

  if (!issuer) {
    errors.push(`Unknown issuer: ${configuration.issuer}`);
  }

  if (!wallet) {
    errors.push(`Unknown wallet: ${configuration.wallet}`);
  }

  if (!verifier) {
    errors.push(`Unknown verifier: ${configuration.verifier}`);
  }

  if (
    issuer &&
    configuration.issuanceProtocol &&
    !issuer.protocols.includes(configuration.issuanceProtocol)
  ) {
    errors.push(
      `Issuer ${issuer.name} does not support ${configuration.issuanceProtocol}`
    );
  }

  if (
    issuer &&
    configuration.credentialFormat &&
    !issuer.credentialFormats.includes(
      configuration.credentialFormat
    )
  ) {
    errors.push(
      `Issuer ${issuer.name} does not support ${configuration.credentialFormat}`
    );
  }

  if (
    wallet &&
    configuration.presentationProtocol &&
    !wallet.protocols.includes(
      configuration.presentationProtocol
    )
  ) {
    errors.push(
      `Wallet ${wallet.name} does not support ${configuration.presentationProtocol}`
    );
  }

  if (
    verifier &&
    configuration.presentationProtocol &&
    !verifier.protocols.includes(
      configuration.presentationProtocol
    )
  ) {
    errors.push(
      `Verifier ${verifier.name} does not support ${configuration.presentationProtocol}`
    );
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateScenario
};