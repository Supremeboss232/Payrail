import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../App';

interface Props {
  user: any;
  gatewayKey: string;
  refreshTrigger: number;
}

interface ServiceStatus {
  name: string;
  status: string;
  configured: boolean;
}

export default function MemberHomeTab({ user, gatewayKey, refreshTrigger }: Props) {
  const [balance,      setBalance]      = useState(0);
  const [txCount,      setTxCount]      = useState(0);
  const [webhookCount, setWebhookCount] = useState(0);
  const [serviceCount, setServiceCount] = useState(0);
  const [providers,    setProviders]    = useState<Record<string, ServiceStatus>>({});
  const [loading,      setLoading]      = useState(true);
  const [keyRevealed,  setKeyRevealed]  = useState(false);
  const [keyCopied,    setKeyCopied]    = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE_URL}/console/accounts`),
      fetch(`${API_BASE_URL}/console/transactions`),
      fetch(`${API_BASE_URL}/v1/services/catalog`),
      fetch(`${API_BASE_URL}/v1/providers/status`),
      fetch(`${API_BASE_URL}/console/webhook_endpoints`),
    ]).then(async ([accsRes, txsRes, catalogRes, statusRes, whRes]) => {
      if (accsRes.ok)   { const d = await accsRes.json();   setBalance(d.reduce((s: number, a: any) => s + Number(a.balance), 0)); }
      if (txsRes.ok)    { const d = await txsRes.json();    setTxCount(d.length); }
      if (catalogRes.ok){ const d = await catalogRes.json();setServiceCount(d.available_services || 0); }
      if (statusRes.ok) { const d = await statusRes.json(); setProviders(d.services || {}); }
      if (whRes.ok)     { const d = await whRes.json();     setWebhookCount(Array.isArray(d) ? d.length : 0); }
    }).catch(console.error).finally(() => setLoading(false));
  }, [refreshTrigger]);

  const checklist = [
    { label: 'Institution registered & BIC assigned', done: !!(user?.routingCode || user?.routing_code) },
    { label: 'Gateway API key generated',             done: !!gatewayKey },
    { label: 'Clearing account active',               done: true },
    { label: 'First transaction posted on ledger',    done: txCount > 0 },
    { label: 'Webhook endpoint subscribed',           done: webhookCount > 0 },
  ];

  const handleCopyKey = () => {
    navigator.clipboard.writeText(gatewayKey).then(() => {
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    });
  };

  const maskedKey = gatewayKey ? `${gatewayKey.slice(0, 8)}••••••••••••${gatewayKey.slice(-4)}` : 'Not set';

  const fmt = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);

  const STATUS_PILLS: Record<string, { cls: string; dot: string }> = {
    live:          { cls: 'badge-success', dot: 'dot-success' },
    available:     { cls: 'badge-info',    dot: 'dot-success' },
    pending:       { cls: 'badge-warning', dot: 'dot-warning' },
    not_configured:{ cls: 'badge-neutral', dot: 'dot-warning' },
    error:         { cls: 'badge-danger',  dot: 'dot-danger'  },
  };

  const svcList = Object.entries(providers).map(([key, s]) => ({ key, ...s }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ─── Welcome Banner ─── */}
      <div className="card card--brand" style={{ padding: '28px 32px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', right: -40, top: -40, width: 200, height: 200, background: 'radial-gradient(circle, hsla(243,75%,59%,0.2) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--brand-light)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Welcome back
        </div>
        <h2 style={{ marginBottom: 6 }}>{user?.legalName || 'Partner Bank'}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {user?.routingCode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 'var(--r-full)', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>BIC</span>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text-0)' }}>{user.routingCode}</code>
            </div>
          )}
          <span className="badge badge-success">
            <span className="dot dot-success" style={{ width: 6, height: 6 }} /> Active Member
          </span>
        </div>
      </div>

      {/* ─── KPI Stats ─── */}
      {loading ? (
        <div className="stat-grid">
          {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 'var(--r-lg)' }} />)}
        </div>
      ) : (
        <div className="stat-grid">
          {[
            { icon: '💰', label: 'Clearing Balance',    value: fmt(balance),             color: 'var(--emerald)',    sub: 'Total ledger reserves' },
            { icon: '📋', label: 'Transactions',        value: txCount.toString(),        color: 'var(--brand-light)',sub: 'All-time' },
            { icon: '🔌', label: 'BaaS Services',       value: serviceCount.toString(),   color: 'var(--cyan)',       sub: 'Available to use' },
            { icon: '✅', label: 'Network Status',      value: 'Online',                  color: 'var(--emerald)',    sub: 'All systems operational' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <span className="stat-icon">{s.icon}</span>
              <span className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</span>
              <span className="stat-label">{s.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.sub}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid-main-aside">
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Gateway API Key card */}
          <div className="card">
            <div className="section-header" style={{ marginBottom: 16 }}>
              <div>
                <h3 style={{ marginBottom: 4 }}>Your Gateway API Key</h3>
                <p style={{ fontSize: 13 }}>Include this in every Payrail API request as <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--brand-light)' }}>X-Gateway-API-Key</code></p>
              </div>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 16px', borderRadius: 'var(--r-md)',
              background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)',
            }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13, flex: 1, color: 'var(--brand-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {keyRevealed ? (gatewayKey || 'No key set') : maskedKey}
              </code>
              <button onClick={() => setKeyRevealed(v => !v)} className="btn btn-ghost btn-sm">
                {keyRevealed ? '🙈' : '👁️'}
              </button>
              <button onClick={handleCopyKey} className="btn btn-ghost btn-sm">
                {keyCopied ? '✅' : '📋'}
              </button>
            </div>

            <div style={{ marginTop: 16, borderRadius: 'var(--r-md)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>cURL example</span>
              </div>
              <pre style={{ padding: '14px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7, color: '#93c5fd', overflowX: 'auto', margin: 0 }}>
{`curl -X POST ${API_BASE_URL}/v1/gateway/cards/issue \\
  -H "X-Gateway-API-Key: ${keyRevealed ? (gatewayKey || 'your_key') : maskedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"cardholder_name":"${user?.legalName || 'Partner Cardholder'}","credit_limit_cents":500000}'`}
              </pre>
            </div>
          </div>

          {/* Getting started checklist */}
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Live Onboarding Progress</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {checklist.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: item.done ? 'var(--emerald-subtle)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${item.done ? 'hsla(158,64%,46%,0.35)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12,
                  }}>
                    {item.done ? <span style={{ color: 'var(--emerald)' }}>✓</span> : <span style={{ color: 'var(--text-3)' }}>○</span>}
                  </div>
                  <span style={{ fontSize: 13, color: item.done ? 'var(--text-1)' : 'var(--text-3)', textDecoration: item.done ? 'none' : 'none' }}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Service status */}
        <div className="card">
          <div className="section-header" style={{ marginBottom: 16 }}>
            <h3 className="section-title">Service Status</h3>
            <span className="badge badge-neutral">{svcList.length} services</span>
          </div>

          {svcList.length === 0 && loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 44, borderRadius: 'var(--r-md)' }} />)}
            </div>
          ) : svcList.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔌</div>
              <div className="empty-state-title">No services configured</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {svcList.map(svc => {
                const pill = STATUS_PILLS[svc.status] || STATUS_PILLS['not_configured'];
                return (
                  <div key={svc.key} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 'var(--r-md)',
                    background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                  }}>
                    <span className={`dot ${pill.dot}`} />
                    <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{svc.name || svc.key}</span>
                    <span className={`badge ${pill.cls}`}>{svc.status}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--brand-subtle)', border: '1px solid hsla(243,75%,59%,0.2)', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            💡 Services with <strong style={{ color: 'var(--amber)' }}>pending</strong> status need a vendor API key configured in the <strong style={{ color: 'var(--text-1)' }}>Provider Services</strong> tab.
          </div>
        </div>
      </div>
    </div>
  );
}
