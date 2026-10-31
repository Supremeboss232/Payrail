import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../App';

interface Props { gatewayKey: string; }

interface CatalogService {
  id: string;
  name: string;
  description: string;
  category: string;
  status: string;
  endpoint?: string;
  cost_model?: string;
  upstream_provider?: string;
}

const ICONS: Record<string, string> = {
  fx_conversion:       '💱',
  aml_screening:       '🛡️',
  otp_verification:    '✉️',
  card_issuance:       '💳',
  ach_wire:            '🏦',
  crypto_wallets:      '₿',
  credit_bureau:       '📊',
  settlement_clearing: '⚡',
  payment_intents:     '🚀',
};

const CAT_COLORS: Record<string, string> = {
  payments:   'var(--brand-light)',
  compliance: 'var(--amber)',
  identity:   'var(--violet)',
  cards:      'var(--rose)',
  crypto:     'var(--emerald)',
  settlement: 'var(--cyan)',
};

const METHOD: Record<string, string> = {
  fx_conversion:       'GET',  aml_screening: 'POST', otp_verification: 'POST',
  card_issuance:       'POST', ach_wire: 'POST',       crypto_wallets: 'GET',
  credit_bureau:       'POST', settlement_clearing: 'POST', payment_intents: 'POST',
};

const STATUS_CLASS: Record<string, string> = {
  live: 'badge-success', available: 'badge-info', pending: 'badge-warning',
  not_configured: 'badge-neutral', error: 'badge-danger',
};

const buildCurl = (svc: CatalogService, key: string): string => {
  const method = METHOD[svc.id] || 'POST';
  const endpoint = svc.endpoint ? svc.endpoint.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, '') : `/v1/gateway/${svc.id.replace(/_/g, '/')}`;
  const base = API_BASE_URL;
  if (method === 'GET') {
    return `curl -X GET ${base}${endpoint} \\\n  -H "X-Gateway-API-Key: ${key || 'your_gateway_key'}"`;
  }
  return `curl -X POST ${base}${endpoint} \\\n  -H "X-Gateway-API-Key: ${key || 'your_gateway_key'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{}'`;
};

export default function MemberServicesTab({ gatewayKey }: Props) {
  const [services,    setServices]    = useState<CatalogService[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [copiedId,    setCopiedId]    = useState<string | null>(null);
  const [catFilter,   setCatFilter]   = useState<string>('all');

  useEffect(() => {
    fetch(`${API_BASE_URL}/v1/services/catalog`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.services) setServices(d.services);
        else if (Array.isArray(d)) setServices(d);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = (svc: CatalogService) => {
    navigator.clipboard.writeText(buildCurl(svc, gatewayKey)).then(() => {
      setCopiedId(svc.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const categories = ['all', ...Array.from(new Set(services.map(s => s.category).filter(Boolean)))];
  const filtered = catFilter === 'all' ? services : services.filter(s => s.category === catFilter);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <style>{'@keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}'}</style>
        {[1,2,3,4].map(i => (
          <div key={i} className="skeleton" style={{ height: 72, borderRadius: 'var(--r-lg)' }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>BaaS Service Catalog</h2>
          <p style={{ fontSize: 14 }}>Call any service using your gateway key. No vendor contracts required.</p>
        </div>
        <div className="filter-strip">
          {categories.map(cat => (
            <button key={cat} className={`filter-pill ${catFilter === cat ? 'active' : ''}`} onClick={() => setCatFilter(cat)}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Service cards */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔌</div>
          <div className="empty-state-title">No services found</div>
          <div className="empty-state-desc">Try a different category filter or contact your operator.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(svc => {
            const isOpen = expandedId === svc.id;
            const icon = ICONS[svc.id] || '🔌';
            const catColor = CAT_COLORS[svc.category] || 'var(--text-2)';
            return (
              <div key={svc.id} className={`accordion ${isOpen ? 'open' : ''}`}>
                {/* Header row */}
                <div
                  className="accordion-header"
                  onClick={() => setExpandedId(isOpen ? null : svc.id)}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: `${catColor}15`, border: `1px solid ${catColor}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20,
                  }}>
                    {icon}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{svc.name}</span>
                      {svc.category && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-full)', background: `${catColor}15`, color: catColor, border: `1px solid ${catColor}30`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {svc.category}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {svc.description}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span className={`badge ${STATUS_CLASS[svc.status] || 'badge-neutral'}`}>{svc.status}</span>
                    <span className="accordion-chevron">›</span>
                  </div>
                </div>

                {/* Expanded body */}
                {isOpen && (
                  <div className="accordion-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {svc.description && (
                      <p style={{ fontSize: 13, lineHeight: 1.65 }}>{svc.description}</p>
                    )}

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {svc.endpoint && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span className="section-label">Endpoint</span>
                          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--brand-light)', background: 'rgba(0,0,0,0.3)', padding: '3px 8px', borderRadius: 'var(--r-sm)' }}>
                            {METHOD[svc.id] || 'POST'} {svc.endpoint}
                          </code>
                        </div>
                      )}
                      {svc.cost_model && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span className="section-label">Pricing</span>
                          <span className="badge badge-neutral">{svc.cost_model}</span>
                        </div>
                      )}
                      {svc.upstream_provider && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span className="section-label">Provider</span>
                          <span style={{ fontSize: 13, color: 'var(--text-1)' }}>{svc.upstream_provider}</span>
                        </div>
                      )}
                    </div>

                    {/* cURL snippet */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span className="section-label">cURL Example</span>
                        <button onClick={() => handleCopy(svc)} className="btn btn-ghost btn-sm">
                          {copiedId === svc.id ? '✅ Copied' : '📋 Copy'}
                        </button>
                      </div>
                      <pre className="code-block">{buildCurl(svc, gatewayKey)}</pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
