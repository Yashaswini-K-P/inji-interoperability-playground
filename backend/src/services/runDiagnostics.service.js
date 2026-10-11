const {
  getComponentById
} = require("./componentRegistry.service");
const { hasIssuerAdapter } = require("./issuer.service");
const { hasWalletAdapter, getWalletInfo } = require("./wallet.service");
const { hasVerifierAdapter } = require("./verifier.service");

function getUrlConfigurationStatus(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "MISSING";
  }

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? "CONFIGURED"
      : "INVALID";
  } catch (error) {
    return "INVALID";
  }
}

function getConfigurationStatus(fields) {
  const statuses = Object.values(fields);

  if (statuses.includes("INVALID")) {
    return "INVALID";
  }

  return statuses.includes("MISSING") ? "MISSING" : "CONFIGURED";
}

function getComponentReadiness(role, componentId) {
  const componentType = `${role}s`;
  const component = getComponentById(componentType, componentId);

  if (!component) {
    return {
      componentId: null,
      adapter: "UNAVAILABLE",
      configuration: {
        status: "NOT_REGISTERED",
        fields: {}
      },
      connectivity: "NOT_CHECKED"
    };
  }

  let adapterAvailable;
  let configurationFields;

  if (role === "issuer") {
    adapterAvailable = hasIssuerAdapter(componentId);
    configurationFields = {
      baseUrl: getUrlConfigurationStatus(component.baseUrl)
    };
  } else if (role === "wallet") {
    adapterAvailable = hasWalletAdapter(componentId);
    configurationFields = {};
  } else {
    adapterAvailable = hasVerifierAdapter(componentId);
    configurationFields = {
      baseUrl: getUrlConfigurationStatus(component.baseUrl),
      clientId: component.clientId ? "CONFIGURED" : "MISSING"
    };
  }

  return {
    componentId,
    adapter: adapterAvailable ? "AVAILABLE" : "UNAVAILABLE",
    configuration: {
      status: role === "wallet"
        ? "NOT_REQUIRED"
        : getConfigurationStatus(configurationFields),
      fields: configurationFields
    },
    connectivity: role === "wallet" ? "NOT_APPLICABLE" : "NOT_CHECKED"
  };
}

function latestExchange(run, stepName) {
  return [...(run.exchanges || [])]
    .reverse()
    .find((exchange) =>
      (exchange.protocolStep || exchange.stepName) === stepName
    );
}

function preparedActionStatus(exchange) {
  if (!exchange) {
    return "NOT_PREPARED";
  }

  if (
    exchange.status === "READY" ||
    exchange.status === "PENDING_EXTERNAL_ACTION"
  ) {
    return "PREPARED";
  }

  return exchange.status === "FAILED" ? "FAILED" : "NOT_PREPARED";
}

function createRunDiagnostics(run, readiness = {
  issuer: getComponentReadiness("issuer", run.scenario?.issuer),
  wallet: getComponentReadiness("wallet", run.scenario?.wallet),
  verifier: getComponentReadiness("verifier", run.scenario?.verifier)
}) {
  const exchanges = run.exchanges || [];
  const offerPrepared = Boolean(run.offer?.credentialOfferUri);
  const issuanceHandoff = latestExchange(run, "Wallet Handoff");
  const presentationRequestPrepared = Boolean(
    run.presentationRequest?.authorizationRequest
  );
  const presentationHandoff = latestExchange(
    run,
    "Authorization URI Generation"
  );
  const verificationResult = run.verificationResult;
  const verificationFailure = run.verificationFailure;
  const hasValidVerificationResult =
    verificationResult &&
    typeof verificationResult.transactionId === "string" &&
    verificationResult.transactionId.length > 0 &&
    typeof verificationResult.allChecksSuccessful === "boolean" &&
    Number.isInteger(verificationResult.credentialCount) &&
    verificationResult.credentialCount > 0;
  const hasValidVerificationFailure =
    typeof verificationFailure?.code === "string" &&
    verificationFailure.code.trim().length > 0;
  const verificationOutcome = hasValidVerificationResult
    ? verificationResult.allChecksSuccessful
      ? "PASS"
      : "FAIL"
    : hasValidVerificationFailure
      ? "FAIL"
      : null;
  const walletInfo = readiness.wallet.adapter === "AVAILABLE"
    ? getWalletInfo(run.scenario?.wallet)
    : null;
  const credentialRequestCapability = !walletInfo
    ? "ADAPTER_UNAVAILABLE"
    : walletInfo.capabilities.createCredentialRequest
      ? "AVAILABLE"
      : "UNSUPPORTED";
  const pendingExternalActions = [];

  if (
    preparedActionStatus(issuanceHandoff) === "PREPARED" &&
    !verificationOutcome
  ) {
    pendingExternalActions.push({
      action: "credential-offer-wallet-scan",
      status: "PENDING",
      confirmation: "The wallet scan is not observed by this backend"
    });
  }

  if (presentationRequestPrepared && !verificationOutcome) {
    pendingExternalActions.push({
      action: "wallet-presentation-submission",
      status: "PENDING",
      confirmation: "A wallet submission has not been confirmed by Verify"
    });
  }

  const tokenExchange = latestExchange(run, "Token Request");

  return {
    runId: run.runId,
    components: readiness,
    connectivity: {
      status: "NOT_CHECKED",
      detail: "Diagnostics do not probe external component endpoints"
    },
    preparedActions: {
      credentialOffer: offerPrepared ? "PREPARED" : "NOT_PREPARED",
      issuanceWalletHandoff: preparedActionStatus(issuanceHandoff),
      presentationRequest: presentationRequestPrepared
        ? "PREPARED"
        : "NOT_PREPARED",
      presentationWalletHandoff: preparedActionStatus(presentationHandoff)
    },
    issuance: {
      tokenExchange:
        tokenExchange?.status === "SUCCESS"
          ? "CONFIRMED"
          : tokenExchange?.status === "FAILED"
            ? "FAILED"
            : "NOT_CONFIRMED",
      credentialRequest: credentialRequestCapability,
      credential: "NOT_CONFIRMED"
    },
    pendingExternalActions,
    outcome: verificationOutcome
      ? { status: "CONFIRMED", result: verificationOutcome }
      : { status: "UNCONFIRMED", result: null }
  };
}

module.exports = {
  createRunDiagnostics,
  getUrlConfigurationStatus,
  getConfigurationStatus
};
