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
}

export default function DashboardTab({ refreshTrigger }: DashboardTabProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Forms
  const [seedAccount, setSeedAccount] = useState('');
  const [seedAmount, setSeedAmount] = useState('1000');
  const [seedCurrency, setSeedCurrency] = useState('USD');

  const [invoiceProvider, setInvoiceProvider] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('2500');
  const [invoiceDesc, setInvoiceDesc] = useState('DHL Shipping Container Invoice #1029');

  const [paymentProvider, setPaymentProvider] = useState('');
  const [paymentBank, setPaymentBank] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('0');

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
          setTransactions(txData.slice(0, 5)); // Show 5 most recent

          if (accData.length > 0) {
            setSeedAccount(accData[0].id);
            const logisticsAccs = accData.filter((a: Account) => a.category === 'logistics');
            if (logisticsAccs.length > 0) {
              setInvoiceProvider(logisticsAccs[0].id);
              setPaymentProvider(logisticsAccs[0].id);
            }
            const bankAccs = accData.filter((a: Account) => a.category === 'bank' || a.category === 'broker_cash');
            if (bankAccs.length > 0) {
              setPaymentBank(bankAccs[0].id);
            }
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
        // Trigger page re-poll by hitting refresh trigger indirectly
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleInvoiceCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceProvider || !invoiceAmount) return;

    try {
      const res = await fetch(`${API_BASE_URL}/console/simulate_logistics_invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: invoiceProvider,
          amount: parseFloat(invoiceAmount) * 100,
          description: invoiceDesc,
        }),
      });

      if (res.ok) {
        alert('Invoice created & ledger transaction posted!');
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleInvoicePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentProvider || !paymentBank || !paymentAmount) return;

    try {
      const res = await fetch(`${API_BASE_URL}/console/pay_logistics_invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: paymentProvider,
          bankAccountId: paymentBank,
          amount: parseFloat(paymentAmount) * 100,
        }),
      });

      if (res.ok) {
        alert('Payment completed! AP liability cleared and ledger updated.');
        window.location.reload();
      } else {
        const data = await res.json();
        alert(`Failed to complete payment: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Calculations
  const formatCurrency = (amountCents: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amountCents / 100);
  };

  const totalAssets = accounts
    .filter(a => a.type === 'asset')
    .reduce((sum, a) => sum + (a.currency === 'USD' ? a.balance : 0), 0); // Convert only USD for display simple aggregation

  const totalLiabilities = accounts
    .filter(a => a.type === 'liability')
    .reduce((sum, a) => sum + (a.currency === 'USD' ? a.balance : 0), 0);

  const netWorth = totalAssets - totalLiabilities;

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)' }}>Gathering ledger analytics...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      
      {/* 3 KPI metric cards */}
      <div className="grid-3">
        <div className="glass-panel metric-card">
          <span className="metric-label">Total System Assets (USD)</span>
          <span className="metric-value">{formatCurrency(totalAssets, 'USD')}</span>
          <span className="metric-sub text-green">
            <span>●</span> In bank & broker accounts
          </span>
        </div>

        <div className="glass-panel metric-card">
          <span className="metric-label">Logistics AP Liabilities (USD)</span>
          <span className="metric-value">{formatCurrency(totalLiabilities, 'USD')}</span>
          <span className="metric-sub text-red">
            <span>●</span> Accounts Payable due
          </span>
        </div>

        <div className="glass-panel metric-card">
          <span className="metric-label">Net Treasury Valuation (USD)</span>
          <span className="metric-value">{formatCurrency(netWorth, 'USD')}</span>
          <span className="metric-sub text-green">
            <span>📈</span> Liquid Assets - Liabilities
          </span>
        </div>
      </div>

      <div className="grid-main-aside">
        
        {/* Left column: Quick Actions and simulations */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div className="glass-panel">
            <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Simulate External Banking Transfer (Deposits)</h3>
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
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency}) - Bal: {formatCurrency(a.balance, a.currency)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ width: '120px', marginBottom: 0 }}>
                <label className="form-label">Amount (Cash)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={seedAmount} 
                  onChange={e => setSeedAmount(e.target.value)} 
                  placeholder="e.g. 5000" 
                />
              </div>

              <button type="submit" className="button">
                <span>➕</span> Inject Funds
              </button>
            </form>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Simulate Logistics Shipment Billings (Liability Creation)</h3>
            <form onSubmit={handleInvoiceCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="grid-2">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Provider Account</label>
                  <select className="form-select" value={invoiceProvider} onChange={e => setInvoiceProvider(e.target.value)}>
                    {accounts.filter(a => a.category === 'logistics').map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Invoice Total (USD)</label>
                  <input type="number" className="form-input" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Line Item Invoice Description</label>
                <input type="text" className="form-input" value={invoiceDesc} onChange={e => setInvoiceDesc(e.target.value)} />
              </div>
              <button type="submit" className="button" style={{ alignSelf: 'flex-start' }}>
                <span>📝</span> Record AP Bill Invoice
              </button>
            </form>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Clear Outstanding Logistics Invoice (Debit AP & Credit Bank)</h3>
            <form onSubmit={handleInvoicePay} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="grid-3">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Logistics Provider</label>
                  <select 
                    className="form-select" 
                    value={paymentProvider} 
                    onChange={(e) => {
                      setPaymentProvider(e.target.value);
                      const acc = accounts.find(a => a.id === e.target.value);
                      if (acc) setPaymentAmount((acc.balance / 100).toString());
                    }}
                  >
                    {accounts.filter(a => a.category === 'logistics').map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} (Due: {formatCurrency(a.balance, 'USD')})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Funding Account</label>
                  <select className="form-select" value={paymentBank} onChange={e => setPaymentBank(e.target.value)}>
                    {accounts.filter(a => a.category === 'bank' || a.category === 'broker_cash').map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} (Bal: {formatCurrency(a.balance, a.currency)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Amount to Clear (USD)</label>
                  <input type="number" className="form-input" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} />
                </div>
              </div>
              <button type="submit" className="button" style={{ alignSelf: 'flex-start' }}>
                <span>💸</span> Execute Settlement Payment
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
                    gap: '4px'
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
                    <span>TX: {tx.id}</span>
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
