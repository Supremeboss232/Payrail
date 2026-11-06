import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../App';
import MemberHomeTab from './MemberHomeTab';
import MemberServicesTab from './MemberServicesTab';
import MemberPaymentsTab from './MemberPaymentsTab';
import MemberTransactionsTab from './MemberTransactionsTab';
import MemberKeysTab from './MemberKeysTab';

export type MemberTab = 'home' | 'payments' | 'services' | 'transactions' | 'keys';

interface MemberLayoutProps {
  user: any;
  onLogout: () => void;
}

const NAV: { key: MemberTab; icon: string; label: string; badge?: string }[] = [
  { key: 'home',         icon: '🏛️', label: 'Treasury & RTGS Switch Setup' },
  { key: 'payments',     icon: '💸', label: 'Switch Transfers, Cards & Reversals', badge: '4 Desks' },
  { key: 'services',     icon: '🧩', label: 'Interactive BaaS Consoles', badge: 'Live FX / OFAC / OTP' },
  { key: 'transactions', icon: '📖', label: 'Double-Entry Ledger & Audit' },
  { key: 'keys',         icon: '🔐', label: 'Gateway Keys & Webhooks' },
];

export default function MemberLayout({ user, onLogout }: MemberLayoutProps) {
  const [activeTab, setActiveTab] = useState<MemberTab>('home');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [gatewayKey, setGatewayKey] = useState<string>(
    user?.gatewayKey || localStorage.getItem('payrail_gateway_key') || ''
  );
  const [clearingBalance, setClearingBalance] = useState<number>(0);
  const [settlementMode, setSettlementMode] = useState<string>('rtgs_webhook');

  const refresh = () => setRefreshTrigger(t => t + 1);

  const handleKeyGenerated = (newKey: string) => {
    localStorage.setItem('payrail_gateway_key', newKey);
    setGatewayKey(newKey);
    refresh();
  };

  const bic = user?.routingCode || user?.routing_code || 'PARTNER_BIC';
  const legalName = user?.legalName || user?.legal_name || 'Partner Financial Institution';

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE_URL}/console/accounts`),
      fetch(`${API_BASE_URL}/console/banks`),
    ]).then(async ([accRes, bankRes]) => {
      if (accRes.ok) {
        const accs = await accRes.json();
        if (Array.isArray(accs)) {
          setClearingBalance(accs.reduce((sum: number, a: any) => sum + Number(a.balance || 0), 0));
        }
      }
      if (bankRes.ok) {
        const banks = await bankRes.json();
        if (Array.isArray(banks)) {
          const myBank = banks.find((b: any) => b.routing_code === bic || b.id === user?.tenantId);
          if (myBank?.settlement_mode) {
            setSettlementMode(myBank.settlement_mode);
          }
        }
      }
    }).catch(() => {});
  }, [refreshTrigger, bic, user?.tenantId]);

  const fmtUsd = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

  return (
    <div className="member-os-root">
      {/* ── DISTINCT EXECUTIVE COMMERCIAL BANK TOPBAR ── */}
      <header className="member-os-header">
        <div className="member-os-topbar">
          {/* Left: Bank Identity & BIC */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              boxShadow: '0 4px 18px rgba(16, 185, 129, 0.35)',
            }}>
              🏦
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 900, fontSize: 16.5, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                  {legalName}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '2px 9px',
                  borderRadius: 99,
                  background: 'rgba(16, 185, 129, 0.14)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.32)',
                }}>
                  BIC: {bic}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                Payrail Executive Treasury &amp; BaaS Workstation · Isolated Member Shard
              </div>
            </div>
          </div>

          {/* Right: Live Settlement Mode Badge, Reserve Position & Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {/* Live Settlement Mode Pill */}
            <div
              onClick={() => setActiveTab('home')}
              style={{
                cursor: 'pointer',
                padding: '6px 12px',
                borderRadius: 10,
                background: settlementMode === 'rtgs_webhook' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(99, 102, 241, 0.12)',
                border: `1px solid ${settlementMode === 'rtgs_webhook' ? 'rgba(16, 185, 129, 0.35)' : 'rgba(99, 102, 241, 0.35)'}`,
                display: 'flex',
                flexDirection: 'column',
              }}
              title="Click to configure Settlement Mode"
            >
              <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Switch Settlement Mode
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, color: settlementMode === 'rtgs_webhook' ? '#34d399' : '#818cf8' }}>
                {settlementMode === 'rtgs_webhook' ? '⚡ Direct Host RTGS (Zero Pre-Fund)' : '🏦 Pre-Funded Reserve Pool'}
              </span>
            </div>

            {/* Live Switch Reserve Balance */}
            <div style={{
              padding: '6px 14px',
              borderRadius: 10,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
            }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Switch Clearing Position
              </span>
              <span style={{
                fontSize: 13.5,
                fontWeight: 800,
                fontFamily: 'var(--font-mono)',
                color: clearingBalance >= 0 ? '#34d399' : '#fbbf24',
              }}>
                {fmtUsd(clearingBalance)}
              </span>
            </div>

            <button className="btn btn-secondary btn-sm" onClick={refresh}>
              🔄 Sync Shard
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onLogout}>
              🚪 Sign Out
            </button>
          </div>
        </div>

        {/* ── HORIZONTAL WORKSPACE NAVIGATION STRIP ── */}
        <nav className="member-os-navstrip">
          {NAV.map(item => (
            <button
              key={item.key}
              className={`member-os-tab ${activeTab === item.key ? 'active' : ''}`}
              onClick={() => setActiveTab(item.key)}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.badge && (
                <span style={{
                  marginLeft: 6,
                  fontSize: 10,
                  padding: '1px 7px',
                  borderRadius: 99,
                  background: activeTab === item.key ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255,255,255,0.06)',
                  color: activeTab === item.key ? '#6ee7b7' : '#94a3b8',
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {/* ── WORKSPACE BODY ── */}
      <main className="member-os-body">
        {activeTab === 'home' && (
          <MemberHomeTab
            user={user}
            gatewayKey={gatewayKey}
            refreshTrigger={refreshTrigger}
            onNavigateTab={(t) => setActiveTab(t)}
            onRefresh={refresh}
          />
        )}
        {activeTab === 'payments' && (
          <MemberPaymentsTab gatewayKey={gatewayKey} onSuccess={refresh} />
        )}
        {activeTab === 'services' && (
          <MemberServicesTab gatewayKey={gatewayKey} />
        )}
        {activeTab === 'transactions' && (
          <MemberTransactionsTab refreshTrigger={refreshTrigger} />
        )}
        {activeTab === 'keys' && (
          <MemberKeysTab refreshTrigger={refreshTrigger} onKeyGenerated={handleKeyGenerated} />
        )}
      </main>
    </div>
  );
}
