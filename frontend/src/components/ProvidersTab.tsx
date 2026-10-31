import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

interface CatalogService {
  id: string;
  name: string;
  description: string;
  category: string;
  status: string;
  endpoint?: string;
  cost_model?: string;
  upstream_provider?: string;
  setup_requirements?: string[];
  note?: string;
}

interface ServiceCatalog {
  tenant_id: string;
  tenant_name: string;
  total_services: number;
  available_services: number;
  services: CatalogService[];
}

interface FxRate {
  base: string;
  rates: Record<string, number>;
  source?: string;
  timestamp: string;
}

const PROVIDER_ENV_FIELDS: { key: string; label: string; placeholder: string; group: string }[] = [
  { key: 'FIXER_IO_API_KEY', label: 'Fixer.io API Key (Optional — Open ExchangeRate-API active by default)', placeholder: 'Enter Fixer.io API key...', group: 'FX & Treasury' },
  { key: 'CRYPTO_RPC_URL', label: 'Web3 EVM RPC Node URL (Ethereum / Polygon / Alchemy)', placeholder: 'https://ethereum-rpc.publicnode.com', group: 'Web3 & Crypto' },
  { key: 'CRYPTO_PRIVATE_KEY', label: 'Custodial Hot Wallet Private Key (Hex)', placeholder: '0x...', group: 'Web3 & Crypto' },
  { key: 'SENDGRID_API_KEY', label: 'SendGrid API Key (Transactional Email & OTP)', placeholder: 'SG.xxxx...', group: 'Email & Identity' },
  { key: 'SENDGRID_FROM_EMAIL', label: 'Verified Sender Email Address', placeholder: 'noreply@yourbank.com', group: 'Email & Identity' },
  { key: 'COMPLY_ADVANTAGE_API_KEY', label: 'ComplyAdvantage API Key (Optional — U.S. Treasury OFAC SDN active by default)', placeholder: 'Enter ComplyAdvantage key...', group: 'Compliance & AML' },
  { key: 'MARQETA_BASE_URL', label: 'Marqeta Base URL (Optional — Internal Luhn Card Vault active by default)', placeholder: 'https://sandbox-api.marqeta.com/v3', group: 'Card Issuing' },
  { key: 'ACH_ROUTING_NUMBER', label: 'Sponsor Bank ABA Routing Number (FedACH)', placeholder: '021000021', group: 'ACH & Wire' },
  { key: 'EQUIFAX_CLIENT_ID', label: 'Equifax Client ID (Optional — Ledger Credit Bureau active by default)', placeholder: 'Enter Equifax Client ID...', group: 'Credit Bureau' },
];

interface CryptoStatus {
  status: string;
  block_number: number | null;
  latency_ms: number;
  rpc_url?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config maps
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { color: string; bg: string; dot: string; label: string }> = {
  active:                { color: '#10b981', bg: 'rgba(16,185,129,0.12)', dot: '#10b981', label: 'Active' },
  available:             { color: '#10b981', bg: 'rgba(16,185,129,0.12)', dot: '#10b981', label: 'Available' },
  pending_configuration: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', dot: '#f59e0b', label: 'Configure' },
  pending_activation:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', dot: '#f59e0b', label: 'Pending Activation' },
  contract_required:     { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', dot: '#8b5cf6', label: 'Contract Required' },
  sponsorship_required:  { color: '#6366f1', bg: 'rgba(99,102,241,0.12)', dot: '#6366f1', label: 'Sponsorship Required' },
  connected:             { color: '#10b981', bg: 'rgba(16,185,129,0.12)', dot: '#10b981', label: 'Connected' },
  degraded:              { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', dot: '#f59e0b', label: 'Degraded' },
  unreachable:           { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  dot: '#ef4444', label: 'Unreachable' },
};

const PROVIDER_ICONS: Record<string, string> = {
  fx_rates: '💱', email_otp: '✉️', aml_screening: '🛡️',
  crypto_rails: '₿', card_issuance: '💳', ach_wire: '🏦',
  credit_bureau: '📊', password_reset: '🔑', security_questions: '🔐',
};

const CATALOG_ICONS: Record<string, string> = {
  fx_conversion: '💱', aml_screening: '🛡️', otp_verification: '✉️',
  card_issuance: '💳', ach_wire: '🏦', crypto_wallets: '₿',
  credit_bureau: '📊', settlement_clearing: '⚡', payment_intents: '🚀',
};

const CATEGORY_COLORS: Record<string, string> = {
  payments: '#3b82f6', compliance: '#f59e0b', identity: '#8b5cf6',
  cards: '#ec4899', crypto: '#10b981', settlement: '#06b6d4',
};

const COMMON_CURRENCIES = ['EUR', 'GBP', 'NGN', 'GHS', 'ZAR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'];

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] || { color: '#64748b', bg: 'rgba(100,116,139,0.12)', dot: '#64748b', label: status };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 10px', borderRadius: '999px',
      background: cfg.bg, color: cfg.color,
      fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase'
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
      {cfg.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ProvidersTab() {
  const [activeView, setActiveView] = useState<'catalog' | 'infrastructure'>('catalog');
  const [status, setStatus] = useState<ProvidersStatus | null>(null);
  const [catalog, setCatalog] = useState<ServiceCatalog | null>(null);
  const [fxRates, setFxRates] = useState<FxRate | null>(null);
  const [cryptoStatus, setCryptoStatus] = useState<CryptoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [fxLoading, setFxLoading] = useState(false);
  const [selectedCurrencies, setSelectedCurrencies] = useState(['EUR', 'GBP', 'NGN', 'GHS']);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [envInputs, setEnvInputs] = useState<Record<string, string>>({});
  const [envMeta, setEnvMeta] = useState<Record<string, { is_set: boolean; masked_value: string }>>({});
  const [savingEnv, setSavingEnv] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [statusRes, catalogRes, envRes] = await Promise.all([
        fetch(`${API_BASE_URL}/v1/providers/status`),
        fetch(`${API_BASE_URL}/v1/services/catalog`),
        fetch(`${API_BASE_URL}/console/settings/providers`),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (catalogRes.ok) setCatalog(await catalogRes.json());
      if (envRes.ok) {
        const d = await envRes.json();
        setEnvMeta(d.keys || {});
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleSaveProviders = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEnv(true);
    setSaveMsg('');
    try {
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(envInputs)) {
        if (v !== undefined && v.trim() !== '') payload[k] = v.trim();
      }
      const res = await fetch(`${API_BASE_URL}/console/settings/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save provider settings');
      setSaveMsg('✅ Live provider credentials saved and activated!');
      setEnvInputs({});
      await Promise.all([fetchAll(), fetchFxRates(), fetchCrypto()]);
    } catch (err: any) {
      setSaveMsg(`❌ ${err.message}`);
    } finally {
      setSavingEnv(false);
    }
  };

  const fetchFxRates = async () => {
    setFxLoading(true);
    try {
      const symbols = selectedCurrencies.join(',');
      const res = await fetch(`${API_BASE_URL}/v1/fx/rates?base=USD&symbols=${symbols}`);
      if (res.ok) setFxRates(await res.json());
    } catch (e) { console.error(e); }
    setFxLoading(false);
  };

  const fetchCrypto = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/crypto/status`);
      if (res.ok) setCryptoStatus(await res.json());
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchAll(); fetchFxRates(); fetchCrypto(); }, []);

  const toggleCurrency = (c: string) =>
    setSelectedCurrencies(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 60 }}>
        <div className="loading-spinner" />
        <p style={{ color: 'var(--text-muted)' }}>Loading service catalog...</p>
      </div>
    );
  }

  const providers = status?.providers || {};
  const services = catalog?.services || [];
  const availableCount = catalog?.available_services || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ─── Header ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Payrail Live Services & Providers</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
            Connected to live market FX feeds, U.S. Treasury OFAC SDN sanctions list, and Ethereum Mainnet RPC.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={() => { setIsConfigOpen(v => !v); setSaveMsg(''); }}>
            🔑 {isConfigOpen ? 'Close Credentials Manager' : 'Configure Live Provider Keys'}
          </button>
          <button className="button button-secondary" onClick={() => { fetchAll(); fetchFxRates(); fetchCrypto(); }} style={{ fontSize: 13 }}>
            🔄 Refresh All
          </button>
        </div>
      </div>

      {/* ─── Live Provider Credentials Drawer / Panel ─── */}
      {isConfigOpen && (
        <div className="glass-panel" style={{ padding: 24, border: '1px solid var(--accent-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🔑 Upstream Vendor API Keys & Endpoints</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                Save live vendor credentials directly to the encrypted Vault database. Changes apply immediately without restarting the server.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveProviders} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {PROVIDER_ENV_FIELDS.map(field => {
                const meta = envMeta[field.key];
                return (
                  <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{field.label}</label>
                      {meta?.is_set && (
                        <span className="badge badge-success" style={{ fontSize: 9.5, padding: '1px 6px' }}>
                          Set ({meta.masked_value})
                        </span>
                      )}
                    </div>
                    <input
                      className="form-input"
                      type={field.key.includes('KEY') || field.key.includes('SECRET') || field.key.includes('TOKEN') ? 'password' : 'text'}
                      placeholder={meta?.is_set ? `Configured (${meta.masked_value}) — enter new value to overwrite` : field.placeholder}
                      value={envInputs[field.key] || ''}
                      onChange={e => setEnvInputs(prev => ({ ...prev, [field.key]: e.target.value }))}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    />
                  </div>
                );
              })}
            </div>

            {saveMsg && (
              <div className={`alert ${saveMsg.startsWith('✅') ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 0 }}>
                {saveMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsConfigOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingEnv}>
                {savingEnv ? 'Saving & Activating…' : '💾 Save & Apply Live Credentials'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── Network Summary Strip ─── */}
      <div style={{
        display: 'flex', gap: 16, padding: '16px 24px',
        borderRadius: 14, flexWrap: 'wrap',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(16,185,129,0.1))',
        border: '1px solid rgba(99,102,241,0.2)'
      }}>
        {[
          { label: 'Total Services', value: catalog?.total_services || services.length, icon: '🔌' },
          { label: 'Available Now', value: availableCount, icon: '✅', color: '#10b981' },
          { label: 'Activation Required', value: services.filter(s => s.status === 'pending_activation').length, icon: '⚙️', color: '#f59e0b' },
          { label: 'Contract / Sponsorship', value: services.filter(s => s.status.includes('required')).length, icon: '📋', color: '#8b5cf6' },
        ].map(stat => (
          <div key={stat.label} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 140px' }}>
            <span style={{ fontSize: 26 }}>{stat.icon}</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: stat.color || 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {stat.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── View Switcher ─── */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-secondary)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {[
          { key: 'catalog', label: '🗂️ Service Catalog', sub: 'Member bank view' },
          { key: 'infrastructure', label: '⚙️ Infrastructure', sub: 'Admin vendor view' },
        ].map(tab => (
          <button key={tab.key}
            onClick={() => setActiveView(tab.key as any)}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: activeView === tab.key ? 'var(--surface-primary)' : 'transparent',
              color: activeView === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeView === tab.key ? 700 : 500,
              fontSize: 14, transition: 'all 0.15s',
              boxShadow: activeView === tab.key ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════
          VIEW: SERVICE CATALOG (what member banks see)
          ═══════════════════════════════════════════════════════ */}
      {activeView === 'catalog' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>
            These are the services your member banks can consume from Payrail via their gateway API key.
            Payrail handles all upstream vendor contracts — banks just call the endpoint.
          </p>

          {services.map(service => {
            const isExpanded = expandedService === service.id;
            const icon = CATALOG_ICONS[service.id] || '🔧';
            const categoryColor = CATEGORY_COLORS[service.category] || '#64748b';

            return (
              <div key={service.id} className="glass-panel" style={{
                padding: '0', overflow: 'hidden',
                border: isExpanded ? `1px solid ${categoryColor}40` : '1px solid var(--border-color)',
                transition: 'border-color 0.2s'
              }}>
                {/* Row header */}
                <div
                  onClick={() => setExpandedService(isExpanded ? null : service.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16, padding: '18px 24px',
                    cursor: 'pointer', userSelect: 'none',
                    background: isExpanded ? `${categoryColor}08` : 'transparent'
                  }}>
                  <span style={{
                    fontSize: 24, width: 44, height: 44, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', borderRadius: 10,
                    background: `${categoryColor}15`, flexShrink: 0
                  }}>{icon}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{service.name}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                        background: `${categoryColor}20`, color: categoryColor, textTransform: 'uppercase', letterSpacing: '0.05em'
                      }}>{service.category}</span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>
                      {service.description}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <StatusBadge status={service.status} />
                    <span style={{ color: 'var(--text-muted)', fontSize: 18, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      ›
                    </span>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{
                    padding: '0 24px 20px',
                    borderTop: `1px solid ${categoryColor}20`,
                    display: 'flex', flexDirection: 'column', gap: 16
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
                      {service.endpoint && (
                        <div style={{ background: 'var(--surface-secondary)', borderRadius: 8, padding: '12px 14px' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Endpoint</div>
                          <code style={{ fontSize: 12, color: '#10b981', fontFamily: 'var(--font-mono)' }}>{service.endpoint}</code>
                        </div>
                      )}
                      {service.upstream_provider && (
                        <div style={{ background: 'var(--surface-secondary)', borderRadius: 8, padding: '12px 14px' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Upstream Vendor</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{service.upstream_provider}</div>
                        </div>
                      )}
                      {service.cost_model && (
                        <div style={{ background: 'var(--surface-secondary)', borderRadius: 8, padding: '12px 14px' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Cost to Member Bank</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#10b981' }}>{service.cost_model}</div>
                        </div>
                      )}
                    </div>

                    {service.setup_requirements && (
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                          What Payrail needs to activate this service:
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {service.setup_requirements.map((req, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                              <span style={{ color: '#8b5cf6', fontWeight: 700, marginTop: 2, flexShrink: 0 }}>{i + 1}.</span>
                              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{req}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {service.note && (
                      <div style={{
                        background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                        borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f59e0b'
                      }}>
                        ⚠️ {service.note}
                      </div>
                    )}

                    {service.status === 'available' && (
                      <div style={{
                        background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                        borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#10b981', fontFamily: 'var(--font-mono)'
                      }}>
                        ✅ Ready — member banks can call <strong>{service.endpoint}</strong> using their gateway API key.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          VIEW: INFRASTRUCTURE (admin vendor status)
          ═══════════════════════════════════════════════════════ */}
      {activeView === 'infrastructure' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Vendor grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
            {Object.entries(providers).map(([key, p]) => (
              <div key={key} className="glass-panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22 }}>{PROVIDER_ICONS[key] || '🔌'}</span>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {p.engine && <div>⚙️ <strong style={{ color: 'var(--text-primary)' }}>{p.engine}</strong></div>}
                  {p.cost && <div>💰 {p.cost}</div>}
                  {p.sdn_entries_cached !== undefined && (
                    <div>🗂️ SDN entries: <strong style={{ color: 'var(--text-primary)' }}>{p.sdn_entries_cached.toLocaleString()}</strong></div>
                  )}
                  {p.last_refreshed && (
                    <div>🕐 Refreshed: {new Date(p.last_refreshed).toLocaleTimeString()}</div>
                  )}
                </div>
                {!p.configured && p.setup_url && (
                  <a href={p.setup_url} target="_blank" rel="noopener noreferrer"
                    className="button" style={{ fontSize: 12, textAlign: 'center', textDecoration: 'none', padding: '7px 14px' }}>
                    🚀 Set Up {p.engine || 'Vendor'}
                  </a>
                )}
              </div>
            ))}
          </div>

          {/* FX Rates Live Panel */}
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>💱 Live Market FX Exchange Rates</h3>
                {fxRates?.source && <div style={{ fontSize: 11.5, color: '#10b981', marginTop: 2 }}>Feed: {fxRates.source}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {fxRates && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🕐 {new Date(fxRates.timestamp).toLocaleTimeString()}</span>}
                <button className="button button-secondary" onClick={fetchFxRates} disabled={fxLoading} style={{ fontSize: 12, padding: '6px 12px' }}>
                  {fxLoading ? '⏳' : '🔄'} Refresh
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {COMMON_CURRENCIES.map(c => (
                <button key={c} onClick={() => toggleCurrency(c)} style={{
                  padding: '3px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${selectedCurrencies.includes(c) ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  background: selectedCurrencies.includes(c) ? 'var(--accent-primary)' : 'transparent',
                  color: selectedCurrencies.includes(c) ? '#fff' : 'var(--text-secondary)', transition: 'all 0.15s'
                }}>{c}</button>
              ))}
              <button onClick={fetchFxRates} className="button" style={{ fontSize: 12, padding: '3px 12px' }}>Apply</button>
            </div>
            {fxRates ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                {Object.entries(fxRates.rates).map(([currency, rate]) => (
                  <div key={currency} style={{ background: 'var(--surface-secondary)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>
                      USD → {currency}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {rate.toFixed(4)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Set <code style={{ fontFamily: 'var(--font-mono)' }}>FIXER_IO_API_KEY</code> in .env to enable live FX rates.
              </div>
            )}
          </div>

          {/* Crypto Node Status */}
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>₿ Crypto / Web3 Node Status</h3>
              <button className="button button-secondary" onClick={fetchCrypto} style={{ fontSize: 12, padding: '6px 12px' }}>🔄 Ping</button>
            </div>
            {cryptoStatus ? (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {[
                  { label: 'Status', value: <StatusBadge status={cryptoStatus.status} /> },
                  cryptoStatus.block_number ? { label: 'Block #', value: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>#{cryptoStatus.block_number.toLocaleString()}</span> } : null,
                  cryptoStatus.latency_ms > 0 ? { label: 'Latency', value: <span style={{ fontFamily: 'var(--font-mono)', color: cryptoStatus.latency_ms < 200 ? '#10b981' : '#f59e0b', fontWeight: 700 }}>{cryptoStatus.latency_ms}ms</span> } : null,
                ].filter(Boolean).map((item: any) => (
                  <div key={item.label} style={{ background: 'var(--surface-secondary)', borderRadius: 10, padding: '12px 16px', minWidth: 120 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{item.label}</div>
                    {item.value}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Set <code style={{ fontFamily: 'var(--font-mono)' }}>CRYPTO_RPC_URL</code> in .env to monitor the Web3 node.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
