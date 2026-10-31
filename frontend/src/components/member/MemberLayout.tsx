import { useState } from 'react';
import MemberHomeTab from './MemberHomeTab';
import MemberServicesTab from './MemberServicesTab';
import MemberPaymentsTab from './MemberPaymentsTab';
import MemberTransactionsTab from './MemberTransactionsTab';
import MemberKeysTab from './MemberKeysTab';

type MemberTab = 'home' | 'services' | 'payments' | 'transactions' | 'keys';

interface MemberLayoutProps {
  user: any;
  onLogout: () => void;
}

const NAV: { key: MemberTab; icon: string; label: string }[] = [
  { key: 'home',         icon: '🏠', label: 'Overview'        },
  { key: 'services',     icon: '🔌', label: 'My Services'     },
  { key: 'payments',     icon: '💳', label: 'Cards & Pay'     },
  { key: 'transactions', icon: '📖', label: 'Transactions'    },
  { key: 'keys',         icon: '🔑', label: 'API & Webhooks'  },
];

const TITLES: Record<MemberTab, string> = {
  home:         'Partner Overview',
  services:     'Available BaaS Services',
  payments:     'Cards & Payments',
  transactions: 'Transaction History',
  keys:         'API Keys & Webhooks',
};

export default function MemberLayout({ user, onLogout }: MemberLayoutProps) {
  const [activeTab, setActiveTab] = useState<MemberTab>('home');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [gatewayKey, setGatewayKey] = useState<string>(
    user?.gatewayKey || localStorage.getItem('payrail_gateway_key') || ''
  );
  const refresh = () => setRefreshTrigger(t => t + 1);

  const handleKeyGenerated = (newKey: string) => {
    localStorage.setItem('payrail_gateway_key', newKey);
    setGatewayKey(newKey);
    refresh();
  };

  return (
    <div className="app-layout">

      {/* ─── Sidebar ─── */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">⚡</div>
          <div className="sidebar-logo-text">
            <h2>Payrail</h2>
            <span>Partner Portal</span>
          </div>
        </div>

        {/* Identity badge */}
        <div style={{ margin: '12px 10px 4px', padding: '12px 14px', borderRadius: 10, background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.22)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className="status-dot online" />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Active Member</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {user?.legalName || user?.legal_name || 'Partner Bank'}
          </div>
          {(user?.routingCode || user?.routing_code) && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#818cf8', marginTop: 3 }}>
              BIC: {user?.routingCode || user?.routing_code}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Institution Menu</div>
          {NAV.map(item => (
            <button
              key={item.key}
              className={`nav-item ${activeTab === item.key ? 'active' : ''}`}
              onClick={() => setActiveTab(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <button className="btn btn-secondary btn-sm" onClick={onLogout} style={{ width: '100%' }}>
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* ─── Main area ─── */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <h1>{TITLES[activeTab]}</h1>
            <p>Isolated Member Shard · {user?.legalName || user?.legal_name || 'Institution'}</p>
          </div>
          <div className="topbar-right">
            <button className="btn btn-secondary btn-sm" onClick={refresh}>🔄 Refresh</button>
          </div>
        </header>

        <div className="content-area">
          {activeTab === 'home'         && <MemberHomeTab user={user} gatewayKey={gatewayKey} refreshTrigger={refreshTrigger} />}
          {activeTab === 'services'     && <MemberServicesTab gatewayKey={gatewayKey} />}
          {activeTab === 'payments'     && <MemberPaymentsTab gatewayKey={gatewayKey} onSuccess={refresh} />}
          {activeTab === 'transactions' && <MemberTransactionsTab refreshTrigger={refreshTrigger} />}
          {activeTab === 'keys'         && <MemberKeysTab refreshTrigger={refreshTrigger} onKeyGenerated={handleKeyGenerated} />}
        </div>
      </div>
    </div>
  );
}
