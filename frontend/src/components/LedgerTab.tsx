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
        <button className="button" onClick={() => setIsCreateOpen(true)}>
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
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{account.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ID: {account.id} • {account.category.toUpperCase()}</div>
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
              <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Current Balance</span>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
                </span>
              </div>

              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                  Journal Posting History
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
                            background: 'rgba(255,255,255,0.015)',
                            border: '1px solid var(--border-glass)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{item.description}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              TX ID: {item.transaction_id} • {new Date(item.created_at).toLocaleDateString()}
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                            <span style={{ 
                              fontWeight: 600, 
                              fontFamily: 'var(--font-mono)', 
                              color: isIncrease ? 'var(--accent-green)' : 'var(--accent-red)' 
                            }}>
                              {isIncrease ? '+' : '-'}{formatCurrency(item.amount, item.currency)}
                            </span>
                            <span className="badge" style={{ 
                              fontSize: '8px',
                              backgroundColor: item.type === 'debit' ? 'rgba(147, 51, 234, 0.1)' : 'rgba(6, 182, 212, 0.1)',
                              color: item.type === 'debit' ? 'var(--primary)' : 'var(--secondary)'
                            }}>
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

              <button type="submit" className="button" style={{ marginTop: '16px' }}>
                Create Account
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
