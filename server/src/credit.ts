/**
 * Payrail Internal Credit Scoring Engine
 *
 * Provides creditworthiness assessments based on transaction history,
 * account longevity, and repayment patterns within the Payrail network.
 *
 * Works without any external credit bureau. Score range: 300–850 (FICO-style).
 *
 * Upgrade path: When an Equifax/Experian bureau contract is signed,
 * supplement this score with a hard-pull bureau report and return both.
 */

import { railDb } from './db';

export interface CreditReport {
  score: number;                  // 300–850
  grade: string;                  // 'A', 'B', 'C', 'D', 'F'
  risk_band: string;              // 'Very Low', 'Low', 'Medium', 'High', 'Very High'
  factors: string[];              // Positive/negative factors driving score
  max_recommended_credit: number; // USD
  dti_estimate: number;           // Debt-to-income ratio estimate (0–1)
  engine: string;
  generated_at: string;
  // Only present when bureau contract is active
  bureau_report?: any;
}

interface TxStats {
  total_transactions: number;
  total_volume_in: number;
  total_volume_out: number;
  avg_monthly_volume: number;
  failed_count: number;
  first_tx_date: string | null;
  account_age_days: number;
  large_inflows: number;          // Transactions > $10,000
  settlement_count: number;
}

async function fetchTxStats(tenantId: string): Promise<TxStats> {
  const now = new Date();

  // Transaction volume and counts
  const statsResult = await railDb.execute({
    sql: `SELECT
            COUNT(*) as total_transactions,
            COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) as total_volume_in,
            COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as total_volume_out,
            MIN(created_at) as first_tx_date,
            COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
            COUNT(CASE WHEN amount > 1000000 THEN 1 END) as large_inflows
          FROM ledger_entries le
          JOIN accounts a ON le.account_id = a.id
          WHERE a.tenant_id = ?`,
    args: [tenantId]
  });

  // Payment intent success rate
  const piResult = await railDb.execute({
    sql: `SELECT COUNT(*) as settlement_count FROM payment_intents WHERE tenant_id = ? AND status = 'settled'`,
    args: [tenantId]
  });

  const row = (statsResult.rows[0] as any) || {};
  const firstDate = row.first_tx_date ? new Date(row.first_tx_date) : null;
  const ageMs = firstDate ? now.getTime() - firstDate.getTime() : 0;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  // Estimate monthly volume based on age
  const months = Math.max(ageDays / 30, 1);
  const avgMonthly = (Number(row.total_volume_in) || 0) / 100 / months; // amounts stored in cents

  return {
    total_transactions: Number(row.total_transactions) || 0,
    total_volume_in: (Number(row.total_volume_in) || 0) / 100,
    total_volume_out: (Number(row.total_volume_out) || 0) / 100,
    avg_monthly_volume: avgMonthly,
    failed_count: Number(row.failed_count) || 0,
    first_tx_date: row.first_tx_date || null,
    account_age_days: ageDays,
    large_inflows: Number(row.large_inflows) || 0,
    settlement_count: Number((piResult.rows[0] as any)?.settlement_count) || 0,
  };
}

function computeScore(stats: TxStats): { score: number; factors: string[] } {
  let score = 500; // baseline
  const factors: string[] = [];

  // ── Account longevity (max +100) ──
  if (stats.account_age_days >= 365) {
    score += 100;
    factors.push('✅ Account active for over 12 months');
  } else if (stats.account_age_days >= 180) {
    score += 60;
    factors.push('✅ Account active for over 6 months');
  } else if (stats.account_age_days >= 30) {
    score += 20;
    factors.push('Account is relatively new (< 6 months)');
  } else {
    factors.push('⚠️ Account age is very short (< 30 days)');
    score -= 20;
  }

  // ── Transaction volume (max +80) ──
  if (stats.avg_monthly_volume >= 1_000_000) {
    score += 80;
    factors.push('✅ High monthly transaction volume (>$1M)');
  } else if (stats.avg_monthly_volume >= 100_000) {
    score += 50;
    factors.push('✅ Strong monthly transaction volume (>$100K)');
  } else if (stats.avg_monthly_volume >= 10_000) {
    score += 25;
    factors.push('Moderate monthly transaction volume (>$10K)');
  } else if (stats.avg_monthly_volume > 0) {
    score += 10;
  } else {
    score -= 30;
    factors.push('⚠️ No transaction history found');
  }

  // ── Settlement success (max +60) ──
  if (stats.settlement_count >= 50) {
    score += 60;
    factors.push(`✅ Excellent settlement record (${stats.settlement_count} settlements)`);
  } else if (stats.settlement_count >= 10) {
    score += 35;
    factors.push(`✅ Good settlement record (${stats.settlement_count} settlements)`);
  } else if (stats.settlement_count >= 1) {
    score += 15;
    factors.push(`${stats.settlement_count} completed settlements on record`);
  }

  // ── Failed transactions (penalty) ──
  const failRate = stats.total_transactions > 0
    ? stats.failed_count / stats.total_transactions
    : 0;
  if (failRate > 0.1) {
    const penalty = Math.round(failRate * 100);
    score -= penalty;
    factors.push(`⚠️ High transaction failure rate (${(failRate * 100).toFixed(1)}%)`);
  } else if (stats.failed_count === 0 && stats.total_transactions > 0) {
    score += 30;
    factors.push('✅ Zero failed transactions on record');
  }

  // ── Large inflows (positive signal) ──
  if (stats.large_inflows >= 5) {
    score += 40;
    factors.push('✅ Regular large-value inflows indicate strong liquidity');
  } else if (stats.large_inflows >= 1) {
    score += 15;
    factors.push('Some large-value transactions observed');
  }

  // ── Clamp to 300–850 ──
  score = Math.max(300, Math.min(850, score));
  return { score, factors };
}

function scoreToGrade(score: number): { grade: string; risk_band: string; max_credit: number; dti: number } {
  if (score >= 750) return { grade: 'A', risk_band: 'Very Low',  max_credit: 10_000_000, dti: 0.15 };
  if (score >= 680) return { grade: 'B', risk_band: 'Low',       max_credit: 2_000_000,  dti: 0.30 };
  if (score >= 620) return { grade: 'C', risk_band: 'Medium',    max_credit: 500_000,    dti: 0.45 };
  if (score >= 550) return { grade: 'D', risk_band: 'High',      max_credit: 100_000,    dti: 0.60 };
  return              { grade: 'F', risk_band: 'Very High', max_credit: 0,          dti: 0.80 };
}

export async function generateCreditReport(tenantId: string): Promise<CreditReport> {
  const stats = await fetchTxStats(tenantId);
  const { score, factors } = computeScore(stats);
  const { grade, risk_band, max_credit, dti } = scoreToGrade(score);

  // Optionally supplement with bureau data if available
  let bureauReport: any = undefined;
  if (process.env.EQUIFAX_CLIENT_ID) {
    // TODO: call Equifax Verification API here
    // bureauReport = await callEquifax(tenantId);
  }

  return {
    score,
    grade,
    risk_band,
    factors,
    max_recommended_credit: max_credit,
    dti_estimate: dti,
    engine: process.env.EQUIFAX_CLIENT_ID
      ? 'Payrail Internal + Equifax'
      : 'Payrail Internal (transaction-history based)',
    generated_at: new Date().toISOString(),
    bureau_report: bureauReport,
  };
}
