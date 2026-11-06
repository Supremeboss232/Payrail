import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../App';

interface Props {
  gatewayKey: string;
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
}

type LiveTool = 'fx' | 'ofac' | 'otp' | 'credit';

export default function MemberServicesTab({ gatewayKey }: Props) {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTool, setActiveTool] = useState<LiveTool>('fx');
  const [toolLoading, setToolLoading] = useState(false);
  const [toolOutput, setToolOutput] = useState<any>(null);

  // 1. FX Conversion state
  const [fxFrom, setFxFrom] = useState('USD');
  const [fxTo, setFxTo] = useState('NGN');
  const [fxAmount, setFxAmount] = useState('1000');

  // 2. OFAC Screening state
  const [ofacName, setOfacName] = useState('Finanza Global Holdings Ltd');
  const [ofacCountry, setOfacCountry] = useState('US');
  const [ofacAmountUsd, setOfacAmountUsd] = useState('25000');

  // 3. Email OTP state
  const [otpEmail, setOtpEmail] = useState('treasury@finanzabank.com');
  const [otpCode, setOtpCode] = useState('');

  // 4. Credit Bureau Soft Pull state
  const [crFirstName, setCrFirstName] = useState('Adaeze');
  const [crLastName, setCrLastName] = useState('Okafor');
  const [crSsnLast4, setCrSsnLast4] = useState('4829');

  useEffect(() => {
    fetch(`${API_BASE_URL}/v1/services/catalog`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.services) setServices(d.services);
        else if (Array.isArray(d)) setServices(d);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const runFxConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    setToolLoading(true);
    setToolOutput(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/fx/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fxFrom, to: fxTo, amount: parseFloat(fxAmount) }),
      });
      setToolOutput(await res.json());
    } catch (err: any) {
      setToolOutput({ error: err.message });
    } finally {
      setToolLoading(false);
    }
  };

  const runOfacScreen = async (e: React.FormEvent) => {
    e.preventDefault();
    setToolLoading(true);
    setToolOutput(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/compliance/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ofacName,
          country: ofacCountry,
          amount_cents: Math.round(parseFloat(ofacAmountUsd) * 100),
        }),
      });
      setToolOutput(await res.json());
    } catch (err: any) {
      setToolOutput({ error: err.message });
    } finally {
      setToolLoading(false);
    }
  };

  const runOtpSend = async () => {
    setToolLoading(true);
    setToolOutput(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpEmail, purpose: 'payment_authorization' }),
      });
      const data = await res.json();
      setToolOutput(data);
      if (data.dev_otp) setOtpCode(data.dev_otp);
    } catch (err: any) {
      setToolOutput({ error: err.message });
    } finally {
      setToolLoading(false);
    }
  };

  const runOtpVerify = async () => {
    setToolLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpEmail, code: otpCode }),
      });
      setToolOutput(await res.json());
    } catch (err: any) {
      setToolOutput({ error: err.message });
    } finally {
      setToolLoading(false);
    }
  };

  const runCreditPull = async (e: React.FormEvent) => {
    e.preventDefault();
    setToolLoading(true);
    setToolOutput(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/credit/soft_pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: crFirstName,
          last_name: crLastName,
          ssn_last4: crSsnLast4,
        }),
      });
      setToolOutput(await res.json());
    } catch (err: any) {
      setToolOutput({ error: err.message });
    } finally {
      setToolLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* ── INTERACTIVE BaaS EXECUTION CONSOLES ── */}
      <div className="card" style={{ border: '1px solid rgba(16, 185, 129, 0.3)' }}>
        <div className="card-header">
          <div>
            <span className="badge badge-success" style={{ marginBottom: 6 }}>LIVE BaaS EXECUTION DESK</span>
            <h3 className="card-title">🧩 Interactive BaaS Consoles (FX, OFAC AML, OTP &amp; Credit Bureau)</h3>
            <p className="card-subtitle">
              Execute live BaaS calls directly from your bank’s workstation or integrate via <code style={{ color: '#34d399' }}>X-Gateway-API-Key</code>.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { key: 'fx' as LiveTool, label: '💱 Live FX Desk' },
              { key: 'ofac' as LiveTool, label: '🛡️ OFAC / AML Screen' },
              { key: 'otp' as LiveTool, label: '✉️ Customer OTP' },
              { key: 'credit' as LiveTool, label: '📊 Credit Soft Pull' },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                className={`btn btn-sm ${activeTool === t.key ? 'btn-success' : 'btn-secondary'}`}
                onClick={() => { setActiveTool(t.key); setToolOutput(null); }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid-2" style={{ alignItems: 'start' }}>
          {/* Left: Active Tool Form */}
          <div>
            {activeTool === 'fx' && (
              <form onSubmit={runFxConvert}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Source Currency</label>
                    <select className="form-select" value={fxFrom} onChange={e => setFxFrom(e.target.value)}>
                      {['USD', 'EUR', 'GBP', 'NGN', 'ZAR', 'KES', 'GHS'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Target Currency</label>
                    <select className="form-select" value={fxTo} onChange={e => setFxTo(e.target.value)}>
                      {['NGN', 'EUR', 'GBP', 'USD', 'ZAR', 'KES', 'GHS'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Amount to Convert</label>
                  <input className="form-input mono" type="number" step="0.01" value={fxAmount} onChange={e => setFxAmount(e.target.value)} required />
                </div>
                <button type="submit" className="btn btn-success" disabled={toolLoading}>
                  {toolLoading ? 'Converting…' : '💱 Execute Live FX Conversion'}
                </button>
              </form>
            )}

            {activeTool === 'ofac' && (
              <form onSubmit={runOfacScreen}>
                <div className="form-group">
                  <label className="form-label">Entity or Individual Name *</label>
                  <input className="form-input" value={ofacName} onChange={e => setOfacName(e.target.value)} placeholder="Try 'Lazarus Group' to test a hit" required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">ISO Country Code</label>
                    <input className="form-input mono" value={ofacCountry} onChange={e => setOfacCountry(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Transfer Value (USD)</label>
                    <input className="form-input mono" type="number" value={ofacAmountUsd} onChange={e => setOfacAmountUsd(e.target.value)} />
                  </div>
                </div>
                <button type="submit" className="btn btn-success" disabled={toolLoading}>
                  {toolLoading ? 'Screening…' : '🛡️ Run Fuzzy Jaro-Winkler OFAC Screen'}
                </button>
              </form>
            )}

            {activeTool === 'otp' && (
              <div>
                <div className="form-group">
                  <label className="form-label">Customer Email Address</label>
                  <input className="form-input" type="email" value={otpEmail} onChange={e => setOtpEmail(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  <button type="button" className="btn btn-primary" onClick={runOtpSend} disabled={toolLoading}>
                    ✉️ Send 6-Digit OTP
                  </button>
                </div>
                <div className="form-row">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <input className="form-input mono" placeholder="Enter 6-digit OTP code" value={otpCode} onChange={e => setOtpCode(e.target.value)} />
                  </div>
                  <button type="button" className="btn btn-success" onClick={runOtpVerify} disabled={toolLoading || !otpCode}>
                    ✅ Verify OTP
                  </button>
                </div>
              </div>
            )}

            {activeTool === 'credit' && (
              <form onSubmit={runCreditPull}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Applicant First Name</label>
                    <input className="form-input" value={crFirstName} onChange={e => setCrFirstName(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Applicant Last Name</label>
                    <input className="form-input" value={crLastName} onChange={e => setCrLastName(e.target.value)} required />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">SSN / National ID Last 4 Digits</label>
                  <input className="form-input mono" maxLength={4} value={crSsnLast4} onChange={e => setCrSsnLast4(e.target.value)} required />
                </div>
                <button type="submit" className="btn btn-success" disabled={toolLoading}>
                  {toolLoading ? 'Querying Bureau…' : '📊 Execute Soft Credit Pull'}
                </button>
              </form>
            )}
          </div>

          {/* Right: Live JSON Output */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
              Live Engine Response
            </div>
            <pre className="code-block" style={{ margin: 0, minHeight: 190, maxHeight: 280, overflowY: 'auto' }}>
              {toolOutput ? JSON.stringify(toolOutput, null, 2) : '// Execute any BaaS tool on the left to inspect the live response payload.'}
            </pre>
          </div>
        </div>
      </div>

      {/* ── FULL 9-SERVICE BaaS API CATALOG ── */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">📚 Complete 9-Engine BaaS API Catalog</h3>
            <p className="card-subtitle">All endpoints are unlocked for your institution via your single Gateway API Key.</p>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading service catalog…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
            {services.map(svc => (
              <div
                key={svc.id}
                style={{
                  padding: '18px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{svc.name}</span>
                    <span className={`badge ${svc.status === 'live' || svc.status === 'available' ? 'badge-success' : 'badge-warning'}`}>
                      {svc.status}
                    </span>
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
                    {svc.description}
                  </p>
                </div>
                {svc.endpoint && (
                  <code style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11.5,
                    color: '#34d399',
                    background: 'rgba(0,0,0,0.35)',
                    padding: '6px 10px',
                    borderRadius: 6,
                    display: 'block',
                  }}>
                    {svc.endpoint}
                  </code>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
