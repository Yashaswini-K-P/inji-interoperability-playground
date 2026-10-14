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
    "status": "PENDING_EXTERNAL_ACTION"
  },
  "exchange": {
    "step": 2,
    "timestamp": "<ISO 8601 timestamp>",
    "stepName": "Authorization URI Generation",
    "protocol": "openid4vp",
    "status": "PENDING_EXTERNAL_ACTION",
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
`requestId`. When Verify omits optional `client_metadata`, the Playground
uses the same wallet format metadata as Verify 0.18.2's QR component.
For by-reference responses, it contains the configured `client_id` and
the verifier-provided `request_uri`; the wallet resolves the request
URI. The playground does not create request JWTs.

The handoff exchange records the Verify request and transaction IDs but not
the QR payload, nonce, or presentation definition. A successful new Verify
request puts the run back in `IN_PROGRESS` while preserving earlier failed
exchanges.

It returns `404` for an unknown run, `409` if no presentation request
has been created yet, and `502` when the selected wallet cannot prepare
the handoff. Failed preparations are recorded as `FAILED` exchanges.

The authorization-URI step is recorded as `PENDING_EXTERNAL_ACTION` when the
QR URI is prepared and `FAILED` if preparation fails. Loopback addresses such as
`localhost` and Docker-only host addresses are rejected because they
cannot be reached by a separate mobile device. Neither status means
that the wallet was opened, a presentation was submitted, or
verification completed. Runs remain `IN_PROGRESS` until a supported
result is retrieved. The Playground's
`GET /api/verify/runs/:runId/result` calls Inji Verify's
`POST /v1/verify/v2/vp-results/{transactionId}` using the transaction ID and
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

## Run History API

`GET /api/runs` returns newest-first, safe summaries for the run-history
view. It does not include offers, authorization request contents, tokens,
or credential/presentation contents:

```json
{
  "success": true,
  "runs": [
    {
      "runId": "RUN-ABC123",
      "status": "IN_PROGRESS",
      "result": null,
      "createdAt": "2026-10-11T08:00:00.000Z",
      "scenario": {
        "issuer": "inji-certify",
        "credential": "FarmerCredential",
        "wallet": "inji-mobile",
        "verifier": "inji-verify",
        "format": "ldp_vc",
        "issuanceFlow": "pre-authorized",
        "presentationProtocol": "openid4vp"
      },
      "exchangeCount": 2,
      "latestExchange": {
        "step": 2,
        "timestamp": "2026-10-11T08:02:00.000Z",
        "componentId": "inji-verify",
        "protocolStep": "Verification Result Retrieval",
        "status": "PENDING",
        "error": null,
        "diagnostic": {
          "code": "NO_VP_SUBMISSION",
          "retryable": true
        }
      }
    }
  ]
}
```

Use `GET /api/runs/:runId` for the full persisted run and its exchange
history. Each exchange recorded by the backend includes server-assigned
`runId`, `step`, `timestamp`, `componentId`, and `protocolStep`, alongside
the existing `status`, protocol, direction, errors, and safe diagnostics.
`componentId` is resolved from the run's configured issuer, wallet, or
verifier according to the exchange direction. `READY` and `PENDING` remain
nonterminal; only an authoritative Verify result sets `PASS` or `FAIL`.
Older persisted exchanges remain readable in their original shape.
`POST /api/runs/:runId/exchanges` returns `405` with
`EXCHANGE_WRITE_UNSUPPORTED`; clients cannot author protocol events or
assert successful wallet/verifier steps. The issuance, wallet, and Verify
operation routes create their own persisted events.

PowerShell smoke-test requests:

```powershell
$baseUrl = "http://localhost:5000"
$history = Invoke-RestMethod -Uri "$baseUrl/api/runs"
$history.runs | ConvertTo-Json -Depth 8

$runId = $history.runs[0].runId
Invoke-RestMethod -Uri "$baseUrl/api/runs/$runId" |
  ConvertTo-Json -Depth 12

Invoke-RestMethod -Uri "$baseUrl/api/verify/runs/$runId/result" |
  ConvertTo-Json -Depth 12
```

The final request may return HTTP `202` while Verify has no wallet
submission yet; that is pending, not a failed or successful presentation.
Malformed or inconsistent `data/runs.json` now prevents the backend from
starting with an empty in-memory history, rather than making existing run
IDs appear missing or allowing a new run to overwrite that history.

## OpenID4VCI Inji Mobile Handoff

Create and prepare an issuance offer in this order:

1. `POST /api/issuance/runs/:runId/pre-authorized-offer` with
   `issuerId` and `credentialConfigurationId` (and optional `claims`,
   `expiresIn`, and `txCode`). A successful response is returned only
   after Certify supplies a non-empty `credential_offer_uri` and the
   Playground stores it on the run.
2. `GET /api/wallet/runs/:runId/continue` returns the stored offer URI
   for the selected wallet. Its `READY` status and
   `handoffStatus: "PREPARED"` mean only that the handoff data is ready.
   `wallet.handoffMethod` is `cross-device-qr`, and `wallet.qrPayload`
   is the exact Certify offer URI for the frontend to encode as a QR
   code. The user must open Inji Mobile and scan it; the wallet owns
   metadata discovery, token exchange, proof generation, credential
   request, and credential storage. The route records the required scan
   action but does not claim that the wallet performed it.
   The exchange's `externalAction: "wallet-scan-not-observed"` makes
   explicit that the Playground cannot observe wallet scanning or
   credential storage.
3. The user must open Inji Mobile and scan/use the returned offer. Inji
   Mobile owns token exchange, holder-key proof generation, credential
   request, and credential storage. The Playground's
   `POST /api/issuance/runs/:runId/credential` intentionally returns
   HTTP `501` with `errorCode: "CREDENTIAL_REQUEST_UNSUPPORTED"`; it
   does not call Certify's credential endpoint or report a received
   credential.

   Component registration and protocol declarations are not proof that a
   callable adapter exists. Scenario creation checks the registered issuer,
   wallet, and verifier against the implemented adapter factories. The
   Inji Web wallet is listed for discovery, but this backend does not yet
   have an Inji Web/Mimoto adapter; scenarios selecting it are rejected
   instead of failing later during a wallet operation.

   `POST /api/issuance/runs/:runId/token` is a separate Playground-to-
   Certify token request, not the Inji Mobile wallet's token exchange. It
returns only safe token metadata and does not persist or forward the
token. A token exchange is recorded as successful only when Certify
returns a non-empty access token and token type; malformed responses are
recorded as failed without exposing token values.

Offer creation failures use `ISSUER_OFFER_REQUEST_FAILED`; a successful
upstream response without a usable offer URI uses
`INVALID_ISSUER_OFFER_RESPONSE`. Neither a prepared handoff nor an
issuance offer changes an incomplete run to a completed/pass result.
Actual scanning and issuance have not been verified against a running
Inji Mobile wallet by these backend tests. The issuer metadata and
credential endpoint URLs embedded in the offer must also be reachable
from the phone; Docker-only hostnames such as `certify-nginx` are not
mobile-reachable unless the device has a route and DNS for them.

The Inji Wallet credential-offer documentation describes a user scanning
an issuer-generated QR code and passing the scanned offer URI or offer
object to its internal `inji-vci-client`; that client performs the
wallet-side VCI protocol. Its native `requestCredentialByOffer` bridge
is an app-internal React Native module, not an external backend API or
documented app-launch callback. The Playground therefore exposes the QR
payload and does not attempt to invoke that bridge or report a wallet
callback/credential receipt. The Verify presentation path separately
returns an `openid4vp://authorize` QR URI; wallet submission and
verification remain separate, externally performed steps.

Run the focused OpenID4VP tests from the backend directory with:

```powershell
node --test test\injiVerify.adapter.test.js test\openid4vpQr.test.js test\verifier.routes.test.js test\verifierConfiguration.test.js test\walletPresentation.routes.test.js test\walletCapabilities.test.js test\runLifecycle.test.js test\verifierResult.routes.test.js test\issuanceToken.routes.test.js test\issuanceOffer.service.test.js test\scenarioAdapterAvailability.test.js
```

## Core Idea

```text
Issuer → Wallet → Verifier