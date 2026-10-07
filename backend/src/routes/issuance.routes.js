const express = require("express");

const {
  createPreAuthorizedOffer,
  getCredentialOffer
} = require("../services/issuance.service");

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



module.exports = router;