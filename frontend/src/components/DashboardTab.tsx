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
  reference_id: string | null;
  status: string;
  created_at: string;
  entries: {
    accountId: string;
    type: 'debit' | 'credit';
    amount: number;
    currency: string;
  }[];
}

interface DashboardTabProps {
  refreshTrigger: number;
  user?: any;
}

export default function DashboardTab({ refreshTrigger, user }: DashboardTabProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Seeding Form
  const [seedAccount, setSeedAccount] = useState('');
  const [seedAmount, setSeedAmount] = useState('1000');
  const [seedCurrency, setSeedCurrency] = useState('USD');

  // Pacs.008 B2B Transfer Form
  const [b2bDestAccount, setB2bDestAccount] = useState('');
  const [b2bAmount, setB2bAmount] = useState('500');
  const [b2bPrivateKey, setB2bPrivateKey] = useState('');
  const [b2bLoading, setB2bLoading] = useState(false);
  const [pacs008Xml, setPacs008Xml] = useState<string | null>(null);

  // Sweep states
  const [sweepLoading, setSweepLoading] = useState(false);
  const [pacs009Xml, setPacs009Xml] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [accsRes, txsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/console/accounts`),
          fetch(`${API_BASE_URL}/console/transactions`),
        ]);

        if (accsRes.ok && txsRes.ok) {
          const accData = await accsRes.json();
          const txData = await txsRes.json();
          setAccounts(accData);
          setTransactions(txData.slice(0, 10)); // Show 10 most recent

          if (accData.length > 0) {
            setSeedAccount(accData[0].id);
            setB2bDestAccount(accData[0].id);
          }
        }
      } catch (err) {
        console.error('Error fetching dashboard stats:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [refreshTrigger]);

  const handleSeedFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seedAccount || !seedAmount) return;

    try {
      const res = await fetch(`${API_BASE_URL}/console/seed_funds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: seedAccount,
          amount: parseFloat(seedAmount) * 100, // Cents
          currency: seedCurrency,
        }),
      });

      if (res.ok) {
        alert(`Successfully deposited $${seedAmount} into ${seedAccount}!`);
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleB2BTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!b2bDestAccount || !b2bAmount || !b2bPrivateKey) {
      alert('Destination Account, Amount, and Private Key PEM are required to execute signed B2B transfers.');
      return;
    }

    setB2bLoading(true);
    setPacs008Xml(null);

    try {
      // 1. Create Payment Intent
      const intentRes = await fetch(`${API_BASE_URL}/v1/payments/payment_intents`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk_live_dev_key_12345',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: parseFloat(b2bAmount) * 100,
          currency: 'USD',
          destination_account_id: b2bDestAccount,
        })
      });

      if (!intentRes.ok) {
        const err = await intentRes.json();
        throw new Error(err.error || 'Failed to create payment intent.');
      }
      
      const intent = await intentRes.json();

      // 2. Request signature
      const signRes = await fetch(`${API_BASE_URL}/v1/auth/sign_payload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privateKeyPem: b2bPrivateKey,
          payload: {}
        })
      });

      if (!signRes.ok) {
        const err = await signRes.json();
        throw new Error(err.error || 'Private Key PEM error.');
      }

      const { timestamp, signature } = await signRes.json();

      // 3. Confirm B2B Transfer with headers
      const confirmRes = await fetch(`${API_BASE_URL}/v1/payments/payment_intents/${intent.id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Payrail-Tenant-Id': user?.tenant_id || '',
          'Payrail-Signature': `t=${timestamp},v1=${signature}`
        },
        body: JSON.stringify({})
      });

      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) {
        throw new Error(confirmData.error || 'B2B Confirmation rejected.');
      }

      if (confirmData.pacs_msg) {
        setPacs008Xml(confirmData.pacs_msg);
      }
      alert('B2B PACS.008 customer credit transfer executed successfully!');
    } catch (err: any) {
      alert(`B2B Transfer Error: ${err.message}`);
    } finally {
      setB2bLoading(false);
    }
  };

  const triggerNetSweep = async () => {
    setSweepLoading(true);
    setPacs009Xml(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/settlements/dns_sweep`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('payrail_api_key') || 'sk_live_dev_key_12345'}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to trigger sweep.');

      if (data.pacs_msg) {
        setPacs009Xml(data.pacs_msg);
      }
      alert(`Deferred Net Settlement completed successfully! Cleared clearing accounts positions.`);
    } catch (err: any) {
      alert(`Net Sweep Error: ${err.message}`);
    } finally {
      setSweepLoading(false);
    }
  };

  const formatCurrency = (amountCents: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amountCents / 100);
  };

  const totalAssets = accounts
    .filter(a => a.type === 'asset')
    .reduce((sum, a) => sum + Number(a.balance), 0);

  const totalLiabilities = accounts
    .filter(a => a.type === 'liability')
    .reduce((sum, a) => sum + Number(a.balance), 0);

  const netTreasury = totalAssets - totalLiabilities;

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)' }}>Gathering ledger analytics...</div>;
  }

  const isMember = user?.role === 'member';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      
      {/* 3 KPI metric cards */}
      <div className="grid-3">
        <div className="glass-panel metric-card">
          <span className="metric-label">{isMember ? 'Clearing Shard Assets' : 'Total System Assets (USD)'}</span>
          <span className="metric-value">{formatCurrency(totalAssets, 'USD')}</span>
          <span className="metric-sub text-green">
            <span>●</span> {isMember ? 'Your liquid ledger reserves' : 'Across all sharded bank balances'}
          </span>
        </div>

        <div className="glass-panel metric-card">
          <span className="metric-label">{isMember ? 'Clearing Account BIC' : 'System Overhead Position'}</span>
          <span className="metric-value" style={{ fontSize: isMember ? '26px' : '36px', fontFamily: isMember ? 'var(--font-mono)' : 'inherit' }}>
            {isMember ? (user?.routingCode || 'NO_BIC') : formatCurrency(totalLiabilities, 'USD')}
          </span>
          <span className="metric-sub text-orange">
            <span>●</span> {isMember ? 'Active Bank Identifier Code' : 'Clearing offset adjustments'}
          </span>
        </div>

        <div className="glass-panel metric-card">
          <span className="metric-label">{isMember ? 'Active B2B Channels' : 'Net Treasury Valuation'}</span>
          <span className="metric-value">{isMember ? accounts.length : formatCurrency(netTreasury, 'USD')}</span>
          <span className="metric-sub text-green">
            <span>📈</span> {isMember ? 'Operational ledger accounts' : 'Core clearing surplus'}
          </span>
        </div>
      </div>

      <div className="grid-main-aside">
        
        {/* Left column: Quick Actions and B2B Simulations */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Member Bank Outbound B2B Transfer Simulator */}
          {isMember ? (
            <div className="glass-panel" style={{ border: '1px solid var(--secondary-glow)' }}>
              <div className="badge" style={{ marginBottom: '12px' }}>INTERBANK PACS.008 CLEARING</div>
              <h3 style={{ marginBottom: '8px', fontSize: '18px', fontWeight: 700, color: 'var(--secondary)' }}>
                Outbound B2B Transfer (PACS.008)
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                Initiate an outbound interbank transfer. This creates a secure payment intent and signs the confirm step using your private key.
              </p>

              <form onSubmit={handleB2BTransfer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="grid-2">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Destination Clearing Account ID</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      style={{ fontFamily: 'var(--font-mono)' }}
                      placeholder="e.g. acc_clearing_bankb"
                      value={b2bDestAccount}
                      onChange={e => setB2bDestAccount(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Transfer Amount (USD)</label>
                    <input 
                      type="number" 
                      className="form-input" 
                      value={b2bAmount} 
                      onChange={e => setB2bAmount(e.target.value)} 
                      required
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Your Private Key PEM (Required to sign request)</label>
                  <textarea 
                    className="form-input" 
                    style={{ fontFamily: 'var(--font-mono)', height: '100px', fontSize: '11px', resize: 'none' }}
                    placeholder="-----BEGIN PRIVATE KEY-----\nMGECAQEGCSqGSIb3DQEHATAoBggqhkjOPQMEAjAXBgcqhkjOPQIB..."
                    value={b2bPrivateKey}
                    onChange={e => setB2bPrivateKey(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" className="btn btn-nav-primary" style={{ alignSelf: 'flex-start' }} disabled={b2bLoading}>
                  {b2bLoading ? 'Signing & Sending...' : 'Execute Outbound Pacs.008 Transfer'}
                </button>
              </form>

              {pacs008Xml && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--secondary)', marginBottom: '6px', fontWeight: 600 }}>
                    GENERATED PACS.008 CUSTOMER CREDIT TRANSFER XML:
                  </div>
                  <pre className="code-block" style={{ fontSize: '10px', maxHeight: '180px', overflowY: 'auto', color: 'var(--secondary)', border: '1px solid var(--secondary-glow)' }}>
                    {pacs008Xml}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            /* Admin Clearinghouse Net Sweep Panel */
            <div className="glass-panel" style={{ border: '1px solid var(--primary-glow)' }}>
              <div className="badge" style={{ marginBottom: '12px' }}>OPERATOR CLEARING sweep</div>
              <h3 style={{ marginBottom: '8px', fontSize: '18px', fontWeight: 700, color: 'var(--primary)' }}>
                Deferred Net Settlement Sweep (PACS.009)
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                As the clearinghouse operator, compute net positions across all bank sharded ledgers and trigger the settlement cover sweeps.
              </p>

              <button 
                type="button" 
                className="btn btn-nav-primary" 
                onClick={triggerNetSweep} 
                disabled={sweepLoading}
                style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-glow))' }}
              >
                {sweepLoading ? 'Processing Net Sweep...' : '⚡ Trigger Net Settlement Sweep'}
              </button>

              {pacs009Xml && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--primary)', marginBottom: '6px', fontWeight: 600 }}>
                    GENERATED PACS.009 COVE CO-SETTLEMENT XML:
                  </div>
                  <pre className="code-block" style={{ fontSize: '10px', maxHeight: '180px', overflowY: 'auto', color: 'var(--primary)', border: '1px solid var(--primary-glow)' }}>
                    {pacs009Xml}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Treasury Liquidity Deposit (Visible to all for funding balances) */}
          <div className="glass-panel">
            <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Treasury Liquidity Deposit (Direct Funding)</h3>
            <form onSubmit={handleSeedFunds} style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flexGrow: 1, marginBottom: 0 }}>
                <label className="form-label">Select Ledger Account</label>
                <select 
                  className="form-select" 
                  value={seedAccount} 
                  onChange={(e) => {
                    setSeedAccount(e.target.value);
                    const acc = accounts.find(a => a.id === e.target.value);
                    if (acc) setSeedCurrency(acc.currency);
                  }}
                >
                  {accounts.map((a, idx) => (
                    <option key={`${a.id}-${idx}`} value={a.id}>
                      {a.name} ({a.currency}) - Bal: {formatCurrency(a.balance, a.currency)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ width: '120px', marginBottom: 0 }}>
                <label className="form-label">Amount (USD)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={seedAmount} 
                  onChange={e => setSeedAmount(e.target.value)} 
                  placeholder="e.g. 5000" 
                />
              </div>

              <button type="submit" className="button">
                <span>➕</span> Deposit Funds
              </button>
            </form>
          </div>

        </div>

        {/* Right column: Recent Transactions list */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Recent Journal Entries</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexGrow: 1 }}>
            {transactions.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No journal entries yet.</div>
            ) : (
              transactions.map(tx => (
                <div 
                  key={tx.id} 
                  style={{ 
                    padding: '12px', 
                    borderRadius: '8px', 
                    background: 'rgba(255,255,255,0.01)', 
                    border: '1px solid var(--border-glass)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                      {tx.description}
                    </span>
                    <span className={`badge ${tx.status === 'posted' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '9px' }}>
                      {tx.status}
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span>TX ID: {tx.id}</span>
                    <span>{new Date(tx.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
