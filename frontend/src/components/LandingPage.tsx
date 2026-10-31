import { useState, useEffect } from 'react';
import Button from '@mui/material/Button';

interface LandingPageProps {
  onNavigate: (view: 'login' | 'register') => void;
}

const FEATURES = [
  { icon: '🔒', title: 'Tenant-Sharded Ledger', desc: "Row-level isolation via Nile PostgreSQL. Each partner bank's data is cryptographically partitioned — zero cross-tenant leakage.", color: 'var(--brand)' },
  { icon: '💳', title: 'Card Issuance (BaaS)', desc: 'Issue virtual and physical cards with full lifecycle management: request → activate → disputes → chargebacks.', color: 'var(--cyan)' },
  { icon: '🏦', title: 'ACH & Wire Rails', desc: 'Originate ACH, same-day ACH, and Fedwire transfers. Full settlement workflow with double-entry ledger posting.', color: 'var(--emerald)' },
  { icon: '🛡️', title: 'AML / OFAC Screening', desc: 'Automated compliance screening on every payment with risk-scoring, SAR filing support, and manual review queues.', color: 'var(--amber)' },
  { icon: '💱', title: 'Live FX Conversion', desc: 'Multi-currency accounts with live rate feeds. Cross-currency transfers with spread management and rate caching.', color: 'var(--violet)' },
  { icon: '⚡', title: 'Deferred Net Settlement', desc: 'ISO 20022-compliant DNS sweep. Aggregate interbank positions and net-settle across all member banks in one sweep.', color: 'var(--rose)' },
  { icon: '🔑', title: 'Secp256k1 Auth', desc: 'Every interbank transfer is signed with elliptic-curve ECDSA keys. Cryptographically validated, tamper-evident logs.', color: 'var(--cyan)' },
  { icon: '🔔', title: 'Real-time Webhooks', desc: 'HMAC-signed webhook delivery for every payment event. Retry queues, delivery logs, and subscription management.', color: 'var(--brand)' },
];

const STATS = [
  { value: '$4.8B+', label: 'Cleared Volume',      color: 'var(--brand-light)' },
  { value: '< 420ms', label: 'Ledger Latency',     color: 'var(--cyan)' },
  { value: '9',       label: 'BaaS Services',       color: 'var(--emerald)' },
  { value: '100%',    label: 'Cryptographically Audited', color: 'var(--amber)' },
];

const FLOW = [
  { step: '01', title: 'Partner Onboarding', desc: 'Financial institutions register via BIC code, configure their connector, and receive a Gateway API Key in minutes.', icon: '🏢' },
  { step: '02', title: 'Consume BaaS Services', desc: 'Partners call Payrail APIs — cards, ACH, FX, AML screening — using their gateway key. We handle all vendor contracts.', icon: '🔌' },
  { step: '03', title: 'Net Settlement Sweep', desc: 'Payrail aggregates interbank positions and executes a ISO 20022 DNS sweep, releasing settled funds to each bank.', icon: '⚡' },
];

export default function LandingPage({ onNavigate }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="landing-root" style={{ position: 'relative' }}>

      {/* ── NAV ── */}
      <nav className="lp-nav" style={{
        boxShadow: scrolled ? '0 2px 24px rgba(0,0,0,0.4)' : 'none',
        transition: 'box-shadow 0.3s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: 'linear-gradient(135deg, var(--brand) 0%, var(--cyan) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, boxShadow: '0 4px 16px var(--brand-glow)',
          }}>⚡</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.1 }}>Payrail</div>
            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--brand-light)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Clearinghouse Network</div>
          </div>
          <span style={{
            marginLeft: 8, padding: '2px 8px', borderRadius: 'var(--r-full)',
            background: 'var(--brand-subtle)', border: '1px solid hsla(243,75%,59%,0.35)',
            fontSize: 9, fontWeight: 800, color: 'var(--brand-light)', textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>ENTERPRISE v2</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button color="inherit" variant="text" size="small" onClick={() => onNavigate('login')}>Sign In</Button>
          <Button variant="contained" color="primary" size="small" onClick={() => onNavigate('register')} sx={{ ml: 1 }}>Join the Network →</Button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <header className="lp-hero">
        {/* Glow orbs */}
        <div style={{ position: 'absolute', top: '10%', left: '15%', width: 400, height: 400, background: 'radial-gradient(circle, hsla(243,75%,59%,0.12) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(40px)' }} />
        <div style={{ position: 'absolute', top: '20%', right: '10%', width: 300, height: 300, background: 'radial-gradient(circle, hsla(192,90%,52%,0.08) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(40px)' }} />

        <div style={{ position: 'relative', maxWidth: 820, margin: '0 auto' }}>
          <div className="lp-hero-pill" style={{ marginBottom: 28 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--emerald)', boxShadow: '0 0 8px var(--emerald-glow)', display: 'inline-block' }} />
            ISO 20022 · AML Compliant · Real-time Clearing
          </div>

          <h1 style={{ marginBottom: 24, letterSpacing: '-0.04em' }}>
            The Private Banking{' '}
            <span className="gradient-text">Clearinghouse</span>
            <br />for Financial Institutions
          </h1>

          <p style={{ fontSize: 18, maxWidth: 580, margin: '0 auto 40px', color: 'var(--text-1)', lineHeight: 1.7 }}>
            Payrail is a multi-tenant BaaS clearinghouse. Partner banks get card issuance,
            ACH rails, FX, AML screening, and net settlement — all through a single gateway API key.
          </p>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="contained" color="primary" size="large" onClick={() => onNavigate('register')} sx={{ minWidth: 200, fontSize: 15 }}>🏢 Onboard Your Institution</Button>
            <Button variant="outlined" color="primary" size="large" onClick={() => onNavigate('login')} sx={{ minWidth: 160 }}>Sign In to Portal</Button>
          </div>

          {/* Terminal preview */}
          <div style={{ marginTop: 64, textAlign: 'left' }}>
            <div className="terminal-window" style={{ maxWidth: 680, margin: '0 auto' }}>
              <div className="terminal-bar">
                <div className="terminal-dot" />
                <div className="terminal-dot" />
                <div className="terminal-dot" />
                <span className="terminal-title">Payrail Gateway API</span>
              </div>
              <div className="terminal-body">
                <span style={{ color: 'var(--text-3)' }}># Issue a virtual card via Payrail BaaS</span>{'\n'}
                <span style={{ color: 'var(--emerald)' }}>curl</span>
                <span style={{ color: 'var(--text-1)' }}> -X POST </span>
                <span style={{ color: 'var(--cyan)' }}>https://api.payrail.io/v1/gateway/cards/issue</span>{' \\\n'}
                <span style={{ color: 'var(--text-3)' }}>  </span>
                <span style={{ color: 'var(--amber)' }}>-H</span>
                <span style={{ color: '#e2e8f0' }}> "X-Gateway-API-Key: <span style={{ color: 'var(--brand-light)' }}>gw_live_sk_••••••••••</span>" \</span>{'\n'}
                <span style={{ color: 'var(--amber)' }}>  -H</span>
                <span style={{ color: '#e2e8f0' }}> "Content-Type: application/json" \</span>{'\n'}
                <span style={{ color: 'var(--amber)' }}>  -d</span>
                <span style={{ color: '#e2e8f0' }}> '{'{'}
                  "cardholder_name": "Jane Smith",{'\n'}
                  {"    "}"credit_limit_cents": 500000,{'\n'}
                  {"    "}"currency": "USD"{' '}
                  {'}'}'</span>{'\n\n'}
                <span style={{ color: 'var(--text-3)' }}># Response</span>{'\n'}
                <span style={{ color: 'var(--emerald)' }}>{'{ "card_number": "4111••••••••5678", "cvv": "•••", "expires": "08/29", "status": "active" }'}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── STATS BAND ── */}
      <div className="lp-stats-band">
        <div className="lp-stats-inner">
          {STATS.map(s => (
            <div key={s.label}>
              <div className="lp-stat-num" style={{ color: s.color }}>{s.value}</div>
              <div className="lp-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: '80px 32px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div className="lp-hero-pill" style={{ display: 'inline-flex', marginBottom: 16 }}>How it works</div>
          <h2>From Onboarding to Settlement</h2>
          <p style={{ marginTop: 12, maxWidth: 480, margin: '12px auto 0' }}>
            Three steps to connect your bank and start using all Payrail BaaS services.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
          {FLOW.map((f, i) => (
            <div key={f.step} style={{
              padding: '28px 24px',
              borderRadius: 'var(--r-xl)',
              background: 'var(--glass-bg)',
              border: '1px solid var(--border)',
              position: 'relative',
              transition: 'all 0.2s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-medium)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.transform = 'none'; }}
            >
              <div style={{
                position: 'absolute', top: 20, right: 20,
                fontSize: 11, fontWeight: 800, color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
              }}>{f.step}</div>
              <div style={{ fontSize: 28, marginBottom: 16 }}>{f.icon}</div>
              <h3 style={{ marginBottom: 10 }}>{f.title}</h3>
              <p style={{ fontSize: 13, lineHeight: 1.65 }}>{f.desc}</p>
              {i < FLOW.length - 1 && (
                <div style={{
                  position: 'absolute', right: -12, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 20, color: 'var(--text-3)', display: 'none',
                }}>→</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES GRID ── */}
      <section className="lp-features">
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div className="lp-hero-pill" style={{ display: 'inline-flex', marginBottom: 16 }}>Platform Services</div>
          <h2>Everything Your Bank Needs</h2>
          <p style={{ marginTop: 12, maxWidth: 520, margin: '12px auto 0' }}>
            Nine production-grade BaaS services. One API key. All vendor contracts handled by Payrail.
          </p>
        </div>
        <div className="lp-features-grid">
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="lp-feature-card"
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${f.color}44`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
            >
              <div className="lp-feature-icon" style={{ background: `${f.color}12`, borderColor: `${f.color}22` }}>
                {f.icon}
              </div>
              <h3 style={{ marginBottom: 10 }}>{f.title}</h3>
              <p style={{ fontSize: 13, lineHeight: 1.65 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta">
        <div className="lp-cta-card">
          <div style={{ marginBottom: 16, fontSize: 40 }}>🏦</div>
          <h2 style={{ marginBottom: 16 }}>
            Ready to connect your<br />financial infrastructure?
          </h2>
          <p style={{ marginBottom: 36, fontSize: 16, maxWidth: 440, margin: '0 auto 36px' }}>
            Join the Payrail clearing network. Register your institution, get your gateway key, and call any BaaS service in under 5 minutes.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="contained" color="primary" size="large" onClick={() => onNavigate('register')}>Start Partner Onboarding →</Button>
            <Button variant="text" color="inherit" size="large" onClick={() => onNavigate('login')}>Sign In</Button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg, var(--brand), var(--cyan))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>⚡</div>
          <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>Payrail</span>
        </div>
        <p>© 2026 Payrail Clearinghouse Inc. · ISO 20022 Compliant · AML Screened · Secp256k1 Signed</p>
      </footer>
    </div>
  );
}
