import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  status: string;
  created_at: string;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string;
  status: string;
}

interface WebhookLog {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: string;
  response_status: number | null;
  response_body: string | null;
  delivered_at: string;
}

interface KeysAndWebhooksTabProps {
  refreshTrigger: number;
}

export default function KeysAndWebhooksTab({ refreshTrigger }: KeysAndWebhooksTabProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Forms
  const [keyName, setKeyName] = useState('');
  const [newRawKey, setNewRawKey] = useState<string | null>(null);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState('payment_intent.succeeded');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [keysRes, epsRes, logsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/console/api_keys`),
          fetch(`${API_BASE_URL}/console/webhook_endpoints`),
          fetch(`${API_BASE_URL}/console/webhook_logs`),
        ]);

        if (keysRes.ok && epsRes.ok && logsRes.ok) {
          setKeys(await keysRes.json());
          setEndpoints(await epsRes.json());
          setLogs(await logsRes.json());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [refreshTrigger]);

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE_URL}/console/api_keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName }),
      });

      if (res.ok) {
        const data = await res.json();
        setNewRawKey(data.rawKey);
        setKeyName('');
        // Refresh key list
        const keysRes = await fetch(`${API_BASE_URL}/console/api_keys`);
        if (keysRes.ok) setKeys(await keysRes.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? Apps using it will immediately fail.')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/console/api_keys/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setKeys(keys.map(k => k.id === id ? { ...k, status: 'revoked' } : k));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookUrl) return;

    try {
      const res = await fetch(`${API_BASE_URL}/console/webhook_endpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          events: [webhookEvents],
        }),
      });

      if (res.ok) {
        setWebhookUrl('');
        // Refresh endpoints
        const epsRes = await fetch(`${API_BASE_URL}/console/webhook_endpoints`);
        if (epsRes.ok) setEndpoints(await epsRes.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Delete this webhook subscription?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/console/webhook_endpoints/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setEndpoints(endpoints.filter(ep => ep.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading keys and webhook dashboards...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      
      {/* API Keys Section */}
      <div className="grid-main-aside">
        <div className="glass-panel">
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Active API Secret Keys</h3>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key Prefix</th>
                  <th>Status</th>
                  <th>Created At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td><code style={{ fontFamily: 'var(--font-mono)' }}>{k.prefix}••••••••</code></td>
                    <td>
                      <span className={`badge ${k.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                        {k.status}
                      </span>
                    </td>
                    <td>{new Date(k.created_at).toLocaleDateString()}</td>
                    <td>
                      {k.status === 'active' && (
                        <button className="button button-secondary button-danger" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => handleRevokeKey(k.id)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Create API Key</h3>
          <form onSubmit={handleGenerateKey}>
            <div className="form-group">
              <label className="form-label">Key Label / Name</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. Logistics Backend App" 
                value={keyName}
                onChange={e => setKeyName(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="button">Generate Live Key</button>
          </form>

          {newRawKey && (
            <div style={{ 
              marginTop: '16px', 
              padding: '16px', 
              borderRadius: '8px', 
              background: 'rgba(34, 197, 94, 0.1)', 
              border: '1px solid rgba(34, 197, 94, 0.2)' 
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-green)', marginBottom: '8px' }}>
                ⚠️ SAVE THIS KEY (ONLY SHOWN ONCE):
              </div>
              <code style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all', fontSize: '13px', display: 'block', padding: '8px', background: '#000', borderRadius: '4px' }}>
                {newRawKey}
              </code>
            </div>
          )}
        </div>
      </div>

      {/* Webhooks Section */}
      <div className="grid-main-aside">
        <div className="glass-panel">
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Webhook Subscriptions</h3>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Target URL</th>
                  <th>Secret</th>
                  <th>Subscribed Events</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--text-muted)' }}>No webhook urls registered.</td>
                  </tr>
                ) : (
                  endpoints.map((ep) => (
                    <tr key={ep.id}>
                      <td>{ep.url}</td>
                      <td><code style={{ fontFamily: 'var(--font-mono)' }}>{ep.secret}</code></td>
                      <td>
                        <span className="badge badge-info" style={{ fontSize: '10px' }}>
                          {JSON.parse(ep.events).join(', ')}
                        </span>
                      </td>
                      <td>
                        <button className="button button-secondary button-danger" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => handleDeleteWebhook(ep.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-panel">
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Subscribe Webhook</h3>
          <form onSubmit={handleCreateWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Endpoint URL</label>
              <input 
                type="url" 
                className="form-input" 
                placeholder="https://my-app.com/api/webhooks" 
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Subscribed Event</label>
              <select className="form-select" value={webhookEvents} onChange={e => setWebhookEvents(e.target.value)}>
                <option value="payment_intent.succeeded">payment_intent.succeeded</option>
                <option value="payment_intent.failed">payment_intent.failed</option>
                <option value="*">All Events (*)</option>
              </select>
            </div>
            <button type="submit" className="button">Add Webhook URL</button>
          </form>
        </div>
      </div>

      {/* Webhook Delivery Logs */}
      <div className="glass-panel">
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>HMAC Webhook Transmission Logs (Recent 100)</h3>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Delivered At</th>
                <th>Event Type</th>
                <th>Status Code</th>
                <th>Response Body</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--text-muted)' }}>No webhook delivery attempts yet.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.delivered_at).toLocaleTimeString()}</td>
                    <td><span className="badge badge-info" style={{ textTransform: 'none' }}>{log.event_type}</span></td>
                    <td>
                      <span className={`badge ${log.response_status && log.response_status >= 200 && log.response_status < 300 ? 'badge-success' : 'badge-danger'}`}>
                        {log.response_status || 'Connection Error'}
                      </span>
                    </td>
                    <td>
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', wordBreak: 'break-all' }}>
                        {log.response_body || 'N/A'}
                      </code>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
