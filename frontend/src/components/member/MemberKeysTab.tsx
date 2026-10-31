import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../App';

interface Props {
  refreshTrigger: number;
  onKeyGenerated?: (rawKey: string) => void;
}

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
  event_type: string;
  response_status: number | null;
  response_body: string | null;
  delivered_at: string;
}

const WEBHOOK_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.failed',
  'card.issued',
  'card.activated',
  'ach.initiated',
  'ach.settled',
  'settlement.completed',
  '*',
];

export default function MemberKeysTab({ refreshTrigger, onKeyGenerated }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [keyName, setKeyName] = useState('');
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvent, setWebhookEvent] = useState('payment_intent.succeeded');

  const [secQuestion, setSecQuestion] = useState('What was the name of your first financial institution?');
  const [secAnswer, setSecAnswer] = useState('');
  const [secMsg, setSecMsg] = useState('');

  const [activeSection, setActiveSection] = useState<'keys' | 'webhooks' | 'security'>('keys');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [keysRes, epsRes, logsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/console/api_keys`),
        fetch(`${API_BASE_URL}/console/webhook_endpoints`),
        fetch(`${API_BASE_URL}/console/webhook_logs`),
      ]);
      if (keysRes.ok) setKeys(await keysRes.json());
      if (epsRes.ok)  setEndpoints(await epsRes.json());
      if (logsRes.ok) setLogs(await logsRes.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [refreshTrigger]);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${API_BASE_URL}/console/api_keys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: keyName }),
    });
    if (res.ok) {
      const d = await res.json();
      setNewRawKey(d.rawKey);
      localStorage.setItem('payrail_gateway_key', d.rawKey);
      onKeyGenerated?.(d.rawKey);
      setKeyName('');
      fetchAll();
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm('Revoke this API key? Any app using it will immediately fail.')) return;
    const res = await fetch(`${API_BASE_URL}/console/api_keys/${id}`, { method: 'DELETE' });
    if (res.ok) setKeys(prev => prev.map(k => k.id === id ? { ...k, status: 'revoked' } : k));
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${API_BASE_URL}/console/webhook_endpoints`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, events: [webhookEvent] }),
    });
    if (res.ok) { setWebhookUrl(''); fetchAll(); }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Delete this webhook subscription?')) return;
    const res = await fetch(`${API_BASE_URL}/console/webhook_endpoints/${id}`, { method: 'DELETE' });
    if (res.ok) setEndpoints(prev => prev.filter(ep => ep.id !== id));
  };

  const handleSaveSecurityQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecMsg('');
    const res = await fetch(`${API_BASE_URL}/console/auth/setup_security_questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: secQuestion, answer: secAnswer }),
    });
    if (res.ok) {
      setSecMsg('✅ Security recovery question saved!');
      setSecAnswer('');
    } else {
      setSecMsg('❌ Failed to save security question.');
    }
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 9, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 12, width: 'fit-content' }}>
        {[
          { key: 'keys' as const, icon: '🔑', label: 'API Keys' },
          { key: 'webhooks' as const, icon: '🔔', label: 'Webhooks' },
          { key: 'security' as const, icon: '🛡️', label: 'Account Recovery' },
        ].map(s => (
          <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
            padding: '9px 20px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: activeSection === s.key ? 'rgba(99,102,241,0.3)' : 'transparent',
            color: activeSection === s.key ? '#a5b4fc' : 'rgba(255,255,255,0.35)',
            fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.15s',
          }}>
            <span>{s.icon}</span> {s.label}
          </button>
        ))}
      </div>

      {/* ─── API KEYS ─── */}
      {activeSection === 'keys' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {newRawKey && (
            <div style={{ padding: '20px 24px', borderRadius: 14, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    ⚠️ Save this key now — it is now active in your portal session
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Store it in your server environment variables immediately.</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setKeyRevealed(r => !r)} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                    {keyRevealed ? '🙈 Hide' : '👁️ Reveal'}
                  </button>
                  <button onClick={() => copyKey(newRawKey)} style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: keyCopied ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.25)', color: keyCopied ? '#10b981' : '#a5b4fc', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                    {keyCopied ? '✅ Copied' : '📋 Copy'}
                  </button>
                </div>
              </div>
              <code style={{ display: 'block', fontFamily: 'monospace', fontSize: 13, color: '#86efac', padding: '12px 14px', background: 'rgba(0,0,0,0.4)', borderRadius: 8, wordBreak: 'break-all' }}>
                {keyRevealed ? newRawKey : newRawKey.slice(0, 8) + '•'.repeat(30) + newRawKey.slice(-4)}
              </code>
              <button onClick={() => setNewRawKey(null)} style={{ marginTop: 12, padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 12 }}>
                Dismiss
              </button>
            </div>
          )}

          <div style={{ padding: '22px 24px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px' }}>Generate New API Key</h3>
            <form onSubmit={handleCreateKey} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Key Label</label>
                <input type="text" style={inputStyle} placeholder="e.g. Production Server" value={keyName} onChange={e => setKeyName(e.target.value)} required />
              </div>
              <button type="submit" style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Generate Key
              </button>
            </form>
          </div>

          <div style={{ padding: '22px 24px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px' }}>Active API Keys</h3>
            {loading ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Loading…</div>
            ) : keys.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0' }}>No API keys yet. Generate one above.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {keys.map(k => (
                  <div key={k.id} style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
                    borderRadius: 10, background: k.status === 'revoked' ? 'rgba(239,68,68,0.04)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${k.status === 'revoked' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.07)'}`,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{k.name}</div>
                      <code style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                        {k.prefix}••••••••••••••
                      </code>
                    </div>
                    <span style={{
                      padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                      background: k.status === 'active' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                      color: k.status === 'active' ? '#10b981' : '#ef4444',
                    }}>{k.status}</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>{new Date(k.created_at).toLocaleDateString()}</span>
                    {k.status === 'active' && (
                      <button onClick={() => handleRevokeKey(k.id)} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── WEBHOOKS ─── */}
      {activeSection === 'webhooks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ padding: '22px 24px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Subscribe to Events</h3>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 16px', lineHeight: 1.5 }}>
              Payrail will POST a signed HMAC payload to your URL every time the selected event fires.
            </p>
            <form onSubmit={handleCreateWebhook} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Endpoint URL</label>
                <input type="url" style={inputStyle} placeholder="https://your-api.com/webhooks" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} required />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Event</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={webhookEvent} onChange={e => setWebhookEvent(e.target.value)}>
                  {WEBHOOK_EVENTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="submit" style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  Add Webhook
                </button>
              </div>
            </form>
          </div>

          <div style={{ padding: '22px 24px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px' }}>Active Subscriptions</h3>
            {endpoints.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '12px 0' }}>No webhooks registered yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {endpoints.map(ep => {
                  let events: string[] = [];
                  try { events = JSON.parse(ep.events); } catch { events = [ep.events]; }
                  return (
                    <div key={ep.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, wordBreak: 'break-all' }}>{ep.url}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                          {events.map(ev => (
                            <span key={ev} style={{ padding: '2px 8px', borderRadius: 5, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontSize: 11, fontWeight: 600, fontFamily: 'monospace' }}>{ev}</span>
                          ))}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>Secret: {ep.secret}</div>
                      </div>
                      <button onClick={() => handleDeleteWebhook(ep.id)} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.06)', color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                        Delete
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {logs.length > 0 && (
            <div style={{ padding: '22px 24px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px' }}>Recent Deliveries</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {logs.slice(0, 20).map(log => {
                  const ok = log.response_status && log.response_status >= 200 && log.response_status < 300;
                  return (
                    <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', color: ok ? '#10b981' : '#ef4444' }}>
                        {log.response_status || 'ERR'}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#a5b4fc', flex: 1 }}>{log.event_type}</span>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
                        {new Date(log.delivered_at).toLocaleTimeString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── SECURITY QUESTION ─── */}
      {activeSection === 'security' && (
        <div style={{ padding: '22px 24px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px' }}>🛡️ Step-2 Security Question</h3>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '0 0 18px' }}>
            Configure a SHA-256 hashed security question for zero-knowledge password recovery.
          </p>
          <form onSubmit={handleSaveSecurityQuestion} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Security Question</label>
              <input style={inputStyle} value={secQuestion} onChange={e => setSecQuestion(e.target.value)} required />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Answer</label>
              <input style={inputStyle} type="password" placeholder="Your secret answer" value={secAnswer} onChange={e => setSecAnswer(e.target.value)} required />
            </div>
            <button type="submit" style={{ width: 'fit-content', padding: '10px 22px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Save Recovery Question
            </button>
            {secMsg && <div style={{ fontSize: 13, fontWeight: 600, color: secMsg.startsWith('✅') ? '#10b981' : '#ef4444' }}>{secMsg}</div>}
          </form>
        </div>
      )}
    </div>
  );
}
