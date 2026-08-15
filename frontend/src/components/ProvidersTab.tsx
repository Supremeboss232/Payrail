import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

interface ProviderInfo {
  name: string;
  status: string;
  engine: string | null;
  configured: boolean;
  setup_url?: string;
  cost?: string;
  timeline?: string;
  upgrade_url?: string;
  sdn_entries_cached?: number;
  last_refreshed?: string | null;
}

interface ProvidersStatus {
  timestamp: string;
  providers: Record<string, ProviderInfo>;
}

interface FxRate {
  base: string;
  rates: Record<string, number>;
  source: string;
  cached: boolean;
  timestamp: string;
}

interface CryptoStatus {
  status: string;
  block_number: number | null;
  latency_ms: number;
  rpc_url?: string;
  error?: string;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  active:                  { color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: '✅', label: 'Active' },
  pending_configuration:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '⚙️', label: 'Configure' },
  contract_required:       { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', icon: '📋', label: 'Contract Required' },
  sponsorship_required:    { color: '#6366f1', bg: 'rgba(99,102,241,0.12)', icon: '🏛️', label: 'Sponsorship Required' },
  connected:               { color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: '⛓️', label: 'Connected' },
  degraded:                { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '⚠️', label: 'Degraded' },
  unreachable:             { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: '❌', label: 'Unreachable' },
};

const PROVIDER_ICONS: Record<string, string> = {
  fx_rates:           '💱',
  email_otp:          '✉️',
  aml_screening:      '🛡️',
  crypto_rails:       '₿',
  card_issuance:      '💳',
  ach_wire:           '🏦',
  credit_bureau:      '📊',
  password_reset:     '🔑',
  security_questions: '🔐',
};

const COMMON_CURRENCIES = ['EUR', 'GBP', 'NGN', 'GHS', 'ZAR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'];

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { color: '#64748b', bg: 'rgba(100,116,139,0.12)', icon: '•', label: status };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 10px', borderRadius: '999px',
      background: cfg.bg, color: cfg.color,
      fontSize: '12px', fontWeight: 600, letterSpacing: '0.02em'
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

export default function ProvidersTab() {
  const [status, setStatus] = useState<ProvidersStatus | null>(null);
  const [fxRates, setFxRates] = useState<FxRate | null>(null);
  const [cryptoStatus, setCryptoStatus] = useState<CryptoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [fxLoading, setFxLoading] = useState(false);
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>(['EUR', 'GBP', 'NGN', 'GHS']);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/providers/status`);
      if (res.ok) setStatus(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchFxRates = async () => {
    setFxLoading(true);
    try {
      const symbols = selectedCurrencies.join(',');
      const res = await fetch(`${API_BASE_URL}/v1/fx/rates?base=USD&symbols=${symbols}`);
      const data = await res.json();
      if (res.ok) setFxRates(data);
      else setFxRates(null);
    } catch (e) {
      console.error(e);
    } finally {
      setFxLoading(false);
    }
  };

  const fetchCryptoStatus = async () => {
    setCryptoLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/crypto/status`);
      const data = await res.json();
      setCryptoStatus(data);
    } catch (e) {
      console.error(e);
    } finally {
      setCryptoLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchFxRates();
    fetchCryptoStatus();
  }, []);

  const toggleCurrency = (c: string) => {
    setSelectedCurrencies(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  };

  if (loading) {
    return (
      <div className="tab-loading">
        <div className="loading-spinner" />
        <p>Loading provider status...</p>
      </div>
    );
  }

  const providers = status?.providers || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Provider Services</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
            Live status of all integrated financial service providers
          </p>
        </div>
        <button className="button button-secondary" onClick={() => { fetchStatus(); fetchFxRates(); fetchCryptoStatus(); }}
          style={{ fontSize: '13px' }}>
          🔄 Refresh All
        </button>
      </div>

      {/* Provider Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
        {Object.entries(providers).map(([key, p]) => (
          <div key={key} className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '24px' }}>{PROVIDER_ICONS[key] || '🔌'}</span>
                <span style={{ fontWeight: 600, fontSize: '15px' }}>{p.name}</span>
              </div>
              <StatusBadge status={p.status} />
            </div>

            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {p.engine && <div>⚙️ Engine: <strong style={{ color: 'var(--text-primary)' }}>{p.engine}</strong></div>}
              {p.cost && <div>💰 Cost: {p.cost}</div>}
              {p.timeline && <div>⏱️ Timeline: {p.timeline}</div>}
              {p.sdn_entries_cached !== undefined && (
                <div>🗂️ SDN entries: <strong style={{ color: 'var(--text-primary)' }}>{p.sdn_entries_cached.toLocaleString()}</strong></div>
              )}
              {p.last_refreshed && (
                <div>🕐 Last refresh: {new Date(p.last_refreshed).toLocaleTimeString()}</div>
              )}
            </div>

            {(p.setup_url || p.upgrade_url) && !p.configured && (
              <a
                href={p.setup_url || p.upgrade_url}
                target="_blank"
                rel="noopener noreferrer"
                className="button"
                style={{ fontSize: '12px', textAlign: 'center', textDecoration: 'none', padding: '8px 14px' }}
              >
                {p.status === 'active' ? '🔗 View Docs' : p.status === 'contract_required' || p.status === 'sponsorship_required' ? '📋 Learn More' : '🚀 Set Up'}
              </a>
            )}
            {p.upgrade_url && p.configured && (
              <a href={p.upgrade_url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'underline' }}>
                Upgrade to {p.engine}
              </a>
            )}
          </div>
        ))}
      </div>

      {/* FX Rate Live Panel */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>💱 Live FX Exchange Rates</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {fxRates && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {fxRates.cached ? '🗄️ Cached' : '🔴 Live'} · {new Date(fxRates.timestamp).toLocaleTimeString()}
              </span>
            )}
            <button className="button button-secondary" onClick={fetchFxRates} disabled={fxLoading}
              style={{ fontSize: '12px', padding: '6px 12px' }}>
              {fxLoading ? '⏳' : '🔄'} Refresh
            </button>
          </div>
        </div>

        {/* Currency selector */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {COMMON_CURRENCIES.map(c => (
            <button key={c}
              onClick={() => toggleCurrency(c)}
              style={{
                padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                border: `1.5px solid ${selectedCurrencies.includes(c) ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                background: selectedCurrencies.includes(c) ? 'var(--accent-primary)' : 'transparent',
                color: selectedCurrencies.includes(c) ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer', transition: 'all 0.15s'
              }}>
              {c}
            </button>
          ))}
          <button onClick={fetchFxRates} className="button" style={{ fontSize: '12px', padding: '4px 14px' }}>
            Apply
          </button>
        </div>

        {fxRates ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
            {Object.entries(fxRates.rates).map(([currency, rate]) => (
              <div key={currency} style={{
                background: 'var(--surface-secondary)', borderRadius: '10px', padding: '14px 16px',
                display: 'flex', flexDirection: 'column', gap: '4px'
              }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.08em' }}>
                  USD → {currency}
                </span>
                <span style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {rate.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '12px 0' }}>
            {providers.fx_rates?.configured === false
              ? '⚙️ Set FIXER_IO_API_KEY in your .env file to enable live FX rates.'
              : 'Loading rates...'}
          </div>
        )}
      </div>

      {/* Crypto Node Status Panel */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>₿ Crypto / Web3 Rail Status</h3>
          <button className="button button-secondary" onClick={fetchCryptoStatus} disabled={cryptoLoading}
            style={{ fontSize: '12px', padding: '6px 12px' }}>
            {cryptoLoading ? '⏳' : '🔄'} Ping Node
          </button>
        </div>

        {cryptoStatus ? (
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div style={{ background: 'var(--surface-secondary)', borderRadius: '10px', padding: '14px 20px', minWidth: '140px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>Status</div>
              <StatusBadge status={cryptoStatus.status} />
            </div>
            {cryptoStatus.block_number && (
              <div style={{ background: 'var(--surface-secondary)', borderRadius: '10px', padding: '14px 20px', minWidth: '140px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>Block Number</div>
                <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  #{cryptoStatus.block_number.toLocaleString()}
                </div>
              </div>
            )}
            {cryptoStatus.latency_ms > 0 && (
              <div style={{ background: 'var(--surface-secondary)', borderRadius: '10px', padding: '14px 20px', minWidth: '140px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>Latency</div>
                <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: cryptoStatus.latency_ms < 200 ? '#10b981' : '#f59e0b' }}>
                  {cryptoStatus.latency_ms}ms
                </div>
              </div>
            )}
            {cryptoStatus.rpc_url && (
              <div style={{ background: 'var(--surface-secondary)', borderRadius: '10px', padding: '14px 20px', flex: 1 }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>RPC Node</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {cryptoStatus.rpc_url}
                </div>
              </div>
            )}
            {cryptoStatus.error && (
              <div style={{ color: '#ef4444', fontSize: '14px', padding: '8px 0' }}>⚠️ {cryptoStatus.error}</div>
            )}
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            {providers.crypto_rails?.configured === false
              ? '⚙️ Set CRYPTO_RPC_URL in your .env to monitor the Web3 node.'
              : 'Checking node...'}
          </div>
        )}
      </div>

    </div>
  );
}
