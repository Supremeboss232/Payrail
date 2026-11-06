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

const COMMAND_PALETTE_ITEMS: { tab: TabType; icon: string; title: string; desc: string; keywords: string }[] = [
  { tab: 'dashboard', icon: '⚡', title: 'Sovereign Switchboard & Multilateral Netting Matrix', desc: 'Execute instant pacs.008 transfers, run multilateral DNS sweeps (pacs.009) & inject reserve liquidity', keywords: 'rtgs dns sweep netting transfer liquidity dashboard' },
  { tab: 'banks', icon: '🏦', title: 'Connected Member Institutions & RTGS Configurator', desc: 'Switch member banks between Direct Host RTGS Webhook and Pre-Funded Reserve Pool modes', keywords: 'finanza bank member webhook rtgs prefunded bic ping' },
  { tab: 'funding_sources', icon: '🔀', title: 'Priority Waterfall Router & Connectors', desc: 'Configure Priority 1 → 2 → 3 failover across HTTP callbacks, EVM RPC nodes & internal reserves', keywords: 'waterfall connector failover rpc webhook funding' },
  { tab: 'ledger', icon: '📒', title: 'Double-Entry Ledger, camt.053 & Reversal Center (pacs.004)', desc: 'Inspect chart of accounts, export ISO 20022 camt.053 statements & reverse settled payment intents', keywords: 'ledger reversal return pacs004 camt053 accounts' },
  { tab: 'playground', icon: '🧪', title: 'ISO 20022 Wire Studio & ECDSA Signing Terminal', desc: 'Sign interbank payloads with Secp256k1 keys and inspect pacs.008, pacs.002 & pacs.004 XML', keywords: 'iso 20022 xml pacs008 pacs002 ecdsa playground api' },
  { tab: 'operations', icon: '🎛️', title: '9-Engine BaaS Operations Execution Desk', desc: 'Run live FX conversions, fuzzy OFAC screening, virtual card issuing, ACH/Wire, OTP & credit pulls', keywords: 'baas fx ofac aml card ach wire otp credit operations' },
  { tab: 'providers', icon: '🔐', title: 'AES-256-GCM Provider Credential Vault', desc: 'Configure upstream API keys encrypted at rest with AES-256-GCM and inspect live engine health', keywords: 'providers vault aes encryption keys resend stripe' },
  { tab: 'keys_webhooks', icon: '🔑', title: 'Gateway API Keys, Security Recovery & HMAC Webhooks', desc: 'Issue API keys, configure zero-knowledge security questions & inspect webhook delivery logs', keywords: 'api keys webhooks hmac security recovery' },
];

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('payrail_token'));
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'landing' | 'login' | 'register' | 'console'>(
    localStorage.getItem('payrail_token') ? 'console' : 'landing'
  );

  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [serverStatus, setServerStatus] = useState<'online' | 'offline'>('offline');
  const [dbEngine, setDbEngine] = useState<string>('SQLITE WAL');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  // Command Launcher Modal (Ctrl+K)
  const [showCmdModal, setShowCmdModal] = useState(false);
  const [cmdSearch, setCmdSearch] = useState('');

  // Close dropdown on click outside
  useEffect(() => {
    const handleClose = () => setShowNotifDropdown(false);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  // Keyboard shortcut Ctrl+K / Cmd+K for Command Launcher
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCmdModal(prev => !prev);
      } else if (e.key === 'Escape') {
        setShowCmdModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  // Poll for API server health & DB engine
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/v1/system/status`);
        if (res.ok) {
          setServerStatus('online');
          const d = await res.json();
          setDbEngine(d.database?.engine === 'postgres' ? 'NILE POSTGRES' : 'SQLITE WAL');
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
      case 'dashboard': return { title: 'Sovereign Switchboard & Netting Matrix', sub: 'Real-time RTGS host authorization, multilateral DNS clearing (pacs.009) & Merkle ledger telemetry' };
      case 'ledger': return { title: 'Double-Entry Ledger & Reversal Center', sub: 'Chart of accounts, ISO 20022 camt.053 statements & pacs.004 payment return reversals' };
      case 'funding_sources': return { title: 'Smart Route Waterfall & Connectors', sub: 'Configure Direct Host RTGS vs. Pre-Funded settlement modes, priority failover & AES-256 credentials' };
      case 'banks': return { title: 'Connected Member Institutions', sub: 'Manage onboarded banks, Direct Host RTGS webhooks, BIC routing & shard clearing positions' };
      case 'providers': return { title: 'BaaS Provider & Rail Vault', sub: 'Live status & AES-256-GCM encrypted credentials across all 9 integrated banking & compliance engines' };
      case 'keys_webhooks': return { title: 'API Keys, Security & Webhooks', sub: 'Manage B2B credentials, zero-knowledge recovery questions & HMAC-SHA256 webhook endpoints' };
      case 'playground': return { title: 'ISO 20022 Switch & B2B API Terminal', sub: 'Execute live pacs.008 transfers, inspect pacs.002 status reports & trigger pacs.004 returns' };
      case 'operations': return { title: 'Clearinghouse BaaS Operations Desk', sub: 'Execute live FX conversions, OFAC AML screening, Card Issuing, ACH/Wire, OTP & Credit pulls' };
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

  // ── WORLD 3: Member Bank Executive Treasury Workstation (Distinct Top-Nav OS) ──
  if (user?.role === 'member') {
    return <MemberLayout user={user} onLogout={handleLogout} />;
  }

  // ── WORLD 2: Sovereign Central Clearinghouse Command Deck (Admin Private OS) ──
  const headerInfo = getTabTitle();
  const filteredCommands = COMMAND_PALETTE_ITEMS.filter(item =>
    !cmdSearch ||
    item.title.toLowerCase().includes(cmdSearch.toLowerCase()) ||
    item.desc.toLowerCase().includes(cmdSearch.toLowerCase()) ||
    item.keywords.toLowerCase().includes(cmdSearch.toLowerCase())
  );

  return (
    <div className="app-layout">
      {/* ── Central Clearinghouse Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">⚡</div>
          <div className="sidebar-logo-text">
            <h2>Payrail v3.0</h2>
            <span>Central Clearinghouse OS</span>
          </div>
        </div>

        {/* Operator Authority Card */}
        <div style={{
          margin: '12px 12px 4px',
          padding: '12px 14px',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.14), rgba(6, 182, 212, 0.08))',
          border: '1px solid rgba(99, 102, 241, 0.28)',
          borderRadius: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a5b4fc' }}>
              ⚡ Sovereign Operator
            </span>
            <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: '#34d399', fontWeight: 700 }}>
              ROOT SHARD
            </span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
            {user?.legalName || user?.legal_name || 'Central Clearinghouse'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            BIC: {user?.routingCode || user?.routing_code || 'PAYRAIL_SYSTEM_BIC'}
          </div>
        </div>

        {/* Quick Command Launcher Button */}
        <div style={{ padding: '6px 12px 2px' }}>
          <button
            onClick={() => { setShowCmdModal(true); setCmdSearch(''); }}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <span>🔍 Quick Command…</span>
            <kbd style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.08)', color: '#a5b4fc' }}>Ctrl+K</kbd>
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">01 · Switching &amp; Clearing Floor</div>
          <button className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <span className="nav-icon">⚡</span>
            <span>Switchboard &amp; Netting</span>
          </button>
          <button className={`nav-item ${activeTab === 'banks' ? 'active' : ''}`} onClick={() => setActiveTab('banks')}>
            <span className="nav-icon">🏦</span>
            <span>Member Institutions</span>
          </button>
          <button className={`nav-item ${activeTab === 'funding_sources' ? 'active' : ''}`} onClick={() => setActiveTab('funding_sources')}>
            <span className="nav-icon">🔀</span>
            <span>Waterfall &amp; Connectors</span>
          </button>

          <div className="sidebar-section-label">02 · Ledger, ISO 20022 &amp; Returns</div>
          <button className={`nav-item ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')}>
            <span className="nav-icon">📒</span>
            <span>Ledger &amp; Reversals</span>
          </button>
          <button className={`nav-item ${activeTab === 'playground' ? 'active' : ''}`} onClick={() => setActiveTab('playground')}>
            <span className="nav-icon">🧪</span>
            <span>ISO 20022 Wire Studio</span>
          </button>

          <div className="sidebar-section-label">03 · BaaS Engines &amp; Security Vault</div>
          <button className={`nav-item ${activeTab === 'operations' ? 'active' : ''}`} onClick={() => setActiveTab('operations')}>
            <span className="nav-icon">🎛️</span>
            <span>9-Engine BaaS Desk</span>
          </button>
          <button className={`nav-item ${activeTab === 'providers' ? 'active' : ''}`} onClick={() => setActiveTab('providers')}>
            <span className="nav-icon">🔐</span>
            <span>Provider Key Vault</span>
          </button>
          <button className={`nav-item ${activeTab === 'keys_webhooks' ? 'active' : ''}`} onClick={() => setActiveTab('keys_webhooks')}>
            <span className="nav-icon">🔑</span>
            <span>Keys &amp; Webhooks</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`status-dot ${serverStatus}`} />
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
                {serverStatus === 'online' ? 'SWITCH ONLINE' : 'SWITCH OFFLINE'}
              </span>
            </div>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#818cf8' }}>{dbEngine}</span>
          </div>
          <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={handleLogout}>
            🚪 Sign Out of Command Deck
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
            {/* Global 1-Click Quick Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 6 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setView('register')}
                title="Onboard a new Partner Bank"
              >
                ➕ Onboard Bank
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setActiveTab('operations')}
                title="Open 9-Engine BaaS Operations Desk"
              >
                🎛️ BaaS Desk
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setShowCmdModal(true); setCmdSearch(''); }}
                title="Open Command Launcher (Ctrl+K)"
              >
                🔍 Cmd
              </button>
            </div>

            <button className="btn btn-secondary btn-sm" onClick={triggerGlobalRefresh}>
              🔄 Sync
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
                      Switch Telemetry Alerts {unreadCount > 0 && <span className="badge badge-info" style={{ marginLeft: 6 }}>{unreadCount} new</span>}
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
                        No switch notifications yet
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

      {/* ── Ctrl+K Quick Command Launcher Modal ── */}
      {showCmdModal && (
        <div
          className="drawer-backdrop"
          style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}
          onClick={() => setShowCmdModal(false)}
        >
          <div
            className="card animate-fade-in"
            style={{ width: '100%', maxWidth: 620, padding: 0, overflow: 'hidden', border: '1px solid var(--border-strong)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 18 }}>🔍</span>
              <input
                className="form-input"
                style={{ border: 'none', background: 'transparent', padding: '4px 0', fontSize: 15, boxShadow: 'none' }}
                placeholder="Jump to any clearinghouse module, ISO 20022 tool, or BaaS engine…"
                value={cmdSearch}
                onChange={e => setCmdSearch(e.target.value)}
                autoFocus
              />
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCmdModal(false)}>ESC</button>
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto', padding: '8px' }}>
              {filteredCommands.map(cmd => (
                <div
                  key={cmd.tab}
                  onClick={() => {
                    setActiveTab(cmd.tab);
                    setShowCmdModal(false);
                  }}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    background: activeTab === cmd.tab ? 'rgba(99, 102, 241, 0.14)' : 'transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = activeTab === cmd.tab ? 'rgba(99, 102, 241, 0.14)' : 'transparent')}
                >
                  <span style={{ fontSize: 22 }}>{cmd.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#f8fafc' }}>{cmd.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{cmd.desc}</div>
                  </div>
                  <span style={{ fontSize: 12, color: '#818cf8', fontWeight: 700 }}>Jump →</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
