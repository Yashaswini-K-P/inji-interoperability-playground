const {
  getComponentById
} = require("../services/componentRegistry.service");
const { hasIssuerAdapter } = require("../services/issuer.service");
const { hasWalletAdapter } = require("../services/wallet.service");
const { hasVerifierAdapter } = require("../services/verifier.service");

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
  } else if (!hasIssuerAdapter(issuer.id)) {
    errors.push(
      `Issuer ${issuer.name} is registered but has no implemented adapter`
    );
  }

  if (!wallet) {
    errors.push(`Unknown wallet: ${configuration.wallet}`);
  } else if (!hasWalletAdapter(wallet.id)) {
    errors.push(
      `Wallet ${wallet.name} is registered but has no implemented adapter`
    );
  }

  if (!verifier) {
    errors.push(`Unknown verifier: ${configuration.verifier}`);
  } else if (!hasVerifierAdapter(verifier.id)) {
    errors.push(
      `Verifier ${verifier.name} is registered but has no implemented adapter`
    );
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