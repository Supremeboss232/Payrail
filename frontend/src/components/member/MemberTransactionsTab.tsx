import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../App';

interface Props { refreshTrigger: number; }

interface TxEntry {
  accountId: string;
  type: 'debit' | 'credit';
  amount: number;
  currency: string;
}

interface Tx {
  id: string;
  description: string;
  source_channel: string;
  status: string;
  created_at: string;
  entries: TxEntry[];
}

const CHAN_ICON: Record<string, string> = {
  api: '🔌', dashboard: '🖥️', pacs008: '📄', pacs009: '⚡',
  gateway: '🌐', ach: '🏦', wire: '⚡', card: '💳', system: '⚙️',
};

const STATUS_CLASS: Record<string, string> = {
  posted: 'badge-success', pending: 'badge-warning',
  failed: 'badge-danger',  reversed: 'badge-brand',
};

export default function MemberTransactionsTab({ refreshTrigger }: Props) {
  const [txs,      setTxs]      = useState<Tx[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState<string>('all');
  const [search,   setSearch]   = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE_URL}/console/transactions`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setTxs(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshTrigger]);

  const fmt = (cents: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

  const filtered = txs.filter(tx => {
    const matchStatus = filter === 'all' || tx.status === filter;
    const matchSearch = !search || tx.description?.toLowerCase().includes(search.toLowerCase()) || tx.id.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const inp: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-medium)',
    borderRadius: 'var(--r-md)', padding: '9px 14px', fontFamily: 'var(--font)',
    fontSize: 13, color: 'var(--text-0)', outline: 'none', width: '100%',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <input
            style={inp}
            type="text"
            placeholder="🔍  Search by description or ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-strip">
          {['all', 'posted', 'pending', 'failed'].map(s => (
            <button key={s} className={`filter-pill ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
              {s}
            </button>
          ))}
        </div>
        <span className="badge badge-neutral">{filtered.length} results</span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div className="spinner" />
            <span style={{ color: 'var(--text-2)', fontSize: 14 }}>Loading transactions…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div className="empty-state-title">No transactions found</div>
            <div className="empty-state-desc">Try adjusting your search or filter.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '36px 1fr 120px 100px 100px',
              gap: 12, padding: '10px 16px',
              background: 'rgba(255,255,255,0.02)',
              borderBottom: '1px solid var(--border)',
              fontSize: 11, fontWeight: 700, color: 'var(--text-3)',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>
              <span />
              <span>Description</span>
              <span>Channel</span>
              <span>Date</span>
              <span style={{ textAlign: 'right' }}>Status</span>
            </div>

            {filtered.map(tx => {
              const isExpanded = expanded === tx.id;
              const credit = tx.entries?.find(e => e.type === 'credit');
              const debit  = tx.entries?.find(e => e.type === 'debit');
              return (
                <div key={tx.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {/* Row */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '36px 1fr 120px 100px 100px',
                      gap: 12, padding: '12px 16px',
                      cursor: 'pointer', alignItems: 'center',
                      transition: 'background 0.12s',
                    }}
                    onClick={() => setExpanded(isExpanded ? null : tx.id)}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <span style={{ fontSize: 18, textAlign: 'center' }}>{CHAN_ICON[tx.source_channel] || '🔄'}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{tx.description || 'Payment'}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                        {tx.id.slice(0, 24)}…
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'capitalize' }}>
                      {tx.source_channel}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <span className={`badge ${STATUS_CLASS[tx.status] || 'badge-neutral'}`}>{tx.status}</span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{
                      padding: '14px 20px 18px',
                      background: 'rgba(0,0,0,0.2)',
                      borderTop: '1px solid var(--border)',
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                        <div>
                          <div className="section-label" style={{ marginBottom: 4 }}>Transaction ID</div>
                          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--brand-light)' }}>{tx.id}</code>
                        </div>
                        <div>
                          <div className="section-label" style={{ marginBottom: 4 }}>Created</div>
                          <span style={{ fontSize: 13, color: 'var(--text-1)' }}>
                            {new Date(tx.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {tx.entries && tx.entries.length > 0 && (
                        <div>
                          <div className="section-label" style={{ marginBottom: 8 }}>Journal Entries</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {tx.entries.map((entry, i) => (
                              <div key={i} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '8px 12px', borderRadius: 'var(--r-md)',
                                background: entry.type === 'credit' ? 'var(--emerald-subtle)' : 'var(--rose-subtle)',
                                border: `1px solid ${entry.type === 'credit' ? 'hsla(158,64%,46%,0.2)' : 'hsla(348,83%,60%,0.2)'}`,
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 11, fontWeight: 800, color: entry.type === 'credit' ? 'var(--emerald)' : 'var(--rose)', textTransform: 'uppercase' }}>
                                    {entry.type}
                                  </span>
                                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
                                    {entry.accountId}
                                  </code>
                                </div>
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: entry.type === 'credit' ? 'var(--emerald)' : 'var(--rose)' }}>
                                  {entry.type === 'credit' ? '+' : '-'}{fmt(entry.amount, entry.currency)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {(credit || debit) && (
                        <div style={{ marginTop: 12, display: 'flex', gap: 20, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                          {debit && (
                            <div>
                              <div className="section-label">Debit</div>
                              <span style={{ fontWeight: 700, color: 'var(--rose)', fontFamily: 'var(--font-mono)' }}>
                                -{fmt(debit.amount, debit.currency)}
                              </span>
                            </div>
                          )}
                          {credit && (
                            <div>
                              <div className="section-label">Credit</div>
                              <span style={{ fontWeight: 700, color: 'var(--emerald)', fontFamily: 'var(--font-mono)' }}>
                                +{fmt(credit.amount, credit.currency)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
