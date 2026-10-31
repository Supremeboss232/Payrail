import { useState } from 'react';
import { API_BASE_URL } from '../App';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

type AuthPortalProps = {
  initialView: 'login' | 'register';
  onAuthSuccess: (token: string, user: any) => void;
  onNavigateHome: () => void;
};

type ConnectorType = 'http_callback' | 'web3_rpc';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'ZAR', 'KES', 'GHS'];

const STEPS = [
  { n: 1, label: 'Institution' },
  { n: 2, label: 'Credentials' },
  { n: 3, label: 'Connector' },
  { n: 4, label: 'Verify' },
];

export default function AuthPortal({ initialView, onAuthSuccess, onNavigateHome }: AuthPortalProps) {
  const [view, setView] = useState<'login' | 'wizard' | 'forgot'>(initialView === 'register' ? 'wizard' : 'login');

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

  // ── Validation ──
  const validateBic = (v: string) => /^[A-Z0-9_]{4,20}$/.test(v.trim().toUpperCase());
  const handleBicChange = (v: string) => {
    const clean = v.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    setRoutingCode(clean);
    setBicError(clean.length > 0 && !validateBic(clean) ? 'BIC must be 4–20 uppercase letters, digits, or underscores.' : '');
  };

  const step1Valid = legalName.trim().length >= 3 && validateBic(routingCode) && !bicError;
  const step2Valid = username.trim().length >= 3 && password.length >= 6 && password === confirmPassword;
  const step3Valid = (connectorType === 'http_callback' && httpUrl.startsWith('http')) ||
    (connectorType === 'web3_rpc' && rpcUrl.startsWith('http'));

  // ── Handlers ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(''); setLoginLoading(true);
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
    if (!fpUser.trim()) { setFpError('Please enter your username.'); return; }
    setFpLoading(true); setFpError(''); setFpMsg('');
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
          setFpMsg('Reset token generated and auto-filled below (in-network mode). Enter your new password to complete reset.');
        } else {
          setFpMsg(data.message || 'Reset link sent.');
        }
      } else {
        if (!fpAnswer.trim()) { setFpError('Please enter your security question answer.'); setFpLoading(false); return; }
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
    setFpLoading(true); setFpError('');
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
      }, 1500);
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
      return { url: httpUrl, method: httpMethod, headers };
    }
    if (connectorType === 'web3_rpc') return { url: rpcUrl };
    return null;
  };

  const handleTestConnection = async () => {
    setTestLoading(true); setTestResult(null);
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
    setRegLoading(true); setRegError('');
    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_name: legalName.trim(),
          routing_code: routingCode.trim(),
          username: username.trim(),
          password,
          connector_type: connectorType,
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
    a.href = url; a.download = `${routingCode.toLowerCase()}_private_key.pem`; a.click();
    URL.revokeObjectURL(url);
  };

  const cardSx = { p: 3, borderRadius: 2, bgcolor: 'background.paper', position: 'relative' } as const;

  // ────────────────────────────────────────────── FORGOT PASSWORD VIEW ──
  if (view === 'forgot') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '85vh', p: 2 }}>
        <Paper sx={{ ...cardSx, width: 460 }} elevation={6} className="animate-fade-in">
          <Button onClick={() => setView('login')} variant="text" sx={{ mb: 1 }}>← Back to Sign In</Button>
          <Box component="h2" sx={{ m: 0, mb: 0.5 }}>Account Recovery</Box>
          <Box sx={{ color: 'text.secondary', fontSize: 13, mb: 2.5 }}>
            Reset your portal password via reset token or security question verification.
          </Box>

          <Box sx={{ display: 'flex', gap: 1, mb: 2.5 }}>
            <Button
              variant={resetMode === 'token' ? 'contained' : 'outlined'}
              size="small"
              onClick={() => { setResetMode('token'); setFpError(''); setFpMsg(''); }}
              sx={{ flex: 1 }}
            >
              🔑 Reset Token
            </Button>
            <Button
              variant={resetMode === 'security_question' ? 'contained' : 'outlined'}
              size="small"
              onClick={() => { setResetMode('security_question'); setFpError(''); setFpMsg(''); }}
              sx={{ flex: 1 }}
            >
              🛡️ Security Question
            </Button>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Username"
              value={fpUser}
              onChange={e => setFpUser(e.target.value)}
              fullWidth
              size="small"
            />

            {resetMode === 'security_question' && (
              <TextField
                label="Security Question Answer"
                value={fpAnswer}
                onChange={e => setFpAnswer(e.target.value)}
                fullWidth
                size="small"
              />
            )}

            <Button variant="outlined" onClick={handleRequestResetToken} disabled={fpLoading}>
              {fpLoading ? 'Verifying…' : resetMode === 'token' ? 'Generate / Send Reset Token' : 'Verify Security Answer'}
            </Button>

            {fpMsg && <Alert severity="success">{fpMsg}</Alert>}
            {fpError && <Alert severity="error">{fpError}</Alert>}

            <Box component="form" onSubmit={handleCompleteReset} sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1, pt: 2, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <TextField
                label="Reset Token"
                value={fpToken}
                onChange={e => setFpToken(e.target.value)}
                placeholder="Paste reset token here"
                fullWidth
                size="small"
              />
              <TextField
                label="New Password (min 8 chars)"
                type="password"
                value={fpNewPass}
                onChange={e => setFpNewPass(e.target.value)}
                fullWidth
                size="small"
              />
              <Button type="submit" variant="contained" disabled={fpLoading || !fpToken}>
                Update Password →
              </Button>
            </Box>
          </Box>
        </Paper>
      </Box>
    );
  }

  // ────────────────────────────────────────────── LOGIN VIEW ──
  if (view === 'login') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '85vh', p: 2 }}>
        <Paper sx={cardSx} elevation={6} className="animate-fade-in">
          <Button onClick={onNavigateHome} variant="text" sx={{ mb: 1 }}>← Home</Button>

          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Box sx={{ width: 52, height: 52, borderRadius: 2, bgcolor: 'primary.main', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, mb: 1 }}>⚡</Box>
            <Box component="h2" sx={{ m: 0, mb: 0.5 }}>Welcome back</Box>
            <Box sx={{ color: 'text.secondary', fontSize: 13 }}>Sign in to your Payrail Clearinghouse or Member Bank portal</Box>
          </Box>

          <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: { xs: '100%', sm: 400 } }}>
            <TextField label="Username" value={loginUser} onChange={e => setLoginUser(e.target.value)} required autoFocus autoComplete="username" />

            <TextField
              label="Password"
              type={showPass ? 'text' : 'password'}
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              required
              autoComplete="current-password"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPass(s => !s)} edge="end">
                      {showPass ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <Button variant="text" size="small" onClick={() => setView('forgot')} sx={{ fontSize: 12 }}>
                Forgot password?
              </Button>
            </Box>

            {loginError && <Alert severity="error">{loginError}</Alert>}

            <Button type="submit" variant="contained" disabled={loginLoading} sx={{ py: 1.5 }}>
              {loginLoading ? <><CircularProgress size={18} sx={{ mr: 1 }} /> Signing in…</> : 'Sign In →'}
            </Button>
          </Box>

          <Box sx={{ textAlign: 'center', mt: 3, borderTop: 1, borderColor: 'divider', pt: 2 }}>
            <Box sx={{ color: 'text.secondary', fontSize: 13 }}>New institution?{' '}
              <Button variant="text" onClick={() => { setView('wizard'); setStep(1); }} sx={{ fontWeight: 700 }}>Join the network</Button>
            </Box>
          </Box>
        </Paper>
      </Box>
    );
  }

  // ────────────────────────────────────────────── WIZARD VIEW ──
  return (
    <div className="auth-root" style={{ alignItems: 'flex-start', paddingTop: 40 }}>
      <div className="auth-card auth-card-wide animate-fade-in">
        {/* Back */}
        <Button
          onClick={step > 1 && step < 5 ? () => setStep(s => s - 1) : onNavigateHome}
          variant="text"
          sx={{ position: 'absolute', top: 20, left: 20 }}
        >
          ← {step > 1 && step < 5 ? 'Back' : 'Home'}
        </Button>

        {/* Header */}
        {step < 5 && (
          <div style={{ textAlign: 'center', marginBottom: 36, paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Partner Onboarding
            </div>
            <h2 style={{ marginBottom: 0 }}>Connect Your Institution</h2>
          </div>
        )}

        {/* Progress track */}
        {step < 5 && (
          <div className="wizard-track" style={{ marginBottom: 36 }}>
            {STEPS.map((s, i) => (
              <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div className={`wizard-step-node ${step > s.n ? 'done' : step === s.n ? 'current' : 'pending'}`}>
                    {step > s.n ? '✓' : s.n}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: step >= s.n ? 'var(--text-1)' : 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`wizard-connector ${step > s.n ? 'done' : ''}`} style={{ margin: '0 8px', marginBottom: 24 }} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── STEP 1: Institution Identity ── */}
        {step === 1 && (
          <Box sx={{ ...cardSx }} className="animate-fade-in">
            <Box sx={{ mb: 2 }}>
              <Box sx={{ fontSize: 28, mb: 1 }}>🏢</Box>
              <Box component="h3" sx={{ mb: 1 }}>Institution Identity</Box>
              <Box sx={{ color: 'text.secondary' }}>Register your financial institution on the Payrail clearing network.</Box>
            </Box>

            <TextField label="Legal Institution Name" placeholder="First National Bank of Commerce" value={legalName} onChange={e => setLegalName(e.target.value)} fullWidth sx={{ mb: 2 }} />

            <Box sx={{ position: 'relative', mb: 2 }}>
              <TextField
                label="Routing BIC Code"
                placeholder="FNB_CORP_001"
                value={routingCode}
                onChange={e => handleBicChange(e.target.value)}
                inputProps={{ maxLength: 20, sx: { fontFamily: 'monospace', letterSpacing: '0.08em' } }}
                fullWidth
              />
              {routingCode.length >= 4 && !bicError && (
                <Box sx={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', px: 1, py: '2px', borderRadius: 2, bgcolor: 'success.light', color: 'success.main', fontSize: 11, fontWeight: 800 }}>VALID</Box>
              )}
              {bicError && <Box sx={{ color: 'error.main', mt: 1 }}>{bicError}</Box>}
              <Box sx={{ color: 'text.secondary', mt: 1, fontSize: 12 }}>4–20 uppercase letters, digits, or underscores. Your unique network identifier.</Box>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Select value={currency} onChange={e => setCurrency(e.target.value)} fullWidth>
                {CURRENCIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </Select>
            </Box>

            <Button variant="contained" disabled={!step1Valid} onClick={() => setStep(2)} fullWidth>Continue →</Button>
          </Box>
        )}

        {/* ── STEP 2: Console Credentials ── */}
        {step === 2 && (
          <Box sx={{ ...cardSx }} className="animate-fade-in">
            <Box sx={{ mb: 2 }}>
              <Box sx={{ fontSize: 28, mb: 1 }}>🔐</Box>
              <Box component="h3" sx={{ mb: 1 }}>Portal Credentials</Box>
              <Box sx={{ color: 'text.secondary' }}>Create your admin login for the Payrail Partner Portal.</Box>
            </Box>

            <TextField label="Admin Username" placeholder="fnb_admin" value={username} onChange={e => setUsername(e.target.value)} fullWidth sx={{ mb: 2 }} />

            <TextField
              label="Password"
              type={showWizPass ? 'text' : 'password'}
              placeholder="Minimum 6 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
              fullWidth
              InputProps={{ endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowWizPass(s => !s)} edge="end">{showWizPass ? <VisibilityOff /> : <Visibility />}</IconButton>
                </InputAdornment>
              ) }}
              sx={{ mb: 2 }}
            />

            <TextField label="Confirm Password" type="password" placeholder="Re-enter password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} fullWidth sx={{ mb: 2 }} />
            {confirmPassword && password !== confirmPassword && <Box sx={{ color: 'error.main', mb: 2 }}>Passwords do not match.</Box>}

            <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Box>🔑</Box>
                <Box sx={{ color: 'text.secondary' }}>A <strong style={{ color: '#6b46ff' }}>Secp256k1 ECDSA key pair</strong> and <strong style={{ color: '#06b6d4' }}>Gateway API Key</strong> will be auto-generated. You'll download them at the end.</Box>
              </Box>
            </Paper>

            <Button variant="contained" disabled={!step2Valid} onClick={() => setStep(3)} fullWidth>Continue →</Button>
          </Box>
        )}

        {/* ── STEP 3: Connector ── */}
        {step === 3 && (
          <Box sx={{ ...cardSx }} className="animate-fade-in">
            <Box sx={{ mb: 2 }}>
              <Box sx={{ fontSize: 28, mb: 1 }}>🔌</Box>
              <Box component="h3" sx={{ mb: 1 }}>Core Banking Connector</Box>
              <Box sx={{ color: 'text.secondary' }}>How should Payrail communicate with your banking system?</Box>
            </Box>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              {[
                { type: 'http_callback' as ConnectorType, icon: '🌐', label: 'REST Webhook', desc: 'HTTP callback to your core banking system' },
                { type: 'web3_rpc' as ConnectorType,     icon: '⛓️', label: 'Web3 / RPC',  desc: 'EVM-compatible blockchain node (Ethereum, Polygon…)' },
              ].map(opt => (
                <Grid item xs={12} md={6} key={opt.type}>
                  <Paper onClick={() => setConnectorType(opt.type)} sx={{ p: 2, cursor: 'pointer', border: connectorType === opt.type ? 2 : 1, borderColor: connectorType === opt.type ? 'primary.main' : 'divider' }}>
                    <Box sx={{ fontSize: 20 }}>{opt.icon}</Box>
                    <Box sx={{ fontWeight: 700 }}>{opt.label}</Box>
                    <Box sx={{ color: 'text.secondary' }}>{opt.desc}</Box>
                  </Paper>
                </Grid>
              ))}
            </Grid>

            {connectorType === 'http_callback' && (
              <Box sx={{ p: 2, borderRadius: 1, border: 1, borderColor: 'divider', mb: 2 }}>
                <TextField label="Webhook Endpoint URL" placeholder="https://api.yourbank.com/v1/payouts" value={httpUrl} onChange={e => setHttpUrl(e.target.value)} fullWidth sx={{ mb: 2 }} />
                <Grid container spacing={2}>
                  <Grid item xs={12} md={3}>
                    <Select value={httpMethod} onChange={e => setHttpMethod(e.target.value)} fullWidth>
                      <MenuItem value="POST">POST</MenuItem>
                      <MenuItem value="PUT">PUT</MenuItem>
                      <MenuItem value="PATCH">PATCH</MenuItem>
                    </Select>
                  </Grid>
                  <Grid item xs={12} md={9}>
                    <TextField label="Authorization Header" placeholder="Bearer your_api_key" value={httpAuthHeader} onChange={e => setHttpAuthHeader(e.target.value)} fullWidth />
                  </Grid>
                </Grid>
              </Box>
            )}

            {connectorType === 'web3_rpc' && (
              <TextField label="RPC Node URL" placeholder="https://mainnet.infura.io/v3/your_project_id" value={rpcUrl} onChange={e => setRpcUrl(e.target.value)} fullWidth sx={{ mb: 2 }} />
            )}

            <Button variant="contained" disabled={!step3Valid} onClick={() => setStep(4)} fullWidth>Continue →</Button>
          </Box>
        )}

        {/* ── STEP 4: Test & Activate ── */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} className="animate-fade-in">
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>📡</div>
              <h3 style={{ marginBottom: 6 }}>Connection Test</h3>
              <p style={{ fontSize: 13 }}>Verify Payrail can reach your {connectorType === 'http_callback' ? 'webhook endpoint' : 'RPC node'} before going live.</p>
            </div>

            <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: 'divider' }}>
              <Box sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', mb: 1 }}>Target</Box>
              <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: 13, color: 'primary.main', whiteSpace: 'pre-wrap' }}>{connectorType === 'http_callback' ? httpUrl : rpcUrl}</Box>
            </Paper>

            <Button variant="outlined" onClick={handleTestConnection} disabled={testLoading} fullWidth sx={{ mb: 2 }}>{testLoading ? <CircularProgress size={18} /> : '▶ Run Connection Test'}</Button>

            {testResult && (
              <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ fontWeight: 700 }}>{testResult.ok ? 'Connection Successful' : 'Connection Failed'}</Box>
                  {testResult.latency_ms && <Box sx={{ ml: 'auto', fontSize: 12, color: 'text.secondary' }}>{testResult.latency_ms}ms</Box>}
                </Box>
                <Box>{testResult.message}</Box>
              </Alert>
            )}

            {regError && <Alert severity="error" sx={{ mb: 2 }}>{regError}</Alert>}

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button variant="outlined" onClick={handleRegister} disabled={regLoading} sx={{ flex: 1 }}>Skip Test & Activate</Button>
              <Button variant="contained" onClick={handleRegister} disabled={regLoading} sx={{ flex: 2 }}>{regLoading ? <CircularProgress size={18} /> : '🏢 Activate Institution →'}</Button>
            </Box>
          </div>
        )}

        {/* ── STEP 5: Success ── */}
        {step === 5 && registered && (
          <Box sx={{ ...cardSx, textAlign: 'center' }} className="animate-fade-in">
            <Box sx={{ fontSize: 48, mb: 1 }}>🎉</Box>
            <Box component="h2" sx={{ mb: 1 }}>Institution Activated!</Box>
            <Box sx={{ color: 'text.secondary', mb: 2 }}><strong>{registered.legal_name}</strong> is now live on the Payrail network with all 9 BaaS services enabled.</Box>

            <Grid container spacing={2} sx={{ textAlign: 'left', mb: 2 }}>
              {[
                { label: 'Tenant ID',        value: registered.id },
                { label: 'Routing BIC',      value: registered.routing_code },
                { label: 'Clearing Account', value: registered.clearing_account },
                { label: 'Gateway API Key',  value: gatewayKey || 'Saved to browser' },
              ].filter(i => i.value).map(item => (
                <Grid item xs={12} md={6} key={item.label}>
                  <Paper sx={{ p: 2 }}>
                    <Box sx={{ fontSize: 10, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', mb: 1 }}>{item.label}</Box>
                    <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: 12, color: 'primary.main', whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0 }}>{item.value}</Box>
                  </Paper>
                </Grid>
              ))}
            </Grid>

            <Paper sx={{ p: 2, mb: 2, bgcolor: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)' }}>
              <Box sx={{ display: 'flex', gap: 2, textAlign: 'left' }}>
                <Box sx={{ fontSize: 20 }}>⚠️</Box>
                <Box>
                  <Box sx={{ fontWeight: 700, color: '#fbbf24', mb: 0.5 }}>Download your ECDSA private key now</Box>
                  <Box sx={{ color: 'text.secondary', fontSize: 12.5 }}>This Secp256k1 ECDSA key is required to sign all interbank payment intents. Store it in a secure vault — Payrail only stores your public key.</Box>
                </Box>
              </Box>
            </Paper>

            <Button onClick={downloadPrivateKey} variant="outlined" fullWidth sx={{ mb: 1.5 }}>⬇️ Download Private Key (.pem)</Button>
            <Button variant="contained" color="primary" onClick={() => { setLoginUser(username); setLoginPass(password); setView('login'); }} fullWidth>Proceed to Sign In →</Button>
          </Box>
        )}
      </div>
    </div>
  );
}
