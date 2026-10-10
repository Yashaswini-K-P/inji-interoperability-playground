const express = require("express");

const {
  getRun,
  addExchange,
  setRunPresentationRequest
} = require("../services/run.service");

const {
  createPresentationRequest,
  getVerifierClientId
} = require("../services/verifier.service");

const router = express.Router();

router.post("/runs/:runId/request", async (req, res) => {
  const startTime = Date.now();

  try {
    const run = getRun(req.params.runId);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: `Run not found: ${req.params.runId}`
      });
    }

    const verifierId = run.scenario.verifier;

    if (!verifierId) {
      return res.status(400).json({
        success: false,
        error: "No verifier selected for this run"
      });
    }

    const clientId = getVerifierClientId(verifierId);

    if (req.body.clientId && req.body.clientId !== clientId) {
      const error = new Error(
        "clientId must match the configured INJI_VERIFY_CLIENT_ID"
      );
      error.statusCode = 400;
      throw error;
    }

    const presentationDefinition =
      req.body.presentationDefinition || {
        id: "farmer-credential-request",
        input_descriptors: [
          {
            id: "farmer-credential",
            format: {
              ldp_vc: {}
            }
          }
        ]
      };

    const presentationRequest =
      await createPresentationRequest(
        verifierId,
        {
          clientId,
          presentationDefinition
        }
      );

    setRunPresentationRequest(
      req.params.runId,
      presentationRequest,
      clientId
    );

    const durationMs = Date.now() - startTime;

    const exchange = addExchange(
      req.params.runId,
      {
        stepName: "Presentation Request",
        protocol: run.scenario.presentationProtocol || "openid4vp",
        direction: "playground-to-verifier",
        status: "SUCCESS",
        durationMs,
        error: null
      }
    );

    res.json({
      success: true,
      presentationRequest,
      exchange
    });
    } catch (error) {
    const durationMs = Date.now() - startTime;

    try {
      const exchange = addExchange(
        req.params.runId,
        {
          stepName: "Presentation Request",
          protocol: "openid4vp",
          direction: "playground-to-verifier",
          status: "FAILED",
          durationMs,
          error: error.response?.data || error.message
        }
      );

      res.status(error.statusCode || 502).json({
        success: false,
        error: error.message,
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