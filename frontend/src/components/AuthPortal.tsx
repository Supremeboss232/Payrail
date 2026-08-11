import { useState } from 'react';
import { API_BASE_URL } from '../App';

type AuthPortalProps = {
  initialView: 'login' | 'register';
  onAuthSuccess: (token: string, user: any) => void;
  onNavigateHome: () => void;
};

type ConnectorType = 'http_callback' | 'web3_rpc';

const CONNECTOR_OPTIONS: { type: ConnectorType; icon: string; label: string; desc: string }[] = [
  {
    type: 'http_callback',
    icon: '🌐',
    label: 'REST API Webhook',
    desc: 'Connect to your core banking system via HTTP callback. Direct automated settlement.'
  },
  {
    type: 'web3_rpc',
    icon: '⚡',
    label: 'Web3 / Blockchain',
    desc: 'Settle via an EVM-compatible blockchain node (Ethereum, Polygon, Arbitrum, etc.).'
  }
];

export default function AuthPortal({ initialView, onAuthSuccess, onNavigateHome }: AuthPortalProps) {
  const [view, setView] = useState<'login' | 'wizard'>(initialView === 'register' ? 'wizard' : 'login');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Wizard state
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

  // Step 3
  const [connectorType, setConnectorType] = useState<ConnectorType>('http_callback');
  const [httpUrl, setHttpUrl] = useState('');
  const [httpMethod, setHttpMethod] = useState('POST');
  const [httpAuthHeader, setHttpAuthHeader] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');

  // Step 4 — live test
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latency_ms?: number } | null>(null);

  // Step 5 — result
  const [registered, setRegistered] = useState<any>(null);
  const [privateKey, setPrivateKey] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');
      onAuthSuccess(data.token, data.user);
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const validateBic = (v: string) => /^[A-Z0-9_]{4,20}$/.test(v.trim().toUpperCase());

  const handleBicChange = (v: string) => {
    const clean = v.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    setRoutingCode(clean);
    if (clean.length > 0 && !validateBic(clean)) {
      setBicError('BIC must be 4-20 uppercase letters, digits, or underscores.');
    } else {
      setBicError('');
    }
  };

  const step1Valid = legalName.trim().length >= 3 && validateBic(routingCode) && !bicError;
  const step2Valid = username.trim().length >= 3 && password.length >= 6 && password === confirmPassword;
  const step3Valid = (connectorType === 'http_callback' && httpUrl.startsWith('http'))
    || (connectorType === 'web3_rpc' && rpcUrl.startsWith('http'));

  const buildConnectorConfig = () => {
    if (connectorType === 'http_callback') {
      const headers: Record<string, string> = {};
      if (httpAuthHeader) headers['Authorization'] = httpAuthHeader;
      return { url: httpUrl, method: httpMethod, headers, body_template: { amount: '{{amount_dollars}}', currency: '{{currency}}', receiver: '{{destination}}' } };
    }
    if (connectorType === 'web3_rpc') {
      return { url: rpcUrl };
    }
    return null;
  };

  const handleTestConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const config = buildConnectorConfig();
      const res = await fetch(`${API_BASE_URL}/v1/banks/test_connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk_live_dev_key_12345' },
        body: JSON.stringify({ connector_type: connectorType, ...(config || {}) })
      });
      const data = await res.json();
      setTestResult(data);
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
      const config = buildConnectorConfig();
      const res = await fetch(`${API_BASE_URL}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_name: legalName.trim(),
          routing_code: routingCode.trim(),
          username: username.trim(),
          password,
          connector_type: connectorType,
          connector_config: config
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed.');
      setRegistered(data.tenant);
      setPrivateKey(data.private_key_pem);
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

  const goToLogin = () => {
    setView('login');
    setStep(1);
  };

  if (view === 'login') {
    return (
      <div className="auth-portal-bg">
        <div className="auth-card glass-card">
          <button className="auth-back-btn" onClick={onNavigateHome}>Back</button>
          <div className="auth-logo-row">
            <span style={{ fontSize: '2rem' }}>💳</span>
            <span className="auth-logo-text">Payrail</span>
          </div>
          <h2 className="auth-title">Clearinghouse Login</h2>
          <p className="auth-subtitle">Access your bank console</p>
          <form onSubmit={handleLogin} className="auth-form">
            <div className="auth-field">
              <label>Username</label>
              <input type="text" value={loginUsername} onChange={e => setLoginUsername(e.target.value)} placeholder="e.g. admin" required />
            </div>
            <div className="auth-field">
              <label>Password</label>
              <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            {loginError && <div className="auth-error">{loginError}</div>}
            <button type="submit" className="auth-btn-primary" disabled={loginLoading}>
              {loginLoading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
          <div className="auth-divider"><span>New to the network?</span></div>
          <button className="auth-btn-ghost" onClick={() => setView('wizard')}>Connect Your Bank</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-portal-bg">
      <div className="auth-card glass-card wizard-card">
        <button className="auth-back-btn" onClick={step > 1 && step < 5 ? () => setStep(s => s - 1) : onNavigateHome}>
          {step > 1 && step < 5 ? 'Back' : 'Home'}
        </button>

        {step < 5 && (
          <div className="wizard-progress">
            {[1,2,3,4].map(n => (
              <div key={n} className={`wizard-step-dot ${step >= n ? 'active' : ''} ${step > n ? 'done' : ''}`}>
                {step > n ? '✓' : n}
              </div>
            ))}
            <div className="wizard-progress-bar">
              <div className="wizard-progress-fill" style={{ width: `${((step - 1) / 3) * 100}%` }} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-step-content">
            <div className="wizard-step-header">
              <span className="wizard-step-icon">🏦</span>
              <h2>Institution Identity</h2>
              <p>Register your financial institution on the Payrail clearing network.</p>
            </div>
            <div className="auth-field">
              <label>Legal Institution Name</label>
              <input type="text" value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="e.g. First National Bank of Commerce" />
            </div>
            <div className="auth-field">
              <label>Routing BIC Code</label>
              <div className="bic-input-wrap">
                <input type="text" value={routingCode} onChange={e => handleBicChange(e.target.value)} placeholder="e.g. FNB_CORP_001" maxLength={20} style={{ letterSpacing: '0.08em', fontFamily: 'monospace' }} />
                {routingCode.length >= 4 && !bicError && <span className="bic-valid-badge">Valid</span>}
              </div>
              {bicError && <span className="field-error">{bicError}</span>}
              <span className="field-hint">4-20 uppercase letters, digits, or underscores. Your unique network identifier.</span>
            </div>
            <div className="auth-field">
              <label>Base Settlement Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="GBP">GBP - British Pound</option>
                <option value="NGN">NGN - Nigerian Naira</option>
                <option value="ZAR">ZAR - South African Rand</option>
                <option value="KES">KES - Kenyan Shilling</option>
              </select>
            </div>
            <button className="auth-btn-primary" disabled={!step1Valid} onClick={() => setStep(2)}>Continue</button>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-step-content">
            <div className="wizard-step-header">
              <span className="wizard-step-icon">🔐</span>
              <h2>Console Account</h2>
              <p>Create your institution operator login for the clearinghouse console.</p>
            </div>
            <div className="auth-field">
              <label>Console Admin Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. fnb_admin" autoComplete="off" />
            </div>
            <div className="auth-field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" />
            </div>
            <div className="auth-field">
              <label>Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" />
              {confirmPassword && password !== confirmPassword && <span className="field-error">Passwords do not match.</span>}
            </div>
            <div className="wizard-info-box">
              <span>🔑</span>
              <p>A <strong>Secp256k1 ECDSA key pair</strong> will be auto-generated for cryptographic signing. You will download the private key at the end — store it securely.</p>
            </div>
            <button className="auth-btn-primary" disabled={!step2Valid} onClick={() => setStep(3)}>Continue</button>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-step-content">
            <div className="wizard-step-header">
              <span className="wizard-step-icon">🔌</span>
              <h2>Core Banking Connector</h2>
              <p>How should Payrail communicate with your banking system?</p>
            </div>
            <div className="connector-cards">
              {CONNECTOR_OPTIONS.map(opt => (
                <button key={opt.type} className={`connector-card ${connectorType === opt.type ? 'selected' : ''}`} onClick={() => setConnectorType(opt.type)}>
                  <span className="connector-icon">{opt.icon}</span>
                  <span className="connector-label">{opt.label}</span>
                  <span className="connector-desc">{opt.desc}</span>
                  {connectorType === opt.type && <span className="connector-check">✓</span>}
                </button>
              ))}
            </div>
            {connectorType === 'http_callback' && (
              <div className="connector-config-fields">
                <div className="auth-field">
                  <label>Webhook Endpoint URL</label>
                  <input type="url" value={httpUrl} onChange={e => setHttpUrl(e.target.value)} placeholder="https://api.yourbank.com/v1/payouts" />
                </div>
                <div className="auth-field-row">
                  <div className="auth-field" style={{ flex: '0 0 120px' }}>
                    <label>Method</label>
                    <select value={httpMethod} onChange={e => setHttpMethod(e.target.value)}>
                      <option>POST</option><option>PUT</option><option>PATCH</option>
                    </select>
                  </div>
                  <div className="auth-field" style={{ flex: 1 }}>
                    <label>Authorization Header</label>
                    <input type="text" value={httpAuthHeader} onChange={e => setHttpAuthHeader(e.target.value)} placeholder="Bearer your_api_key_here" />
                  </div>
                </div>
                <div className="wizard-template-hint">
                  <strong>Template vars:</strong>
                  <code>{'{{amount_dollars}}'}</code>
                  <code>{'{{currency}}'}</code>
                  <code>{'{{destination}}'}</code>
                </div>
              </div>
            )}
            {connectorType === 'web3_rpc' && (
              <div className="connector-config-fields">
                <div className="auth-field">
                  <label>RPC Node URL</label>
                  <input type="url" value={rpcUrl} onChange={e => setRpcUrl(e.target.value)} placeholder="https://mainnet.infura.io/v3/your_project_id" />
                </div>
              </div>
            )}
            <button className="auth-btn-primary" disabled={!step3Valid} onClick={() => setStep(4)}>Continue</button>
          </div>
        )}

        {step === 4 && (
          <div className="wizard-step-content">
            <div className="wizard-step-header">
              <span className="wizard-step-icon">📡</span>
              <h2>Connection Test</h2>
              <p>Verify Payrail can reach your {connectorType === 'http_callback' ? 'webhook endpoint' : 'RPC node'} before going live.</p>
            </div>
            <div className="test-connection-panel">
              <div className="test-target">
                <div className="test-target-label">Target</div>
                <div className="test-target-value">
                  {connectorType === 'http_callback' && `🌐 ${httpUrl}`}
                  {connectorType === 'web3_rpc' && `⚡ ${rpcUrl}`}
                </div>
              </div>
              <button className="auth-btn-primary test-btn" onClick={handleTestConnection} disabled={testLoading}>
                {testLoading ? 'Testing...' : 'Run Connection Test'}
              </button>
              {testResult && (
                <div className={`test-result-card ${testResult.ok ? 'ok' : 'fail'}`}>
                  <div className="test-result-icon">{testResult.ok ? '✅' : '❌'}</div>
                  <div className="test-result-body">
                    <div className="test-result-status">{testResult.ok ? 'Connection Successful' : 'Connection Failed'}</div>
                    <div className="test-result-message">{testResult.message}</div>
                    {testResult.latency_ms !== undefined && testResult.latency_ms > 0 && (
                      <div className="test-result-latency">{testResult.latency_ms}ms latency</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="wizard-step-actions">
              <button className="auth-btn-ghost" onClick={handleRegister} disabled={regLoading}>Skip &amp; Activate</button>
              <button className="auth-btn-primary" onClick={handleRegister} disabled={regLoading || !testResult?.ok}>
                {regLoading ? 'Activating...' : 'Activate Bank'}
              </button>
            </div>
            {regError && <div className="auth-error">{regError}</div>}
          </div>
        )}

        {step === 5 && registered && (
          <div className="wizard-step-content">
            <div className="wizard-success-header">
              <div className="wizard-success-icon">🎉</div>
              <h2>Bank Connected Successfully</h2>
              <p><strong>{registered.legal_name}</strong> is now live on the Payrail network.</p>
            </div>
            <div className="wizard-summary-cards">
              <div className="summary-card"><div className="summary-label">Tenant ID</div><code className="summary-value">{registered.id}</code></div>
              <div className="summary-card"><div className="summary-label">Routing BIC</div><code className="summary-value">{registered.routing_code}</code></div>
              <div className="summary-card"><div className="summary-label">Clearing Account</div><code className="summary-value">{registered.clearing_account}</code></div>
              <div className="summary-card"><div className="summary-label">Connector</div><code className="summary-value">{registered.connector_type}</code></div>
              {registered.funding_source_id && (
                <div className="summary-card"><div className="summary-label">Funding Source</div><code className="summary-value">{registered.funding_source_id}</code></div>
              )}
            </div>
            <div className="wizard-key-warning">
              <div className="key-warning-icon">⚠️</div>
              <div>
                <strong>Download your private key — it will never be shown again.</strong>
                <p>This Secp256k1 ECDSA key is required to sign all payment intents. Store in a secure vault. Payrail does not retain a copy.</p>
              </div>
            </div>
            <button className="auth-btn-key" onClick={downloadPrivateKey}>Download Private Key PEM</button>
            <button className="auth-btn-primary" style={{ marginTop: '12px' }} onClick={goToLogin}>Enter Console</button>
          </div>
        )}
      </div>
    </div>
  );
}
