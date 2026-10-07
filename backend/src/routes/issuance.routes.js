const express = require("express");

const {
  createPreAuthorizedOffer,
  getCredentialOffer,
  createPreAuthorizedOfferForRun,
  requestToken
} = require("../services/issuance.service");

const {
  addExchange,
  getRun
} = require("../services/run.service");


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



module.exports = router;