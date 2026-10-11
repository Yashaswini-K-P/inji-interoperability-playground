# Backend API lifecycle notes

Start the service with `npm start` (port 5000). Run the automated tests with
`node --test`.

## Configuration

Copy `.env.example` to `.env` if a local `.env` does not already exist, then
set the component URLs for the local environment:

- `INJI_CERTIFY_URL` is the Inji Certify base URL.
- `INJI_VERIFY_URL` is the Inji Verify base URL.
- `INJI_VERIFY_CLIENT_ID` must be the client ID accepted by the Verify
  deployment and trusted by the selected wallet. Obtain it from the real
  Verify deployment's relying-party/client registration or documented DID
  configuration; do not substitute a test or example identifier. Keep it
  empty until confirmed.
- `PORT` selects the backend port.

For DID/by-reference OpenID4VP requests, the Verify DID document and request
URI must be reachable from the wallet. Verify's `response_uri` is constructed
from `INJI_VP_SUBMISSION_BASE_URL` with `/vp-submission/direct-post`; configure
the wallet to trust that callback according to its deployment policy.

## Implemented lifecycle

- The component registry exposes Inji Certify, Inji Mobile for Android/iOS,
  Inji Web, and Inji Verify. The backend package does not pin or embed an Inji
  Mobile SDK/app version.
- Certify metadata/credential discovery, pre-authorized offer creation and
  retrieval, and the pre-authorized token exchange are implemented. A
  successful offer or token exchange is not evidence that a credential was
  issued.
- `GET /api/wallet/runs/:runId/continue` returns a cross-device QR handoff
  using the Certify-created offer URI. Its exchange is recorded as
  `PENDING_EXTERNAL_ACTION` with `handoffStatus: PREPARED`: the backend cannot
  observe a scan or credential receipt.
- `POST /api/issuance/runs/:runId/credential` does not create or request a
  credential. It responds with HTTP 501 and
  `CREDENTIAL_REQUEST_UNSUPPORTED`, records an `UNSUPPORTED` OpenID4VCI
  exchange against the selected wallet, and returns a continuation descriptor
  for the existing offer QR route. The continuation remains
  `PENDING_EXTERNAL_ACTION`; native wallet proof/key operations and issuer
  responses are not fabricated or accepted by this endpoint.
- `POST /api/wallet/runs/:runId/presentation` prepares an OpenID4VP QR
  handoff. The exchange remains `PENDING_EXTERNAL_ACTION` until the selected
  wallet submits a presentation and Verify reports an authoritative result.
  A prepared request/QR alone is not a submitted presentation or PASS/FAIL.
- `GET /api/runs/:runId/diagnostics` distinguishes prepared actions, pending
  external actions, unsupported credential requests, and authoritative
  verification outcomes. Diagnostics do not probe external connectivity or
  return configured values, request/offer URIs, tokens, or credential contents.

Authorization-code issuance, native Inji Mobile credential request/proof and
receipt, and end-to-end wallet presentation submission are not implemented.
The Android/iOS platforms in the component registry describe the wallet
targets, not a backend connection to a running app. Configure
`INJI_VERIFY_CLIENT_ID` from the real deployment before attempting Verify
flows. Diagnostics are not connectivity checks; `GET /api/health` only
confirms the backend process is running.

## Manual test: truthful unsupported-wallet result

In one PowerShell window, start the backend:

```powershell
Set-Location 'C:\path\to\inji-interoperability-playground\backend'
npm start
```

In a second window, create a run and call the unsupported operation. The
example uses registered component IDs and does not contact Certify, Wallet,
or Verify:

```powershell
$base = 'http://localhost:5000'
$runBody = @{
  issuer = 'inji-certify'
  credential = 'UniversityDegree'
  format = 'ldp_vc'
  issuanceFlow = 'pre_authorized_code'
  wallet = 'inji-mobile'
  verifier = 'inji-verify'
  presentationProtocol = 'openid4vp'
} | ConvertTo-Json
$created = Invoke-RestMethod -Method Post `
  -Uri "$base/api/runs" `
  -ContentType 'application/json' `
  -Body $runBody
$runId = $created.run.runId

curl.exe -i -X POST "$base/api/issuance/runs/$runId/credential" `
  -H 'Content-Type: application/json' -d '{}'
Invoke-RestMethod -Uri "$base/api/runs/$runId" |
  ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "$base/api/runs/$runId/diagnostics" |
  ConvertTo-Json -Depth 10
```

Expect HTTP 501 and `CREDENTIAL_REQUEST_UNSUPPORTED`; the run history should
contain a timestamped `UNSUPPORTED` exchange for `inji-mobile`, protocol
`OpenID4VCI`, and a continuation endpoint. Diagnostics should continue to
report credential issuance as `NOT_CONFIRMED`.

To exercise the real offer QR handoff, first configure a reachable Certify
service, discover its supported credential configuration, and create a
pre-authorized offer for the same run. Then call
`GET /api/wallet/runs/:runId/continue` and scan the returned offer with the
real wallet. The backend currently cannot confirm wallet scanning or
credential receipt.
