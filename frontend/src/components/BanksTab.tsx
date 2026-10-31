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
  funding_source?: {
    id: string;
    connector_type: string;
    status: string;
    priority: number;
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
          <p>{banks.length} institution{banks.length !== 1 ? 's' : ''} onboarded on the Payrail clearinghouse network</p>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 18 }}>
          {banks.map(bank => {
            const result = testResults[bank.id];
            const isTesting = testingId === bank.id;
            const connectorType = bank.funding_source?.connector_type || 'http_callback';
            const connectorIcon = CONNECTOR_ICONS[connectorType] || '🌐';

            return (
              <div
                key={bank.id}
                className="card"
                style={{
                  opacity: bank.api_status === 'inactive' ? 0.65 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
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
                  <span className={`badge ${bank.api_status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                    {bank.api_status === 'active' ? '● Active' : '○ Suspended'}
                  </span>
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
                      Clearing Balance
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#34d399', marginTop: 3 }}>
                      {formatBalance(bank.clearing_balance)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Core Connector
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginTop: 3 }}>
                      {connectorIcon} {connectorType.replace('_', ' ')}
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

                <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => handleTestConnection(bank)}
                    disabled={isTesting}
                  >
                    {isTesting ? '⏳ Testing…' : '📡 Ping Connector'}
                  </button>
                  <button
                    className={`btn btn-sm ${bank.api_status === 'active' ? 'btn-danger' : 'btn-success'}`}
                    style={{ flex: 1 }}
                    onClick={() => handleToggleStatus(bank)}
                  >
                    {bank.api_status === 'active' ? '⏸ Suspend Shard' : '▶ Activate Shard'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
