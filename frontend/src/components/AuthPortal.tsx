import { useState } from 'react';
import { API_BASE_URL } from '../App';

type AuthPortalProps = {
  initialView: 'login' | 'register';
  onAuthSuccess: (token: string, user: any) => void;
  onNavigateHome: () => void;
};

type ConnectorType = 'http_callback' | 'web3_rpc';
type SettlementMode = 'rtgs_webhook' | 'prefunded_pool';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'ZAR', 'KES', 'GHS'];

const STEPS = [
  { n: 1, label: 'Institution Identity', desc: 'Legal name, BIC routing code & currency' },
  { n: 2, label: 'Operator Credentials', desc: 'Portal login & Secp256k1 keypair generation' },
  { n: 3, label: 'Connector & Settlement Mode', desc: 'Direct Host RTGS Webhook vs. Pre-Funded Pool' },
  { n: 4, label: 'Live Endpoint Verification', desc: 'Pre-flight connectivity & latency test' },
  { n: 5, label: 'Cryptographic Key Vault', desc: 'Download .pem private key & Gateway API key' },
];

export default function AuthPortal({ initialView, onAuthSuccess, onNavigateHome }: AuthPortalProps) {
  const [view, setView] = useState<'login' | 'wizard' | 'forgot'>(
    initialView === 'register' ? 'wizard' : 'login'
  );

  // ── Login state ──
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  // ── Forgot Password state ──
  const [resetMode, setResetMode] = useState<'token' | 'security_question'>('token');
  const [fpUser, setFpUser] = useState('');
  const [fpAnswer, setFpAnswer] = useState('');
  const [fpToken, setFpToken] = useState('');
  const [fpNewPass, setFpNewPass] = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const [fpMsg, setFpMsg] = useState('');
  const [fpError, setFpError] = useState('');

  // ── Wizard state ──
  const [step, setStep] = useState(1);
  // Step 1
  const [legalName, setLegalName] = useState('');
  const [routingCode, setRoutingCode] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [bicError, setBicError] = useState('');
  // Step 2
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showWizPass, setShowWizPass] = useState(false);
  // Step 3
  const [connectorType, setConnectorType] = useState<ConnectorType>('http_callback');
  const [settlementMode, setSettlementMode] = useState<SettlementMode>('rtgs_webhook');
  const [httpUrl, setHttpUrl] = useState('');
  const [httpMethod, setHttpMethod] = useState('POST');
  const [httpAuthHeader, setHttpAuthHeader] = useState('');
  const [rpcUrl, setRpcUrl] = useState('https://ethereum-rpc.publicnode.com');
  // Step 4
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latency_ms?: number } | null>(null);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');
  // Step 5
  const [registered, setRegistered] = useState<any>(null);
  const [privateKey, setPrivateKey] = useState('');
  const [gatewayKey, setGatewayKey] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);

  // ── Validation ──
  const validateBic = (v: string) => /^[A-Z0-9_]{4,20}$/.test(v.trim().toUpperCase());
  const handleBicChange = (v: string) => {
    const clean = v.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    setRoutingCode(clean);
    setBicError(
      clean.length > 0 && !validateBic(clean)
        ? 'BIC must be 4–20 uppercase letters, digits, or underscores.'
        : ''
    );
  };

  const step1Valid = legalName.trim().length >= 3 && validateBic(routingCode) && !bicError;
  const step2Valid = username.trim().length >= 3 && password.length >= 6 && password === confirmPassword;
  const step3Valid =
    (connectorType === 'http_callback' && httpUrl.startsWith('http')) ||
    (connectorType === 'web3_rpc' && rpcUrl.startsWith('http'));

  // ── Handlers ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');
      if (data.gateway_key) {
        localStorage.setItem('payrail_gateway_key', data.gateway_key);
      }
      onAuthSuccess(data.token, data.user);
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRequestResetToken = async () => {
    if (!fpUser.trim()) {
      setFpError('Please enter your username.');
      return;
    }
    setFpLoading(true);
    setFpError('');
    setFpMsg('');
    try {
      if (resetMode === 'token') {
        const res = await fetch(`${API_BASE_URL}/v1/auth/forgot_password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: fpUser.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to request reset.');
        if (data.reset_token_dev) {
          setFpToken(data.reset_token_dev);
          setFpMsg('Reset token generated and auto-filled below. Enter your new password to complete recovery.');
        } else {
          setFpMsg(data.message || 'Reset link sent.');
        }
      } else {
        if (!fpAnswer.trim()) {
          setFpError('Please enter your security question answer.');
          setFpLoading(false);
          return;
        }
        const res = await fetch(`${API_BASE_URL}/v1/auth/verify_security_question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: fpUser.trim(), answer: fpAnswer.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Security question verification failed.');
        setFpToken(data.reset_token);
        setFpMsg('Security answer verified! Enter your new password below.');
      }
    } catch (err: any) {
      setFpError(err.message);
    } finally {
      setFpLoading(false);
    }
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fpToken.trim() || fpNewPass.length < 8) {
      setFpError('Valid reset token and a new password (min 8 chars) are required.');
      return;
    }
    setFpLoading(true);
    setFpError('');
    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/reset_password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: fpToken.trim(), new_password: fpNewPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Password reset failed.');
      setFpMsg('✅ Password updated! Redirecting to login…');
      setTimeout(() => {
        setLoginUser(fpUser);
        setView('login');
        setFpMsg('');
        setFpToken('');
        setFpNewPass('');
      }, 1400);
    } catch (err: any) {
      setFpError(err.message);
    } finally {
      setFpLoading(false);
    }
  };

  const buildConnectorConfig = () => {
    if (connectorType === 'http_callback') {
      const headers: Record<string, string> = {};
      if (httpAuthHeader) headers['Authorization'] = httpAuthHeader;
      return {
        url: httpUrl,
        method: httpMethod,
        headers,
        settlement_mode: settlementMode,
      };
    }
    if (connectorType === 'web3_rpc') {
      return {
        url: rpcUrl,
        settlement_mode: settlementMode,
      };
    }
    return { settlement_mode: settlementMode };
  };

  const handleTestConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/banks/test_connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector_type: connectorType, ...buildConnectorConfig() }),
      });
      setTestResult(await res.json());
    } catch (err: any) {
      setTestResult({ ok: false, message: `Request error: ${err.message}` });
    } finally {
      setTestLoading(false);
    }
  };

  const handleRegister = async () => {
    setRegLoading(true);
    setRegError('');
    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_name: legalName.trim(),
          routing_code: routingCode.trim(),
          currency,
          username: username.trim(),
          password,
          connector_type: connectorType,
          settlement_mode: settlementMode,
          connector_config: buildConnectorConfig(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed.');
      setRegistered(data.tenant);
      setPrivateKey(data.private_key_pem);
      if (data.gateway_key) {
        setGatewayKey(data.gateway_key);
        localStorage.setItem('payrail_gateway_key', data.gateway_key);
      }
      setStep(5);
    } catch (err: any) {
      setRegError(err.message);
    } finally {
      setRegLoading(false);
    }
  };

  const downloadPrivateKey = () => {
    const blob = new Blob([privateKey], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${routingCode.toLowerCase()}_private_key.pem`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      gridTemplateColumns: 'minmax(320px, 440px) 1fr',
      background: 'var(--bg-base)',
      color: 'var(--text-primary)',
    }}>
      {/* ── LEFT PANEL: SOVEREIGN NETWORK TELEMETRY & GUARANTEES ── */}
      <aside style={{
        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(3, 7, 18, 0.99) 100%)',
        borderRight: '1px solid var(--border-subtle)',
        padding: '36px 32px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div>
          <button
            onClick={onNavigateHome}
            className="btn btn-ghost btn-sm"
            style={{ marginBottom: 28, paddingLeft: 0 }}
          >
            ← Back to Network Showcase
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 11,
              background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)',
            }}>⚡</div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 17, color: '#f8fafc' }}>Payrail v3.0</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Sovereign Financial Switch
              </div>
            </div>
          </div>

          <h2 style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25, marginBottom: 12 }}>
            {view === 'wizard'
              ? 'Institutional Node Onboarding & Key Provisioning'
              : 'Cryptographic Portal Access'}
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: 28 }}>
            {view === 'wizard'
              ? 'Register your bank or fintech on the clearing network, configure Direct Host RTGS or Pre-Funded settlement, and provision your Secp256k1 signing keys.'
              : 'Sign in with your Clearinghouse Operator or Partner Bank credentials to access your isolated workspace.'}
          </p>

          {/* Wizard Step Sidebar Tracker OR Security Guarantees */}
          {view === 'wizard' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {STEPS.map((s) => {
                const isDone = step > s.n;
                const isCurrent = step === s.n;
                return (
                  <div
                    key={s.n}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: isCurrent ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isCurrent ? 'rgba(99, 102, 241, 0.4)' : isDone ? 'rgba(16, 185, 129, 0.25)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800,
                      background: isDone ? '#10b981' : isCurrent ? '#6366f1' : 'rgba(255,255,255,0.06)',
                      color: isDone || isCurrent ? '#fff' : 'var(--text-muted)',
                    }}>
                      {isDone ? '✓' : s.n}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isCurrent || isDone ? '#f8fafc' : 'var(--text-muted)' }}>
                        {s.label}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        {s.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { icon: '⚡', title: 'Direct Host RTGS Mode', desc: 'Settle directly against your core banking webhook without pre-funding a reserve pool.' },
                { icon: '🔑', title: 'Secp256k1 ECDSA Signatures', desc: 'Non-repudiable cryptographic verification on every interbank payment instruction.' },
                { icon: '📜', title: 'ISO 20022 Native Switch', desc: 'Real-time pacs.008, pacs.002, pacs.009, pacs.004 & camt.053 XML telemetry.' },
              ].map((item) => (
                <div key={item.title} style={{
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.025)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  gap: 12,
                }}>
                  <span style={{ fontSize: 20 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{
          paddingTop: 20,
          borderTop: '1px solid var(--border-subtle)',
          fontSize: 11.5,
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>AES-256-GCM Encrypted Vault</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: '#34d399' }}>● TLS 1.3 / ECDSA</span>
        </div>
      </aside>

      {/* ── RIGHT PANEL: INTERACTIVE AUTH / WIZARD WORKSPACE ── */}
      <main style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 32px',
        overflowY: 'auto',
      }}>
        {/* ─────────────── FORGOT PASSWORD VIEW ─────────────── */}
        {view === 'forgot' && (
          <div className="card animate-fade-in" style={{ width: '100%', maxWidth: 480, padding: '32px' }}>
            <button onClick={() => setView('login')} className="btn btn-ghost btn-sm" style={{ marginBottom: 16, paddingLeft: 0 }}>
              ← Back to Sign In
            </button>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Zero-Knowledge Account Recovery</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Recover your operator or partner bank account via cryptographic token or SHA-256 security answer.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button
                type="button"
                className={`btn btn-sm ${resetMode === 'token' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => { setResetMode('token'); setFpError(''); setFpMsg(''); }}
              >
                🔑 Reset Token
              </button>
              <button
                type="button"
                className={`btn btn-sm ${resetMode === 'security_question' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => { setResetMode('security_question'); setFpError(''); setFpMsg(''); }}
              >
                🛡️ Security Question
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                className="form-input"
                placeholder="Enter your portal username"
                value={fpUser}
                onChange={e => setFpUser(e.target.value)}
              />
            </div>

            {resetMode === 'security_question' && (
              <div className="form-group">
                <label className="form-label">Security Question Answer</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="Enter your secret recovery answer"
                  value={fpAnswer}
                  onChange={e => setFpAnswer(e.target.value)}
                />
              </div>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', marginBottom: 16 }}
              onClick={handleRequestResetToken}
              disabled={fpLoading}
            >
              {fpLoading ? 'Verifying…' : resetMode === 'token' ? 'Generate Recovery Token' : 'Verify Security Answer'}
            </button>

            {fpMsg && <div className="alert alert-success" style={{ marginBottom: 16 }}>{fpMsg}</div>}
            {fpError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{fpError}</div>}

            <form onSubmit={handleCompleteReset} style={{ paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
              <div className="form-group">
                <label className="form-label">Recovery Token</label>
                <input
                  className="form-input mono"
                  placeholder="Paste recovery token"
                  value={fpToken}
                  onChange={e => setFpToken(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">New Password (min 8 chars)</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="••••••••••••"
                  value={fpNewPass}
                  onChange={e => setFpNewPass(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={fpLoading || !fpToken}>
                Update Password &amp; Sign In →
              </button>
            </form>
          </div>
        )}

        {/* ─────────────── LOGIN VIEW ─────────────── */}
        {view === 'login' && (
          <div className="card animate-fade-in" style={{ width: '100%', maxWidth: 460, padding: '36px 32px' }}>
            <div style={{ marginBottom: 24 }}>
              <span className="badge badge-info" style={{ marginBottom: 10 }}>AUTHENTICATED SESSION</span>
              <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 6 }}>Sign In to Payrail</h2>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                Automatically routes to the <strong>Central Clearinghouse Deck</strong> (Admin) or <strong>Executive Treasury Workstation</strong> (Member Bank).
              </p>
            </div>

            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label">Operator / Institution Username</label>
                <input
                  className="form-input"
                  placeholder="e.g. admin or finanza_admin"
                  value={loginUser}
                  onChange={e => setLoginUser(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>Password</label>
                  <button
                    type="button"
                    onClick={() => setView('forgot')}
                    style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    className="form-input"
                    type={showPass ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    value={loginPass}
                    onChange={e => setLoginPass(e.target.value)}
                    required
                    autoComplete="current-password"
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14,
                    }}
                  >
                    {showPass ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {loginError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{loginError}</div>}

              <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loginLoading}>
                {loginLoading ? 'Authenticating Session…' : 'Launch Workspace →'}
              </button>
            </form>

            <div style={{
              marginTop: 24,
              paddingTop: 20,
              borderTop: '1px solid var(--border-subtle)',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}>
              Connecting a new bank or fintech?{' '}
              <button
                type="button"
                onClick={() => { setView('wizard'); setStep(1); }}
                style={{ background: 'none', border: 'none', color: '#34d399', fontWeight: 700, cursor: 'pointer' }}
              >
                Start 5-Step Institution Onboarding →
              </button>
            </div>
          </div>
        )}

        {/* ─────────────── 5-STEP ONBOARDING WIZARD ─────────────── */}
        {view === 'wizard' && (
          <div className="card animate-fade-in" style={{ width: '100%', maxWidth: 640, padding: '36px' }}>
            {/* Top Wizard Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              {step > 1 && step < 5 ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setStep(s => s - 1)} style={{ paddingLeft: 0 }}>
                  ← Previous Step
                </button>
              ) : (
                <span className="badge badge-info">STEP {step} OF 5</span>
              )}

              {step < 5 && (
                <button
                  type="button"
                  onClick={() => setView('login')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 12.5, cursor: 'pointer' }}
                >
                  Already onboarded? <strong style={{ color: '#818cf8' }}>Sign In</strong>
                </button>
              )}
            </div>

            {/* ── STEP 1: INSTITUTION IDENTITY ── */}
            {step === 1 && (
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>🏢 Step 1: Institution Identity</h2>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 24 }}>
                  Register your commercial bank, microfinance institution, or fintech on the sovereign clearing switch.
                </p>

                <div className="form-group">
                  <label className="form-label">Legal Institution Name *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Finanza Financial Services Ltd"
                    value={legalName}
                    onChange={e => setLegalName(e.target.value)}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">ISO 9362 Routing BIC Code *</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input mono"
                        placeholder="e.g. FINANZA_BANK_01"
                        value={routingCode}
                        onChange={e => handleBicChange(e.target.value)}
                        maxLength={20}
                      />
                      {routingCode.length >= 4 && !bicError && (
                        <span className="badge badge-success" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
                          VALID BIC
                        </span>
                      )}
                    </div>
                    {bicError && <div style={{ color: 'var(--accent-danger)', fontSize: 12, marginTop: 4 }}>{bicError}</div>}
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                      4–20 uppercase characters, digits, or underscores.
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Primary Settlement Currency</label>
                    <select className="form-select" value={currency} onChange={e => setCurrency(e.target.value)}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c} — Sovereign Clearing</option>)}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  style={{ width: '100%', marginTop: 8 }}
                  disabled={!step1Valid}
                  onClick={() => setStep(2)}
                >
                  Continue to Operator Credentials →
                </button>
              </div>
            )}

            {/* ── STEP 2: OPERATOR CREDENTIALS ── */}
            {step === 2 && (
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>🔐 Step 2: Treasury Operator Credentials</h2>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 24 }}>
                  Create your institution’s master login for the Partner Bank Executive Treasury Workstation.
                </p>

                <div className="form-group">
                  <label className="form-label">Treasury Operator Username *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. finanza_treasury"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Password (min 6 chars) *</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input"
                        type={showWizPass ? 'text' : 'password'}
                        placeholder="••••••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowWizPass(s => !s)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        {showWizPass ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Confirm Password *</label>
                    <input
                      className="form-input"
                      type="password"
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                    />
                  </div>
                </div>

                {confirmPassword && password !== confirmPassword && (
                  <div className="alert alert-error" style={{ marginBottom: 16 }}>Passwords do not match.</div>
                )}

                <div className="alert alert-info" style={{ marginBottom: 20 }}>
                  <span>🔑</span>
                  <div>
                    Payrail will automatically generate an isolated <strong>Secp256k1 ECDSA Key Pair</strong> (for signing interbank <code style={{ color: '#fff' }}>pacs.008</code> transfers) and a live <strong>BaaS Gateway API Key</strong> (<code style={{ color: '#fff' }}>gw_live_sk_...</code>).
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  style={{ width: '100%' }}
                  disabled={!step2Valid}
                  onClick={() => setStep(3)}
                >
                  Continue to Connector &amp; Settlement Mode →
                </button>
              </div>
            )}

            {/* ── STEP 3: CONNECTOR & SETTLEMENT MODE ── */}
            {step === 3 && (
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>⚡ Step 3: Core Connector &amp; Settlement Mode</h2>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  Configure how Payrail communicates with your bank and whether outbound transfers settle via Direct Host RTGS Webhook or a Pre-Funded Clearing Pool.
                </p>

                {/* Settlement Authorization Mode Selector */}
                <label className="form-label">1. Select Settlement Authorization Mode *</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22 }}>
                  <div
                    onClick={() => setSettlementMode('rtgs_webhook')}
                    style={{
                      padding: '16px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      background: settlementMode === 'rtgs_webhook' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255,255,255,0.02)',
                      border: `2px solid ${settlementMode === 'rtgs_webhook' ? '#10b981' : 'var(--border-subtle)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 13.5, color: '#34d399' }}>⚡ Direct Host RTGS</span>
                      <span className="badge badge-success">Recommended</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                      Authorizes debits directly against your core banking webhook in real time. <strong>No pre-funded reserve balance required on Payrail.</strong>
                    </p>
                  </div>

                  <div
                    onClick={() => setSettlementMode('prefunded_pool')}
                    style={{
                      padding: '16px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      background: settlementMode === 'prefunded_pool' ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.02)',
                      border: `2px solid ${settlementMode === 'prefunded_pool' ? '#6366f1' : 'var(--border-subtle)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 13.5, color: '#818cf8' }}>🏦 Pre-Funded Pool</span>
                      <span className="badge badge-info">Ring-Fenced</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                      Requires your Payrail Base Clearing Account to hold pre-funded liquidity before releasing outbound payments.
                    </p>
                  </div>
                </div>

                {/* Connector Protocol Selector */}
                <label className="form-label">2. Select Core Banking Protocol *</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  {[
                    { type: 'http_callback' as ConnectorType, icon: '🌐', label: 'REST / ISO 20022 Webhook', desc: 'HTTP callback to your core banking ledger' },
                    { type: 'web3_rpc' as ConnectorType, icon: '⛓️', label: 'EVM Web3 / JSON-RPC', desc: 'Ethereum, Polygon, or sovereign L2 node' },
                  ].map(opt => (
                    <div
                      key={opt.type}
                      onClick={() => setConnectorType(opt.type)}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        cursor: 'pointer',
                        background: connectorType === opt.type ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.02)',
                        border: `1.5px solid ${connectorType === opt.type ? '#6366f1' : 'var(--border-subtle)'}`,
                      }}
                    >
                      <div style={{ fontSize: 18, marginBottom: 4 }}>{opt.icon}</div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{opt.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{opt.desc}</div>
                    </div>
                  ))}
                </div>

                {connectorType === 'http_callback' ? (
                  <div style={{ padding: '18px', borderRadius: 12, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-subtle)', marginBottom: 20 }}>
                    <div className="form-group">
                      <label className="form-label">Core Banking Webhook Endpoint URL *</label>
                      <input
                        className="form-input mono"
                        placeholder="https://api.finanzabank.com/v1/payrail/rtgs-callback"
                        value={httpUrl}
                        onChange={e => setHttpUrl(e.target.value)}
                      />
                    </div>
                    <div className="form-row">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">HTTP Method</label>
                        <select className="form-select" value={httpMethod} onChange={e => setHttpMethod(e.target.value)}>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="PATCH">PATCH</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Authorization Header (Optional)</label>
                        <input
                          className="form-input mono"
                          placeholder="Bearer sk_core_bank_secret"
                          value={httpAuthHeader}
                          onChange={e => setHttpAuthHeader(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">EVM JSON-RPC Node URL *</label>
                    <input
                      className="form-input mono"
                      placeholder="https://ethereum-rpc.publicnode.com"
                      value={rpcUrl}
                      onChange={e => setRpcUrl(e.target.value)}
                    />
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  style={{ width: '100%' }}
                  disabled={!step3Valid}
                  onClick={() => setStep(4)}
                >
                  Continue to Live Endpoint Verification →
                </button>
              </div>
            )}

            {/* ── STEP 4: TEST & ACTIVATE ── */}
            {step === 4 && (
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>📡 Step 4: Pre-Flight Verification &amp; Activation</h2>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  Verify your endpoint reachability and activate <strong>{legalName}</strong> on the Payrail clearing switch.
                </p>

                <div style={{
                  padding: '16px 18px',
                  borderRadius: 12,
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: 18,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Institution &amp; BIC</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 2 }}>{legalName} ({routingCode})</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Settlement Mode</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: settlementMode === 'rtgs_webhook' ? '#34d399' : '#818cf8', marginTop: 2 }}>
                      {settlementMode === 'rtgs_webhook' ? '⚡ Direct Host RTGS Webhook' : '🏦 Pre-Funded Reserve Pool'}
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target Endpoint</div>
                    <div style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', color: '#22d3ee', marginTop: 2, wordBreak: 'break-all' }}>
                      {connectorType === 'http_callback' ? httpUrl : rpcUrl}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '100%', marginBottom: 16 }}
                  onClick={handleTestConnection}
                  disabled={testLoading}
                >
                  {testLoading ? 'Pinging Host Endpoint…' : '▶ Run Live Connection Ping Test'}
                </button>

                {testResult && (
                  <div className={`alert ${testResult.ok ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: 18 }}>
                    <span>{testResult.ok ? '✅' : '⚠️'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>
                        {testResult.ok ? 'Host Reachable' : 'Ping Notice'} {testResult.latency_ms ? `(${testResult.latency_ms}ms)` : ''}
                      </div>
                      <div style={{ fontSize: 12.5 }}>{testResult.message}</div>
                    </div>
                  </div>
                )}

                {regError && <div className="alert alert-error" style={{ marginBottom: 18 }}>{regError}</div>}

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    style={{ flex: 1 }}
                    onClick={handleRegister}
                    disabled={regLoading}
                  >
                    {regLoading ? 'Provisioning Shard & Keys…' : '🏛️ Activate Institution & Generate Keys →'}
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 5: ACTIVATED & KEY VAULT ── */}
            {step === 5 && registered && (
              <div>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <div style={{ fontSize: 44, marginBottom: 8 }}>🎉</div>
                  <span className="badge badge-success" style={{ marginBottom: 8 }}>SHARD ACTIVE · 9 BAAS ENGINES UNLOCKED</span>
                  <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>{registered.legal_name} is Live!</h2>
                  <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                    Your isolated ledger accounts, RTGS connector, and cryptographic keys have been provisioned.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
                  <div style={{ padding: '14px', borderRadius: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Routing BIC</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: '#a5b4fc', marginTop: 4 }}>{registered.routing_code}</div>
                  </div>
                  <div style={{ padding: '14px', borderRadius: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Base Clearing Account ID</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#34d399', marginTop: 4, wordBreak: 'break-all' }}>{registered.clearing_account}</div>
                  </div>
                </div>

                {gatewayKey && (
                  <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', marginBottom: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#34d399', textTransform: 'uppercase' }}>
                        🔑 Master BaaS Gateway API Key (X-Gateway-API-Key)
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(gatewayKey);
                          setKeyCopied(true);
                          setTimeout(() => setKeyCopied(false), 1800);
                        }}
                      >
                        {keyCopied ? '✅ Copied' : '📋 Copy Key'}
                      </button>
                    </div>
                    <code style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: '#f8fafc', wordBreak: 'break-all' }}>
                      {gatewayKey}
                    </code>
                  </div>
                )}

                <div className="alert alert-warning" style={{ marginBottom: 18 }}>
                  <span>⚠️</span>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>Download Your Secp256k1 ECDSA Private Key (.pem)</div>
                    <div style={{ fontSize: 12.5 }}>
                      Payrail only stores your public key. Download this private key now to sign interbank <code style={{ color: '#fff' }}>pacs.008</code> transfers.
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button type="button" className="btn btn-secondary btn-lg" onClick={downloadPrivateKey} style={{ width: '100%' }}>
                    ⬇️ Download Secp256k1 Private Key ({routingCode.toLowerCase()}_private_key.pem)
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    style={{ width: '100%' }}
                    onClick={() => {
                      setLoginUser(username);
                      setLoginPass(password);
                      setView('login');
                    }}
                  >
                    Proceed to Sign In &amp; Open Treasury Workstation →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
