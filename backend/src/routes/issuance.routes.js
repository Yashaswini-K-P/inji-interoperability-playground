const express = require("express");

const {
  createPreAuthorizedOffer,
  getCredentialOffer,
  createPreAuthorizedOfferForRun,
  requestToken,
  requestCredential
} = require("../services/issuance.service");

const {
  addExchange,
  getRun,
  setRunOffer,
  setRunToken
} = require("../services/run.service");

const {
  createCredentialRequest
} = require("../services/wallet.service");


const router = express.Router();

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

    try {
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

      const exchange = addExchange(
        req.params.runId,
        {
          stepName: "Pre-Authorized Data",
          protocol: "OpenID4VCI",
          direction: "playground-to-issuer",
          status: result.success
            ? "SUCCESS"
            : "FAILED",
          durationMs: result.durationMs,
          error: result.success
            ? null
            : result.error
        }
      );

      if (!result.success) {
        return res.status(502).json({
          success: false,
          exchange
        });
      }

   const offerUri = result.offer.credential_offer_uri;

setRunOffer(req.params.runId, {
  credentialOfferUri: offerUri,
  type: "openid-credential-offer"
});


      res.status(201).json({
        success: true,
        offer: result.offer,
        exchange
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;

      try {
        const exchange = addExchange(
          req.params.runId,
          {
            stepName: "Pre-Authorized Data",
            protocol: "OpenID4VCI",
            direction: "playground-to-issuer",
            status: "FAILED",
            durationMs,
            error: error.message
          }
        );

        return res.status(502).json({
          success: false,
          error: error.message,
          exchange
        });
      } catch (runError) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
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
      setRunToken(
  req.params.runId,
  token
);

      const durationMs = Date.now() - startTime;

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
        token,
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
          error: error.response?.data || error.message
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

      if (!run.token) {
        return res.status(400).json({
          success: false,
          error: "Token request must be completed first"
        });
      }

      const issuerId = run.scenario.issuer;
      const walletId = run.scenario.wallet;
      const credentialConfigurationId =
        run.scenario.credential;

      const token = run.token;

      const issuerAdapter =
        require("../services/issuer.service")
          .getIssuerAdapter(issuerId);

      const credentials =
        await issuerAdapter.getCredentials();

      const credentialConfiguration =
        credentials.find(
          (credential) =>
            credential.id === credentialConfigurationId
        );

      if (!credentialConfiguration) {
        throw new Error(
          `Credential configuration not found: ${credentialConfigurationId}`
        );
      }

      const metadata =
        await issuerAdapter.getMetadata();

      const credentialIssuer =
        metadata.credential_issuer;

      const walletRequest =
        await createCredentialRequest(
          walletId,
          {
            accessToken: token.access_token,
            cNonce: token.c_nonce,
            credentialIssuer,
            credentialConfiguration
          }
        );

      const credentialResponse =
        await requestCredential(
          issuerId,
          {
            accessToken: walletRequest.accessToken,
            format:
              walletRequest.request.format,
            credentialDefinition:
              walletRequest.request
                .credential_definition,
            proof:
              walletRequest.request.proof
          }
        );

      const durationMs =
        Date.now() - startTime;

      const exchange = addExchange(
        req.params.runId,
        {
          stepName: "Credential Request",
          protocol: "OpenID4VCI",
          direction: "wallet-to-issuer",
          status: "SUCCESS",
          durationMs,
          error: null
        }
      );

      res.json({
        success: true,
        credential: credentialResponse,
        exchange
      });
    } catch (error) {
      const durationMs =
        Date.now() - startTime;

      const exchange = addExchange(
        req.params.runId,
        {
          stepName: "Credential Request",
          protocol: "OpenID4VCI",
          direction: "wallet-to-issuer",
          status: "FAILED",
          durationMs,
          error: error.message,
          diagnostic: {
            code: error.code || null,
            upstreamStatus: error.response?.status || null
          }
        }
      );

      res.status(error.statusCode || 502).json({
        success: false,
        error: error.message,
        exchange
      });
    }
  }
);


module.exports = router;