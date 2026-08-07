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
  simulation: '🔬',
  http_callback: '🌐',
  web3_rpc: '⚡',
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
    if (!bank.funding_source) return;
    setTestingId(bank.id);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/banks/test_connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk_live_dev_key_12345' },
        body: JSON.stringify({ connector_type: bank.funding_source.connector_type })
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
    if (cents === undefined || cents === null) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  if (loading) {
    return (
      <div className="tab-loading">
        <div className="loading-spinner" />
        <p>Loading connected banks...</p>
      </div>
    );
  }

  if (error) {
    return <div className="tab-error">⚠️ {error}</div>;
  }

  return (
    <div className="banks-tab">
      <div className="banks-header">
        <div>
          <h2 className="banks-title">Connected Banks</h2>
          <p className="banks-subtitle">{banks.length} institution{banks.length !== 1 ? 's' : ''} on the clearing network</p>
        </div>
        <button className="btn-connect-bank" onClick={onConnectBank}>
          <span>+</span> Connect New Bank
        </button>
      </div>

      {banks.length === 0 ? (
        <div className="banks-empty-state">
          <div className="banks-empty-icon">🏦</div>
          <h3>No Banks Connected Yet</h3>
          <p>Connect your first financial institution to start clearing payments on the Payrail network.</p>
          <button className="auth-btn-primary" onClick={onConnectBank} style={{ marginTop: '20px', maxWidth: '260px' }}>
            Connect Your First Bank
          </button>
        </div>
      ) : (
        <div className="banks-grid">
          {banks.map(bank => {
            const result = testResults[bank.id];
            const isTesting = testingId === bank.id;
            const connectorType = bank.funding_source?.connector_type || 'none';
            const connectorIcon = CONNECTOR_ICONS[connectorType] || '—';

            return (
              <div key={bank.id} className={`bank-card ${bank.api_status === 'inactive' ? 'inactive' : ''}`}>
                <div className="bank-card-header">
                  <div className="bank-card-identity">
                    <div className="bank-card-name">{bank.legal_name || bank.name}</div>
                    <div className="bank-card-bic">{bank.routing_code}</div>
                  </div>
                  <div className={`bank-status-badge ${bank.api_status}`}>
                    {bank.api_status === 'active' ? '● Active' : '○ Inactive'}
                  </div>
                </div>

                <div className="bank-card-stats">
                  <div className="bank-stat">
                    <div className="bank-stat-label">Clearing Balance</div>
                    <div className="bank-stat-value">{formatBalance(bank.clearing_balance)}</div>
                  </div>
                  <div className="bank-stat">
                    <div className="bank-stat-label">Connector</div>
                    <div className="bank-stat-value">{connectorIcon} {connectorType === 'none' ? 'None' : connectorType.replace('_', ' ')}</div>
                  </div>
                  <div className="bank-stat">
                    <div className="bank-stat-label">Connected</div>
                    <div className="bank-stat-value">{formatDate(bank.created_at)}</div>
                  </div>
                  {bank.clearing_account && (
                    <div className="bank-stat">
                      <div className="bank-stat-label">Clearing Account</div>
                      <div className="bank-stat-value" style={{ fontFamily: 'monospace', fontSize: '11px' }}>{bank.clearing_account}</div>
                    </div>
                  )}
                </div>

                {result && (
                  <div className={`bank-test-result ${result.ok ? 'ok' : 'fail'}`}>
                    {result.ok ? '✅' : '❌'} {result.message}
                    {result.latency_ms !== undefined && result.latency_ms > 0 && ` (${result.latency_ms}ms)`}
                  </div>
                )}

                <div className="bank-card-actions">
                  {bank.funding_source && (
                    <button
                      className="bank-action-btn"
                      onClick={() => handleTestConnection(bank)}
                      disabled={isTesting}
                      title="Test connector connectivity"
                    >
                      {isTesting ? '⏳' : '📡'} {isTesting ? 'Testing...' : 'Test'}
                    </button>
                  )}
                  <button
                    className={`bank-action-btn ${bank.api_status === 'active' ? 'danger' : 'success'}`}
                    onClick={() => handleToggleStatus(bank)}
                    title={bank.api_status === 'active' ? 'Disable bank' : 'Enable bank'}
                  >
                    {bank.api_status === 'active' ? '⏸ Disable' : '▶ Enable'}
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
