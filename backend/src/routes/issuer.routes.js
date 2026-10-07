const express = require("express");

const {
  getIssuerAdapter
} = require("../services/issuer.service");

const router = express.Router();

router.get("/:issuerId/metadata", async (req, res) => {
  try {
    const adapter = getIssuerAdapter(req.params.issuerId);

    const metadata = await adapter.getMetadata();

    res.json({
      success: true,
      issuer: req.params.issuerId,
      metadata
    });
  } catch (error) {
    console.error("Issuer metadata error:", error.message);

    res.status(502).json({
      success: false,
      error: "Failed to retrieve issuer metadata",
      details: error.message
    });
  }
});

router.get("/:issuerId/credentials", async (req, res) => {
  try {
    const {
      getIssuerCredentials
    } = require("../services/issuer.service");

    const credentials =
      await getIssuerCredentials(req.params.issuerId);

    res.json({
      success: true,
      issuer: req.params.issuerId,
      credentials
    });
  } catch (error) {
    console.error(
      "Issuer credential discovery error:",
      error.message
    );

    res.status(502).json({
      success: false,
      error: "Failed to retrieve issuer credentials",
      details: error.message
    });
  }
});

module.exports = router;