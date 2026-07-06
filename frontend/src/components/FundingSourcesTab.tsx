import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

interface FundingSource {
  id: string;
  name: string;
  type: 'bank' | 'broker' | 'crypto' | 'logistics';
  account_id: string;
  priority: number;
  status: 'active' | 'inactive';
  created_at: string;
}

interface FundingSourcesTabProps {
  refreshTrigger: number;
  onUpdate: () => void;
}

export default function FundingSourcesTab({ refreshTrigger, onUpdate }: FundingSourcesTabProps) {
  const [sources, setSources] = useState<FundingSource[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [fsName, setFsName] = useState('');
  const [fsType, setFsType] = useState<'bank' | 'broker' | 'crypto' | 'logistics'>('bank');
  const [fsAccountId, setFsAccountId] = useState('');
  const [fsPriority, setFsPriority] = useState('1');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [fsRes, accsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/console/funding_sources`),
          fetch(`${API_BASE_URL}/console/accounts`),
        ]);

        if (fsRes.ok && accsRes.ok) {
          const fsData = await fsRes.json();
          const accsData = await accsRes.json();
          setSources(fsData);
          // Filter to asset accounts that can be debited
          const assets = accsData.filter((a: any) => a.type === 'asset');
          setAccounts(assets);
          if (assets.length > 0) {
            setFsAccountId(assets[0].id);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [refreshTrigger]);

  const handleAddFundingSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fsName || !fsAccountId) return;

    try {
      const res = await fetch(`${API_BASE_URL}/console/funding_sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fsName,
          type: fsType,
          account_id: fsAccountId,
          priority: parseInt(fsPriority),
        }),
      });

      if (res.ok) {
        setFsName('');
        setFsPriority('1');
        setIsAddOpen(false);
        onUpdate();
      } else {
        const data = await res.json();
        alert(`Failed to register funding source: ${data.error}`);
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleSwapPriority = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sources.length) return;

    const currentFs = sources[index];
    const targetFs = sources[targetIndex];

    try {
      // Swap priorities in backend
      await Promise.all([
        fetch(`${API_BASE_URL}/console/funding_sources/${currentFs.id}/swap`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority: targetFs.priority }),
        }),
        fetch(`${API_BASE_URL}/console/funding_sources/${targetFs.id}/swap`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority: currentFs.priority }),
        }),
      ]);

      // Refetch
      onUpdate();
    } catch (err) {
      console.error('Failed to swap priorities:', err);
    }
  };

  const handleToggleStatus = async (fs: FundingSource) => {
    const newStatus = fs.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetch(`${API_BASE_URL}/console/funding_sources/${fs.id}/swap`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        onUpdate();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading configured funding methods...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Add Funding Source Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="button" onClick={() => setIsAddOpen(true)}>
          <span>➕</span> Link Funding Source
        </button>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Gateway Routing Failover Priority</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
          Define the order in which the payment rail pulls funds. When a payment intent is confirmed, the rail checks the first active funding source. If it fails (e.g. due to insufficient funds), the gateway dynamically **swaps** and fails-over to the next active method in the queue.
        </p>

        <div className="funding-source-list">
          {sources.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px' }}>
              No funding sources linked yet. Click "Link Funding Source" to bind your first bank/broker account to the routing gateway!
            </div>
          ) : (
            sources.map((fs, index) => (
              <div key={fs.id} className="funding-source-item" style={{ opacity: fs.status === 'active' ? 1 : 0.5 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {/* Up/Down buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginRight: '16px' }}>
                    <button 
                      className="button button-secondary" 
                      style={{ padding: '4px 8px', fontSize: '10px' }}
                      disabled={index === 0}
                      onClick={() => handleSwapPriority(index, 'up')}
                    >
                      ▲
                    </button>
                    <button 
                      className="button button-secondary" 
                      style={{ padding: '4px 8px', fontSize: '10px' }}
                      disabled={index === sources.length - 1}
                      onClick={() => handleSwapPriority(index, 'down')}
                    >
                      ▼
                    </button>
                  </div>

                  <div className="fs-details">
                    <div className="fs-name">
                      {fs.name} 
                      <span className="fs-priority-badge">Priority #{fs.priority}</span>
                    </div>
                    <div className="fs-type">
                      Channel: {fs.type} • Account: <code style={{ fontFamily: 'var(--font-mono)' }}>{fs.account_id}</code>
                    </div>
                  </div>
                </div>

                <div className="fs-actions">
                  <span className={`badge ${fs.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                    {fs.status}
                  </span>

                  <button 
                    className={`button ${fs.status === 'active' ? 'button-secondary' : ''}`}
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => handleToggleStatus(fs)}
                  >
                    {fs.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Link Funding Source Slide Out Drawer */}
      {isAddOpen && (
        <div className="drawer-backdrop" onClick={() => setIsAddOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3 className="drawer-title">Link Funding Source</h3>
              <button className="drawer-close" onClick={() => setIsAddOpen(false)}>×</button>
            </div>

            <form onSubmit={handleAddFundingSource} className="drawer-content">
              <div className="form-group">
                <label className="form-label">Funding Source Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. Chase Business Checking" 
                  value={fsName}
                  onChange={e => setFsName(e.target.value)}
                  required
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Source Type</label>
                  <select 
                    className="form-select" 
                    value={fsType} 
                    onChange={e => setFsType(e.target.value as any)}
                  >
                    <option value="bank">Bank Account</option>
                    <option value="broker">Broker Account</option>
                    <option value="crypto">Crypto Wallet</option>
                    <option value="logistics">Logistics Account</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Failover Priority</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={fsPriority}
                    onChange={e => setFsPriority(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Link to Ledger Account (Debit Source)</label>
                {accounts.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                    No asset accounts configured. Create an asset account in the Ledger tab first!
                  </div>
                ) : (
                  <select 
                    className="form-select" 
                    value={fsAccountId} 
                    onChange={e => setFsAccountId(e.target.value)}
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                    ))}
                  </select>
                )}
              </div>

              <button type="submit" className="button" style={{ marginTop: '16px' }} disabled={accounts.length === 0}>
                Link Funding Source
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
