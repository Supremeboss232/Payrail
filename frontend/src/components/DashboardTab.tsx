import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

interface Account {
  id: string;
  name: string;
  type: string;
  category: string;
  currency: string;
  balance: number;
}

interface Transaction {
  id: string;
  description: string;
  source_channel: string;
  status: string;
  created_at: string;
  merkle_hash?: string;
  hash?: string;
  entries: { accountId: string; type: 'debit' | 'credit'; amount: number; currency: string }[];
}

interface NetPosition {
  tenant_id: string;
  legal_name: string;
  routing_code: string;
  status: string;
  clearing_account_id: string | null;
  currency: string;
  clearing_balance_cents: number;
  net_position: 'NET_PAYABLE' | 'NET_RECEIVABLE' | 'SETTLED_FLAT';
  net_obligation_cents: number;
  net_surplus_cents: number;
  connector_type: string;
  settlement_mode: 'rtgs_webhook' | 'prefunded_pool';
  has_live_endpoint: boolean;
}

interface DashboardTabProps {
  refreshTrigger: number;
  user?: any;
  onRefresh?: () => void;
}

const CHAN_ICON: Record<string, string> = {
  api: '🔌', dashboard: '🖥️', console: '🖥️', pacs008: '📄', pacs009: '⚡',
  gateway: '🌐', ach: '🏦', wire: '⚡', card: '💳', card_auth: '💳', system: '🏛️'
};

export default function DashboardTab({ refreshTrigger, user, onRefresh }: DashboardTabProps) {
  const [accounts, setAccounts]           = useState<Account[]>([]);
  const [transactions, setTransactions]   = useState<Transaction[]>([]);
  const [netPositions, setNetPositions]   = useState<NetPosition[]>([]);
  const [totalPayable, setTotalPayable]   = useState(0);
  const [loading, setLoading]             = useState(true);

  // Seed funds form
  const [seedAccount,  setSeedAccount]  = useState('');
  const [seedAmount,   setSeedAmount]   = useState('10000');
  const [seedCurrency, setSeedCurrency] = useState('USD');
  const [seedLoading,  setSeedLoading]  = useState(false);
  const [seedMsg,      setSeedMsg]      = useState('');

  // B2B transfer form
  const [b2bDest,    setB2bDest]    = useState('');
  const [b2bAmount,  setB2bAmount]  = useState('250');
  const [b2bKey,     setB2bKey]     = useState('');
  const [b2bLoading, setB2bLoading] = useState(false);
  const [b2bResult,  setB2bResult]  = useState<string | null>(null);
  const [b2bPacs002, setB2bPacs002] = useState<string | null>(null);
  const [b2bError,   setB2bError]   = useState('');

  // Sweep form
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepResult,  setSweepResult]  = useState<string | null>(null);
  const [sweepMsg,     setSweepMsg]     = useState('');
  const [sweepError,   setSweepError]   = useState('');

  const loadMetrics = () => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE_URL}/console/accounts`),
      fetch(`${API_BASE_URL}/console/transactions`),
      fetch(`${API_BASE_URL}/console/settlements/net_positions`),
    ]).then(async ([accsRes, txsRes, netRes]) => {
      if (accsRes.ok) {
        const d = await accsRes.json();
        setAccounts(d);
        if (d.length > 0 && !seedAccount) { setSeedAccount(d[0].id); setB2bDest(d[0].id); }
      }
      if (txsRes.ok) {
        const d = await txsRes.json();
        setTransactions(d.slice(0, 12));
      }
      if (netRes.ok) {
        const netData = await netRes.json();
        setNetPositions(netData.positions || []);
        setTotalPayable(netData.total_net_payable_cents || 0);
      }
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMetrics();
  }, [refreshTrigger]);

  const fmt = (cents: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

  const totalAssets      = accounts.filter(a => a.type === 'asset').reduce((s, a) => s + Number(a.balance), 0);
  const totalLiabilities = accounts.filter(a => a.type === 'liability').reduce((s, a) => s + Number(a.balance), 0);
  const netTreasury      = totalAssets - totalLiabilities;

  const isAdmin = user?.role === 'admin';

  const handleSeedFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    setSeedLoading(true); setSeedMsg('');
    try {
      const res = await fetch(`${API_BASE_URL}/console/seed_funds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: seedAccount, amount: Math.round(parseFloat(seedAmount) * 100), currency: seedCurrency }),
      });
      if (res.ok) {
        setSeedMsg(`✅ Deposited ${fmt(Math.round(parseFloat(seedAmount) * 100), seedCurrency)} to ${seedAccount}`);
        loadMetrics();
        onRefresh?.();
      } else {
        const err = await res.json();
        setSeedMsg(`❌ Deposit failed: ${err.error || 'Unknown error'}`);
      }
    } catch { setSeedMsg('❌ Request error.'); }
    setSeedLoading(false);
  };

  const handleB2BTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setB2bLoading(true); setB2bResult(null); setB2bPacs002(null); setB2bError('');
    const gwKey = localStorage.getItem('payrail_gateway_key') || '';
    try {
      const intentRes = await fetch(`${API_BASE_URL}/v1/payment_intents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${gwKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Math.round(parseFloat(b2bAmount) * 100), currency: 'USD', destination_account_id: b2bDest }),
      });
      if (!intentRes.ok) { const e = await intentRes.json(); throw new Error(e.error); }
      const intent = await intentRes.json();

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${gwKey}`,
        'Content-Type': 'application/json',
      };

      if (b2bKey.trim()) {
        const signRes = await fetch(`${API_BASE_URL}/v1/auth/sign_payload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ privateKeyPem: b2bKey, payload: {} }),
        });
        if (!signRes.ok) { const e = await signRes.json(); throw new Error(e.error); }
        const { timestamp, signature } = await signRes.json();
        const tenantId = user?.tenantId || user?.tenant_id || '';
        headers['Payrail-Tenant-Id'] = tenantId;
        headers['Payrail-Signature'] = `t=${timestamp},v1=${signature}`;
      }

      const confirmRes = await fetch(`${API_BASE_URL}/v1/payment_intents/${intent.id}/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error?.message || confirmData.error || 'Confirm failed');
      const xml = confirmData.pacs_008_xml || confirmData.pacs_msg;
      if (xml) setB2bResult(xml);
      if (confirmData.pacs_002_xml) setB2bPacs002(confirmData.pacs_002_xml);
      loadMetrics();
      onRefresh?.();
    } catch (err: any) { setB2bError(err.message); }
    setB2bLoading(false);
  };

  const handleSweep = async () => {
    setSweepLoading(true); setSweepResult(null); setSweepError(''); setSweepMsg('');
    try {
      const res = await fetch(`${API_BASE_URL}/v1/settlements/dns_sweep`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('payrail_gateway_key') || ''}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ currency: 'USD' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const xml = data.pacs_009_xml || data.pacs_msg;
      if (xml) setSweepResult(xml);
      setSweepMsg(
        data.settled_amount_cents
          ? `Multilateral Net Settlement Sweep completed (${fmt(data.settled_amount_cents)} between ${data.dest_bic} and ${data.source_bic}).`
          : 'Multilateral Net Settlement Sweep completed and pacs.009 cover message emitted.'
      );
      loadMetrics();
      onRefresh?.();
    } catch (err: any) { setSweepError(err.message); }
    setSweepLoading(false);
  };

  if (loading) {
    return (
      <div className="empty-state">
        <span className="spinner" style={{ width: 28, height: 28, marginBottom: 12 }} />
        <h3>Syncing Sovereign Financial Switch…</h3>
        <p>Loading connected member institutions, RTGS clearing positions, and Merkle journal chains</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── KPI Stat Grid ── */}
      <div className="stat-grid">
        <div className="stat-card" style={{ '--stat-color': 'var(--accent-success)' } as any}>
          <div className="stat-icon">🏛️</div>
          <div className="stat-label">Connected Institutions</div>
          <div className="stat-value" style={{ color: '#34d399' }}>{netPositions.length}</div>
          <div className="stat-sub">Active member bank shards on switch</div>
        </div>

        <div className="stat-card" style={{ '--stat-color': 'var(--accent-warning)' } as any}>
          <div className="stat-icon">⚡</div>
          <div className="stat-label">Open Net Interbank Payable</div>
          <div className="stat-value" style={{ color: '#fbbf24' }}>
            {fmt(totalPayable)}
          </div>
          <div className="stat-sub">RTGS obligations awaiting DNS sweep</div>
        </div>

        <div className="stat-card" style={{ '--stat-color': 'var(--accent-primary)' } as any}>
          <div className="stat-icon">💰</div>
          <div className="stat-label">{isAdmin ? 'Gross Switch Liquidity' : 'Clearing Balance'}</div>
          <div className="stat-value" style={{ color: '#818cf8' }}>
            {fmt(totalAssets)}
          </div>
          <div className="stat-sub">Net treasury position: {fmt(netTreasury)}</div>
        </div>

        <div className="stat-card" style={{ '--stat-color': 'var(--accent-secondary)' } as any}>
          <div className="stat-icon">⛓️</div>
          <div className="stat-label">Merkle Ledger Blocks</div>
          <div className="stat-value" style={{ color: '#22d3ee' }}>{transactions.length}</div>
          <div className="stat-sub">SHA-256 cryptographic audit chain</div>
        </div>
      </div>

      {/* ── Live Interbank Switchboard & Multilateral Netting Matrix ── */}
      {netPositions.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-header" style={{ padding: '18px 24px', marginBottom: 0, borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className="badge badge-info">SOVEREIGN SWITCH TOPOLOGY</span>
                <span className="badge badge-purple">RTGS + DNS HYBRID</span>
              </div>
              <div className="card-title">Live Interbank Clearing & Multilateral Netting Matrix</div>
              <div className="card-subtitle">
                Banks in <strong>Direct Host RTGS Webhook</strong> mode authorize debits on their own core ledger first and accrue net clearing positions here without requiring pre-funded balances.
              </div>
            </div>
            {isAdmin && (
              <button className="btn btn-primary" onClick={handleSweep} disabled={sweepLoading}>
                {sweepLoading ? <><span className="spinner" /> Running DNS Sweep…</> : '⚡ Run Multilateral DNS Sweep (pacs.009)'}
              </button>
            )}
          </div>

          <div className="data-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member Institution</th>
                  <th>BIC Routing Code</th>
                  <th>Settlement Mode</th>
                  <th>Clearing Account</th>
                  <th>Net Switch Position</th>
                  <th style={{ textAlign: 'right' }}>Clearing Book Balance</th>
                </tr>
              </thead>
              <tbody>
                {netPositions.map((pos) => (
                  <tr key={pos.tenant_id}>
                    <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{pos.legal_name}</td>
                    <td><span className="mono" style={{ color: '#818cf8', fontWeight: 600 }}>{pos.routing_code}</span></td>
                    <td>
                      <span className={`badge ${pos.settlement_mode === 'rtgs_webhook' ? 'badge-info' : 'badge-warning'}`}>
                        {pos.settlement_mode === 'rtgs_webhook'
                          ? `⚡ Direct Host RTGS (${pos.connector_type})`
                          : '🏦 Pre-Funded Pool'}
                      </span>
                    </td>
                    <td><span className="mono">{pos.clearing_account_id || '—'}</span></td>
                    <td>
                      <span className={`badge ${
                        pos.net_position === 'NET_RECEIVABLE'
                          ? 'badge-success'
                          : pos.net_position === 'NET_PAYABLE'
                          ? 'badge-warning'
                          : 'badge-muted'
                      }`}>
                        {pos.net_position === 'NET_PAYABLE'
                          ? `OWES SWITCH ${fmt(pos.net_obligation_cents, pos.currency)}`
                          : pos.net_position === 'NET_RECEIVABLE'
                          ? `SURPLUS +${fmt(pos.net_surplus_cents, pos.currency)}`
                          : 'SETTLED FLAT ($0.00)'}
                      </span>
                    </td>
                    <td style={{
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: pos.clearing_balance_cents >= 0 ? '#34d399' : '#fbbf24'
                    }}>
                      {fmt(pos.clearing_balance_cents, pos.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(sweepError || sweepMsg || sweepResult) && (
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
              {sweepError && <div className="alert alert-error">⚠️ {sweepError}</div>}
              {sweepMsg && !sweepError && <div className="alert alert-success">✅ {sweepMsg}</div>}
              {sweepResult && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                    Generated ISO 20022 pacs.009.001.08 Multilateral Cover Settlement XML
                  </div>
                  <pre className="code-block" style={{ maxHeight: 220, fontSize: 11.5 }}>{sweepResult}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Main Two-Column Section ── */}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Quick Interbank Switch Transfer */}
          <div className="card">
            <div className="card-header">
              <div>
                <span className="badge badge-info" style={{ marginBottom: 6 }}>ISO 20022 PACS.008 + PACS.002</span>
                <div className="card-title">Instant Sovereign Switch Transfer</div>
                <div className="card-subtitle">
                  Dispatch a live interbank payment intent. Authorizes via your bank's Direct Host RTGS webhook (or clearing line) and returns both <code>pacs.008</code> and <code>pacs.002</code> XML.
                </div>
              </div>
            </div>

            <form onSubmit={handleB2BTransfer} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Destination Account</label>
                  <select className="form-select" value={b2bDest} onChange={e => setB2bDest(e.target.value)} required>
                    {accounts.map((a, idx) => (
                      <option key={`${a.id}-${idx}`} value={a.id}>{a.name} ({a.id})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (USD)</label>
                  <input className="form-input" type="number" step="0.01" min="0.01" value={b2bAmount} onChange={e => setB2bAmount(e.target.value)} required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">ECDSA Private Key PEM (Optional — leave blank to use Gateway Bearer Session Key)</label>
                <textarea className="form-textarea" rows={3} value={b2bKey} onChange={e => setB2bKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY----- (Optional for B2B ECDSA signature verification)" />
              </div>
              {b2bError && <div className="alert alert-error">⚠️ {b2bError}</div>}
              <button type="submit" className="btn btn-primary" disabled={b2bLoading || accounts.length === 0}>
                {b2bLoading ? 'Authorizing & Switching…' : '⚡ Execute Switch Transfer (pacs.008) →'}
              </button>
              {b2bResult && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>ISO 20022 pacs.008.001.08 Credit Transfer:</div>
                  <pre className="code-block" style={{ maxHeight: 180, fontSize: 11 }}>{b2bResult}</pre>
                </div>
              )}
              {b2bPacs002 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', marginBottom: 4 }}>ISO 20022 pacs.002.001.10 Status Report (ACSC):</div>
                  <pre className="code-block" style={{ maxHeight: 160, fontSize: 11 }}>{b2bPacs002}</pre>
                </div>
              )}
            </form>
          </div>

          {/* Treasury Liquidity Injection */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Reserve Liquidity Deposit (Pre-Funding / Settlement Top-Up)</div>
                <div className="card-subtitle">Credit any member bank clearing account or settlement wallet via double-entry System Capital Equity posting.</div>
              </div>
            </div>

            <form onSubmit={handleSeedFunds} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: '2 1 220px' }}>
                <label className="form-label">Target Ledger Account</label>
                <select
                  className="form-select"
                  value={seedAccount}
                  onChange={e => {
                    setSeedAccount(e.target.value);
                    const acc = accounts.find(a => a.id === e.target.value);
                    if (acc) setSeedCurrency(acc.currency);
                  }}
                >
                  {accounts.map((a, i) => (
                    <option key={`${a.id}-${i}`} value={a.id}>
                      {a.name} ({a.id}) — {fmt(a.balance, a.currency)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ flex: '1 1 130px' }}>
                <label className="form-label">Amount ({seedCurrency})</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  min="1"
                  value={seedAmount}
                  onChange={e => setSeedAmount(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-success" disabled={seedLoading || accounts.length === 0}>
                {seedLoading ? 'Depositing…' : '➕ Inject Liquidity'}
              </button>
            </form>

            {seedMsg && (
              <div className={`alert ${seedMsg.startsWith('✅') ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 14 }}>
                {seedMsg}
              </div>
            )}
          </div>
        </div>

        {/* Recent Journal Entries */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Merkle-Chained Switch Journal</div>
              <div className="card-subtitle">Real-time double-entry settlement legs across all shards</div>
            </div>
            <span className="badge badge-info">{transactions.length} entries</span>
          </div>

          {transactions.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 16px' }}>
              <div className="empty-state-icon">📭</div>
              <h3>No transactions yet</h3>
              <p>Execute an Instant Switch Transfer or inject liquidity to populate the journal.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {transactions.map(tx => {
                const hashStr = tx.merkle_hash || tx.hash;
                return (
                  <div
                    key={tx.id}
                    style={{
                      padding: '12px 14px',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 10,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div style={{ fontSize: 20 }}>{CHAN_ICON[tx.source_channel] || '🔄'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tx.description || 'Ledger Transfer'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {new Date(tx.created_at).toLocaleString()} {hashStr ? `· ⛓️ ${hashStr.slice(0, 12)}…` : ''}
                      </div>
                    </div>
                    <span className={`badge ${tx.status === 'posted' ? 'badge-success' : 'badge-warning'}`}>
                      {tx.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Accounts Overview Table ── */}
      {accounts.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-header" style={{ padding: '20px 24px', marginBottom: 0, borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <div className="card-title">Active Ledger Accounts</div>
              <div className="card-subtitle">Real-time balances across all clearinghouse and member bank accounts</div>
            </div>
            <span className="badge badge-purple">{accounts.length} accounts</span>
          </div>

          <div className="data-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account ID</th>
                  <th>Account Name</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Currency</th>
                  <th style={{ textAlign: 'right' }}>Cleared Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc, i) => (
                  <tr key={`${acc.id}-${i}`}>
                    <td><span className="mono">{acc.id}</span></td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{acc.name}</td>
                    <td>
                      <span className={`badge ${acc.type === 'asset' ? 'badge-info' : acc.type === 'equity' ? 'badge-purple' : 'badge-warning'}`}>
                        {acc.type}
                      </span>
                    </td>
                    <td><span className="badge badge-muted">{acc.category}</span></td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{acc.currency}</td>
                    <td style={{
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: Number(acc.balance) >= 0 ? '#34d399' : '#fbbf24'
                    }}>
                      {fmt(Number(acc.balance), acc.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
