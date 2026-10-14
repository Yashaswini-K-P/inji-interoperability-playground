const {
  getIssuerAdapter,
  getCredentialConfiguration
} = require("./issuer.service");

async function createPreAuthorizedOffer(
  issuerId,
  {
    credentialConfigurationId,
    claims = {},
    expiresIn = 600,
    txCode
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

async function createPreAuthorizedOfferForRun(
  runId,
  issuerId,
  {
    credentialConfigurationId,
    claims = {},
    expiresIn = 600,
    txCode
  }
) {
  const adapter = getIssuerAdapter(issuerId);

  const startTime = Date.now();

  try {
    const offer = await adapter.createPreAuthorizedOffer({
      credentialConfigurationId,
      claims,
      expiresIn,
      txCode
    });

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      offer,
      durationMs
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    return {
      success: false,
      durationMs,
      diagnostic: {
        upstreamStatus: Number.isInteger(error.response?.status)
          ? error.response.status
          : null
      }
    };
  }
}

async function requestToken(
  issuerId,
  {
    preAuthorizedCode,
    txCode
  }
) {
  const adapter = getIssuerAdapter(issuerId);

  return adapter.requestToken({
    preAuthorizedCode,
    txCode
  });
}

async function requestCredential(
  issuerId,
  {
    accessToken,
    format,
    credentialDefinition,
    doctype,
    vct,
    proof
  }
) {
  const adapter = getIssuerAdapter(issuerId);

  return adapter.requestCredential({
    accessToken,
    format,
    credentialDefinition,
    doctype,
    vct,
    proof
  });
}

module.exports = {
  createPreAuthorizedOffer,
  getCredentialOffer,
  createPreAuthorizedOfferForRun,
  requestToken,
  requestCredential,
  getCredentialConfiguration
};