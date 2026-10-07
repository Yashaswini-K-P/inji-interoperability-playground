const express = require("express");

const {
  getRun,
  createRun,
  addExchange
} = require("../services/run.service");

const router = express.Router();

router.post("/", (req, res) => {
  try {
    const {
      issuer,
      credential,
      format,
      issuanceFlow
    } = req.body;

    if (!issuer || !credential || !issuanceFlow) {
      return res.status(400).json({
        success: false,
        error:
          "issuer, credential and issuanceFlow are required"
      });
    }

    const run = createRun({
      issuer,
      credential,
      format,
      issuanceFlow
    });

    res.status(201).json({
      success: true,
      run
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/:runId", (req, res) => {
  const run = getRun(req.params.runId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: "Run not found"
    });
  }

  res.json({
    success: true,
    run
  });
});

router.post("/:runId/exchanges", (req, res) => {
  try {
    const exchange = addExchange(
      req.params.runId,
      req.body
    );

    res.status(201).json({
      success: true,
      exchange
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;