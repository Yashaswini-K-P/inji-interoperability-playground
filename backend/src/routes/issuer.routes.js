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

module.exports = router;