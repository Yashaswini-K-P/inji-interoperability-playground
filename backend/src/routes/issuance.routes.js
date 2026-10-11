const express = require("express");

const {
  createPreAuthorizedOffer,
  getCredentialOffer,
  createPreAuthorizedOfferForRun,
  requestToken
} = require("../services/issuance.service");

const {
  addExchange,
  getRun,
  setRunOffer
} = require("../services/run.service");

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
    txCode: req.body.txCode || "1234"
  }
);

    res.status(201).json({
      success: true,
      issuer: issuerId,
      credentialConfigurationId,
      offer
    });
  } catch (error) {
    console.error(
      "Pre-authorized offer error:",
      error.message
    );

    res.status(502).json({
      success: false,
      error: "Failed to create credential offer",
      details: error.message
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
      txCode = "1234"
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
        txCode = "1234"
      } = req.body;

      if (!preAuthorizedCode) {
        return res.status(400).json({
          success: false,
          error: "preAuthorizedCode is required"
        });
      }

      const token = await requestToken(
        issuerId,
        {
          preAuthorizedCode,
          txCode
        }
      );

      const durationMs = Date.now() - startTime;
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

      res.json({
        success: true,
        token: tokenMetadata,
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

router.post(
  "/runs/:runId/credential",
  (req, res) => {
    const run = getRun(req.params.runId);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
        errorCode: "RUN_NOT_FOUND"
      });
    }

    return res.status(501).json({
      success: false,
      error: "The Playground does not create wallet credential requests",
      errorCode: "CREDENTIAL_REQUEST_UNSUPPORTED",
      diagnostic: {
        owner: "selected-wallet",
        action:
          "Continue issuance in the selected wallet using the credential offer handoff"
      }
    });
  }
);


module.exports = router;