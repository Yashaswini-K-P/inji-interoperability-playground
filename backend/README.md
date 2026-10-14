# Backend API lifecycle notes

Start the service with `npm start` (port 5000). Run the automated tests with
`node --test`.

## Configuration

Copy `.env.example` to `.env` if a local `.env` does not already exist, then
set the component URLs for the local environment:

- `INJI_CERTIFY_URL` is the Inji Certify base URL.
- `INJI_VERIFY_URL` is the Inji Verify base URL.
- `INJI_VERIFY_CLIENT_ID` must be the client ID accepted by the Verify
  deployment and trusted by the selected wallet. This flow requires the
  deployment's verifier DID (for example a correctly configured `did:web`),
  not an arbitrary client label. Obtain the real value from the Verify
  deployment configuration; do not substitute a test or example identifier.
- `PORT` selects the backend port.
- `PLAYGROUND_PUBLIC_URL` is the externally reachable HTTPS origin used for
  the Inji Mobile credential-storage callback. Set it to the active HTTPS
  tunnel origin for phone testing; do not use `localhost`, a Docker hostname,
  or a URL containing credentials, query parameters, or fragments.
- A Certify transaction code is optional and is not defaulted by the backend.
  Enter it in the issuance panel only when required by Certify, then enter the
  same value in Inji Mobile if the offer prompts for it. It is not stored in
  run history.

For DID/by-reference OpenID4VP requests, the Verify DID document and request
URI must be reachable from the wallet. Verify's `response_uri` is constructed
from `INJI_VP_SUBMISSION_BASE_URL` with `/vp-submission/direct-post`; configure
the wallet to trust that callback according to its deployment policy.
When the backend runs on the host, `INJI_VERIFY_URL` can use the published
local Verify port (for example `http://localhost:8080`). If the backend runs
in Compose, use the Verify service's Docker-network hostname instead. The
wallet-facing DID document, request URI, and response URI must use the
deployment's externally reachable HTTPS origin; do not use Docker hostnames
or loopback addresses in the wallet handoff.

## Implemented lifecycle

- The component registry exposes Inji Certify, Inji Mobile for Android/iOS,
  Inji Web, and Inji Verify. The backend package does not pin or embed an Inji
  Mobile SDK/app version. The local Inji Wallet checkout is `v0.22.1`
  (`2b37c058a9ae10216e099dce78fbda57069d41ef`); it calls
  `requestCredentialByOffer` in the app and delegates offer processing,
  token/proof callbacks, and credential receipt to its native VCI client
  (`io.inji:inji-vci-client-aar:0.7.0` on Android). The local checkout has
  been modified for the playground QR envelope; an unmodified release app
  does not understand that envelope. The specified `v1.0.0-alpha.1` tag is
  available and exposes the same `requestCredentialByOffer` API; the working
  tree was not switched away from its pre-existing `v0.22.1` checkout.
- Certify metadata/credential discovery, pre-authorized offer creation and
  retrieval, and the pre-authorized token exchange are implemented. A
  successful offer or token exchange is not evidence that a credential was
  issued.
- `GET /api/wallet/runs/:runId/continue` returns a cross-device QR handoff.
  For the Inji Mobile integration it contains a versioned playground envelope
  around the unchanged Certify offer URI. The local wallet build unwraps the
  offer and passes it to its existing native VCI client. Configure
  `PLAYGROUND_PUBLIC_URL` as the externally reachable HTTPS origin before
  preparing this handoff; physical-device testing requires a secure tunnel or
  equivalent public HTTPS route to the backend.
- `POST /api/issuance/runs/:runId/credential` accepts a wallet-generated
  OpenID4VCI JWT proof only after the run's successful token exchange. The
  access token and `c_nonce` are held in process memory for that run; the
  access token is never returned or persisted, while the token endpoint returns
  the `cNonce` challenge so a wallet can sign its proof. The endpoint validates
  the proof structure and nonce, selects the credential format and definition
  from Certify metadata, and records `SUCCESS` only when Certify returns a
  credential. Missing wallet proof remains `PENDING_EXTERNAL_ACTION`. The
  backend does not create wallet keys or sign proofs.
- `POST /api/wallet/runs/:runId/presentation` prepares an OpenID4VP QR
  handoff. The exchange remains `PENDING_EXTERNAL_ACTION` until the selected
  wallet submits a presentation and Verify reports an authoritative result.
  The returned `wallet.qrUri` follows Verify 0.18.2's `openid4vp://authorize`
  QR format; the exchange records its request and transaction IDs but not the
  QR payload. A prepared request/QR alone is not a submitted presentation or
  PASS/FAIL.
- The checked-out Inji Wallet scans offers inside the app; it has no
  OpenID4VCI app-link intent filter or existing playground callback. The
  playground-specific QR envelope is therefore recognized by the modified
  local wallet scanner path rather than claiming support from an unmodified
  release app. Token exchange, proof signing, issuer communication, and
  credential validation continue through the wallet's existing native VCI
  client and the wallet's own protected key. After the wallet reads the
  verified credential back from its encrypted store, it sends a scoped,
  run-bound callback containing only the selected configuration and format.
  The backend stores that safe receipt and an exchange; it never receives the
  token, proof JWT, or credential. Callback tokens are memory-only, expire
  after 30 minutes, and are not included in run history.
- The local Inji Verify source is `v0.18.2` (`verify-service` POM and Git tag).
  It mounts its API at `/v1/verify`. The backend sends a Presentation Exchange
  `presentationDefinition` to `POST /v1/verify/vp-request`, along with the
  configured verifier DID and `responseCodeValidationRequired: false`.
  Verify returns `requestId`, `transactionId`, and (for a DID client ID) a
  `requestUri`. Verify's signed authorization request is fetched by the wallet
  from `GET /v1/verify/vp-request/:requestId`; the wallet QR is
  `openid4vp://authorize?client_id=...&request_uri=...`, not the bare request
  URI.
- Verify accepts the wallet's form-encoded VP submission at
  `POST /v1/verify/vp-submission/direct-post`. This is a direct wallet-to-
  Verify callback; the playground neither receives nor proxies the VP.
  `GET /v1/verify/vp-request/:requestId/status` long-polls and returns
  `ACTIVE`, `VP_SUBMITTED`, or `EXPIRED`. The backend uses that status before
  querying `POST /v1/verify/v2/vp-results/:transactionId` with
  `skipStatusChecks: false`, `statusCheckFilters: []`, and `includeClaims:
  false`. Verify returns `transactionId`, `allChecksSuccessful`, and
  `credentialResults`; only a validated response from this result endpoint
  becomes a verification outcome.
- `POST /api/verify/runs/:runId/request` sends the configured
  `INJI_VERIFY_CLIENT_ID` and a Presentation Exchange definition to Verify.
  The response's request URI, `requestId`, `transactionId`, and run association
  are persisted. `state` is the Verify `requestId` in its signed request;
  the Verify-generated nonce remains inside that signed request and is
  delivered to the wallet when it dereferences `requestUri`. A second request
  cannot be created against the same run.
- `GET /api/verify/runs/:runId/result` checks Verify's request status and
  retrieves results using the run's saved `transactionId`. `ACTIVE` maps to
  `PENDING`; `VP_SUBMITTED` maps to `SUBMITTED` while its authoritative result
  is retrieved; a valid positive result maps to `VERIFIED`/PASS and a valid
  negative result or explicit Verify rejection maps to `REJECTED`/FAIL.
  Request expiry, malformed responses, upstream errors, and timeouts map to
  `ERROR` with safe status/code diagnostics. If Verify briefly reports
  `NO_VP_SUBMISSION` after reporting `VP_SUBMITTED`, the backend retries only
  twice with bounded backoff. A submitted HTTP request alone is never treated
  as a successful verification.
- `GET /api/runs/:runId/diagnostics` distinguishes prepared actions, pending
  external actions, unsupported credential requests, and authoritative
  verification outcomes. Diagnostics do not probe external connectivity or
  return configured values, request/offer URIs, tokens, or credential contents.

Authorization-code issuance, native Inji Mobile credential request/proof and
receipt, and end-to-end wallet presentation submission are not implemented.
The registered Android/iOS platforms describe wallet targets, not a backend
connection to a running app. Configure
`INJI_VERIFY_CLIENT_ID` from the real deployment before attempting Verify
flows. Diagnostics are not connectivity checks; `GET /api/health` only
confirms the backend process is running.

## Manual test: Inji Verify DID-based presentation

Configure the real local deployment values in `backend/.env` first. The
wallet-facing Verify DID and callback must use the deployment's actual
externally reachable HTTPS origin; for physical-device tests, expose the local
Verify service and configure Verify's DID/public-key and
`INJI_VP_SUBMISSION_BASE_URL` consistently. Do not use the tunnel URL as the
backend's Docker-internal service address.

Start the local Verify Compose deployment and backend in separate PowerShell
windows (adjust the Verify checkout path if needed):

```powershell
Set-Location 'C:\path\to\inji-verify\docker-compose'
docker compose -f .\docker-compose.yml up -d
docker compose -f .\docker-compose.yml ps
```

```powershell
Set-Location 'C:\path\to\inji-interoperability-playground\backend'
npm start
```

Create a run, create the Verify request, and prepare the wallet handoff:

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
$created = Invoke-RestMethod -Method Post -Uri "$base/api/runs" `
  -ContentType 'application/json' -Body $runBody
$runId = $created.run.runId

$definition = @{
  id = 'playground-presentation'
  input_descriptors = @(@{
    id = 'requested-credential'
    format = @{ ldp_vc = @{} }
    constraints = @{ fields = @(@{ path = @('$.type[*]') }) }
  })
} | ConvertTo-Json -Depth 10
$requestBody = @{ presentationDefinition = ($definition | ConvertFrom-Json) } |
  ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post `
  -Uri "$base/api/verify/runs/$runId/request" `
  -ContentType 'application/json' -Body $requestBody
$handoff = Invoke-RestMethod -Method Post `
  -Uri "$base/api/wallet/runs/$runId/presentation" `
  -ContentType 'application/json' -Body '{}'
$handoff.wallet.qrUri
```

Display/scan `qrUri` with a compatible Inji Wallet. The URI uses the
`openid4vp://authorize` app scheme; the wallet dereferences Verify's signed
request URI and sends the VP directly to Verify. Retrieve the result:

```powershell
$result = Invoke-RestMethod -Uri "$base/api/verify/runs/$runId/result"
$result | ConvertTo-Json -Depth 10
```

The result call waits on Verify's request-status endpoint (configured there
for a maximum 55-second long poll). An `ACTIVE` response is `PENDING`; call
the same result endpoint again after the wallet submits. Check
`verificationStatus` and the correlated run before interpreting PASS/FAIL.
This workflow has unit coverage with mocked HTTP only; it is not a claim that
the local Verify and physical wallet have been exercised end to end.

## Manual test: wallet-bound credential issuance

In one PowerShell window, start the backend:

```powershell
Set-Location 'C:\path\to\inji-interoperability-playground\backend'
npm start
```

In a second window, create a run and a Certify offer. This flow requires
Certify to be reachable at `INJI_CERTIFY_URL`:

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

$offerBody = @{
  issuerId = 'inji-certify'
  credentialConfigurationId = 'UniversityDegree'
  claims = @{}
  expiresIn = 600
  txCode = '1234'
} | ConvertTo-Json -Depth 10
$offer = Invoke-RestMethod -Method Post `
  -Uri "$base/api/issuance/runs/$runId/pre-authorized-offer" `
  -ContentType 'application/json' `
  -Body $offerBody
$offer.offer.credential_offer_uri

# Have the wallet retrieve the offer and provide its pre-authorized code.
# It must not exchange that code independently for this backend-bound request.
$preAuthorizedCode = '<pre-authorized_code from the retrieved offer>'
$tokenBody = @{
  preAuthorizedCode = $preAuthorizedCode
  txCode = '1234'
} | ConvertTo-Json
$token = Invoke-RestMethod -Method Post `
  -Uri "$base/api/issuance/runs/$runId/token" `
  -ContentType 'application/json' `
  -Body $tokenBody
$token.token.cNonce

# Obtain this signed JWT from the wallet; do not create it in the Playground.
$walletProofJwt = '<wallet-signed-openid4vci-proof-jwt>'
$credentialBody = @{
  proof = @{
    proof_type = 'jwt'
    jwt = $walletProofJwt
  }
} | ConvertTo-Json -Depth 10
$issued = Invoke-RestMethod -Method Post `
  -Uri "$base/api/issuance/runs/$runId/credential" `
  -ContentType 'application/json' `
  -Body $credentialBody
$issued.status

Invoke-RestMethod -Uri "$base/api/runs/$runId" |
  ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "$base/api/runs/$runId/diagnostics" |
  ConvertTo-Json -Depth 10
```

The token endpoint returns a wallet-usable `token.cNonce` but never the
access token. The wallet must sign a JWT with header `typ` set to
`openid4vci-proof+jwt`, a supported signing algorithm and public key
(`jwk` or `kid`), and claims containing that exact `nonce`, an `aud`, and
`iat`. Submit it as `proof.jwt` with `proof.proof_type` set to `jwt`.
Certify performs authoritative cryptographic proof validation. An omitted
proof returns HTTP 202 `WALLET_PROOF_REQUIRED`; invalid proof is rejected
without calling Certify. An accepted HTTP response is not considered issuance
success unless it contains a usable credential. Token material is memory-only,
so restart the run's token exchange after a backend restart.

Current Inji Mobile integration does not yet expose a callback to generate and
submit this backend-bound proof or return the pre-authorized code to the
Playground. Until those wallet capabilities exist, the placeholders above
cannot be filled by the current mobile integration; do not substitute a proof
or token created for a different Certify nonce.

To exercise the real offer QR handoff, first configure a reachable Certify
service, discover its supported credential configuration, and create a
pre-authorized offer for the same run. Then call
`GET /api/wallet/runs/:runId/continue` and scan the returned offer with the
real wallet. The backend currently cannot confirm wallet scanning or
credential receipt.
