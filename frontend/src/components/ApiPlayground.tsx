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
}

export default function ApiPlayground({ refreshTrigger, onApiExecuted }: ApiPlaygroundProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([]);
  const [apiKey, setApiKey] = useState('sk_live_dev_key_12345');

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
  const [routingLogs, setRoutingLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [accsRes, fsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/console/accounts`),
          fetch(`${API_BASE_URL}/v1/funding_sources`),
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
    setRoutingLogs([]);

    const body = {
      amount: parseInt(intentAmount),
      currency: intentCurrency,
      destination_account_id: destinationAccount,
      metadata: { order_id: 'order_9831', customer_email: 'finance@startup.io' },
    };

    const curl = `curl -X POST ${API_BASE_URL}/v1/payment_intents \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'`;
    setCurlCommand(curl);

    try {
      const res = await fetch(`${API_BASE_URL}/v1/payment_intents`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
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
    setRoutingLogs([]);

    const body: any = {};
    if (confirmFundingSource) {
      body.funding_source_id = confirmFundingSource;
    }

    const curl = `curl -X POST ${API_BASE_URL}/v1/payment_intents/${confirmIntentId}/confirm \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'`;
    setCurlCommand(curl);

    try {
      const res = await fetch(`${API_BASE_URL}/v1/payment_intents/${confirmIntentId}/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      setResponseStatus(res.status);
      const data = await res.json();
      setResponseBody(data);

      if (data.routing_logs) {
        setRoutingLogs(data.routing_logs);
      }
      onApiExecuted();
    } catch (err: any) {
      setResponseBody({ error: err.message || 'API call failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid-main-aside" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
      
      {/* Left panel: Forms for API calls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Auth Config */}
        <div className="glass-panel">
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>Authentication Credentials</h3>
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
                <label className="form-label">Recipient Wallet</label>
                <select className="form-select" value={destinationAccount} onChange={e => setDestinationAccount(e.target.value)}>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
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
                  {fundingSources.map(fs => (
                    <option key={fs.id} value={fs.id}>{fs.name}</option>
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
        
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', flexGrow: 1, minHeight: '400px' }}>
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
