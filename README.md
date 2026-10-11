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

The backend reads these settings when its Node process starts. Setting
an environment variable in another PowerShell window does not update an
already-running process. The startup script loads `backend/.env` before
importing component configuration; process environment variables set in
PowerShell take precedence. From the backend directory, set both values
and start the process in the same PowerShell session:

```powershell
$env:INJI_VERIFY_URL = "http://localhost:8080"
$env:INJI_VERIFY_CLIENT_ID = "<wallet-configured verifier client ID>"
npm run dev
```

Confirm the running process's verifier configuration with either:

```powershell
(Invoke-RestMethod `
  -Uri "http://localhost:5000/api/components/verifiers/inji-verify"
).component.clientId

$verifier = (Invoke-RestMethod `
  -Uri "http://localhost:5000/api/components"
).components.verifiers | Where-Object { $_.id -eq "inji-verify" }
$verifier | ConvertTo-Json -Depth 5
```

An ID accepted by Inji Verify's request-creation API is not necessarily
trusted/configured in Inji Mobile. Confirm the target wallet accepts
the selected client ID before scanning. Also ensure the Verify
`response_uri` (and DID document/request URI for by-reference mode) is
reachable from the phone; `localhost` on the phone refers to the phone,
not the development PC.
In the checked Inji Verify source, the generated direct-post callback is
constructed as the configured `INJI_VP_SUBMISSION_BASE_URL` followed by
`/vp-submission/direct-post`. Ensure the wallet's trusted-verifier
configuration allows that exact callback URL; do not assume a different
documented/example path is interchangeable.

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
    "stepName": "Authorization URI Generation",
    "protocol": "openid4vp",
    "status": "READY",
    "direction": "playground-to-wallet",
    "initiatedBy": "playground",
    "externalAction": "wallet-scan-not-observed",
    "handoffMethod": "cross-device-qr",
    "durationMs": 1,
    "error": null
  }
}
```

For by-value responses, `qrUri` contains the authorization parameters
from `authorizationDetails`, including `state` correlated with
`requestId`; `client_metadata` is included only when supplied by Verify.
For by-reference responses, it contains the configured `client_id` and
the verifier-provided `request_uri`; the wallet resolves the request
URI. The playground does not create request JWTs.

It returns `404` for an unknown run, `409` if no presentation request
has been created yet, and `502` when the selected wallet cannot prepare
the handoff. Failed preparations are recorded as `FAILED` exchanges.

The authorization-URI step is recorded as `READY` when the QR URI is
prepared and `FAILED` if preparation fails. Loopback addresses such as
`localhost` and Docker-only host addresses are rejected because they
cannot be reached by a separate mobile device. Neither status means
that the wallet was opened, a presentation was submitted, or
verification completed. Runs remain `IN_PROGRESS` until a supported
result is retrieved. The Playground's
`GET /api/verify/runs/:runId/result` calls Inji Verify's
`POST /v2/vp-results/{transactionId}` using the transaction ID and
request ID returned when the verifier request was created. Verify stores
the wallet submission against the OpenID4VP `state`/request ID; its
result endpoint resolves the transaction's request and performs VP/VC
validation when the result is retrieved.

Verify returns `NO_VP_SUBMISSION` until the wallet has submitted a
presentation; the Playground maps that response to HTTP `202` and keeps
the run `IN_PROGRESS`. On a valid result response, the Playground uses
Verify's `allChecksSuccessful` value to set `COMPLETED`/`PASS` or
`FAILED`/`FAIL`. Transport errors, unrecognized service errors, and
malformed results are recorded as `ERROR` and do not invent an outcome.
The detailed Verify response can contain credential contents, so the
Playground persists and returns only its transaction ID, aggregate
result, credential count, and retrieval timestamp.

Run the focused OpenID4VP tests from the backend directory with:

```powershell
node --test test\injiVerify.adapter.test.js test\openid4vpQr.test.js test\verifier.routes.test.js test\verifierConfiguration.test.js test\walletPresentation.routes.test.js test\walletCapabilities.test.js test\runLifecycle.test.js test\verifierResult.routes.test.js
```

## Core Idea

```text
Issuer → Wallet → Verifier