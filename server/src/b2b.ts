import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { railDb } from './db';

// Extend Request interface to include tenant details
declare global {
  namespace Express {
    interface Request {
      tenant?: {
        id: string;
        legal_name: string;
        routing_code: string;
      };
    }
  }
}

/**
 * Express middleware to verify ECDSA signatures on incoming B2B request payloads.
 * Requires headers:
 * - Payrail-Tenant-Id: ID of the tenant making the request
 * - Payrail-Signature: Signature in format "t=TIMESTAMP,v1=SIGNATURE_HEX"
 */
export async function authenticateB2BRequest(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.headers['payrail-tenant-id'] as string;
  const signatureHeader = req.headers['payrail-signature'] as string;

  if (!tenantId || !signatureHeader) {
    res.status(401).json({ error: 'B2B Authentication failed: Payrail-Tenant-Id and Payrail-Signature headers are required.' });
    return;
  }

  try {
    // 1. Fetch Tenant details and public key
    const tenantResult = await railDb.execute({
      sql: 'SELECT * FROM tenants WHERE id = ? AND api_status = \'active\'',
      args: [tenantId]
    });

    if (tenantResult.rows.length === 0) {
      res.status(401).json({ error: `Tenant ${tenantId} not found or inactive.` });
      return;
    }

    const tenant = tenantResult.rows[0] as any;

    // 2. Parse Signature Header (t=TIMESTAMP,v1=SIGNATURE_HEX)
    const sigMatch = signatureHeader.match(/t=(\d+),v1=([a-f0-9]+)/);
    if (!sigMatch) {
      res.status(401).json({ error: 'Invalid Payrail-Signature header format. Must be t=TIMESTAMP,v1=HEX_SIGNATURE' });
      return;
    }

    const timestamp = sigMatch[1];
    const signatureHex = sigMatch[2];

    // 3. Verify Timestamp freshness (prevent replay attacks, e.g., 5-minute window)
    const requestTime = parseInt(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - requestTime) > 300) {
      res.status(401).json({ error: 'Signature expired. Request timestamp lies outside of the 5-minute security window.' });
      return;
    }

    // 4. Reconstruct signed data
    // Payload consists of timestamp + '.' + JSON.stringify(body)
    const rawBody = JSON.stringify(req.body || {});
    const dataToVerify = `${timestamp}.${rawBody}`;

    // 5. Asymmetric Verification (ECDSA-SHA256)
    const verify = crypto.createVerify('SHA256');
    verify.update(dataToVerify);
    
    const isVerified = verify.verify(tenant.public_key_pem, signatureHex, 'hex');

    if (!isVerified) {
      res.status(401).json({ error: 'Invalid cryptographic signature. Asymmetric signature verification failed.' });
      return;
    }

    // Attach verified tenant object to request
    req.tenant = {
      id: tenant.id,
      legal_name: tenant.legal_name,
      routing_code: tenant.routing_code
    };

    next();
  } catch (error: any) {
    console.error('B2B Auth Error:', error);
    res.status(500).json({ error: 'Failed to process B2B signature verification.' });
  }
}

/**
 * Calculates a Merkle-chain hash connecting the new transaction to the previous transaction.
 * SHA256(current_transaction_data + previous_hash)
 */
export async function generateMerkleHash(txId: string, description: string, referenceId: string, paymentIntentId: string): Promise<string> {
  try {
    // 1. Fetch the latest transaction hash
    const lastTxResult = await railDb.execute('SELECT merkle_hash FROM transactions WHERE merkle_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1');
    
    let previousHash = '0000000000000000000000000000000000000000000000000000000000000000'; // Genesis Hash Seed
    if (lastTxResult.rows.length > 0) {
      previousHash = (lastTxResult.rows[0] as any).merkle_hash;
    }

    // 2. Hash contents
    const hashData = `${txId}:${description}:${referenceId || ''}:${paymentIntentId || ''}:${previousHash}`;
    const hash = crypto.createHash('sha256').update(hashData).digest('hex');
    
    return hash;
  } catch (error) {
    console.error('Failed to calculate Merkle hash:', error);
    throw new Error('Merkle Ledger integrity computation failed.');
  }
}

/**
 * ISO 20022 Pacs.008 (Customer Credit Transfer) XML message builder.
 */
export function buildPacs008(pi: { id: string; amount: number; currency: string; destination_account_id: string }, sourceBic: string, destBic: string): string {
  const amountStr = (pi.amount / 100).toFixed(2);
  const timestamp = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>${pi.id}</MsgId>
      <CreDtTm>${timestamp}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>${pi.id}</EndToEndId>
        <UETR>${crypto.randomUUID()}</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="${pi.currency}">${amountStr}</IntrBkSttlmAmt>
      <Dbtr>
        <Nm>B2B Client Gateway Originator</Nm>
      </Dbtr>
      <DbtrAgt>
        <FinInstnId>
          <BICFI>${sourceBic}</BICFI>
        </FinInstnId>
      </DbtrAgt>
      <CdtrAgt>
        <FinInstnId>
          <BICFI>${destBic}</BICFI>
        </FinInstnId>
      </CdtrAgt>
      <Cdtr>
        <Nm>Merchant Settlement Wallet</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <Othr>
            <Id>${pi.destination_account_id}</Id>
          </Othr>
        </Id>
      </CdtrAcct>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`.trim();
}

/**
 * ISO 20022 Pacs.009 (FI Credit Transfer) XML message builder for Bank-to-Bank settlements.
 */
export function buildPacs009(txId: string, amount: number, currency: string, sourceBic: string, destBic: string): string {
  const amountStr = (amount / 100).toFixed(2);
  const timestamp = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08">
  <FICdtTrf>
    <GrpHdr>
      <MsgId>${txId}</MsgId>
      <CreDtTm>${timestamp}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>COVE</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>${txId}</EndToEndId>
        <UETR>${crypto.randomUUID()}</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="${currency}">${amountStr}</IntrBkSttlmAmt>
      <Dbtr>
        <Nm>Bank Core Settlement Reserve</Nm>
      </Dbtr>
      <DbtrAgt>
        <FinInstnId>
          <BICFI>${sourceBic}</BICFI>
        </FinInstnId>
      </DbtrAgt>
      <CdtrAgt>
        <FinInstnId>
          <BICFI>${destBic}</BICFI>
        </FinInstnId>
      </CdtrAgt>
    </CdtTrfTxInf>
  </FICdtTrf>
</Document>`.trim();
}

/**
 * ISO 20022 Camt.053 Bank Statement XML export builder.
 */
export function buildCamt053(account: { id: string; name: string; currency: string; balance: number }, entries: any[]): string {
  const timestamp = new Date().toISOString();
  const balanceStr = (account.balance / 100).toFixed(2);

  const entryItemsXml = entries.map(ent => `
      <Ntry>
        <Amt Ccy="${ent.currency}">${(ent.amount / 100).toFixed(2)}</Amt>
        <CdtDbtInd>${ent.type === 'debit' ? 'CRDT' : 'DBIT'}</CdtDbtInd>
        <Status>BOOK</Status>
        <BkTxCd>
          <Domn>
            <Cd>PMNT</Cd>
            <Fmly>
              <Cd>RCDT</Cd>
              <SubFmlyCd>INTR</SubFmlyCd>
            </Fmly>
          </Domn>
        </BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>${ent.transaction_id}</EndToEndId>
            </Refs>
          </TxDtls>
        </NtryDtls>
      </Ntry>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>stmt_${account.id}_${Date.now()}</MsgId>
      <CreDtTm>${timestamp}</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>stmt_${account.id}</Id>
      <CreDtTm>${timestamp}</CreDtTm>
      <Acct>
        <Id>
          <Othr>
            <Id>${account.id}</Id>
          </Othr>
        </Id>
        <Ccy>${account.currency}</Ccy>
        <Nm>${account.name}</Nm>
      </Acct>
      <Bal>
        <Type>
          <CdOrPrtry>
            <Cd>CLBD</Cd>
          </CdOrPrtry>
        </Type>
        <Amt Ccy="${account.currency}">${balanceStr}</Amt>
        <Dt>
          <Dt>${timestamp.split('T')[0]}</Dt>
        </Dt>
      </Bal>
      ${entryItemsXml}
    </Stmt>
  </BkToCstmrStmt>
</Document>`.trim();
}
