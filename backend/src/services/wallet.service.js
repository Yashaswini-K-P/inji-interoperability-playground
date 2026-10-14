const {
  getComponentById
} = require("./componentRegistry.service");

const InjiMobileAdapter = require("../adapters/wallets/injiMobile.adapter");
const crypto = require("crypto");

const walletAdapterFactories = new Map([
  ["inji-mobile", (wallet) => new InjiMobileAdapter(wallet)]
]);
const playgroundIssuanceHandoffs = new Map();
const PLAYGROUND_OFFER_TYPE =
  "inji-interoperability-playground/credential-offer";
const HANDOFF_TTL_MS = 30 * 60 * 1000;

function getWalletAdapter(walletId) {
  const wallet = getComponentById("wallets", walletId);

  if (!wallet) {
    throw new Error(`Unknown wallet: ${walletId}`);
  }

  const createAdapter = walletAdapterFactories.get(wallet.id);

  if (!createAdapter) {
    throw new Error(`No adapter available for wallet: ${wallet.id}`);
  }

  return createAdapter(wallet);
}

function hasWalletAdapter(walletId) {
  return walletAdapterFactories.has(walletId);
}

function getWalletInfo(walletId) {
  const adapter = getWalletAdapter(walletId);

  return adapter.getInfo();
}

function createWalletContinuation(
  walletId,
  credentialOfferUri
) {
  const adapter = getWalletAdapter(walletId);

  return adapter.createCredentialOfferContinuation(
    credentialOfferUri
  );
}

function createPlaygroundCredentialOfferHandoff(
  runId,
  credentialOfferUri,
  publicBaseUrl
) {
  if (
    typeof runId !== "string" ||
    !runId.trim() ||
    typeof credentialOfferUri !== "string" ||
    !credentialOfferUri.trim()
  ) {
    throw new Error("runId and credentialOfferUri are required");
  }

  if (typeof publicBaseUrl !== "string" || !publicBaseUrl.trim()) {
    const configurationError = new Error(
      "Set PLAYGROUND_PUBLIC_URL to the externally reachable HTTPS origin used by Inji Mobile"
    );
    configurationError.code = "PLAYGROUND_PUBLIC_URL_REQUIRED";
    configurationError.statusCode = 503;
    throw configurationError;
  }

  let baseUrl;
  try {
    baseUrl = new URL(publicBaseUrl);
  } catch (error) {
    const configurationError = new Error(
      "PLAYGROUND_PUBLIC_URL must be a valid externally reachable HTTPS URL"
    );
    configurationError.code = "PLAYGROUND_PUBLIC_URL_INVALID";
    configurationError.statusCode = 503;
    throw configurationError;
  }

  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    ["localhost", "::1", "[::1]", "0.0.0.0"].includes(
      baseUrl.hostname.toLowerCase()
    ) ||
    baseUrl.hostname.toLowerCase().startsWith("127.")
  ) {
    const configurationError = new Error(
      "PLAYGROUND_PUBLIC_URL must use HTTPS and be reachable by the mobile wallet"
    );
    configurationError.code = "PLAYGROUND_PUBLIC_URL_INVALID";
    configurationError.statusCode = 503;
    throw configurationError;
  }

  const now = Date.now();
  for (const [id, handoff] of playgroundIssuanceHandoffs) {
    if (handoff.expiresAt <= now) {
      playgroundIssuanceHandoffs.delete(id);
    }
  }

  let handoff = playgroundIssuanceHandoffs.get(runId);
  if (!handoff) {
    const callbackToken = crypto.randomBytes(32).toString("base64url");
    const callbackUrl = new URL(
      `/api/wallet/runs/${encodeURIComponent(runId)}/issuance-outcome`,
      baseUrl
    ).toString();
    const envelope = {
      type: PLAYGROUND_OFFER_TYPE,
      version: 1,
      credentialOfferUri,
      runId,
      callbackUrl,
      callbackToken
    };

    handoff = {
      callbackTokenHash: crypto
        .createHash("sha256")
        .update(callbackToken)
        .digest(),
      qrPayload: JSON.stringify(envelope),
      expiresAt: now + HANDOFF_TTL_MS
    };
    playgroundIssuanceHandoffs.set(runId, handoff);
  }

  return {
    qrPayload: handoff.qrPayload,
    handoffMethod: "inji-mobile-playground-offer-qr",
    callbackExpiresAt: new Date(handoff.expiresAt).toISOString()
  };
}

function hasValidPlaygroundCredentialHandoffToken(runId, callbackToken) {
  const handoff = playgroundIssuanceHandoffs.get(runId);
  if (
    !handoff ||
    handoff.expiresAt <= Date.now() ||
    typeof callbackToken !== "string"
  ) {
    return false;
  }

  const candidateHash = crypto
    .createHash("sha256")
    .update(callbackToken)
    .digest();
  return crypto.timingSafeEqual(handoff.callbackTokenHash, candidateHash);
}

function clearPlaygroundCredentialOfferHandoff(runId) {
  playgroundIssuanceHandoffs.delete(runId);
}

function createPresentationRequestContinuation(
  walletId,
  verifierResponse,
  clientId
) {
  const adapter = getWalletAdapter(walletId);

  return adapter.createPresentationRequestContinuation(
    verifierResponse,
    clientId
  );
}

async function createCredentialRequest(
  walletId,
  data
) {
  const adapter = getWalletAdapter(walletId);

  if (typeof adapter.createCredentialRequest !== "function") {
    const error = new Error(
      `Wallet ${walletId} does not support credential request creation`
    );
    error.code = "WALLET_OPERATION_UNSUPPORTED";
    error.statusCode = 501;
    throw error;
  }

  return adapter.createCredentialRequest(data);
}

module.exports = {
  getWalletAdapter,
  hasWalletAdapter,
  getWalletInfo,
  createWalletContinuation,
  createPlaygroundCredentialOfferHandoff,
  hasValidPlaygroundCredentialHandoffToken,
  clearPlaygroundCredentialOfferHandoff,
  createPresentationRequestContinuation,
  createCredentialRequest
};
