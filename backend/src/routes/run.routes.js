const express = require("express");

const {
  getRun,
  listRuns,
  createRun
} = require("../services/run.service");
const {
  createRunDiagnostics
} = require("../services/runDiagnostics.service");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    runs: listRuns()
  });
});

router.post("/", (req, res) => {
  try {
    const {
  issuer,
  credential,
  format,
  issuanceFlow,
  wallet,
  verifier,
  presentationProtocol
} = req.body;

    if (
  !issuer ||
  !credential ||
  !issuanceFlow ||
  !wallet ||
  !verifier ||
  !presentationProtocol
) {
      return res.status(400).json({
        success: false,
        error:
  "issuer, credential, issuanceFlow, wallet, verifier and presentationProtocol are required"
      });
    }

    const run = createRun({
  issuer,
  credential,
  format,
  issuanceFlow,
  wallet,
  verifier,
  presentationProtocol
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

  const publicRun = { ...run };
  delete publicRun.token;

  res.json({
    success: true,
    run: publicRun
  });
});

router.get("/:runId/diagnostics", (req, res) => {
  const run = getRun(req.params.runId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: "Run not found"
    });
  }

  res.json({
    success: true,
    diagnostics: createRunDiagnostics(run)
  });
});

router.post("/:runId/exchanges", (req, res) => {
  res.status(405).json({
    success: false,
    error: "Exchange history is recorded by backend protocol operations",
    errorCode: "EXCHANGE_WRITE_UNSUPPORTED",
    diagnostic: {
      action: "Use the issuance, wallet, or verification operation routes"
    }
  });
});

module.exports = router;