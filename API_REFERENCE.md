# 📖 Payrail REST API Reference (v2.0)

Base URL (Local Development): `http://127.0.0.95:9500`

---

## 🔐 Authentication Modes

| Route Prefix | Auth Mechanism | Header Format |
| :--- | :--- | :--- |
| `/v1/auth/*`, `/v1/partners/register`, `/v1/services/catalog`, `/health` | Public | None required |
| `/console/*` | Operator / Member Session JWT | `Authorization: Bearer <jwt_token>` |
| `/v1/*` (and `/v1/gateway/*` aliases) | Gateway Secret API Key | `Authorization: Bearer sk_live_...` or `X-Gateway-API-Key: sk_live_...` |
| `/v1/payment_intents/:id/confirm` (B2B mode) | ECDSA Detached Signature | `Payrail-Tenant-Id: <uuid>` + `Payrail-Signature: t=...,v1=...` |

---

## 1. Identity, Onboarding & Recovery (`/v1/auth/*`)

### `POST /v1/auth/login`
Authenticate an operator (`admin`) or member bank user.
- **Request**: `{ "username": "admin", "password": "admin123" }`
- **Response**: `{ "token": "<jwt>", "user": { "id": "...", "username": "admin", "role": "admin", "tenantId": "...", "legalName": "...", "routingCode": "..." } }`

### `POST /v1/auth/register`
Self-service wizard onboarding for a new member bank. Generates a `Secp256k1` key pair, clearing account, funding source, all 9 active BaaS services, and a Gateway API Key.
- **Request**:
  ```json
  {
    "legal_name": "First National Bank",
    "routing_code": "FNB_CORP_01",
    "username": "fnb_admin",
    "password": "StrongPassword123",
    "connector_type": "http_callback",
    "connector_config": { "url": "https://api.partnerbank.com/v1/payouts", "method": "POST" }
  }
  ```
- **Response**: `{ "success": true, "tenant": { ... }, "private_key_pem": "-----BEGIN EC PRIVATE KEY-----...", "gateway_key": "sk_live_..." }`

### `POST /v1/auth/forgot_password`
Generate a 1-hour password reset token (emailed via SendGrid or returned in dev mode as `reset_token_dev`).
- **Request**: `{ "username": "fnb_admin" }`

### `POST /v1/auth/verify_security_question`
Verify a user's SHA-256 hashed security question answer and receive a 15-minute reset token.
- **Request**: `{ "username": "fnb_admin", "answer": "MySecretAnswer" }`

### `POST /v1/auth/reset_password`
Reset password using either a reset token or security-question JWT.
- **Request**: `{ "token": "<token>", "new_password": "NewSecurePassword123" }`

### `POST /v1/auth/sign_payload`
Helper utility to compute a valid `Secp256k1` ECDSA signature for testing B2B `pacs.008` requests.
- **Request**: `{ "privateKeyPem": "-----BEGIN EC PRIVATE KEY-----...", "payload": {} }`

---

## 2. Core Clearinghouse & Payment Intents (`/v1/*`)

> All `/v1/*` BaaS endpoints are also accessible under `/v1/gateway/*` (e.g., `/v1/gateway/payment_intents`).

### `POST /v1/payment_intents`
Create a payment intent. Accepts `amount` or `amount_cents` (in minor units / cents).
- **Request**:
  ```json
  {
    "amount": 50000,
    "currency": "USD",
    "destination_account_id": "acc_merchant_usd",
    "description": "Invoice #1042"
  }
  ```

### `POST /v1/payment_intents/:id/confirm`
Execute priority waterfall routing across active funding sources, post balanced double-entry ledger entries, and generate an ISO 20022 `pacs.008.001.08` XML message (`pacs_008_xml` / `pacs_msg`).

### `POST /v1/settlements/dns_sweep`
Execute a multilateral Deferred Net Settlement (DNS) sweep across member bank clearing accounts and generate an ISO 20022 `pacs.009.001.08` Financial Institution Credit Transfer XML message (`pacs_009_xml` / `pacs_msg`).

### `GET /v1/statements/:accountId/camt053`
Generate and export an ISO 20022 `camt.053.001.02` Bank-to-Customer Statement XML document for the specified ledger account.

---

## 3. Integrated BaaS Services (`/v1/*`)

### `GET /v1/services/catalog`
Returns the full catalog of all 9 BaaS services, statuses, engines, and sample payloads.

### `GET /v1/fx/rates?base=USD&symbols=EUR,GBP,NGN`
Returns live or institutional reference FX exchange rates.

### `POST /v1/fx/convert`
Convert an amount between two currencies.
- **Request**: `{ "from": "USD", "to": "EUR", "amount": 1000 }`

### `POST /v1/aml/screen`
Screen an individual or entity against the OFAC SDN sanctions list (or ComplyAdvantage).
- **Request**: `{ "name": "John Doe", "country": "US", "type": "individual" }`

### `POST /v1/cards/issue`
Issue a Luhn-valid virtual Visa card (`4532...`) encrypted with AES-256-GCM and linked to a ledger account.
- **Request**: `{ "account_id": "acc_merchant_usd", "cardholder_name": "Jane Doe", "limit_cents": 500000, "currency": "USD" }`

### `POST /v1/cards/:id/authorize`
Authorize a card transaction against the linked ledger account and spend limit, posting a balanced double-entry settlement transaction.
- **Request**: `{ "amount_cents": 2500, "merchant_name": "Cloud Services Inc", "merchant_category": "5734" }`

### `POST /v1/ach/initiate`
Initiate a NACHA ACH debit or credit transfer with immediate ledger posting.
- **Request**: `{ "account_id": "acc_merchant_usd", "routing_number": "021000021", "account_number": "1234567890", "amount_cents": 25000, "direction": "credit" }`

### `POST /v1/payments/transfer`
Initiate a domestic Fedwire (`wire`) or international `swift` transfer.
- **Request**: `{ "type": "wire", "from_account_id": "acc_merchant_usd", "amount_cents": 100000, "currency": "USD", "beneficiary_name": "Acme Corp", "routing_number": "021000021", "account_number": "987654321" }`

### `POST /v1/credit/score`
Perform a soft credit pull with deterministic ledger-backed risk scoring and credit limit recommendation.
- **Request**: `{ "full_name": "John Smith", "ssn_last4": "1234", "dob": "1985-06-15", "account_id": "acc_merchant_usd" }`

### `POST /v1/otp/send`
Dispatch a 6-digit verification OTP via SendGrid or the Payrail In-Network OTP Engine.
- **Request**: `{ "email": "ops@partnerbank.com", "purpose": "transaction_approval" }`
