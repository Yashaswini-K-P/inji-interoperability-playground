const express = require("express");

const {
  getRun,
  addExchange
} = require("../services/run.service");

const {
  createWalletContinuation
} = require("../services/wallet.service");

const router = express.Router();

router.get("/runs/:runId/continue", (req, res) => {
  const startTime = Date.now();

  try {
    const run = getRun(req.params.runId);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: "Run not found"
      });
    }

    const walletId = run.scenario.wallet;

    if (!walletId) {
      return res.status(400).json({
        success: false,
        error: "No wallet selected for this run"
      });
    }

    const credentialOfferUri =
      run.offer?.credentialOfferUri;

    if (!credentialOfferUri) {
      return res.status(400).json({
        success: false,
        error: "Credential offer not available for this run"
      });
    }

    const continuation =
      createWalletContinuation(
        walletId,
        credentialOfferUri
      );

    const durationMs = Date.now() - startTime;

    const exchange = addExchange(
      req.params.runId,
      {
        stepName: "Wallet Continuation",
        protocol: "OpenID4VCI",
        direction: "playground-to-wallet",
        status: "SUCCESS",
        durationMs,
        error: null
      }
    );

    res.json({
      success: true,
      wallet: continuation,
      exchange
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;

    try {
      const exchange = addExchange(
        req.params.runId,
        {
          stepName: "Wallet Continuation",
          protocol: "OpenID4VCI",
          direction: "playground-to-wallet",
          status: "FAILED",
          durationMs,
          error: error.message
        }
      );

      res.status(502).json({
        success: false,
        error: "Wallet continuation failed",
        exchange
      });
    } catch (runError) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

module.exports = router;