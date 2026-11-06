import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

interface BankTenant {
  id: string;
  legal_name: string;
  name?: string;
  routing_code: string;
  api_status: string;
  created_at: string;
  clearing_account?: string;
  clearing_balance?: number;
  net_position?: 'NET_PAYABLE' | 'NET_RECEIVABLE' | 'SETTLED_FLAT';
  settlement_mode?: 'rtgs_webhook' | 'prefunded_pool';
  endpoint_url?: string | null;
  funding_source?: {
    id: string;
    connector_type: string;
    status: string;
    priority: number;
    has_credentials?: boolean;
    settlement_mode?: 'rtgs_webhook' | 'prefunded_pool';
    endpoint_url?: string | null;
  };
}

interface BanksTabProps {
  refreshTrigger: number;
  onUpdate: () => void;
  onConnectBank: () => void;
}

const CONNECTOR_ICONS: Record<string, string> = {
  http_callback: '🌐',
  web3_rpc: '⛓️',
  none: '—'
};

export default function BanksTab({ refreshTrigger, onUpdate, onConnectBank }: BanksTabProps) {
  const [banks, setBanks] = useState<BankTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string; latency_ms?: number }>>({});

  // Connector / Settlement Mode configuration modal state
  const [editingBank, setEditingBank] = useState<BankTenant | null>(null);
  const [editConnectorType, setEditConnectorType] = useState<'http_callback' | 'web3_rpc'>('http_callback');
  const [editSettlementMode, setEditSettlementMode] = useState<'rtgs_webhook' | 'prefunded_pool'>('rtgs_webhook');
  const [editUrl, setEditUrl] = useState('');
  const [savingConnector, setSavingConnector] = useState(false);

  const fetchBanks = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/console/banks`);
      if (!res.ok) throw new Error('Failed to load connected banks.');
      const data = await res.json();
      setBanks(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBanks(); }, [refreshTrigger]);

  const handleTestConnection = async (bank: BankTenant) => {
    setTestingId(bank.id);
    try {
      const res = await fetch(`${API_BASE_URL}/console/banks/${bank.id}/test_connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      setTestResults(prev => ({ ...prev, [bank.id]: data }));
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [bank.id]: { ok: false, message: err.message } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleStatus = async (bank: BankTenant) => {
    const newStatus = bank.api_status === 'active' ? 'inactive' : 'active';
    try {
      await fetch(`${API_BASE_URL}/console/banks/${bank.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      onUpdate();
    } catch {}
  };

  const openEditConnector = (bank: BankTenant) => {
    setEditingBank(bank);
    setEditConnectorType((bank.funding_source?.connector_type as any) || 'http_callback');
    setEditSettlementMode(bank.settlement_mode || bank.funding_source?.settlement_mode || 'rtgs_webhook');
    setEditUrl(bank.endpoint_url || bank.funding_source?.endpoint_url || '');
  };

  const handleSaveConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBank) return;
    setSavingConnector(true);
    try {
      const res = await fetch(`${API_BASE_URL}/console/banks/${editingBank.id}/connector`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector_type: editConnectorType,
          settlement_mode: editSettlementMode,
          url: editUrl.trim() || undefined,
        }),
      });
      if (res.ok) {
        setEditingBank(null);
        fetchBanks();
        onUpdate();
      }
    } finally {
      setSavingConnector(false);
    }
  };

  const formatBalance = (cents: number | undefined) => {
    if (cents === undefined || cents === null) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  if (loading) {
    return (
      <div className="empty-state">
        <span className="spinner" style={{ width: 24, height: 24, marginBottom: 12 }} />
        <p>Loading connected member banks…</p>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-error">⚠️ {error}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="section-header">
        <div>
          <h2>Connected Member Institutions</h2>
          <p>{banks.length} institution{banks.length !== 1 ? 's' : ''} onboarded on the Payrail Sovereign Financial Switch</p>
        </div>
        <button className="btn btn-primary" onClick={onConnectBank}>
          ➕ Onboard New Bank
        </button>
      </div>

      {banks.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🏦</div>
            <h3>No Member Banks Connected Yet</h3>
            <p>Onboard your first financial institution to provision an isolated clearing shard and ECDSA key pair.</p>
            <button className="btn btn-primary" onClick={onConnectBank} style={{ marginTop: 18 }}>
              ➕ Onboard First Institution
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 18 }}>
          {banks.map(bank => {
            const result = testResults[bank.id];
            const isTesting = testingId === bank.id;
            const connectorType = bank.funding_source?.connector_type || 'http_callback';
            const connectorIcon = CONNECTOR_ICONS[connectorType] || '🌐';
            const settlementMode = bank.settlement_mode || bank.funding_source?.settlement_mode || 'rtgs_webhook';
            const endpointUrl = bank.endpoint_url || bank.funding_source?.endpoint_url;
            const bal = Number(bank.clearing_balance ?? 0);

            return (
              <div
                key={bank.id}
                className="card"
                style={{
                  opacity: bank.api_status === 'inactive' ? 0.65 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {bank.legal_name || bank.name}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#818cf8', marginTop: 3 }}>
                      BIC: {bank.routing_code}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge ${settlementMode === 'rtgs_webhook' ? 'badge-info' : 'badge-warning'}`}>
                      {settlementMode === 'rtgs_webhook' ? '⚡ Direct Host RTGS' : '🏦 Pre-Funded Pool'}
                    </span>
                    <span className={`badge ${bank.api_status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                      {bank.api_status === 'active' ? '● Active' : '○ Suspended'}
                    </span>
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10,
                  padding: 12,
                  background: 'var(--bg-surface)',
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Switch Clearing Position
                    </div>
                    <div style={{
                      fontSize: 15,
                      fontWeight: 800,
                      fontFamily: 'var(--font-mono)',
                      color: bal >= 0 ? '#34d399' : '#fbbf24',
                      marginTop: 3
                    }}>
                      {formatBalance(bank.clearing_balance)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {bal < 0 ? 'Net Payable (DNS Sweep)' : bal > 0 ? 'Pre-Funded Reserve' : 'Settled Flat ($0)'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Core Connector
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginTop: 3 }}>
                      {connectorIcon} {connectorType.replace('_', ' ')}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {endpointUrl ? endpointUrl : 'In-Network Switch Clearing'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Clearing Account
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 3 }}>
                      {bank.clearing_account || '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Onboarded
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                      {formatDate(bank.created_at)}
                    </div>
                  </div>
                </div>

                {result && (
                  <div className={`alert ${result.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 0, padding: '8px 12px', fontSize: 12 }}>
                    {result.ok ? '✅' : '❌'} {result.message}
                    {result.latency_ms !== undefined && result.latency_ms > 0 && ` (${result.latency_ms}ms)`}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => openEditConnector(bank)}
                  >
                    ⚙️ Mode / Webhook
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => handleTestConnection(bank)}
                    disabled={isTesting}
                  >
                    {isTesting ? '⏳ Pinging…' : '📡 Ping Host'}
                  </button>
                  <button
                    className={`btn btn-sm ${bank.api_status === 'active' ? 'btn-danger' : 'btn-success'}`}
                    onClick={() => handleToggleStatus(bank)}
                  >
                    {bank.api_status === 'active' ? '⏸' : '▶'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Configure Bank Settlement Mode & Webhook Drawer */}
      {editingBank && (
        <div className="drawer-backdrop" onClick={() => setEditingBank(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3 className="drawer-title">Configure Switch Settlement Mode</h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {editingBank.legal_name} ({editingBank.routing_code})
                </div>
              </div>
              <button className="drawer-close" onClick={() => setEditingBank(null)}>×</button>
            </div>

            <form onSubmit={handleSaveConnector} className="drawer-content">
              <div className="form-group">
                <label className="form-label">Settlement Authorization Mode</label>
                <select
                  className="form-select"
                  value={editSettlementMode}
                  onChange={e => setEditSettlementMode(e.target.value as any)}
                >
                  <option value="rtgs_webhook">
                    ⚡ Direct Host Authorization (RTGS Webhook / Interbank Credit Line — No Pre-Funded Pool Required)
                  </option>
                  <option value="prefunded_pool">
                    🏦 Pre-Funded Reserve Clearing Pool (Requires Positive Balance on Payrail Before Dispatch)
                  </option>
                </select>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.45 }}>
                  {editSettlementMode === 'rtgs_webhook'
                    ? 'In Direct Host RTGS mode, Payrail authorizes the debit via your bank webhook (or records an interbank clearing obligation) without blocking on a $0 pre-funded clearing balance.'
                    : 'In Pre-Funded Pool mode, Payrail enforces that your clearing account on Payrail holds sufficient pre-deposited liquidity before routing transfers.'}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Connector Protocol</label>
                <select
                  className="form-select"
                  value={editConnectorType}
                  onChange={e => setEditConnectorType(e.target.value as any)}
                >
                  <option value="http_callback">🌐 HTTP REST Webhook Callback</option>
                  <option value="web3_rpc">⛓️ Web3 EVM JSON-RPC Node</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  {editConnectorType === 'web3_rpc' ? 'Web3 RPC URL' : 'Live Bank Host Webhook URL (Optional)'}
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={editConnectorType === 'web3_rpc' ? 'https://ethereum-rpc.publicnode.com' : 'https://api.finanzabank.com/v1/payouts'}
                  value={editUrl}
                  onChange={e => setEditUrl(e.target.value)}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Leave blank to settle directly on Payrail's Interbank Clearing Book, or provide your core bank's live webhook URL.
                </div>
              </div>

              <button type="submit" className="btn btn-primary" disabled={savingConnector}>
                {savingConnector ? 'Saving…' : '💾 Save Settlement Configuration'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
