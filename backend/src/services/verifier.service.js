const {
  getComponentById
} = require("./componentRegistry.service");

const InjiVerifyAdapter =
  require("../adapters/verifiers/injiVerify.adapter");

function getVerifierAdapter(verifierId) {
  const verifier =
    getComponentById("verifiers", verifierId);

  if (!verifier) {
    throw new Error(`Unknown verifier: ${verifierId}`);
  }

  switch (verifier.id) {
    case "inji-verify":
      return new InjiVerifyAdapter(verifier);

    default:
      throw new Error(
        `No adapter available for verifier: ${verifier.id}`
      );
  }
}

function getVerifierInfo(verifierId) {
  const adapter = getVerifierAdapter(verifierId);

  return adapter.getInfo();
}

async function createPresentationRequest(
  verifierId,
  data
) {
  const adapter =
    getVerifierAdapter(verifierId);

  return adapter.createPresentationRequest(data);
}

function getVerifierClientId(verifierId) {
  const adapter = getVerifierAdapter(verifierId);
  const clientId = adapter.getInfo().clientId;

  if (!clientId) {
    const error = new Error(
      "INJI_VERIFY_CLIENT_ID must be configured with the verifier client ID accepted by the selected wallet"
    );
    error.code = "VERIFIER_CLIENT_ID_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }

  return clientId;
}

module.exports = {
  getVerifierAdapter,
  getVerifierInfo,
  getVerifierClientId,
  createPresentationRequest
};