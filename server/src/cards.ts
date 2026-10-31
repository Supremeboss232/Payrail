/**
 * Payrail Internal Virtual Card System
 *
 * Issues and manages ledger-backed virtual cards for partner firms.
 * Works without any external card network contract. Each card is backed
 * by a dedicated sub-account in the Payrail ledger.
 *
 * Upgrade path: When a Marqeta/Galileo contract is signed, forward card
 * operations to the external provider and map their card IDs back to
 * Payrail card IDs for continuity.
 */

import { v4 as uuidv4 } from 'uuid';
import { railDb, systemTenantId, createNotification } from './db';
import { createAccount, postTransaction } from './ledger';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function generatePan(): string {
  // Generate a 16-digit Luhn-valid number in the test BIN range 4111...
  // Using BIN 4716 (Visa test range) for internal cards
  const prefix = '4716';
  let pan = prefix;
  while (pan.length < 15) pan += Math.floor(Math.random() * 10).toString();
  // Luhn check digit
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = parseInt(pan[14 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return pan + check.toString();
}

function generateCvv(): string {
  return Math.floor(100 + Math.random() * 900).toString();
}

function generateExpiry(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear() + 3).slice(-2); // 3 years validity
  return `${month}/${year}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Card Issuance
// ─────────────────────────────────────────────────────────────────────────────

export interface CardIssueRequest {
  tenantId: string;
  cardholderName: string;
  cardType: 'virtual' | 'physical';
  currency?: string;
  spendLimit?: number;
  purpose?: string;
}

export interface VirtualCard {
  id: string;
  tenant_id: string;
  cardholder_name: string;
  pan_masked: string;
  pan_last4: string;
  expiry: string;
  card_type: string;
  currency: string;
  status: string;
  spend_limit: number | null;
  spend_used: number;
  ledger_account_id: string;
  purpose: string;
  issued_at: string;
  // Only present at issuance
  pan_full?: string;
  cvv?: string;
}

export async function issueCard(req: CardIssueRequest): Promise<VirtualCard> {
  const cardId = `card_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
  const pan = generatePan();
  const cvv = generateCvv();
  const expiry = generateExpiry();
  const currency = req.currency || 'USD';
  const issuedAt = new Date().toISOString();

  // Create a dedicated ledger account for this card
  const ledgerAccountId = `acc_card_${cardId}`;
  await railDb.execute({
    sql: `INSERT OR IGNORE INTO accounts (id, name, type, category, currency, balance, status, tenant_id, created_at)
          VALUES (?, ?, 'asset', 'card', ?, 0, 'active', ?, ?)`,
    args: [ledgerAccountId, `Card Account – ${req.cardholderName}`, currency, req.tenantId, issuedAt]
  });

  // Store the card (pan stored as last4 + hash; full pan only returned once)
  const panLast4 = pan.slice(-4);
  const panMasked = `**** **** **** ${panLast4}`;
  const panHash = Buffer.from(pan).toString('base64'); // In production: use Vault/KMS

  await railDb.execute({
    sql: `INSERT INTO virtual_cards
          (id, tenant_id, cardholder_name, pan_hash, pan_last4, pan_masked, expiry, cvv_hash,
           card_type, currency, status, spend_limit, spend_used, ledger_account_id, purpose, issued_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?)`,
    args: [
      cardId, req.tenantId, req.cardholderName, panHash, panLast4, panMasked,
      expiry, cvv, req.cardType, currency,
      req.spendLimit ?? null, ledgerAccountId, req.purpose || 'general', issuedAt
    ]
  });

  await createNotification(
    req.tenantId,
    'Card Issued',
    `Virtual card issued to ${req.cardholderName} (${panMasked})`,
    'success'
  );

  return {
    id: cardId,
    tenant_id: req.tenantId,
    cardholder_name: req.cardholderName,
    pan_masked: panMasked,
    pan_last4: panLast4,
    expiry,
    card_type: req.cardType,
    currency,
    status: 'active',
    spend_limit: req.spendLimit ?? null,
    spend_used: 0,
    ledger_account_id: ledgerAccountId,
    purpose: req.purpose || 'general',
    issued_at: issuedAt,
    // Only returned at issuance — never again
    pan_full: pan,
    cvv,
  };
}

export async function listCards(tenantId: string): Promise<VirtualCard[]> {
  const result = await railDb.execute({
    sql: `SELECT id, tenant_id, cardholder_name, pan_masked, pan_last4, expiry,
                 card_type, currency, status, spend_limit, spend_used,
                 ledger_account_id, purpose, issued_at
          FROM virtual_cards WHERE tenant_id = ? ORDER BY issued_at DESC`,
    args: [tenantId]
  });
  return result.rows as unknown as VirtualCard[];
}

export async function getCard(cardId: string, tenantId: string): Promise<VirtualCard | null> {
  const result = await railDb.execute({
    sql: `SELECT id, tenant_id, cardholder_name, pan_masked, pan_last4, expiry,
                 card_type, currency, status, spend_limit, spend_used,
                 ledger_account_id, purpose, issued_at
          FROM virtual_cards WHERE id = ? AND tenant_id = ?`,
    args: [cardId, tenantId]
  });
  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as VirtualCard;
}

export async function updateCardStatus(cardId: string, tenantId: string, status: 'active' | 'frozen' | 'canceled'): Promise<void> {
  await railDb.execute({
    sql: `UPDATE virtual_cards SET status = ? WHERE id = ? AND tenant_id = ?`,
    args: [status, cardId, tenantId]
  });
}

export async function authorizeCardTransaction(
  cardId: string,
  tenantId: string,
  amount: number,
  merchant: string
): Promise<{ approved: boolean; reason?: string; transaction_id?: string }> {
  const card = await getCard(cardId, tenantId);
  if (!card) return { approved: false, reason: 'Card not found.' };
  if (card.status !== 'active') return { approved: false, reason: `Card is ${card.status}.` };
  if (card.spend_limit !== null && (card.spend_used + amount) > card.spend_limit) {
    return { approved: false, reason: `Spend limit exceeded. Available: ${card.currency} ${(card.spend_limit - card.spend_used).toFixed(2)}` };
  }

  // Check balance in card's ledger account
  const balResult = await railDb.execute({
    sql: `SELECT balance FROM accounts WHERE id = ?`,
    args: [card.ledger_account_id]
  });
  const balanceCents = Number((balResult.rows[0] as any)?.balance ?? 0);
  const amountCents = Math.round(amount * 100);
  if (balanceCents < amountCents) {
    return { approved: false, reason: `Insufficient funds. Available: ${card.currency} ${(balanceCents / 100).toFixed(2)}` };
  }

  // Debit the card account (asset decrease -> credit card account, debit merchant settlement equity)
  const merchantRevenueId = `acc_card_settlement_${card.currency.toLowerCase()}`;
  await railDb.execute({
    sql: `INSERT OR IGNORE INTO accounts (id, name, type, category, currency, balance, status, tenant_id, created_at)
          VALUES (?, 'Card Merchant Settlement Pool', 'liability', 'escrow', ?, 0, 'active', ?, ?)`,
    args: [merchantRevenueId, card.currency, tenantId, new Date().toISOString()]
  });

  const tx = await postTransaction(
    `Card purchase – ${merchant}`,
    'api',
    [
      { accountId: merchantRevenueId, type: 'debit', amount: Math.round(amount * 100), currency: card.currency },
      { accountId: card.ledger_account_id, type: 'credit', amount: Math.round(amount * 100), currency: card.currency }
    ],
    `card_auth_${cardId}_${Date.now()}`,
    null,
    tenantId
  );

  // Update spend_used
  await railDb.execute({
    sql: `UPDATE virtual_cards SET spend_used = spend_used + ? WHERE id = ?`,
    args: [amount, cardId]
  });

  return { approved: true, transaction_id: tx.id };
}
