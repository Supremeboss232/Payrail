import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

interface Account {
  id: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  category: string;
  currency: string;
  balance: number;
  status: string;
}

interface HistoryItem {
  id: string;
  type: 'debit' | 'credit';
  amount: number;
  currency: string;
  created_at: string;
  description: string;
  transaction_id: string;
}

interface LedgerTabProps {
  refreshTrigger: number;
}

export default function LedgerTab({ refreshTrigger }: LedgerTabProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [accountHistory, setAccountHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [camtXml, setCamtXml] = useState<string | null>(null);
  const [camtLoading, setCamtLoading] = useState(false);

  // Creation form states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'asset' | 'liability' | 'equity' | 'revenue' | 'expense'>('asset');
  const [newCategory, setNewCategory] = useState<'bank' | 'broker_cash' | 'broker_asset' | 'logistics' | 'wallet' | 'revenue' | 'escrow' | 'equity'>('bank');
  const [newCurrency, setNewCurrency] = useState('USD');
  const [newInitialBalance, setNewInitialBalance] = useState('0');

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId || !newName || !newCurrency) return;

    try {
      const res = await fetch(`${API_BASE_URL}/console/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          name: newName,
          type: newType,
          category: newCategory,
          currency: newCurrency.toUpperCase(),
          initialBalance: parseFloat(newInitialBalance) * 100, // Cents
        }),
      });

      if (res.ok) {
        setNewId('');
        setNewName('');
        setNewCurrency('USD');
        setNewInitialBalance('0');
        setIsCreateOpen(false);
        
        const fetchRes = await fetch(`${API_BASE_URL}/console/accounts`);
        if (fetchRes.ok) setAccounts(await fetchRes.json());
      } else {
        const data = await res.json();
        alert(`Failed to create account: ${data.error}`);
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/console/accounts`);
        if (res.ok) {
          const data = await res.json();
          setAccounts(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchAccounts();
  }, [refreshTrigger]);

  const handleAccountClick = async (account: Account) => {
    setSelectedAccount(account);
    setCamtXml(null);
    try {
      const res = await fetch(`${API_BASE_URL}/console/accounts/${account.id}/history`);
      if (res.ok) {
        const data = await res.json();
        setAccountHistory(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportCamt053 = async (accountId: string) => {
    setCamtLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/statements/${accountId}/camt053`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('payrail_gateway_key') || ''}`
        }
      });
      const data = await res.json();
      if (res.ok && data.camt_053_xml) {
        setCamtXml(data.camt_053_xml);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCamtLoading(false);
    }
  };

  const downloadCamtXml = () => {
    if (!camtXml || !selectedAccount) return;
    const blob = new Blob([camtXml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedAccount.id}_camt053_statement.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatCurrency = (amountCents: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amountCents / 100);
  };

  // Group accounts by type
  const grouped = accounts.reduce((acc, current) => {
    if (!acc[current.type]) {
      acc[current.type] = [];
    }
    acc[current.type].push(current);
    return acc;
  }, {} as Record<string, Account[]>);

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading ledger chart of accounts...</div>;
  }

  return (
    <div style={{ position: 'relative' }}>
      
      {/* Create Account Header Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <button className="btn btn-primary" onClick={() => setIsCreateOpen(true)}>
          <span>➕</span> Create Ledger Account
        </button>
      </div>
      
      {/* List of Accounts Grouped by Type */}
      <div className="glass-panel ledger-tree">
        {Object.keys(grouped).length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px' }}>
            No accounts in ledger. Click "Create Ledger Account" to configure your first wallet, bank, or broker ledger account!
          </div>
        ) : (
          Object.entries(grouped).map(([type, list]) => (
            <div key={type} className="ledger-category-group">
              <h4 className="ledger-category-title">{type} Accounts</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {list.map((account, idx) => (
                  <div 
                    key={`${account.id}-${idx}`} 
                    className={`ledger-row ${selectedAccount?.id === account.id ? 'selected' : ''}`}
                    onClick={() => handleAccountClick(account)}
                  >
                    <div className="ledger-row-title">
                      <span style={{ fontSize: '16px' }}>
                        {account.type === 'asset' ? '📥' : account.type === 'liability' ? '📤' : '💼'}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{account.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          ID: {account.id} • {account.category.toUpperCase()}
                        </div>
                      </div>
                    </div>

                    <div className="ledger-row-balance">
                      {formatCurrency(account.balance, account.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Account History Slider Drawer */}
      {selectedAccount && (
        <div className="drawer-backdrop" onClick={() => setSelectedAccount(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3 className="drawer-title">{selectedAccount.name}</h3>
                <span className="badge badge-info" style={{ marginTop: '8px' }}>
                  {selectedAccount.type.toUpperCase()} / {selectedAccount.currency.toUpperCase()}
                </span>
              </div>
              <button className="drawer-close" onClick={() => setSelectedAccount(null)}>×</button>
            </div>

            <div className="drawer-content">
              <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Current Cleared Balance</div>
                  <div style={{ fontWeight: 800, fontSize: 20, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginTop: 2 }}>
                    {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
                  </div>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleExportCamt053(selectedAccount.id)}
                  disabled={camtLoading}
                >
                  {camtLoading ? 'Generating…' : '📄 Export ISO 20022 camt.053'}
                </button>
              </div>

              {camtXml && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span className="badge badge-purple">ISO 20022 camt.053.001.02 XML Statement</span>
                    <button className="btn btn-primary btn-sm" onClick={downloadCamtXml}>⬇️ Download XML</button>
                  </div>
                  <pre className="code-block" style={{ maxHeight: 200, fontSize: 11 }}>{camtXml}</pre>
                </div>
              )}

              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                  Journal Posting History ({accountHistory.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {accountHistory.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No entries recorded for this account.</div>
                  ) : (
                    accountHistory.map((item) => {
                      const isAssetOrExpense = selectedAccount.type === 'asset' || selectedAccount.type === 'expense';
                      const isIncrease = isAssetOrExpense 
                        ? item.type === 'debit' 
                        : item.type === 'credit';

                      return (
                        <div 
                          key={item.id} 
                          style={{ 
                            padding: '12px', 
                            borderRadius: '8px', 
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid var(--border-subtle)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{item.description}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                              TX: {item.transaction_id} • {new Date(item.created_at).toLocaleString()}
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                            <span style={{ 
                              fontWeight: 700, 
                              fontFamily: 'var(--font-mono)', 
                              color: isIncrease ? '#34d399' : '#f87171' 
                            }}>
                              {isIncrease ? '+' : '-'}{formatCurrency(item.amount, item.currency)}
                            </span>
                            <span className={`badge ${item.type === 'debit' ? 'badge-purple' : 'badge-info'}`} style={{ fontSize: '9px' }}>
                              {item.type.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Account Slide Out Drawer */}
      {isCreateOpen && (
        <div className="drawer-backdrop" onClick={() => setIsCreateOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3 className="drawer-title">Create Ledger Account</h3>
              <button className="drawer-close" onClick={() => setIsCreateOpen(false)}>×</button>
            </div>

            <form onSubmit={handleCreateAccount} className="drawer-content">
              <div className="form-group">
                <label className="form-label">Account ID (unique)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. acc_chase_checking" 
                  value={newId}
                  onChange={e => setNewId(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Account Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. Chase Business Checking" 
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  required
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select 
                    className="form-select" 
                    value={newType} 
                    onChange={e => setNewType(e.target.value as any)}
                  >
                    <option value="asset">Asset (Banks/Brokers/Wallets)</option>
                    <option value="liability">Liability (AP/AP Costs)</option>
                    <option value="equity">Equity (Investments/Capital)</option>
                    <option value="revenue">Revenue</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select 
                    className="form-select" 
                    value={newCategory} 
                    onChange={e => setNewCategory(e.target.value as any)}
                  >
                    <option value="bank">Bank Account</option>
                    <option value="broker_cash">Broker Cash</option>
                    <option value="broker_asset">Broker Asset</option>
                    <option value="logistics">Logistics Account</option>
                    <option value="wallet">Wallet Balance</option>
                    <option value="revenue">Revenue Channel</option>
                    <option value="escrow">Escrow Hold</option>
                    <option value="equity">System Equity</option>
                  </select>
                </div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="USD" 
                    value={newCurrency}
                    onChange={e => setNewCurrency(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Initial Balance (USD/EUR)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={newInitialBalance}
                    onChange={e => setNewInitialBalance(e.target.value)}
                  />
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ marginTop: '16px' }}>
                Create Account
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
