# Backend API lifecycle notes

Start the service with `npm start` (port 5000). Run the test suite with
`node --test`.

## Verifier and wallet configuration

`INJI_VERIFY_URL` is the base URL used by the Inji Verify adapter.
`INJI_VERIFY_CLIENT_ID` must be the client ID that Inji Verify accepts and
the selected wallet is configured to trust. Obtain it from the Verify
deployment's relying-party/client registration or the deployment's
documented DID configuration; do not substitute a test/example identifier.
The backend passes this value to Verify when creating a VP request and uses
the same value as `client_id` in the wallet's OpenID4VP QR URI.

For DID/by-reference requests, the Verify DID document and request URI must
be reachable from the wallet. Verify's `response_uri` is constructed from
`INJI_VP_SUBMISSION_BASE_URL` with `/vp-submission/direct-post`; configure the
wallet to trust that callback according to its deployment policy. Keep
`INJI_VERIFY_CLIENT_ID` empty until its real deployment value is confirmed.
Issuer URL configuration is separate: `INJI_CERTIFY_URL` is the Certify base
URL used by the issuer adapter.

## Run diagnostics

`GET /api/runs/:runId/diagnostics` reports adapter availability and whether
required component configuration is present, including per-field statuses,
without returning configured URLs, client IDs, credential-offer URIs,
authorization requests, or tokens. Configuration is not a connectivity
check: issuer and verifier connectivity are reported as `NOT_CHECKED`, and
the wallet is `NOT_APPLICABLE` because its handoff is an external user action.

The response separately reports prepared actions, pending wallet actions,
issuance state, and verification outcome. A prepared QR handoff does not
confirm a wallet scan or credential issuance. A pending presentation is not a
verification result; only a stored authoritative Verify result or rejection
sets the outcome to `CONFIRMED` with `PASS` or `FAIL`.

The current Inji Mobile adapter does not implement credential request
creation: `POST /api/issuance/runs/:runId/credential` returns HTTP 501.
`GET /api/wallet/runs/:runId/continue` prepares an OpenID4VCI offer QR
handoff, while `POST /api/wallet/runs/:runId/presentation` prepares an
OpenID4VP QR URI. These endpoints do not observe a wallet scan, create or
submit a credential/presentation, or prove issuance. Diagnostics do not
contact Certify, Wallet, or Verify; their connectivity must be established
by actual protocol operations. `GET /api/health` only confirms that the
backend process is running.
