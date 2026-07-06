import { useState, useEffect } from 'react';
import DashboardTab from './components/DashboardTab';
import LedgerTab from './components/LedgerTab';
import FundingSourcesTab from './components/FundingSourcesTab';
import KeysAndWebhooksTab from './components/KeysAndWebhooksTab';
import ApiPlayground from './components/ApiPlayground';

export type TabType = 'dashboard' | 'ledger' | 'funding_sources' | 'keys_webhooks' | 'playground';

export const API_BASE_URL = 'http://localhost:9500';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [serverStatus, setServerStatus] = useState<'online' | 'offline'>('offline');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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

  const triggerGlobalRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const getTabTitle = () => {
    switch (activeTab) {
      case 'dashboard': return 'System Health & Metrics';
      case 'ledger': return 'Double-Entry Bookkeeping Ledger';
      case 'funding_sources': return 'Funding Source Priority Routing';
      case 'keys_webhooks': return 'API Keys & HMAC Webhook Subscriptions';
      case 'playground': return 'API Gateway & Integration Playground';
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="logo-section">
          <div className="logo-icon">💳</div>
          <div className="logo-text">Payrail</div>
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
          <div className={`status-indicator ${serverStatus === 'online' ? 'online' : 'offline'}`} 
               style={{ backgroundColor: serverStatus === 'online' ? 'var(--accent-green)' : 'var(--accent-red)', 
                        boxShadow: serverStatus === 'online' ? '0 0 8px var(--accent-green)' : '0 0 8px var(--accent-red)' }} />
          <span className="status-text">
            Gateway Server: {serverStatus.toUpperCase()}
          </span>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="header">
          <h1 className="header-title">{getTabTitle()}</h1>
          <div className="header-actions">
            <button className="button button-secondary" onClick={triggerGlobalRefresh}>
              <span>🔄</span> Refresh Stats
            </button>
          </div>
        </header>

        <div className="tab-viewport">
          {activeTab === 'dashboard' && <DashboardTab refreshTrigger={refreshTrigger} />}
          {activeTab === 'ledger' && <LedgerTab refreshTrigger={refreshTrigger} />}
          {activeTab === 'funding_sources' && <FundingSourcesTab refreshTrigger={refreshTrigger} onUpdate={triggerGlobalRefresh} />}
          {activeTab === 'keys_webhooks' && <KeysAndWebhooksTab refreshTrigger={refreshTrigger} />}
          {activeTab === 'playground' && <ApiPlayground refreshTrigger={refreshTrigger} onApiExecuted={triggerGlobalRefresh} />}
        </div>
      </main>
    </div>
  );
}

export default App;
