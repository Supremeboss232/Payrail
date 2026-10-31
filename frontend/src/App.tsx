import { useState, useEffect } from 'react';
import DashboardTab from './components/DashboardTab';
import LedgerTab from './components/LedgerTab';
import FundingSourcesTab from './components/FundingSourcesTab';
import KeysAndWebhooksTab from './components/KeysAndWebhooksTab';
import ApiPlayground from './components/ApiPlayground';
import LandingPage from './components/LandingPage';
import AuthPortal from './components/AuthPortal';
import BanksTab from './components/BanksTab';
import ProvidersTab from './components/ProvidersTab';
import AdminOperationsTab from './components/AdminOperationsTab';
import MemberLayout from './components/member/MemberLayout';

export type TabType = 'dashboard' | 'ledger' | 'funding_sources' | 'banks' | 'providers' | 'keys_webhooks' | 'playground' | 'operations';

export const API_BASE_URL = window.location.port === '9000' ? 'http://127.0.0.95:9500' : window.location.origin;

// Decorate global fetch to inject JWT tokens automatically for console routes
const originalFetch = window.fetch;
window.fetch = function (url, options: any = {}) {
  const token = localStorage.getItem('payrail_token');
  const urlStr = url.toString();
  if (token && urlStr.includes('/console')) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
  }
  return originalFetch(url, options);
};

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('payrail_token'));
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'landing' | 'login' | 'register' | 'console'>(
    localStorage.getItem('payrail_token') ? 'console' : 'landing'
  );
  
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [serverStatus, setServerStatus] = useState<'online' | 'offline'>('offline');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClose = () => setShowNotifDropdown(false);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  // Parse JWT token on boot
  useEffect(() => {
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          setUser(payload);
          setView('console');
        } else {
          handleLogout();
        }
      } catch {
        handleLogout();
      }
    }
  }, [token]);

  // Poll for API server health
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/health`);
        if (res.ok) {
          setServerStatus('online');
        } else {
          setServerStatus('offline');
        }
      } catch {
        setServerStatus('offline');
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  // Poll for scoped notifications
  const fetchNotifications = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/console/notifications`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000);
    return () => clearInterval(interval);
  }, [token, refreshTrigger]);

  const handleAuthSuccess = (newToken: string, newUser: any) => {
    localStorage.setItem('payrail_token', newToken);
    setToken(newToken);
    setUser(newUser);
    setView('console');
  };

  const handleLogout = () => {
    localStorage.removeItem('payrail_token');
    setToken(null);
    setUser(null);
    setView('landing');
  };

  const triggerGlobalRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const markNotifRead = async (id: string) => {
    try {
      await fetch(`${API_BASE_URL}/console/notifications/${id}/read`, { method: 'POST' });
      fetchNotifications();
    } catch {}
  };

  const markAllNotifsRead = async () => {
    try {
      await fetch(`${API_BASE_URL}/console/notifications/read_all`, { method: 'POST' });
      fetchNotifications();
    } catch {}
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const getTabTitle = () => {
    switch (activeTab) {
      case 'dashboard': return { title: 'Clearinghouse Overview', sub: 'Real-time double-entry balance sheet, DNS sweep & treasury controls' };
      case 'ledger': return { title: 'Double-Entry Ledger & Journal', sub: 'Cryptographically chained ledger accounts, journal entries & ISO 20022 camt.053 statements' };
      case 'funding_sources': return { title: 'Routing Paths & Priority Swaps', sub: 'Configure waterfall priority, AES-256 credentials & live failover rails' };
      case 'banks': return { title: 'Connected Member Banks', sub: 'Onboarded financial institutions, ECDSA public keys & shard clearing balances' };
      case 'providers': return { title: 'BaaS Provider Integrations', sub: 'Live status across all 9 integrated banking, compliance & settlement engines' };
      case 'keys_webhooks': return { title: 'API Keys, Security & Webhooks', sub: 'Manage B2B credentials, account recovery questions & HMAC-SHA256 webhook endpoints' };
      case 'playground': return { title: 'Interactive API & ISO 20022 Playground', sub: 'Execute live Payment Intents, ECDSA PACS.008 confirmations & DNS sweeps' };
      case 'operations': return { title: 'Clearinghouse Operations Center', sub: 'Execute live FX conversions, OFAC AML screening, Card Issuing, ACH/Wire & Credit pulls' };
    }
  };

  if (view === 'landing') {
    return <LandingPage onNavigate={(target) => setView(target)} />;
  }

  if (view === 'login' || view === 'register') {
    return (
      <AuthPortal 
        initialView={view} 
        onAuthSuccess={handleAuthSuccess} 
        onNavigateHome={() => setView('landing')} 
      />
    );
  }

  // ── Member portal: dedicated institution experience ──
  if (user?.role === 'member') {
    return <MemberLayout user={user} onLogout={handleLogout} />;
  }

  const headerInfo = getTabTitle();

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">⚡</div>
          <div className="sidebar-logo-text">
            <h2>Payrail</h2>
            <span>Clearinghouse v2.0</span>
          </div>
        </div>

        {/* Operator Badge */}
        <div style={{
          margin: '12px 12px 4px',
          padding: '12px 14px',
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.22)',
          borderRadius: 10,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#818cf8', marginBottom: 3 }}>
            ⚡ Clearinghouse Operator
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            {user?.legalName || user?.legal_name || 'System Administrator'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            BIC: {user?.routingCode || user?.routing_code || 'PAYRAIL_SYSTEM_BIC'}
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Core Ledger & Routing</div>
          <button className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </button>
          <button className={`nav-item ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')}>
            <span className="nav-icon">📒</span>
            <span>Ledger & Journal</span>
          </button>
          <button className={`nav-item ${activeTab === 'funding_sources' ? 'active' : ''}`} onClick={() => setActiveTab('funding_sources')}>
            <span className="nav-icon">🔀</span>
            <span>Funding & Swaps</span>
          </button>

          <div className="sidebar-section-label">Network & Operations</div>
          <button className={`nav-item ${activeTab === 'banks' ? 'active' : ''}`} onClick={() => setActiveTab('banks')}>
            <span className="nav-icon">🏦</span>
            <span>Member Banks</span>
          </button>
          <button className={`nav-item ${activeTab === 'operations' ? 'active' : ''}`} onClick={() => setActiveTab('operations')}>
            <span className="nav-icon">🎛️</span>
            <span>Operations Center</span>
          </button>

          <div className="sidebar-section-label">BaaS & Developer</div>
          <button className={`nav-item ${activeTab === 'providers' ? 'active' : ''}`} onClick={() => setActiveTab('providers')}>
            <span className="nav-icon">🔌</span>
            <span>Provider Services</span>
          </button>
          <button className={`nav-item ${activeTab === 'keys_webhooks' ? 'active' : ''}`} onClick={() => setActiveTab('keys_webhooks')}>
            <span className="nav-icon">🔑</span>
            <span>Keys & Webhooks</span>
          </button>
          <button className={`nav-item ${activeTab === 'playground' ? 'active' : ''}`} onClick={() => setActiveTab('playground')}>
            <span className="nav-icon">🧪</span>
            <span>API Playground</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`status-dot ${serverStatus}`} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Core Rail: {serverStatus === 'online' ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>:9500</span>
          </div>
          <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={handleLogout}>
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main Content Area ── */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <h1>{headerInfo.title}</h1>
            <p>{headerInfo.sub}</p>
          </div>

          <div className="topbar-right">
            <button className="btn btn-secondary btn-sm" onClick={triggerGlobalRefresh}>
              🔄 Refresh
            </button>

            {/* Notifications Bell & Dropdown */}
            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                style={{ position: 'relative', padding: '7px 12px' }}
                title="System Notifications"
              >
                🔔
                {unreadCount > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    background: 'var(--accent-danger)',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 800,
                    borderRadius: 99,
                    padding: '1px 6px',
                    border: '2px solid var(--bg-surface)',
                  }}>
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifDropdown && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: 380,
                  maxHeight: 460,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 14,
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 300,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>
                      Notifications {unreadCount > 0 && <span className="badge badge-info" style={{ marginLeft: 6 }}>{unreadCount} new</span>}
                    </span>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllNotifsRead}
                        style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        No notifications yet
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => !n.read && markNotifRead(n.id)}
                          style={{
                            padding: '12px 16px',
                            borderBottom: '1px solid var(--border-subtle)',
                            background: n.read ? 'transparent' : 'rgba(99, 102, 241, 0.07)',
                            cursor: n.read ? 'default' : 'pointer',
                            transition: 'background 0.15s',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-primary)' }}>
                              {!n.read && <span style={{ color: '#6366f1', marginRight: 6 }}>●</span>}
                              {n.title}
                            </span>
                            <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                              {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                            {n.message}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content-area">
          {activeTab === 'dashboard' && <DashboardTab refreshTrigger={refreshTrigger} user={user} onRefresh={triggerGlobalRefresh} />}
          {activeTab === 'ledger' && <LedgerTab refreshTrigger={refreshTrigger} />}
          {activeTab === 'funding_sources' && <FundingSourcesTab refreshTrigger={refreshTrigger} onUpdate={triggerGlobalRefresh} />}
          {activeTab === 'banks' && (
            <BanksTab
              refreshTrigger={refreshTrigger}
              onUpdate={triggerGlobalRefresh}
              onConnectBank={() => setView('register')}
            />
          )}
          {activeTab === 'providers' && <ProvidersTab />}
          {activeTab === 'keys_webhooks' && <KeysAndWebhooksTab refreshTrigger={refreshTrigger} />}
          {activeTab === 'playground' && <ApiPlayground refreshTrigger={refreshTrigger} onApiExecuted={triggerGlobalRefresh} user={user} />}
          {activeTab === 'operations' && <AdminOperationsTab />}
        </main>
      </div>
    </div>
  );
}

export default App;
