const express = require("express");

const {
  createPreAuthorizedOffer,
  getCredentialOffer,
  createPreAuthorizedOfferForRun,
  requestToken,
  requestCredential,
  getCredentialConfiguration
} = require("../services/issuance.service");

const {
  addExchange,
  getRun,
  setRunOffer,
  setRunIssuanceToken,
  clearRunIssuanceToken,
  getRunIssuanceToken,
  reserveRunCredentialRequest,
  releaseRunCredentialRequest,
  completeRunCredentialRequest,
  hasSubmittedRunCredentialRequest
} = require("../services/run.service");
const {
  clearPlaygroundCredentialOfferHandoff
} = require("../services/wallet.service");

const router = express.Router();

const SAFE_TOKEN_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_BAD_REQUEST",
  "ERR_BAD_RESPONSE",
  "ERR_NETWORK",
  "ERR_CANCELED"
]);

function createCredentialExchange(run, status, durationMs, error, diagnostic) {
  return {
    stepName: "Credential Request",
    protocol: "OpenID4VCI",
    direction: "playground-to-issuer",
    componentId: run.scenario?.issuer || null,
    status,
    durationMs,
    format: run.scenario?.format || null,
    error,
    ...(diagnostic ? { diagnostic } : {})
  };
}

function parseProofJwt(jwt, cNonce) {
  if (typeof jwt !== "string" || jwt.length > 16384) {
    return { valid: false, code: "INVALID_PROOF_JWT" };
  }

  const segments = jwt.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    return { valid: false, code: "INVALID_PROOF_JWT" };
  }

  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(segments[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    return { valid: false, code: "INVALID_PROOF_JWT" };
  }

  const hasJwk = Boolean(
    header &&
    header.jwk &&
    typeof header.jwk === "object" &&
    !Array.isArray(header.jwk)
  );
  const hasKid = typeof header?.kid === "string" && header.kid.length > 0;
  const privateJwkParameters = new Set([
    "d", "p", "q", "dp", "dq", "qi", "oth", "k"
  ]);
  const containsPrivateKey = hasJwk &&
    Object.keys(header.jwk).some((key) => privateJwkParameters.has(key));
  const validAudience = typeof claims?.aud === "string"
    ? claims.aud.length > 0
    : Array.isArray(claims?.aud) &&
      claims.aud.length > 0 &&
      claims.aud.every((audience) =>
        typeof audience === "string" && audience.length > 0
      );
  if (
    !header ||
    header.typ !== "openid4vci-proof+jwt" ||
    typeof header.alg !== "string" ||
    !header.alg ||
    header.alg.toLowerCase() === "none" ||
    hasJwk === hasKid ||
    (hasJwk && (containsPrivateKey || typeof header.jwk.kty !== "string")) ||
    (hasKid && !header.kid.startsWith("did:key:") &&
      !header.kid.startsWith("did:jwk:")) ||
    !claims ||
    claims.nonce !== cNonce ||
    !validAudience ||
    !Number.isFinite(claims.iat)
  ) {
    return { valid: false, code: "INVALID_PROOF_JWT" };
  }

  return { valid: true, algorithm: header.alg };
}

function createOfferExchange(status, durationMs, error, diagnostic) {
  return {
    stepName: "Pre-Authorized Data",
    protocol: "OpenID4VCI",
    direction: "playground-to-issuer",
    status,
    durationMs,
    error,
    ...(diagnostic ? { diagnostic } : {})
  };
}

router.post("/pre-authorized-offer", async (req, res) => {
  try {
    const {
      issuerId,
      credentialConfigurationId
    } = req.body;

    if (!issuerId || !credentialConfigurationId) {
      return res.status(400).json({
        success: false,
        error:
          "issuerId and credentialConfigurationId are required"
      });
    }

    const offer = await createPreAuthorizedOffer(
  issuerId,
  {
    credentialConfigurationId,
    claims: req.body.claims || {},
    expiresIn: req.body.expiresIn || 600,
    txCode: req.body.txCode
  }
);

    res.status(201).json({
      success: true,
      issuer: issuerId,
      credentialConfigurationId,
      offer
    });
  } catch (error) {
      res.status(502).json({
        success: false,
        error: "Failed to create credential offer",
        errorCode: "ISSUER_OFFER_REQUEST_FAILED",
        diagnostic: {
          upstreamStatus: Number.isInteger(error.response?.status)
            ? error.response.status
            : null
        }
    });
  }
});

router.get("/offers/:offerId", async (req, res) => {
  try {
    const issuerId = req.query.issuerId;

    if (!issuerId) {
      return res.status(400).json({
        success: false,
        error: "issuerId is required"
      });
    }

    const offer = await getCredentialOffer(
      issuerId,
      req.params.offerId
    );

    res.json({
      success: true,
      issuer: issuerId,
      offerId: req.params.offerId,
      offer
    });
  } catch (error) {
    console.error(
      "Credential offer retrieval error:",
      error.message
    );

    res.status(502).json({
      success: false,
      error: "Failed to retrieve credential offer",
      details: error.message
    });
  }
});

router.post(
  "/runs/:runId/pre-authorized-offer",
  async (req, res) => {
    const {
      issuerId,
      credentialConfigurationId,
      claims = {},
      expiresIn = 600,
      txCode
    } = req.body;

    const startTime = Date.now();
    let exchangeAttempted = false;

    try {
      const run = getRun(req.params.runId);

      if (!run) {
        return res.status(404).json({
          success: false,
          error: "Run not found",
          errorCode: "RUN_NOT_FOUND"
        });
      }

      if (!issuerId || !credentialConfigurationId) {
        return res.status(400).json({
          success: false,
          error: "issuerId and credentialConfigurationId are required",
          errorCode: "INVALID_OFFER_REQUEST"
        });
      }

      if (issuerId !== run.scenario.issuer) {
        return res.status(400).json({
          success: false,
          error: "issuerId must match the issuer configured for this run",
          errorCode: "RUN_ISSUER_MISMATCH"
        });
      }

      if (run.issuanceStatus === "STORED") {
        return res.status(409).json({
          success: false,
          error: "This run already has a credential stored by the wallet",
          errorCode: "CREDENTIAL_ALREADY_STORED"
        });
      }

      const result =
        await createPreAuthorizedOfferForRun(
          req.params.runId,
          issuerId,
          {
            credentialConfigurationId,
            claims,
            expiresIn,
            txCode
          }
        );

      const durationMs = Date.now() - startTime;

      if (!result.success) {
        exchangeAttempted = true;
        const exchange = addExchange(
          req.params.runId,
          createOfferExchange(
            "FAILED",
            result.durationMs,
            "Certify did not create the pre-authorized offer",
            {
              code: "ISSUER_OFFER_REQUEST_FAILED",
              upstreamStatus: result.diagnostic?.upstreamStatus || null,
              action: "Check Certify availability and the issuer configuration, then retry"
            }
          )
        );

        return res.status(502).json({
          success: false,
          error: "Certify did not create the pre-authorized offer",
          errorCode: "ISSUER_OFFER_REQUEST_FAILED",
          diagnostic: exchange.diagnostic,
          exchange
        });
      }

      const offerUri = result.offer?.credential_offer_uri;

      if (typeof offerUri !== "string" || !offerUri.trim()) {
        exchangeAttempted = true;
        const exchange = addExchange(
          req.params.runId,
          createOfferExchange(
            "FAILED",
            durationMs,
            "Certify returned an offer response without credential_offer_uri",
            {
              code: "INVALID_ISSUER_OFFER_RESPONSE",
              action: "Check the Certify offer response contract before retrying"
            }
          )
        );

        return res.status(502).json({
          success: false,
          error: "Certify returned an invalid offer response",
          errorCode: "INVALID_ISSUER_OFFER_RESPONSE",
          diagnostic: exchange.diagnostic,
          exchange
        });
      }

      setRunOffer(req.params.runId, {
        credentialOfferUri: offerUri,
        type: "openid-credential-offer"
      });
      clearPlaygroundCredentialOfferHandoff(req.params.runId);

      exchangeAttempted = true;
      const exchange = addExchange(
        req.params.runId,
        createOfferExchange("SUCCESS", durationMs, null)
      );

      res.status(201).json({
        success: true,
        offer: result.offer,
        exchange
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (!exchangeAttempted) {
        exchangeAttempted = true;
        let exchange;
        try {
          exchange = addExchange(
            req.params.runId,
            createOfferExchange(
              "ERROR",
              durationMs,
              "The Playground could not store or record the Certify offer",
              {
                code: "OFFER_LIFECYCLE_FAILED",
                action: "Check the run store and retry after resolving the reported server issue"
              }
            )
          );
        } catch (recordError) {
          return res.status(500).json({
            success: false,
            error: "The Playground could not record the offer operation",
            errorCode: "EXCHANGE_RECORDING_FAILED"
          });
        }

        return res.status(500).json({
          success: false,
          error: "The Playground could not store or record the Certify offer",
          errorCode: "OFFER_LIFECYCLE_FAILED",
          diagnostic: exchange.diagnostic,
          exchange
        });
      }

      return res.status(500).json({
        success: false,
        error: "The Playground could not record the offer operation",
        errorCode: "EXCHANGE_RECORDING_FAILED"
      });
    }
  }
);

router.get(
  "/runs/:runId/offers/:offerId",
  async (req, res) => {
    const startTime = Date.now();

    try {
      const run = getRun(req.params.runId);

      if (!run) {
        return res.status(404).json({
          success: false,
          error: "Run not found"
        });
      }

      const issuerId = run.scenario.issuer;

      const offer = await getCredentialOffer(
        issuerId,
        req.params.offerId
      );

      const durationMs = Date.now() - startTime;

      const exchange = addExchange(
        req.params.runId,
        {
          stepName: "Credential Offer",
          protocol: "OpenID4VCI",
          direction: "playground-to-issuer",
          status: "SUCCESS",
          durationMs,
          error: null
        }
      );

      res.json({
        success: true,
        offer,
        exchange
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;

      try {
        const exchange = addExchange(
          req.params.runId,
          {
            stepName: "Credential Offer",
            protocol: "OpenID4VCI",
            direction: "playground-to-issuer",
            status: "FAILED",
            durationMs,
            error: error.message
          }
        );

        res.status(502).json({
          success: false,
          error: "Failed to retrieve credential offer",
          exchange
        });
      } catch (runError) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  }
);

router.post(
  "/runs/:runId/token",
  async (req, res) => {
    const startTime = Date.now();

    try {
      const run = getRun(req.params.runId);

      if (!run) {
        return res.status(404).json({
          success: false,
          error: "Run not found"
        });
      }

      const issuerId = run.scenario.issuer;

      const {
        preAuthorizedCode,
        txCode
      } = req.body;

      if (!preAuthorizedCode) {
        return res.status(400).json({
          success: false,
          error: "preAuthorizedCode is required"
        });
      }

      clearRunIssuanceToken(req.params.runId);
      const token = await requestToken(
        issuerId,
        {
          preAuthorizedCode,
          txCode
        }
      );

      const durationMs = Date.now() - startTime;

      if (
        !token ||
        typeof token.access_token !== "string" ||
        !token.access_token.trim() ||
        typeof token.token_type !== "string" ||
        !token.token_type.trim()
      ) {
        const exchange = addExchange(
          req.params.runId,
          {
            stepName: "Token Request",
            protocol: "OpenID4VCI",
            direction: "playground-to-issuer",
            status: "FAILED",
            durationMs,
            error: "Certify returned an invalid token response",
            diagnostic: {
              code: "INVALID_TOKEN_RESPONSE",
              action: "Check Certify token endpoint configuration and response"
            }
          }
        );

        return res.status(502).json({
          success: false,
          error: "Certify returned an invalid token response",
          errorCode: "INVALID_TOKEN_RESPONSE",
          exchange
        });
      }

      const tokenMetadata = {
        tokenType:
          typeof token.token_type === "string"
            ? token.token_type
            : null,
        expiresIn:
          Number.isFinite(token.expires_in)
            ? token.expires_in
            : null,
        hasCNonce:
          typeof token.c_nonce === "string" &&
          token.c_nonce.length > 0
      };

      const exchange = addExchange(
        req.params.runId,
        {
          stepName: "Token Request",
          protocol: "OpenID4VCI",
          direction: "playground-to-issuer",
          status: "SUCCESS",
          durationMs,
          error: null
        }
      );
      setRunIssuanceToken(req.params.runId, {
        accessToken: token.access_token,
        cNonce: token.c_nonce,
        expiresIn: token.expires_in
      });

      res.json({
        success: true,
        token: {
          ...tokenMetadata,
          cNonce: token.c_nonce || null
        },
        exchange
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;

      const exchange = addExchange(
        req.params.runId,
        {
          stepName: "Token Request",
          protocol: "OpenID4VCI",
          direction: "playground-to-issuer",
          status: "FAILED",
          durationMs,
          error: "Token request failed",
          diagnostic: {
            code: SAFE_TOKEN_ERROR_CODES.has(error.code)
              ? error.code
              : null,
            upstreamStatus: error.response?.status || null
          }
        }
      );

      res.status(502).json({
        success: false,
        error: "Token request failed",
        exchange
      });
    }
  }
);

router.post("/runs/:runId/credential", async (req, res) => {
  const runId = req.params.runId;
  const startTime = Date.now();
  const run = getRun(runId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: "Run not found",
      errorCode: "RUN_NOT_FOUND"
    });
  }

  if (!run.scenario?.wallet) {
    return res.status(409).json({
      success: false,
      error: "No wallet is selected for this run",
      errorCode: "WALLET_NOT_SELECTED"
    });
  }

  if (run.scenario.issuer !== "inji-certify") {
    return res.status(501).json({
      success: false,
      error: "Credential issuance is not supported for this issuer adapter",
      errorCode: "ISSUER_CREDENTIAL_REQUEST_UNSUPPORTED"
    });
  }

  if (hasSubmittedRunCredentialRequest(runId)) {
    return res.status(409).json({
      success: false,
      error: "A credential request was already submitted for this run",
      errorCode: "CREDENTIAL_REQUEST_ALREADY_SUBMITTED"
    });
  }

  const recordPending = (error, errorCode, actionRequiredCode) => {
    let exchange;
    try {
      exchange = addExchange(
        runId,
        createCredentialExchange(
          run,
          "PENDING",
          Date.now() - startTime,
          error,
          {
            code: errorCode,
            owner: "selected-wallet",
            action: error
          }
        )
      );
    } catch {
      return res.status(500).json({
        success: false,
        error: "The Playground could not record the pending credential request",
        errorCode: "EXCHANGE_RECORDING_FAILED"
      });
    }

    return res.status(202).json({
      success: false,
      status: "PENDING_EXTERNAL_ACTION",
      error,
      errorCode,
      actionRequiredCode,
      exchange
    });
  };

  if (!run.offer?.credentialOfferUri) {
    return recordPending(
      "The run has no Certify credential offer to continue",
      "CREDENTIAL_OFFER_REQUIRED",
      "CREATE_AND_SCAN_CREDENTIAL_OFFER"
    );
  }

  const token = getRunIssuanceToken(runId);
  if (!token?.accessToken) {
    return recordPending(
      "A successful token exchange is required before credential issuance",
      "ACCESS_TOKEN_REQUIRED",
      "COMPLETE_WALLET_TOKEN_EXCHANGE"
    );
  }
  if (!token.cNonce) {
    return recordPending(
      "Certify did not provide c_nonce; a wallet proof cannot be validated",
      "C_NONCE_REQUIRED",
      "COMPLETE_TOKEN_EXCHANGE_WITH_C_NONCE"
    );
  }
  if (req.body?.proof?.proof_type !== "jwt" ||
      typeof req.body?.proof?.jwt !== "string") {
    return recordPending(
      "The wallet must provide proof.proof_type='jwt' and its signed proof.proof.jwt",
      "WALLET_PROOF_REQUIRED",
      "SUBMIT_WALLET_SIGNED_PROOF_JWT"
    );
  }

  const proofValidation = parseProofJwt(req.body.proof.jwt, token.cNonce);
  if (!proofValidation.valid) {
    let exchange;
    try {
      exchange = addExchange(
        runId,
        createCredentialExchange(
          run,
          "FAILED",
          Date.now() - startTime,
          "The wallet proof is malformed or does not match the run's c_nonce",
          {
            code: proofValidation.code,
            action: "Submit a wallet-signed OpenID4VCI proof JWT containing the current c_nonce"
          }
        )
      );
    } catch {
      return res.status(500).json({
        success: false,
        error: "The Playground could not record the invalid credential proof",
        errorCode: "EXCHANGE_RECORDING_FAILED"
      });
    }

    return res.status(400).json({
      success: false,
      error: "The wallet proof is malformed or does not match the run's c_nonce",
      errorCode: proofValidation.code,
      exchange
    });
  }

  if (!reserveRunCredentialRequest(runId)) {
    return res.status(409).json({
      success: false,
      error: "A credential request is already in progress or was already submitted for this run",
      errorCode: "CREDENTIAL_REQUEST_ALREADY_SUBMITTED"
    });
  }

  let submissionAttempted = false;
  try {
    const configuration = await getCredentialConfiguration(
      run.scenario.issuer,
      run.scenario.credential
    );
    const requestedFormat = run.scenario.format === "sd_jwt_vc"
      ? "vc+sd-jwt"
      : run.scenario.format;

    if (
      !configuration ||
      !["ldp_vc", "vc+sd-jwt", "mso_mdoc"].includes(configuration.format) ||
      (requestedFormat && requestedFormat !== configuration.format)
    ) {
      releaseRunCredentialRequest(runId);
      const exchange = addExchange(
        runId,
        createCredentialExchange(
          run,
          "UNSUPPORTED",
          Date.now() - startTime,
          "The selected credential format is not supported by Certify metadata",
          {
            code: "CREDENTIAL_FORMAT_UNSUPPORTED",
            action: "Select a credential configuration and format supported by Certify"
          }
        )
      );
      return res.status(422).json({
        success: false,
        error: "The selected credential format is not supported by Certify metadata",
        errorCode: "CREDENTIAL_FORMAT_UNSUPPORTED",
        exchange
      });
    }

    if (
      Array.isArray(configuration.proofAlgorithms) &&
      configuration.proofAlgorithms.length > 0
    ) {
      if (!configuration.proofAlgorithms.includes(proofValidation.algorithm)) {
        releaseRunCredentialRequest(runId);
        const exchange = addExchange(
          runId,
          createCredentialExchange(
            run,
            "FAILED",
            Date.now() - startTime,
            "The wallet proof algorithm is not supported by Certify metadata",
            {
              code: "UNSUPPORTED_PROOF_ALGORITHM",
              action: "Use an algorithm listed in the credential configuration's proof_types_supported metadata"
            }
          )
        );
        return res.status(400).json({
          success: false,
          error: "The wallet proof algorithm is not supported by Certify metadata",
          errorCode: "UNSUPPORTED_PROOF_ALGORITHM",
          exchange
        });
      }
    }

    if (
      (configuration.format === "ldp_vc" &&
        (!configuration.credentialDefinition ||
          !Array.isArray(configuration.credentialDefinition.type) ||
          configuration.credentialDefinition.type.length === 0)) ||
      (configuration.format === "vc+sd-jwt" &&
        (typeof configuration.vct !== "string" || !configuration.vct)) ||
      (configuration.format === "mso_mdoc" &&
        (typeof configuration.doctype !== "string" || !configuration.doctype))
    ) {
      releaseRunCredentialRequest(runId);
      const exchange = addExchange(
        runId,
        createCredentialExchange(
          run,
          "ERROR",
          Date.now() - startTime,
          "Certify metadata is missing fields required for the selected credential format",
          {
            code: "INVALID_ISSUER_CREDENTIAL_METADATA",
            action: "Check the credential configuration in Certify metadata"
          }
        )
      );
      return res.status(502).json({
        success: false,
        error: "Certify metadata is missing fields required for the selected credential format",
        errorCode: "INVALID_ISSUER_CREDENTIAL_METADATA",
        exchange
      });
    }

    submissionAttempted = true;
    const credentialResponse = await requestCredential(
      run.scenario.issuer,
      {
        accessToken: token.accessToken,
        format: configuration.format,
        credentialDefinition: configuration.credentialDefinition || null,
        doctype: configuration.doctype || null,
        vct: configuration.vct || null,
        proof: {
          proof_type: "jwt",
          jwt: req.body.proof.jwt
        }
      }
    );

    if (
      credentialResponse &&
      typeof credentialResponse.acceptance_token === "string" &&
      credentialResponse.acceptance_token.trim() &&
      !Object.hasOwn(credentialResponse, "credential")
    ) {
      completeRunCredentialRequest(runId);
      const exchange = addExchange(
        runId,
        createCredentialExchange(
          run,
          "PENDING",
          Date.now() - startTime,
          "Certify accepted the request for deferred credential delivery",
          {
            code: "CREDENTIAL_ACCEPTANCE_PENDING",
            action: "Deferred credential retrieval using acceptance_token is not implemented in the Playground"
          }
        )
      );
      return res.status(202).json({
        success: false,
        status: "PENDING_EXTERNAL_ACTION",
        error: "Certify accepted the request but did not return the credential",
        errorCode: "CREDENTIAL_ACCEPTANCE_PENDING",
        actionRequiredCode: "DEFERRED_CREDENTIAL_RETRIEVAL_NOT_SUPPORTED",
        exchange
      });
    }

    if (
      !credentialResponse ||
      (typeof credentialResponse.credential !== "string" &&
        (!credentialResponse.credential ||
          typeof credentialResponse.credential !== "object" ||
          Array.isArray(credentialResponse.credential) ||
          Object.keys(credentialResponse.credential).length === 0)) ||
      (typeof credentialResponse.credential === "string" &&
        !credentialResponse.credential.trim()) ||
      (credentialResponse.format &&
        credentialResponse.format !== configuration.format)
    ) {
      completeRunCredentialRequest(runId);
      const exchange = addExchange(
        runId,
        createCredentialExchange(
          run,
          "FAILED",
          Date.now() - startTime,
          "Certify returned a response without a usable credential",
          {
            code: "INVALID_ISSUER_CREDENTIAL_RESPONSE",
            action: "Check Certify's credential response contract; the request will not be resubmitted automatically"
          }
        )
      );
      return res.status(502).json({
        success: false,
        error: "Certify returned an invalid credential response",
        errorCode: "INVALID_ISSUER_CREDENTIAL_RESPONSE",
        exchange
      });
    }

    completeRunCredentialRequest(runId);
    const exchange = addExchange(
      runId,
      createCredentialExchange(
        run,
        "SUCCESS",
        Date.now() - startTime,
        null
      )
    );
    return res.json({
      success: true,
      status: "ISSUED",
      credential: credentialResponse,
      exchange
    });
  } catch (error) {
    const upstreamStatus = Number.isInteger(error.response?.status)
      ? error.response.status
      : null;
    const configurationMissing = !submissionAttempted &&
      typeof error.message === "string" &&
      error.message.startsWith("Credential configuration not found:");
    const submissionUncertain = submissionAttempted &&
      (upstreamStatus === null || upstreamStatus >= 500);
    if (submissionUncertain) {
      completeRunCredentialRequest(runId);
    } else {
      releaseRunCredentialRequest(runId);
    }

    let exchange;
    try {
      exchange = addExchange(
        runId,
        createCredentialExchange(
          run,
          configurationMissing
            ? "UNSUPPORTED"
            : submissionUncertain
              ? "ERROR"
              : "FAILED",
          Date.now() - startTime,
          configurationMissing
            ? "The selected credential configuration is not present in Certify metadata"
            : submissionAttempted
              ? "Certify did not issue the credential"
              : "The Playground could not retrieve the issuer credential configuration",
          {
            code: configurationMissing
              ? "CREDENTIAL_CONFIGURATION_NOT_FOUND"
              : submissionAttempted
                ? "ISSUER_CREDENTIAL_REQUEST_FAILED"
                : "ISSUER_CREDENTIAL_METADATA_UNAVAILABLE",
            upstreamStatus,
            retryable: !submissionUncertain && !configurationMissing,
            action: configurationMissing
              ? "Select a credential configuration listed by Certify"
              : submissionAttempted
                ? "Check the Certify response and retry only after confirming the request was not issued"
                : "Check Certify availability and credential metadata"
          }
        )
      );
    } catch {
      return res.status(500).json({
        success: false,
        error: "The Playground could not record the credential request outcome",
        errorCode: "EXCHANGE_RECORDING_FAILED"
      });
    }

    return res.status(configurationMissing ? 422 : 502).json({
      success: false,
      error: configurationMissing
        ? "The selected credential configuration is not present in Certify metadata"
        : submissionAttempted
          ? "Certify did not issue the credential"
          : "The Playground could not retrieve the issuer credential configuration",
      errorCode: configurationMissing
        ? "CREDENTIAL_CONFIGURATION_NOT_FOUND"
        : submissionAttempted
          ? "ISSUER_CREDENTIAL_REQUEST_FAILED"
          : "ISSUER_CREDENTIAL_METADATA_UNAVAILABLE",
      diagnostic: exchange.diagnostic,
      exchange
    });
  }
});


module.exports = router;