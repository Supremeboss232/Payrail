import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../App';

interface Props {
  gatewayKey: string;
  onSuccess: () => void;
}

type ActiveForm = 'card' | 'ach' | 'intent';

interface ApiResult { ok: boolean; data: unknown; }

function ResultPanel({ result, onClear }: { result: ApiResult; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={{ marginTop: 16, borderRadius: 'var(--r-lg)', background: 'rgba(0,0,0,0.4)', border: `1px solid ${result.ok ? 'hsla(158,64%,46%,0.3)' : 'hsla(348,83%,60%,0.3)'}`, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: result.ok ? 'var(--emerald)' : 'var(--rose)' }}>
          {result.ok ? '✅ Success' : '❌ Error'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={copy} className="btn btn-ghost btn-sm">{copied ? '✅ Copied' : '📋 Copy'}</button>
          <button onClick={onClear} className="btn btn-ghost btn-sm">Clear</button>
        </div>
      </div>
      <pre style={{ margin: 0, padding: '14px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', color: result.ok ? '#86efac' : '#fca5a5', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {JSON.stringify(result.data, null, 2)}
      </pre>
    </div>
  );
}

const FORMS: { key: ActiveForm; icon: string; label: string; desc: string }[] = [
  { key: 'card',   icon: '💳', label: 'Issue Virtual Card',      desc: 'Create a new virtual card for a cardholder' },
  { key: 'ach',    icon: '🏦', label: 'ACH / Wire Transfer',      desc: 'Initiate an ACH debit, credit, or wire' },
  { key: 'intent', icon: '🚀', label: 'Payment Intent',           desc: 'Create and confirm a payment intent' },
];

export default function MemberPaymentsTab({ gatewayKey, onSuccess }: Props) {
  const [activeForm, setActiveForm] = useState<ActiveForm>('card');
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<ApiResult | null>(null);

  // Card form
  const [cardName,     setCardName]     = useState('');
  const [cardLimit,    setCardLimit]    = useState('500000');
  const [cardCurrency, setCardCurrency] = useState('USD');

  // ACH form
  const [achFrom,     setAchFrom]     = useState('');
  const [achTo,       setAchTo]       = useState('');
  const [achAmount,   setAchAmount]   = useState('100');
  const [achType,     setAchType]     = useState<'ach_debit'|'ach_credit'|'wire'>('ach_credit');
  const [achDesc,     setAchDesc]     = useState('');

  // Intent form
  const [intAmount,   setIntAmount]   = useState('5000');
  const [intCurrency, setIntCurrency] = useState('USD');
  const [intDest,     setIntDest]     = useState('');
  const [liveAccounts, setLiveAccounts] = useState<{ id: string; name: string; currency: string }[]>([]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/console/accounts`)
      .then(r => r.ok ? r.json() : [])
      .then(accs => {
        if (Array.isArray(accs)) {
          setLiveAccounts(accs);
          if (accs.length > 0 && !achFrom) setAchFrom(accs[0].id);
          if (accs.length > 0 && !intDest) setIntDest(accs[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const headers = () => ({
    'X-Gateway-API-Key': gatewayKey || localStorage.getItem('payrail_gateway_key') || '',
    'Content-Type': 'application/json',
  });

  const callApi = async (url: string, body: object) => {
    setLoading(true); setResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}${url}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      const data = await res.json();
      setResult({ ok: res.ok, data });
      if (res.ok) onSuccess();
    } catch (err: any) {
      setResult({ ok: false, data: { error: err.message } });
    } finally { setLoading(false); }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeForm === 'card') callApi('/v1/gateway/cards/issue', { cardholder_name: cardName, credit_limit_cents: parseInt(cardLimit), currency: cardCurrency });
    if (activeForm === 'ach')  callApi('/v1/gateway/payments/transfer', { from_account_id: achFrom, to_account_id: achTo, amount_cents: parseFloat(achAmount) * 100, type: achType, description: achDesc });
    if (activeForm === 'intent') callApi('/v1/gateway/payment_intents', { amount_cents: parseInt(intAmount), currency: intCurrency, destination_account_id: intDest });
  };

  const inp: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-medium)',
    borderRadius: 'var(--r-md)', padding: '10px 14px', fontFamily: 'var(--font)',
    fontSize: 14, color: 'var(--text-0)', width: '100%', outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
      <datalist id="member-live-accounts">
        {liveAccounts.map((a, idx) => (
          <option key={`${a.id}-${idx}`} value={a.id}>{a.name} ({a.currency})</option>
        ))}
      </datalist>

      {/* Form selector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {FORMS.map(f => (
          <button
            key={f.key}
            onClick={() => { setActiveForm(f.key); setResult(null); }}
            style={{
              padding: '16px 14px', borderRadius: 'var(--r-lg)', border: `1.5px solid ${activeForm === f.key ? 'var(--brand)' : 'var(--border)'}`,
              background: activeForm === f.key ? 'var(--brand-subtle)' : 'var(--glass-bg)',
              cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{f.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: activeForm === f.key ? 'var(--brand-light)' : 'var(--text-0)', marginBottom: 4 }}>{f.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.desc}</div>
          </button>
        ))}
      </div>

      {/* Form panel */}
      <div className="card">
        <h3 style={{ marginBottom: 20 }}>{FORMS.find(f => f.key === activeForm)?.label}</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Card Form ── */}
          {activeForm === 'card' && (<>
            <div className="field">
              <label className="field-label">Cardholder Name <span style={{ color: 'var(--rose)' }}>*</span></label>
              <input style={inp} type="text" placeholder="Jane Smith" value={cardName} onChange={e => setCardName(e.target.value)} required />
            </div>
            <div className="grid-2">
              <div className="field">
                <label className="field-label">Credit Limit (cents)</label>
                <input style={inp} type="number" value={cardLimit} onChange={e => setCardLimit(e.target.value)} />
                <span className="field-hint">500000 = $5,000.00</span>
              </div>
              <div className="field">
                <label className="field-label">Currency</label>
                <select style={{ ...inp, cursor: 'pointer' }} value={cardCurrency} onChange={e => setCardCurrency(e.target.value)}>
                  {['USD','EUR','GBP','NGN','ZAR'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </>)}

          {/* ── ACH / Wire Form ── */}
          {activeForm === 'ach' && (<>
            <div className="field">
              <label className="field-label">Transfer Type</label>
              <select style={{ ...inp, cursor: 'pointer' }} value={achType} onChange={e => setAchType(e.target.value as any)}>
                <option value="ach_credit">ACH Credit (push)</option>
                <option value="ach_debit">ACH Debit (pull)</option>
                <option value="wire">Wire Transfer</option>
              </select>
            </div>
            <div className="grid-2">
              <div className="field">
                <label className="field-label">From Account ID <span style={{ color: 'var(--rose)' }}>*</span></label>
                <input list="member-live-accounts" style={{ ...inp, fontFamily: 'var(--font-mono)' }} placeholder="Select or enter source account ID" value={achFrom} onChange={e => setAchFrom(e.target.value)} required />
              </div>
              <div className="field">
                <label className="field-label">To Account ID <span style={{ color: 'var(--rose)' }}>*</span></label>
                <input list="member-live-accounts" style={{ ...inp, fontFamily: 'var(--font-mono)' }} placeholder="Select or enter destination account ID" value={achTo} onChange={e => setAchTo(e.target.value)} required />
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label className="field-label">Amount (USD) <span style={{ color: 'var(--rose)' }}>*</span></label>
                <input style={inp} type="number" step="0.01" value={achAmount} onChange={e => setAchAmount(e.target.value)} required />
              </div>
              <div className="field">
                <label className="field-label">Description</label>
                <input style={inp} type="text" placeholder="Invoice #12345" value={achDesc} onChange={e => setAchDesc(e.target.value)} />
              </div>
            </div>
          </>)}

          {/* ── Payment Intent Form ── */}
          {activeForm === 'intent' && (<>
            <div className="grid-2">
              <div className="field">
                <label className="field-label">Amount (cents) <span style={{ color: 'var(--rose)' }}>*</span></label>
                <input style={inp} type="number" value={intAmount} onChange={e => setIntAmount(e.target.value)} required />
                <span className="field-hint">5000 = $50.00</span>
              </div>
              <div className="field">
                <label className="field-label">Currency</label>
                <select style={{ ...inp, cursor: 'pointer' }} value={intCurrency} onChange={e => setIntCurrency(e.target.value)}>
                  {['USD','EUR','GBP'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label className="field-label">Destination Account ID</label>
              <input list="member-live-accounts" style={{ ...inp, fontFamily: 'var(--font-mono)' }} placeholder="Select or enter destination account ID" value={intDest} onChange={e => setIntDest(e.target.value)} />
            </div>
          </>)}

          <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start', minWidth: 180 }} disabled={loading}>
            {loading ? <><span className="btn-spinner" /> Processing…</> : `Submit ${FORMS.find(f => f.key === activeForm)?.label}`}
          </button>
        </form>

        {result && <ResultPanel result={result} onClear={() => setResult(null)} />}
      </div>
    </div>
  );
}
