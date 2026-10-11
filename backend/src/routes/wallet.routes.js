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
  let exchangeAttempted = false;
  const run = getRun(req.params.runId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: "Run not found",
      errorCode: "RUN_NOT_FOUND"
    });
  }

  const walletId = run.scenario.wallet;
  const credentialOfferUri = run.offer?.credentialOfferUri;

  if (!walletId) {
    return res.status(400).json({
      success: false,
      error: "No wallet selected for this run",
      errorCode: "WALLET_NOT_SELECTED"
    });
  }

  if (!credentialOfferUri) {
    return res.status(409).json({
      success: false,
      error: "Credential offer not available for this run",
      errorCode: "CREDENTIAL_OFFER_NOT_AVAILABLE"
    });
  }

  try {
    const continuation = {
      ...createWalletContinuation(
        walletId,
        credentialOfferUri
      ),
      handoffStatus: "PREPARED",
      externalAction: "wallet-scan-not-observed"
    };

    const durationMs = Date.now() - startTime;

    exchangeAttempted = true;
    const exchange = addExchange(
      req.params.runId,
      {
        stepName: "Wallet Handoff",
        protocol: "OpenID4VCI",
        direction: "playground-to-wallet",
        status: "PENDING_EXTERNAL_ACTION",
        externalAction: "wallet-scan-not-observed",
        handoffStatus: "PREPARED",
        handoffMethod: continuation.handoffMethod,
        actionRequiredCode: "SCAN_CREDENTIAL_OFFER_IN_INJI_MOBILE",
        actionRequired: "Scan the offer with the selected wallet",
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

    if (exchangeAttempted) {
      return res.status(500).json({
        success: false,
        error: "The Playground could not record the wallet handoff",
        errorCode: "EXCHANGE_RECORDING_FAILED"
      });
    }

    exchangeAttempted = true;
    let exchange;
    try {
      exchange = addExchange(
        req.params.runId,
        {
          stepName: "Wallet Handoff",
          protocol: "OpenID4VCI",
          direction: "playground-to-wallet",
          status: "FAILED",
          externalAction: "wallet-scan-not-observed",
          handoffStatus: "NOT_PREPARED",
          durationMs,
          error: "Wallet handoff could not be prepared",
          diagnostic: {
            code: "WALLET_HANDOFF_PREPARATION_FAILED",
            action: "Verify the selected wallet and stored offer URI"
          }
        }
      );
    } catch (recordError) {
      return res.status(500).json({
        success: false,
        error: "The Playground could not record the wallet handoff",
        errorCode: "EXCHANGE_RECORDING_FAILED"
      });
    }

    return res.status(502).json({
      success: false,
      error: "Wallet handoff could not be prepared",
      errorCode: "WALLET_HANDOFF_PREPARATION_FAILED",
      diagnostic: exchange.diagnostic,
      exchange
    });
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
        stepName: "Authorization URI Generation",
        protocol: run.scenario.presentationProtocol || "openid4vp",
        direction: "playground-to-wallet",
        status: "PENDING_EXTERNAL_ACTION",
        initiatedBy: "playground",
        externalAction: "wallet-scan-not-observed",
        handoffStatus: "PREPARED",
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
          stepName: "Authorization URI Generation",
          protocol: run.scenario.presentationProtocol || "openid4vp",
          direction: "playground-to-wallet",
          status: "FAILED",
          initiatedBy: "playground",
          externalAction: "wallet-scan-not-observed",
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