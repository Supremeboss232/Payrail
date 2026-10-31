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
  hash?: string;
  entries: { accountId: string; type: 'debit' | 'credit'; amount: number; currency: string }[];
}

interface DashboardTabProps {
  refreshTrigger: number;
  user?: any;
  onRefresh?: () => void;
}

const CHAN_ICON: Record<string, string> = {
  api: '🔌', dashboard: '🖥️', console: '🖥️', pacs008: '📄', pacs009: '⚡',
  gateway: '🌐', ach: '🏦', wire: '⚡', card: '💳', card_auth: '💳',
};

export default function DashboardTab({ refreshTrigger, user, onRefresh }: DashboardTabProps) {
  const [accounts, setAccounts]         = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading]           = useState(true);

  // Seed funds form
  const [seedAccount,  setSeedAccount]  = useState('');
  const [seedAmount,   setSeedAmount]   = useState('10000');
  const [seedCurrency, setSeedCurrency] = useState('USD');
  const [seedLoading,  setSeedLoading]  = useState(false);
  const [seedMsg,      setSeedMsg]      = useState('');

  // B2B transfer form
  const [b2bDest,    setB2bDest]    = useState('');
  const [b2bAmount,  setB2bAmount]  = useState('500');
  const [b2bKey,     setB2bKey]     = useState('');
  const [b2bLoading, setB2bLoading] = useState(false);
  const [b2bResult,  setB2bResult]  = useState<string | null>(null);
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
    ]).then(async ([accsRes, txsRes]) => {
      if (accsRes.ok) {
        const d = await accsRes.json();
        setAccounts(d);
        if (d.length > 0 && !seedAccount) { setSeedAccount(d[0].id); setB2bDest(d[0].id); }
      }
      if (txsRes.ok) {
        const d = await txsRes.json();
        setTransactions(d.slice(0, 12));
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
    setB2bLoading(true); setB2bResult(null); setB2bError('');
    const gwKey = localStorage.getItem('payrail_gateway_key') || '';
    try {
      const intentRes = await fetch(`${API_BASE_URL}/v1/payment_intents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${gwKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Math.round(parseFloat(b2bAmount) * 100), currency: 'USD', destination_account_id: b2bDest }),
      });
      if (!intentRes.ok) { const e = await intentRes.json(); throw new Error(e.error); }
      const intent = await intentRes.json();

      const signRes = await fetch(`${API_BASE_URL}/v1/auth/sign_payload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privateKeyPem: b2bKey, payload: {} }),
      });
      if (!signRes.ok) { const e = await signRes.json(); throw new Error(e.error); }
      const { timestamp, signature } = await signRes.json();

      const tenantId = user?.tenantId || user?.tenant_id || '';
      const confirmRes = await fetch(`${API_BASE_URL}/v1/payment_intents/${intent.id}/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gwKey}`,
          'Content-Type': 'application/json',
          'Payrail-Tenant-Id': tenantId,
          'Payrail-Signature': `t=${timestamp},v1=${signature}`,
        },
        body: JSON.stringify({}),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error);
      const xml = confirmData.pacs_008_xml || confirmData.pacs_msg;
      if (xml) setB2bResult(xml);
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
      setSweepMsg(data.message || `Settled ${data.settled_entries || 0} interbank positions.`);
      loadMetrics();
      onRefresh?.();
    } catch (err: any) { setSweepError(err.message); }
    setSweepLoading(false);
  };

  if (loading) {
    return (
      <div className="empty-state">
        <span className="spinner" style={{ width: 28, height: 28, marginBottom: 12 }} />
        <h3>Gathering network metrics…</h3>
        <p>Syncing double-entry accounts and Merkle journal chains</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── KPI Stat Grid ── */}
      <div className="stat-grid">
        <div className="stat-card" style={{ '--stat-color': 'var(--accent-success)' } as any}>
          <div className="stat-icon">💰</div>
          <div className="stat-label">{isAdmin ? 'Total System Assets' : 'Clearing Assets'}</div>
          <div className="stat-value" style={{ color: '#34d399' }}>{fmt(totalAssets)}</div>
          <div className="stat-sub">{isAdmin ? 'Across all member bank shards' : 'Active clearing reserve'}</div>
        </div>

        <div className="stat-card" style={{ '--stat-color': 'var(--accent-warning)' } as any}>
          <div className="stat-icon">⚖️</div>
          <div className="stat-label">{isAdmin ? 'System Liabilities' : 'Network BIC'}</div>
          <div className="stat-value" style={{ color: '#fbbf24' }}>
            {isAdmin ? fmt(totalLiabilities) : (user?.routingCode || user?.routing_code || '—')}
          </div>
          <div className="stat-sub">{isAdmin ? 'Offset clearing positions' : 'ISO 9362 identifier'}</div>
        </div>

        <div className="stat-card" style={{ '--stat-color': 'var(--accent-primary)' } as any}>
          <div className="stat-icon">📊</div>
          <div className="stat-label">{isAdmin ? 'Net Treasury Position' : 'Active Accounts'}</div>
          <div className="stat-value" style={{ color: '#818cf8' }}>
            {isAdmin ? fmt(netTreasury) : accounts.length.toString()}
          </div>
          <div className="stat-sub">{isAdmin ? 'Clearinghouse net surplus' : 'Double-entry ledger accounts'}</div>
        </div>

        <div className="stat-card" style={{ '--stat-color': 'var(--accent-secondary)' } as any}>
          <div className="stat-icon">⛓️</div>
          <div className="stat-label">Recent Journal Entries</div>
          <div className="stat-value" style={{ color: '#22d3ee' }}>{transactions.length}</div>
          <div className="stat-sub">SHA-256 Merkle hash-chained</div>
        </div>
      </div>

      {/* ── Main Two-Column Section ── */}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {isAdmin ? (
            <div className="card">
              <div className="card-header">
                <div>
                  <span className="badge badge-purple" style={{ marginBottom: 6 }}>ISO 20022 PACS.009</span>
                  <div className="card-title">Deferred Net Settlement (DNS) Multilateral Sweep</div>
                  <div className="card-subtitle">
                    Aggregate net clearing positions across all member bank accounts and generate an ISO 20022 pacs.009 cover settlement message.
                  </div>
                </div>
              </div>

              <button className="btn btn-primary" onClick={handleSweep} disabled={sweepLoading}>
                {sweepLoading ? <><span className="spinner" /> Executing Sweep…</> : '⚡ Trigger Net Settlement Sweep'}
              </button>

              {sweepError && <div className="alert alert-error" style={{ marginTop: 14 }}>⚠️ {sweepError}</div>}
              {sweepMsg && !sweepError && <div className="alert alert-success" style={{ marginTop: 14 }}>✅ {sweepMsg}</div>}
              {sweepResult && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                    Generated ISO 20022 pacs.009 XML
                  </div>
                  <pre className="code-block" style={{ maxHeight: 240, fontSize: 11.5 }}>{sweepResult}</pre>
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <div>
                  <span className="badge badge-info" style={{ marginBottom: 6 }}>INTERBANK PACS.008</span>
                  <div className="card-title">Outbound B2B Signed Transfer</div>
                  <div className="card-subtitle">Initiate an interbank transfer signed with your Secp256k1 ECDSA private key.</div>
                </div>
              </div>

              <form onSubmit={handleB2BTransfer} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Destination Account ID</label>
                    <input className="form-input" value={b2bDest} onChange={e => setB2bDest(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Amount (USD)</label>
                    <input className="form-input" type="number" step="0.01" value={b2bAmount} onChange={e => setB2bAmount(e.target.value)} required />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">ECDSA Private Key (PEM)</label>
                  <textarea className="form-textarea" rows={4} value={b2bKey} onChange={e => setB2bKey(e.target.value)} placeholder="-----BEGIN EC PRIVATE KEY-----..." required />
                </div>
                {b2bError && <div className="alert alert-error">⚠️ {b2bError}</div>}
                <button type="submit" className="btn btn-primary" disabled={b2bLoading}>
                  {b2bLoading ? 'Signing & Broadcasting…' : 'Execute PACS.008 Transfer →'}
                </button>
                {b2bResult && <pre className="code-block" style={{ maxHeight: 220 }}>{b2bResult}</pre>}
              </form>
            </div>
          )}

          {/* Treasury Liquidity Injection */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Treasury Liquidity Deposit</div>
                <div className="card-subtitle">Directly inject capital into any ledger account via balanced double-entry System Capital Equity posting.</div>
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
              <div className="card-title">Recent Journal Entries</div>
              <div className="card-subtitle">Latest double-entry transactions on the clearinghouse rail</div>
            </div>
            <span className="badge badge-info">{transactions.length} entries</span>
          </div>

          {transactions.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 16px' }}>
              <div className="empty-state-icon">📭</div>
              <h3>No transactions yet</h3>
              <p>Inject treasury liquidity or run a payment intent to populate the journal.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {transactions.map(tx => (
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
                      {new Date(tx.created_at).toLocaleString()} {tx.hash ? `· #${tx.hash.slice(0, 10)}…` : ''}
                    </div>
                  </div>
                  <span className={`badge ${tx.status === 'posted' ? 'badge-success' : 'badge-warning'}`}>
                    {tx.status}
                  </span>
                </div>
              ))}
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
                      color: Number(acc.balance) >= 0 ? '#34d399' : '#f87171'
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
