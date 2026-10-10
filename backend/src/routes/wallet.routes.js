const express = require("express");

const {
  getRun,
  addExchange
} = require("../services/run.service");

const {
  createWalletContinuation,
  createPresentationRequestContinuation
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
        stepName: "Wallet Handoff",
        protocol: "OpenID4VCI",
        direction: "playground-to-wallet",
        status: "READY",
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

router.post("/runs/:runId/presentation", (req, res) => {
  const startTime = Date.now();
  const run = getRun(req.params.runId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: `Run not found: ${req.params.runId}`
    });
  }

  try {
    const walletId = run.scenario.wallet;

    if (!walletId) {
      throw new Error("No wallet selected for this run");
    }

    if (!run.presentationRequest?.authorizationRequest) {
      const error = new Error(
        "Presentation request not available for this run"
      );
      error.statusCode = 409;
      throw error;
    }

    if (!run.presentationRequest.clientId) {
      throw new Error(
        "Verifier client ID is not available for this presentation request"
      );
    }

    if (
      run.presentationRequest.verifierId !==
        run.scenario.verifier ||
      run.presentationRequest.protocol !==
        (run.scenario.presentationProtocol || "openid4vp")
    ) {
      throw new Error(
        "Presentation request does not match this run's verifier and protocol"
      );
    }

    const continuation =
      createPresentationRequestContinuation(
        walletId,
        run.presentationRequest.authorizationRequest,
        run.presentationRequest.clientId
      );
    const durationMs = Date.now() - startTime;
    const exchange = addExchange(
      req.params.runId,
      {
        stepName: "Wallet Presentation Handoff",
        protocol: run.scenario.presentationProtocol || "openid4vp",
        direction: "playground-to-wallet",
        status: "READY",
        qrUri: continuation.qrUri,
        handoffMethod: continuation.handoffMethod,
        durationMs,
        error: null
      }
    );

    return res.json({
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
          stepName: "Wallet Presentation Handoff",
          protocol: run.scenario.presentationProtocol || "openid4vp",
          direction: "playground-to-wallet",
          status: "FAILED",
          durationMs,
          error: error.message
        }
      );

      return res.status(error.statusCode || 502).json({
        success: false,
        error: "Wallet presentation handoff failed",
        exchange
      });
    } catch (recordError) {
      return res.status(500).json({
        success: false,
        error: recordError.message
      });
    }
  }
});

module.exports = router;