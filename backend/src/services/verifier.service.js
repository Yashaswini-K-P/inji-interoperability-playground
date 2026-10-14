const {
  getComponentById
} = require("./componentRegistry.service");

const InjiVerifyAdapter =
  require("../adapters/verifiers/injiVerify.adapter");

const verifierAdapterFactories = new Map([
  ["inji-verify", (verifier) => new InjiVerifyAdapter(verifier)]
]);

function getVerifierAdapter(verifierId) {
  const verifier =
    getComponentById("verifiers", verifierId);

  if (!verifier) {
    throw new Error(`Unknown verifier: ${verifierId}`);
  }

  const createAdapter = verifierAdapterFactories.get(verifier.id);

  if (!createAdapter) {
    throw new Error(`No adapter available for verifier: ${verifier.id}`);
  }

  return createAdapter(verifier);
}

function hasVerifierAdapter(verifierId) {
  return verifierAdapterFactories.has(verifierId);
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

async function getPresentationResult(
  verifierId,
  data
) {
  const adapter = getVerifierAdapter(verifierId);

  if (typeof adapter.getPresentationResult !== "function") {
    const error = new Error(
      `Verifier ${verifierId} does not support result retrieval`
    );
    error.code = "VERIFIER_OPERATION_UNSUPPORTED";
    error.statusCode = 501;
    throw error;
  }

  return adapter.getPresentationResult(data);
}

async function getPresentationRequestStatus(
  verifierId,
  data
) {
  const adapter = getVerifierAdapter(verifierId);

  if (typeof adapter.getPresentationRequestStatus !== "function") {
    const error = new Error(
      `Verifier ${verifierId} does not support request status retrieval`
    );
    error.code = "VERIFIER_OPERATION_UNSUPPORTED";
    error.statusCode = 501;
    throw error;
  }

  return adapter.getPresentationRequestStatus(data);
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

  if (!clientId.startsWith("did:")) {
    const error = new Error(
      "INJI_VERIFY_CLIENT_ID must be the verifier DID used for a DID-based OpenID4VP request"
    );
    error.code = "VERIFIER_CLIENT_ID_NOT_DID";
    error.statusCode = 503;
    throw error;
  }

  return clientId;
}

module.exports = {
  getVerifierAdapter,
  hasVerifierAdapter,
  getVerifierInfo,
  getVerifierClientId,
  createPresentationRequest,
  getPresentationRequestStatus,
  getPresentationResult
};