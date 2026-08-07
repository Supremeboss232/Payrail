import { useState, useEffect } from 'react';
import DashboardTab from './components/DashboardTab';
import LedgerTab from './components/LedgerTab';
import FundingSourcesTab from './components/FundingSourcesTab';
import KeysAndWebhooksTab from './components/KeysAndWebhooksTab';
import ApiPlayground from './components/ApiPlayground';
import LandingPage from './components/LandingPage';
import AuthPortal from './components/AuthPortal';
import BanksTab from './components/BanksTab';

export type TabType = 'dashboard' | 'ledger' | 'funding_sources' | 'banks' | 'keys_webhooks' | 'playground';

export const API_BASE_URL = window.location.port === '9000' ? 'http://127.0.0.95:9500' : window.location.origin;

// Decorate global fetch to inject JWT tokens automatically for console routes
const originalFetch = window.fetch;
window.fetch = function (url, options: any = {}) {
  const token = localStorage.getItem('payrail_token');
  if (token && url.toString().includes('/console')) {
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

  const markAsRead = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/console/notifications/${id}/read`, {
        method: 'POST',
      });
      if (res.ok) {
        setNotifications(prev =>
          prev.map(n => (n.id === id ? { ...n, read: 1 } : n))
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const markAllAsRead = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/console/notifications/read_all`, {
        method: 'POST',
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const renderNotificationCenter = () => {
    return (
      <div className="notification-center" onClick={(e) => e.stopPropagation()}>
        <button 
          className="notification-trigger" 
          onClick={() => setShowNotifDropdown(!showNotifDropdown)}
          title="Notifications Center"
        >
          <span className="bell-icon">🔔</span>
          {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
        </button>

        {showNotifDropdown && (
          <div className="notification-dropdown glassmorphism">
            <div className="notification-dropdown-header">
              <h3>Notifications</h3>
              {unreadCount > 0 && (
                <button className="mark-all-read-btn" onClick={markAllAsRead}>
                  Mark all as read
                </button>
              )}
            </div>
            <div className="notification-dropdown-list">
              {notifications.length === 0 ? (
                <div className="notification-empty-state">No alerts registered.</div>
              ) : (
                notifications.map((notif) => (
                  <div 
                    key={notif.id} 
                    className={`notification-card ${notif.read ? 'read' : 'unread'} notif-type-${notif.type}`}
                    onClick={() => markAsRead(notif.id)}
                  >
                    <div className="notification-card-status">
                      {notif.type === 'success' && '🟢'}
                      {notif.type === 'info' && '🔵'}
                      {notif.type === 'warning' && '🟡'}
                      {notif.type === 'error' && '🔴'}
                    </div>
                    <div className="notification-card-body">
                      <div className="notification-card-title">{notif.title}</div>
                      <div className="notification-card-message">{notif.message}</div>
                      <div className="notification-card-time">
                        {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const getTabTitle = () => {
    switch (activeTab) {
      case 'dashboard': return user?.role === 'admin' ? 'Network Cleared Metrics' : 'Bank Shard Metrics';
      case 'ledger': return 'Double-Entry Bookkeeping Journal';
      case 'funding_sources': return 'Routing Paths & Swaps';
      case 'banks': return 'Connected Banks & Connectors';
      case 'keys_webhooks': return 'B2B Credentials & Callback Subscriptions';
      case 'playground': return 'API Gateway & Integration Playground';
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

  return (
    <div className="app-container">
      {/* Mobile Top Header */}
      <header className="mobile-header">
        <div className="mobile-logo">
          <span className="logo-icon">💳</span>
          <span className="logo-text">Payrail</span>
        </div>
        <div className="mobile-header-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {user?.routingCode && <span className="mobile-bic">{user.routingCode}</span>}
          {renderNotificationCenter()}
          <button className="mobile-logout-btn" onClick={handleLogout} title="Log Out" style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }}>🚪</button>
        </div>
      </header>

      {/* Sidebar Navigation (Desktop) */}
      <aside className="sidebar">
        <div className="logo-section">
          <div className="logo-icon">💳</div>
          <div className="logo-text">Payrail</div>
        </div>

        {/* Logged in Tenant Indicator */}
        <div className="tenant-indicator">
          <div className="tenant-role">{user?.role?.toUpperCase()}</div>
          <div className="tenant-name">{user?.legalName}</div>
          {user?.routingCode && <div className="tenant-bic">{user.routingCode}</div>}
        </div>

        <nav className="nav-links">
          <button 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'ledger' ? 'active' : ''}`}
            onClick={() => setActiveTab('ledger')}
          >
            <span className="nav-icon">📖</span>
            <span>Ledger & Journal</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'funding_sources' ? 'active' : ''}`}
            onClick={() => setActiveTab('funding_sources')}
          >
            <span className="nav-icon">🔄</span>
            <span>Funding & Swaps</span>
          </button>

          {user?.role === 'admin' && (
            <button 
              className={`nav-item ${activeTab === 'banks' ? 'active' : ''}`}
              onClick={() => setActiveTab('banks')}
            >
              <span className="nav-icon">🏦</span>
              <span>Connected Banks</span>
            </button>
          )}

          <button 
            className={`nav-item ${activeTab === 'keys_webhooks' ? 'active' : ''}`}
            onClick={() => setActiveTab('keys_webhooks')}
          >
            <span className="nav-icon">🔑</span>
            <span>Keys & Webhooks</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'playground' ? 'active' : ''}`}
            onClick={() => setActiveTab('playground')}
          >
            <span className="nav-icon">🚀</span>
            <span>API Playground</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="btn-logout" onClick={handleLogout}>
            <span>🚪</span> Log Out
          </button>
          
          <div className="gateway-status">
            <div className={`status-indicator ${serverStatus === 'online' ? 'online' : 'offline'}`} 
                 style={{ backgroundColor: serverStatus === 'online' ? 'var(--accent-green)' : 'var(--accent-red)', 
                          boxShadow: serverStatus === 'online' ? '0 0 8px var(--accent-green)' : '0 0 8px var(--accent-red)' }} />
            <span className="status-text">
              Server: {serverStatus.toUpperCase()}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="header">
          <h1 className="header-title">{getTabTitle()}</h1>
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {renderNotificationCenter()}
            <button className="button button-secondary" onClick={triggerGlobalRefresh}>
              <span>🔄</span> Refresh Stats
            </button>
          </div>
        </header>

        <div className="tab-viewport">
          {activeTab === 'dashboard' && <DashboardTab refreshTrigger={refreshTrigger} user={user} />}
          {activeTab === 'ledger' && <LedgerTab refreshTrigger={refreshTrigger} />}
          {activeTab === 'funding_sources' && <FundingSourcesTab refreshTrigger={refreshTrigger} onUpdate={triggerGlobalRefresh} />}
          {activeTab === 'banks' && user?.role === 'admin' && (
            <BanksTab
              refreshTrigger={refreshTrigger}
              onUpdate={triggerGlobalRefresh}
              onConnectBank={() => setView('register')}
            />
          )}
          {activeTab === 'keys_webhooks' && <KeysAndWebhooksTab refreshTrigger={refreshTrigger} />}
          {activeTab === 'playground' && <ApiPlayground refreshTrigger={refreshTrigger} onApiExecuted={triggerGlobalRefresh} user={user} />}
        </div>
      </main>

      {/* Mobile Bottom Tab Navigation */}
      <nav className="mobile-nav-bar">
        <button 
          className={`mobile-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <span className="mobile-nav-icon">📊</span>
          <span className="mobile-nav-label">Dashboard</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'ledger' ? 'active' : ''}`}
          onClick={() => setActiveTab('ledger')}
        >
          <span className="mobile-nav-icon">📖</span>
          <span className="mobile-nav-label">Ledger</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'funding_sources' ? 'active' : ''}`}
          onClick={() => setActiveTab('funding_sources')}
        >
          <span className="mobile-nav-icon">🔄</span>
          <span className="mobile-nav-label">Funding</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'keys_webhooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('keys_webhooks')}
        >
          <span className="mobile-nav-icon">🔑</span>
          <span className="mobile-nav-label">Keys</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'playground' ? 'active' : ''}`}
          onClick={() => setActiveTab('playground')}
        >
          <span className="mobile-nav-icon">🚀</span>
          <span className="mobile-nav-label">Playground</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
