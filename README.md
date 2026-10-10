# Inji Interoperability Playground

A configurable interoperability playground for testing
credential issuance and presentation flows across different
issuers, wallets, verifiers, credential formats, and protocols.

## Initial Goal

The initial implementation will focus on representative
interoperability scenarios involving:

- Inji Certify
- Inji Wallet
- Inji Verify

The architecture will be extensible to support external
issuers, wallets, verifiers, credential formats, and protocols.

## OpenID4VP Wallet Handoff

Create a verifier request with
`POST /api/verify/runs/:runId/request`, then prepare the selected
Inji Mobile wallet handoff with
`POST /api/wallet/runs/:runId/presentation`.

Set `INJI_VERIFY_CLIENT_ID` to the verifier client ID configured and
accepted by the target wallet. Request creation fails explicitly if it
is not configured; the playground does not assume a placeholder client
ID is trusted. For DID/by-reference flow, configure the verifier's real
DID and ensure Verify's DID document, signing key, and request URI are
reachable by the wallet. For a pre-registered client ID, use the value
registered with the verifier and allowed by the wallet.

The handoff endpoint returns the original verifier response unchanged
as `wallet.verifierResponse` and the constructed OpenID4VP URI
separately as `wallet.qrUri`. The QR URI follows Inji Verify's SDK
contract (`openid4vp://authorize?...`) and is intended to be encoded as
a QR code by the client. The backend does not invent a wallet deep link
or create a presentation.

The handoff endpoint takes no request body and returns this shape
(`verifierResponse` is the verifier's response value, unchanged):

```json
{
  "success": true,
  "wallet": {
    "walletId": "inji-mobile",
    "wallet": "Inji Mobile Wallet",
    "protocol": "openid4vp",
    "handoffMethod": "cross-device-qr",
    "verifierResponse": "<unchanged Inji Verify response>",
    "qrUri": "openid4vp://authorize?<encoded authorization-request parameters>",
    "status": "READY"
  },
  "exchange": {
    "step": 2,
    "timestamp": "<ISO 8601 timestamp>",
    "stepName": "Wallet Presentation Handoff",
    "protocol": "openid4vp",
    "status": "READY",
    "direction": "playground-to-wallet",
    "qrUri": "openid4vp://authorize?<encoded authorization-request parameters>",
    "handoffMethod": "cross-device-qr",
    "durationMs": 1,
    "error": null
  }
}
```

For by-value responses, `qrUri` contains the authorization parameters
from `authorizationDetails`, including `state` from `requestId` and
client metadata. For by-reference responses, it contains the configured
`client_id` and the verifier-provided `request_uri`; the wallet resolves
the request URI. The playground does not create request JWTs.

It returns `404` for an unknown run, `409` if no presentation request
has been created yet, and `502` when the selected wallet cannot prepare
the handoff. Failed preparations are recorded as `FAILED` exchanges.

The wallet handoff exchange is recorded as `READY` when the QR URI is
prepared and `FAILED` if preparation fails. Neither status means that
the wallet was opened, a presentation was submitted, or verification
completed. Those steps require the mobile wallet and verifier to
exchange the real, user-approved presentation.

Run the focused OpenID4VP tests from the backend directory with:

```powershell
node --test test\openid4vpQr.test.js test\injiVerify.adapter.test.js test\verifier.routes.test.js test\walletPresentation.routes.test.js
```

## Core Idea

```text
Issuer → Wallet → Verifier