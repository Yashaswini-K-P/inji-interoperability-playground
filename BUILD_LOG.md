# Inji Interoperability Playground — Build Log

## Project Goal

Build a configurable interoperability playground that reflects
the Inji ecosystem while allowing interoperability testing with
external credential stacks.

The playground should allow users to configure representative
issuer → wallet → verifier scenarios, execute or facilitate the
relevant credential issuance and presentation flows, capture
protocol exchanges, and report interoperability results.

---

# Phase 0 — Project Initialization

## Step 1 — Repository Creation

Date: 2026-10-07

### Created

- Created the project repository
- Created the initial backend directory
- Created BUILD_LOG.md
- Created README.md
- Created .gitignore
- Initialized Git

### Initial Structure

```text
inji-interoperability-playground/
├── backend/
├── BUILD_LOG.md
├── README.md
└── .gitignore
```


# Phase 1 — Backend Foundation

## Step 2 — Node.js Backend Initialization

Date: 2026-10-07

### Created

- Initialized Node.js backend with npm
- Added Express
- Added CORS
- Added dotenv
- Added Axios
- Added Nodemon
- Created initial backend directory structure

### Backend Structure

```text
backend/
├── src/
│   ├── adapters/
│   │   ├── issuers/
│   │   ├── wallets/
│   │   └── verifiers/
│   ├── config/
│   ├── controllers/
│   ├── engine/
│   ├── logger/
│   ├── routes/
│   ├── services/
│   └── app.js
├── .env
├── .env.example
├── package.json
└── server.js
```

# Phase 2 — Component Registry

## Step 3 — Configurable Component Registry

Date: 2026-10-07

### Built

Created the initial component registry for:

- Issuers
- Wallets
- Verifiers

Initial components:

- Inji Certify
- Inji Mobile Wallet
- Inji Web Wallet
- Inji Verify

Each component contains metadata describing its identity,
configuration, supported protocols and relevant capabilities.

### Architecture

```text
API
 ↓
Component Registry Service
 ↓
Component Configuration

# API's
GET /api/components
GET /api/components/:type
GET /api/components/:type/:id
```

# Phase 3 — Scenario Configuration and Compatibility

## Step 4 — Scenario Model

Date: 2026-10-07

### Built

Created the initial scenario model representing a complete
interoperability test configuration.

A scenario contains:

- Issuer
- Credential
- Credential format
- Issuance protocol
- Issuance flow
- Wallet
- Verifier
- Presentation protocol

### API

```text
POST /api/scenarios
GET  /api/scenarios
GET  /api/scenarios/:id
```

# Phase 4 — Inji Certify Integration

## Step 6 — Inji Certify Adapter

Date: 2026-10-07

### Built

Created the first issuer adapter for Inji Certify.

The adapter is responsible for communicating with the configured
Inji Certify instance.

### Architecture

```text
Scenario / API
      ↓
Issuer Service
      ↓
Inji Certify Adapter
      ↓
Inji Certify
```

## Step 7 — Dynamic Credential Discovery

Date: 2026-10-07

### Built

Added credential discovery through the Inji Certify issuer adapter.

The Playground now retrieves the issuer's live OpenID4VCI
metadata and converts `credential_configurations_supported`
into a simplified Playground credential model.

### API

```text
GET /api/issuers/:issuerId/credentials
```

## Step 9 — Pre-Authorized Credential Offer

Date: 2026-10-07

### Built

Implemented the first real OpenID4VCI issuance operation through
the Inji Certify adapter.

### Flow

```text
Playground
    ↓
Inji Certify Adapter
    ↓
POST /v1/certify/pre-authorized-data
    ↓
credential_offer_uri
    ↓
GET /v1/certify/credential-offer-data/{offer_id}
    ↓
OpenID4VCI Credential Offer
```
### Playground API's
POST /api/issuance/pre-authorized-offer
GET  /api/issuance/offers/:offerId