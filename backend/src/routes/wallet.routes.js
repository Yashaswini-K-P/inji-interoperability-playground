const express = require("express");

const {
  getRun,
  addExchange,
  recordWalletCredentialReceipt
} = require("../services/run.service");

const {
  createWalletContinuation,
  createPlaygroundCredentialOfferHandoff,
  hasValidPlaygroundCredentialHandoffToken,
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

  if (run.issuanceStatus === "STORED") {
    return res.status(409).json({
      success: false,
      error: "The wallet has already stored a credential for this run",
      errorCode: "CREDENTIAL_ALREADY_STORED"
    });
  }

  try {
    const continuation = createWalletContinuation(
      walletId,
      credentialOfferUri
    );

    if (walletId === "inji-mobile") {
      const handoff = createPlaygroundCredentialOfferHandoff(
        run.runId,
        credentialOfferUri,
        process.env.PLAYGROUND_PUBLIC_URL
      );
      continuation.qrPayload = handoff.qrPayload;
      continuation.handoffMethod = handoff.handoffMethod;
      continuation.callbackExpiresAt = handoff.callbackExpiresAt;
    }

    continuation.handoffStatus = "PREPARED";
    continuation.externalAction = "wallet-scan-not-observed";

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
    if (
      error.code === "PLAYGROUND_PUBLIC_URL_REQUIRED" ||
      error.code === "PLAYGROUND_PUBLIC_URL_INVALID"
    ) {
      return res.status(error.statusCode || 503).json({
        success: false,
        error: error.message,
        errorCode: error.code,
        action:
          "Configure PLAYGROUND_PUBLIC_URL with the HTTPS tunnel or deployment origin reachable by the phone, then prepare the handoff again"
      });
    }

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

router.post("/runs/:runId/issuance-outcome", (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) {
    return res.status(404).json({
      success: false,
      error: "Run not found",
      errorCode: "RUN_NOT_FOUND"
    });
  }

  const authorization = req.get("authorization") || "";
  const callbackToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (
    run.scenario?.wallet !== "inji-mobile" ||
    !hasValidPlaygroundCredentialHandoffToken(
      req.params.runId,
      callbackToken
    )
  ) {
    return res.status(401).json({
      success: false,
      error: "The wallet completion callback is not authorized",
      errorCode: "INVALID_WALLET_CALLBACK"
    });
  }

  const { status, credentialConfigurationId, format } = req.body || {};
  if (status !== "STORED") {
    return res.status(400).json({
      success: false,
      error: "Only a wallet-confirmed stored credential can complete this run step",
      errorCode: "INVALID_WALLET_OUTCOME"
    });
  }

  if (
    typeof credentialConfigurationId !== "string" ||
    credentialConfigurationId !== run.scenario.credential ||
    typeof format !== "string" ||
    (run.scenario.format && format !== run.scenario.format)
  ) {
    return res.status(409).json({
      success: false,
      error: "The wallet credential does not match this run's selected credential",
      errorCode: "WALLET_CREDENTIAL_MISMATCH"
    });
  }

  try {
    const duplicate = Boolean(run.credentialReceipt);
    const receipt = recordWalletCredentialReceipt(req.params.runId, {
      credentialConfigurationId,
      format
    });

    return res.status(200).json({
      success: true,
      duplicate,
      issuanceStatus: "STORED",
      credentialReceipt: receipt
    });
  } catch (error) {
    return res.status(409).json({
      success: false,
      error: "The wallet credential receipt could not be recorded",
      errorCode: "WALLET_RECEIPT_RECORDING_FAILED"
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
        transactionId: run.presentationRequest.transactionId || null,
        requestId: run.presentationRequest.requestId || null,
        actionRequiredCode: "SCAN_PRESENTATION_REQUEST_IN_INJI_MOBILE",
        actionRequired: "Scan the presentation request with the selected wallet",
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