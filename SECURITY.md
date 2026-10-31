# 🛡️ Payrail Security & Cryptographic Architecture

Payrail is engineered with defense-in-depth cryptographic controls across authentication, interbank message non-repudiation, ledger immutability, and sensitive credential storage.

---

## 1. Interbank Non-Repudiation (Secp256k1 ECDSA Signatures)
Every member financial institution onboarded onto Payrail receives an asymmetric **Secp256k1 ECDSA** key pair (`server/src/b2b.ts`):
- **Public Key (`public_key_pem`)**: Stored in the clearinghouse `tenants` registry.
- **Private Key (`private_key_pem`)**: Returned once during onboarding and never persisted by Payrail.
- **Detached Signature Header (`Payrail-Signature`)**:
  ```http
  Payrail-Tenant-Id: <tenant-uuid>
  Payrail-Signature: t=<unix-ms-timestamp>,v1=<hex-ecdsa-sha256-signature>
  ```
- **Replay Protection**: `verifyB2BSignature` enforces a strict **±5-minute clock drift window** (`300,000 ms`) on `t` before verifying `SHA256(t + "." + JSON.stringify(body))` against the tenant's registered public key.

---

## 2. Cryptographic Ledger Audit Trail (SHA-256 Merkle Hash Chain)
All financial postings in `server/src/ledger.ts` (`postTransaction`) enforce two invariants:
1. **Strict Zero-Sum Double-Entry**: Total debits must equal total credits (`totalDebits === totalCredits`) across every transaction, or the database transaction immediately rolls back.
2. **Immutable Hash Chaining**: Every transaction computes a deterministic SHA-256 digest linking the previous transaction's hash (`previousHash`):
   $$\text{Hash}_n = \text{SHA256}(\text{Hash}_{n-1} \parallel \text{txId} \parallel \text{timestamp} \parallel \text{referenceId} \parallel \text{entriesJson})$$
   Any tampering with historical journal entries invalidates the entire downstream hash chain.

---

## 3. Vault Encryption at Rest (`AES-256-GCM`)
External bank connector credentials (`funding_sources.credentials_encrypted`) and virtual card sensitive data (`pan_encrypted`, `cvv_encrypted`) are encrypted prior to database persistence (`server/src/crypto.ts` & `server/src/cards.ts`):
- **Cipher**: `aes-256-gcm` with authenticated encryption tags (`16-byte` auth tag) and unique per-record initialization vectors (`IV`).
- **Master Key**: Derived from `MASTER_KEY` environment variable (32-byte / 64-hex character key).

---

## 4. Password Hashing & Authentication Controls
- **Scrypt Key Derivation**: User passwords in `server/src/db.ts` (`hashPassword` / `verifyPassword`) use `crypto.scryptSync` with a random 16-byte salt (`N=16384, r=8, p=1, keylen=64`) and constant-time comparison via `crypto.timingSafeEqual`.
- **Session Tokens (JWT)**: Console routes (`/console/*`) require an `HMAC-SHA256` signed JWT bearer token (`authenticateJwt`).
- **Gateway API Keys**: BaaS gateway routes (`/v1/*`) authenticate against SHA-256 hashed `sk_live_...` keys via `Authorization: Bearer <key>` or `X-Gateway-API-Key: <key>`.
- **Zero-Knowledge Account Recovery**: Supports both expiring single-use reset tokens (`password_reset_tokens`) and SHA-256 hashed Security Questions (`security_questions`).

---

## 5. HTTP Security Headers & Brute-Force Protection
`server/src/index.ts` enforces:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- **IP Rate Limiting**: Authentication routes (`/v1/auth/*`) are rate-limited to prevent credential stuffing and brute-force attacks.

---

## 6. Outbound Webhook Signatures (`HMAC-SHA256`)
All outbound webhook events (`server/src/webhooks.ts`) include a `Payrail-Signature` header computed with the endpoint's `whsec_...` secret:
```text
Payrail-Signature: t=<timestamp>,v1=<HMAC-SHA256(timestamp + "." + payload, secret)>
```
