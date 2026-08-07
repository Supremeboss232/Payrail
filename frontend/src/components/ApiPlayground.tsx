import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

interface Account {
  id: string;
  name: string;
  currency: string;
}

interface FundingSource {
  id: string;
  name: string;
  type: string;
}

interface ApiPlaygroundProps {
  refreshTrigger: number;
  onApiExecuted: () => void;
  user?: any;
}

export default function ApiPlayground({ refreshTrigger, onApiExecuted, user }: ApiPlaygroundProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([]);
  const [apiKey, setApiKey] = useState('sk_live_dev_key_12345');

  // B2B Asymmetric Signing Credentials
  const [authMode, setAuthMode] = useState<'bearer' | 'b2b'>('bearer');
  const [b2bTenantId, setB2bTenantId] = useState(user?.tenant_id || '');
  const [privateKeyPem, setPrivateKeyPem] = useState('');

  // Input States
  const [intentAmount, setIntentAmount] = useState('2500'); // $25.00
  const [intentCurrency, setIntentCurrency] = useState('USD');
  const [destinationAccount, setDestinationAccount] = useState('');
  
  const [confirmIntentId, setConfirmIntentId] = useState('');
  const [confirmFundingSource, setConfirmFundingSource] = useState('');

  // Response States
  const [curlCommand, setCurlCommand] = useState('');
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseBody, setResponseBody] = useState<any>(null);
  const [pacsXml, setPacsXml] = useState<string | null>(null);
  const [routingLogs, setRoutingLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [signingError, setSigningError] = useState<string | null>(null);

  // Sync user tenant on load
  useEffect(() => {
    if (user?.tenant_id) {
      setB2bTenantId(user.tenant_id);
      setAuthMode('b2b');
    }
  }, [user]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [accsRes, fsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/console/accounts`),
          fetch(`${API_BASE_URL}/console/funding_sources`),
        ]);

        if (accsRes.ok && fsRes.ok) {
          const accs = await accsRes.json();
          setAccounts(accs);
          setFundingSources(await fsRes.json());
          if (accs.length > 0) {
            setDestinationAccount(accs[0].id);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchData();
  }, [refreshTrigger]);

  const handleCreateIntent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResponseStatus(null);
    setResponseBody(null);
    setPacsXml(null);
    setRoutingLogs([]);

    const body = {
      amount: parseInt(intentAmount),
      currency: intentCurrency,
      destination_account_id: destinationAccount,
      metadata: { order_id: 'order_9831', customer_email: 'finance@startup.io' },
    };

    const headers: any = {
      'Content-Type': 'application/json'
    };

    if (authMode === 'bearer') {
      headers['Authorization'] = `Bearer ${apiKey}`;
      const curl = `curl -X POST ${API_BASE_URL}/v1/payments/payment_intents \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'`;
      setCurlCommand(curl);
    } else {
      // B2B routing doesn't require Bearer tokens for intent creation, just standard B2B checks or Bearer bypass
      headers['Authorization'] = `Bearer sk_live_dev_key_12345`; // Dev key fallback for intent creation
      const curl = `curl -X POST ${API_BASE_URL}/v1/payments/payment_intents \\\n  -H "Authorization: Bearer sk_live_dev_key_12345" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'`;
      setCurlCommand(curl);
    }

    try {
      const res = await fetch(`${API_BASE_URL}/v1/payments/payment_intents`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      setResponseStatus(res.status);
      const data = await res.json();
      setResponseBody(data);

      if (res.ok && data.id) {
        setConfirmIntentId(data.id);
      }
      onApiExecuted();
    } catch (err: any) {
      setResponseBody({ error: err.message || 'API call failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmIntent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmIntentId) return;

    setLoading(true);
    setResponseStatus(null);
    setResponseBody(null);
    setPacsXml(null);
    setRoutingLogs([]);
    setSigningError(null);

    const payload: any = {};
    if (confirmFundingSource) {
      payload.funding_source_id = confirmFundingSource;
    }

    const headers: any = {
      'Content-Type': 'application/json'
    };

    let curl = '';

    if (authMode === 'bearer') {
      headers['Authorization'] = `Bearer ${apiKey}`;
      curl = `curl -X POST ${API_BASE_URL}/v1/payments/payment_intents/${confirmIntentId}/confirm \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(payload, null, 2)}'`;
      setCurlCommand(curl);

      try {
        const res = await fetch(`${API_BASE_URL}/v1/payments/payment_intents/${confirmIntentId}/confirm`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        setResponseStatus(res.status);
        const data = await res.json();
        setResponseBody(data);

        if (data.routing_logs) setRoutingLogs(data.routing_logs);
        if (data.pacs_msg) setPacsXml(data.pacs_msg);
        onApiExecuted();
      } catch (err: any) {
        setResponseBody({ error: err.message || 'API call failed' });
      } finally {
        setLoading(false);
      }
    } else {
      // B2B Asymmetric Cryptography Signed Confirm Flow
      if (!privateKeyPem) {
        setSigningError('You must provide your Secp256k1 Private Key PEM to sign B2B request.');
        setLoading(false);
        return;
      }

      try {
        // 1. Request signature from signing helper
        const signRes = await fetch(`${API_BASE_URL}/v1/auth/sign_payload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ privateKeyPem, payload })
        });
        
        if (!signRes.ok) {
          const signErrData = await signRes.json();
          throw new Error(signErrData.error || 'Failed to sign confirm request payload.');
        }

        const { timestamp, signature } = await signRes.json();

        headers['Payrail-Tenant-Id'] = b2bTenantId;
        headers['Payrail-Signature'] = `t=${timestamp},v1=${signature}`;

        curl = `curl -X POST ${API_BASE_URL}/v1/payments/payment_intents/${confirmIntentId}/confirm \\\n  -H "Payrail-Tenant-Id: ${b2bTenantId}" \\\n  -H "Payrail-Signature: t=${timestamp},v1=${signature}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(payload, null, 2)}'`;
        setCurlCommand(curl);

        // 2. Perform Confirm
        const res = await fetch(`${API_BASE_URL}/v1/payments/payment_intents/${confirmIntentId}/confirm`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        setResponseStatus(res.status);
        const data = await res.json();
        setResponseBody(data);

        if (data.routing_logs) setRoutingLogs(data.routing_logs);
        if (data.pacs_msg) setPacsXml(data.pacs_msg);
        onApiExecuted();
      } catch (err: any) {
        setResponseBody({ error: err.message || 'B2B API Confirm failed' });
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="grid-main-aside" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
      
      {/* Left panel: Forms for API calls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Auth Config */}
        <div className="glass-panel">
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Gateway Authorization Mode</h3>
          
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <button 
              className={`btn ${authMode === 'bearer' ? 'btn-nav-primary' : 'btn-nav-secondary'}`}
              type="button"
              style={{ flex: 1, padding: '8px 12px', fontSize: '12px' }}
              onClick={() => setAuthMode('bearer')}
            >
              Bearer API Token
            </button>
            <button 
              className={`btn ${authMode === 'b2b' ? 'btn-nav-primary' : 'btn-nav-secondary'}`}
              type="button"
              style={{ flex: 1, padding: '8px 12px', fontSize: '12px' }}
              onClick={() => setAuthMode('b2b')}
            >
              Asymmetric Secp256k1 Signature (B2B)
            </button>
          </div>

          {authMode === 'bearer' ? (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Private Bearer Secret Key</label>
              <input 
                type="text" 
                className="form-input" 
                style={{ fontFamily: 'var(--font-mono)' }}
                value={apiKey} 
                onChange={e => setApiKey(e.target.value)} 
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tenant ID (BIC Shard Boundary)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  style={{ fontFamily: 'var(--font-mono)' }}
                  placeholder="e.g. 019f94e4-30d0-..."
                  value={b2bTenantId} 
                  onChange={e => setB2bTenantId(e.target.value)} 
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Private Key PEM (Required to calculate ECDSA signatures)</label>
                <textarea 
                  className="form-input" 
                  style={{ fontFamily: 'var(--font-mono)', height: '100px', fontSize: '11px', resize: 'none' }}
                  placeholder="-----BEGIN PRIVATE KEY-----\nMGECAQEGCSqGSIb3DQEHATAoBggqhkjOPQMEAjAXBgcqhkjOPQIBBggqhkjOPQMBQwUGAyt0AAYE..."
                  value={privateKeyPem} 
                  onChange={e => setPrivateKeyPem(e.target.value)} 
                />
              </div>
              {signingError && <div className="text-red" style={{ fontSize: '12px' }}>⚠️ {signingError}</div>}
            </div>
          )}
        </div>

        {/* Create Payment Intent */}
        <div className="glass-panel">
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Endpoint: Create Payment Intent</h3>
          <form onSubmit={handleCreateIntent} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="grid-3">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Amount (Cents)</label>
                <input type="number" className="form-input" value={intentAmount} onChange={e => setIntentAmount(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Currency</label>
                <select className="form-select" value={intentCurrency} onChange={e => setIntentCurrency(e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Recipient Account</label>
                <select className="form-select" value={destinationAccount} onChange={e => setDestinationAccount(e.target.value)}>
                  {accounts.map((a, idx) => (
                    <option key={`${a.id}-${idx}`} value={a.id}>{a.name} ({a.currency})</option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" className="button" disabled={loading}>
              Create Payment Intent
            </button>
          </form>
        </div>

        {/* Confirm Payment Intent */}
        <div className="glass-panel">
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Endpoint: Confirm & Execute Transfer</h3>
          <form onSubmit={handleConfirmIntent} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="grid-2">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Payment Intent ID</label>
                <input 
                  type="text" 
                  className="form-input" 
                  style={{ fontFamily: 'var(--font-mono)' }}
                  placeholder="pi_..." 
                  value={confirmIntentId} 
                  onChange={e => setConfirmIntentId(e.target.value)} 
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Force Funding Source (Optional)</label>
                <select className="form-select" value={confirmFundingSource} onChange={e => setConfirmFundingSource(e.target.value)}>
                  <option value="">Use Global Priority order (Failover Swap)</option>
                  {fundingSources.map((fs, idx) => (
                    <option key={`${fs.id}-${idx}`} value={fs.id}>{fs.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" className="button" disabled={!confirmIntentId || loading}>
              Confirm Payment Intent
            </button>
          </form>
        </div>

      </div>

      {/* Right panel: Live API logs, cURL, and responses */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', flexGrow: 1, minHeight: '550px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600 }}>API Terminal Inspector</h3>
            {responseStatus && (
              <span className={`badge ${responseStatus >= 200 && responseStatus < 300 ? 'badge-success' : 'badge-danger'}`}>
                HTTP {responseStatus}
              </span>
            )}
          </div>

          {/* cURL Command Codeblock */}
          {curlCommand && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>REQUEST CURL COMMAND:</div>
              <pre className="code-block" style={{ fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {curlCommand}
              </pre>
            </div>
          )}

          {/* Failover / Swapping logs */}
          {routingLogs.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>GATEWAY ROUTING & SWAP LOGS:</div>
              <div style={{ 
                padding: '12px', 
                borderRadius: '8px', 
                background: 'rgba(245, 158, 11, 0.05)', 
                border: '1px solid rgba(245, 158, 11, 0.1)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)'
              }}>
                {routingLogs.map((log, i) => (
                  <div key={i} style={{ color: log.includes('succeeded') ? 'var(--accent-green)' : log.includes('failed') ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>
                    {log.includes('succeeded') ? '✅' : log.includes('failed') ? '⚠️' : '⚡'} {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ISO 20022 PACs XML payload */}
          {pacsXml && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--secondary)', marginBottom: '4px', fontWeight: 600 }}>GENERATED ISO 20022 PACS.008 MESSAGE XML:</div>
              <pre className="code-block" style={{ fontSize: '11px', whiteSpace: 'pre-wrap', maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--secondary-glow)', color: 'var(--secondary)' }}>
                {pacsXml}
              </pre>
            </div>
          )}

          {/* HTTP JSON Response */}
          <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>RESPONSE PAYLOAD JSON:</div>
            <pre className="code-block" style={{ flexGrow: 1, overflowY: 'auto', fontSize: '12px' }}>
              {responseBody ? JSON.stringify(responseBody, null, 2) : '// Execute an API action to inspect response payloads.'}
            </pre>
          </div>
        </div>

      </div>

    </div>
  );
}
