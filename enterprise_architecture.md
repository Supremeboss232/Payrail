# Payrail Enterprise Settlement Rail
## System Architecture & Technical Specifications Design Document

This design document outlines the enterprise-grade system architecture, multi-tenant database schemas, cryptographic audit trails, financial messaging systems, and deployment strategies required for **Payrail** to operate as a self-hosted private settlement network for B2B transactional routing between financial entities.

---

## 1. System Topology & Transaction Flow

The system coordinates secure communications between external Fintech API consumers, the Payrail middleware, Bank-side ISO 20022 message routers, and the internal Core Banking System (CBS).

```mermaid
sequenceDiagram
    autonumber
    actor Client as External API / Fintech Client
    participant PR as Payrail Gateway (Self-Hosted)
    participant MR as ISO 20022 Message Router
    participant CBS as Core Banking System (CBS)

    Client->>PR: HTTPS POST /v1/payment_intents (Signed Payload, mTLS)
    activate PR
    PR->>PR: Authenticate client public key & verify payload signature
    PR->>PR: Check real-time liquidity (RTGS check) & rate limits
    PR->>PR: Write atomic Escrow Lock in double-entry ledger
    PR->>MR: Dispatch Pacs.008 (ISO 20022 XML Message)
    activate MR
    MR->>CBS: Post clearing transaction request
    activate CBS
    CBS-->>MR: Transaction posted successfully
    deactivate CBS
    MR-->>PR: Pacs.002 Payment Status Report (Succeeded)
    deactivate MR
    PR->>PR: Release Escrow: Credit Merchant, Debit Clearing
    PR-->>Client: HTTP 200 OK (Payment Succeeded)
    PR->>Client: Dispatch Signed Webhook (payment_intent.succeeded)
    deactivate PR
```

---

## 2. Multi-Tenant Ledger & Database Schema

To support absolute isolation and auditability, Payrail utilizes a relational database structure designed to guarantee ACID transactions. Balanced journal records are enforced via constraints and transactions.

```mermaid
erDiagram
    TENANTS ||--o{ LEDGER_ACCOUNTS : owns
    TENANTS ||--o{ API_KEYS : authenticates
    LEDGER_ACCOUNTS ||--o{ ENTRIES : records
    TRANSACTIONS ||--o{ ENTRIES : groups
    TRANSACTIONS ||--o{ AUDIT_LOGS : hash-chained
    TENANTS ||--o{ WEBHOOK_ENDPOINTS : registers
    WEBHOOK_ENDPOINTS ||--o{ WEBHOOK_DELIVERY_LOGS : records
```

### Relational Schema (PostgreSQL DDL Spec)

```sql
-- 1. Tenant Registry
CREATE TABLE tenants (
    id VARCHAR(50) PRIMARY KEY,
    legal_name VARCHAR(255) NOT NULL,
    routing_code VARCHAR(50) UNIQUE NOT NULL, -- e.g. BIC / Swift / Routing Number
    api_status VARCHAR(20) DEFAULT 'active' CHECK (api_status IN ('active', 'suspended', 'disabled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Multi-Tenant Ledger Accounts
CREATE TABLE ledger_accounts (
    id VARCHAR(50) PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('settlement', 'clearing', 'escrow', 'operating')),
    currency CHAR(3) NOT NULL, -- ISO 4217
    balance BIGINT DEFAULT 0 NOT NULL, -- Stored in minor units (e.g. cents) to prevent float errors
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 3. Double-Entry Transaction Headers
CREATE TABLE transactions (
    id VARCHAR(50) PRIMARY KEY,
    payment_intent_id VARCHAR(50) UNIQUE,
    description VARCHAR(255) NOT NULL,
    source_channel VARCHAR(50) NOT NULL, -- e.g. 'api', 'rtgs_settlement', 'dns_netting'
    reference_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'posted' CHECK (status IN ('pending', 'posted', 'void')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Double-Entry Journal Legs (Debits and Credits)
CREATE TABLE entries (
    id VARCHAR(50) PRIMARY KEY,
    transaction_id VARCHAR(50) NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    account_id VARCHAR(50) NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    type VARCHAR(10) NOT NULL CHECK (type IN ('debit', 'credit')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Cryptographic Ledger Hash-Chain (Merkle Integrity Audit)
CREATE TABLE ledger_audit_chain (
    sequence_id BIGSERIAL PRIMARY KEY,
    transaction_id VARCHAR(50) UNIQUE NOT NULL REFERENCES transactions(id),
    previous_block_hash CHAR(64) NOT NULL, -- SHA-256 hash of the previous record block
    current_block_hash CHAR(64) NOT NULL, -- SHA-256 hash representing current transaction block
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. Double-Entry Balance & Settlement Workflows

Any movement of money must exist as a set of debit and credit legs that balance to zero within the system.

### A. Gross Settlement Mode (RTGS)
RTGS executes immediately. If Bank A owes Bank B $5,000.00, Payrail performs the following transaction atomically:

```sql
BEGIN TRANSACTION;

-- 1. Insert Transaction Header
INSERT INTO transactions (id, description, source_channel, status)
VALUES ('tx_rtgs_001', 'Bank A to Bank B Clearing Transfer', 'rtgs_settlement', 'posted');

-- 2. Credit Leg: Reduces Bank A's Settlement Account Balance
INSERT INTO entries (id, transaction_id, account_id, type, amount, currency)
VALUES ('ent_rtgs_001_A', 'tx_rtgs_001', 'acc_bank_a_settlement', 'credit', 500000, 'USD');

UPDATE ledger_accounts 
SET balance = balance - 500000 
WHERE id = 'acc_bank_a_settlement' AND balance >= 500000; -- Protects against overdrafts

-- 3. Debit Leg: Increases Bank B's Settlement Account Balance
INSERT INTO entries (id, transaction_id, account_id, type, amount, currency)
VALUES ('ent_rtgs_001_B', 'tx_rtgs_001', 'acc_bank_b_settlement', 'debit', 500000, 'USD');

UPDATE ledger_accounts 
SET balance = balance + 500000 
WHERE id = 'acc_bank_b_settlement';

COMMIT;
```

### B. Net Settlement Mode (DNS)
Under Deferred Net Settlement (DNS), incoming payments are queued without moving money between banks instantly. At 17:00 UTC, the netting engine aggregates obligations:

$$\text{Net Position} = \sum \text{Debits} - \sum \text{Credits}$$

If Bank A owes Bank B $10M but Bank B owes Bank A $8M over the clearing period, a single Net Settlement transaction clears the difference:
* **Debit**: Bank A Settlement Account ($2,000,000)
* **Credit**: Bank B Settlement Account (+$2,000,000)

---

## 4. ISO 20022 Financial Messaging Engine

To communicate with central clearing systems (FedNow, TARGET2, SWIFT), Payrail features an XML messaging router that maps SQL transactions to formal ISO schemas.

### PACs.008 (Customer Credit Transfer Message) Example:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
    <FIToFICstmrCdtTrf>
        <GrpHdr>
            <MsgId>MSG20260711-9928172</MsgId>
            <CreDtTm>2026-07-11T15:07:00Z</CreDtTm>
            <NbOfTxs>1</NbOfTxs>
            <SttlmInf>
                <SttlmMtd>CLRG</SttlmMtd>
            </SttlmInf>
        </GrpHdr>
        <CdtTrfTxInf>
            <PmtId>
                <EndToEndId>pi_test_verification_999</EndToEndId>
                <UETR>3e7ebb36-010d-4b0a-98fc-faf1c89bfdb3</UETR>
            </PmtId>
            <IntrBkSttlmAmt Ccy="USD">500.00</IntrBkSttlmAmt>
            <Dbtr>
                <Nm>Fintech Client Inc</Nm>
            </Dbtr>
            <DbtrAgt>
                <FinInstnId>
                    <BICFI>PAYRUSA1XXX</BICFI>
                </FinInstnId>
            </DbtrAgt>
            <CdtrAgt>
                <FinInstnId>
                    <BICFI>COREUSA2XXX</BICFI>
                </FinInstnId>
            </CdtrAgt>
            <Cdtr>
                <Nm>Merchant Destination LLC</Nm>
            </Cdtr>
        </CdtTrfTxInf>
    </FIToFICstmrCdtTrf>
</Document>
```

---

## 5. Security, Cryptographic Guardrails, and Webhooks

### A. Mutual TLS (mTLS) Setup
For bank-to-bank server calls, authentication bypasses raw passwords. Nginx/HAProxy is configured at the gateway boundary to enforce client certificates:

```nginx
server {
    listen 443 ssl;
    server_name api.payrail.internal;

    ssl_certificate /etc/ssl/certs/payrail.crt;
    ssl_certificate_key /etc/ssl/private/payrail.key;

    # Enable Mutual TLS (mTLS)
    ssl_client_certificate /etc/ssl/certs/trusted_clients_ca.crt;
    ssl_verify_client on;

    location /v1/ {
        proxy_pass http://localhost:9500;
        proxy_set_header X-Client-DN $ssl_client_s_dn; # Passes client certificate name to backend
    }
}
```

### B. Payload Signing (ECDSA)
Every request payload must include a cryptographic header `X-Payrail-Signature` generated using the client's private key. The gateway verifies the signature before processing the API body:

```typescript
import * as crypto from 'crypto';

export function verifyPayloadSignature(payload: string, signature: string, clientPublicKey: string): boolean {
  const verifier = crypto.createVerify('sha256');
  verifier.update(payload);
  return verifier.verify(clientPublicKey, signature, 'hex');
}
```

### C. Webhook Idempotency & Exponential Backoff
Webhooks dispatch asynchronously. If a client server drops, Payrail executes retries with jitter:

$$t_{\text{retry}} = t_{\text{base}} \times 2^{\text{attempt}} \pm \text{jitter}$$

* **Idempotency**: Clients must send an `X-Idempotency-Key` header with requests. Payrail caches this key in SQLite/Redis for 24 hours to prevent duplicate transaction executions if client retries are received.

---

## 6. Air-Gapped Containerized Packaging Blueprint

To support completely isolated on-premise bank datacenters with zero public internet connection, Payrail builds into self-contained container matrices.

### Docker-Compose Air-Gapped Blueprint (`docker-compose.yml`):
```yaml
version: '3.8'

services:
  database:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: payrail_settlement
      POSTGRES_USER: payrail_admin
      POSTGRES_PASSWORD: secure_system_password
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - private_network

  gateway:
    image: payrail/gateway-service:latest
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgres://payrail_admin:secure_system_password@database:5432/payrail_settlement
      PORT: 8080
      NODE_ENV: production
    ports:
      - "8080:8080"
    depends_on:
      - database
    networks:
      - private_network

volumes:
  pgdata:

networks:
  private_network:
    driver: bridge
    internal: true # Disables external NAT access (Air-gapped isolation)
```
