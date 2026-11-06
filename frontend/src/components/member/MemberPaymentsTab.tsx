import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../App';

interface Props {
  gatewayKey: string;
  onSuccess: () => void;
}

type ActiveDesk = 'switch_intent' | 'ach_wire' | 'card_vault' | 'returns_camt';

interface ApiResult {
  ok: boolean;
  data: any;
}

export default function MemberPaymentsTab({ gatewayKey, onSuccess }: Props) {
  const [activeDesk, setActiveDesk] = useState<ActiveDesk>('switch_intent');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  // Live accounts, cards & payment intents
  const [liveAccounts, setLiveAccounts] = useState<any[]>([]);
  const [issuedCards, setIssuedCards] = useState<any[]>([]);
  const [paymentIntents, setPaymentIntents] = useState<any[]>([]);

  // 1. Switch Transfer (pacs.008 + pacs.002) state
  const [intAmountUsd, setIntAmountUsd] = useState('250.00');
  const [intCurrency, setIntCurrency] = useState('USD');
  const [intDest, setIntDest] = useState('');

  // 2. ACH / Wire state
  const [achFrom, setAchFrom] = useState('');
  const [achTo, setAchTo] = useState('');
  const [achAmountUsd, setAchAmountUsd] = useState('500.00');
  const [achType, setAchType] = useState<'ach_credit' | 'ach_debit' | 'wire'>('ach_credit');
  const [achDesc, setAchDesc] = useState('Interbank commercial settlement');

  // 3. Card Issuing & Merchant Authorization state
  const [cardName, setCardName] = useState('');
  const [cardLimitUsd, setCardLimitUsd] = useState('5000');
  const [cardCurrency, setCardCurrency] = useState('USD');
  const [cardType, setCardType] = useState<'virtual' | 'physical'>('virtual');
  const [authCardId, setAuthCardId] = useState('');
  const [authMerchant, setAuthMerchant] = useState('Amazon Web Services');
  const [authAmountUsd, setAuthAmountUsd] = useState('49.99');

  // 4. Returns (pacs.004) & camt.053 Statement state
  const [reverseReason, setReverseReason] = useState('CUST');
  const [camtAccountId, setCamtAccountId] = useState('');
  const [camtXml, setCamtXml] = useState('');

  const headers = () => ({
    'X-Gateway-API-Key': gatewayKey || localStorage.getItem('payrail_gateway_key') || '',
    'Content-Type': 'application/json',
  });

  const loadWorkspaceData = async () => {
    try {
      const [accRes, cardsRes, piRes] = await Promise.all([
        fetch(`${API_BASE_URL}/console/accounts`),
        fetch(`${API_BASE_URL}/v1/gateway/cards`, { headers: headers() }),
        fetch(`${API_BASE_URL}/console/payment_intents`),
      ]);
      if (accRes.ok) {
        const accs = await accRes.json();
        if (Array.isArray(accs)) {
          setLiveAccounts(accs);
          if (accs.length > 0 && !achFrom) setAchFrom(accs[0].id);
          if (accs.length > 1 && !achTo) setAchTo(accs[1].id);
          if (accs.length > 0 && !intDest) setIntDest(accs[0].id);
          if (accs.length > 0 && !camtAccountId) setCamtAccountId(accs[0].id);
        }
      }
      if (cardsRes.ok) {
        const cData = await cardsRes.json();
        const list = cData.cards || (Array.isArray(cData) ? cData : []);
        setIssuedCards(list);
        if (list.length > 0 && !authCardId) setAuthCardId(list[0].id);
      }
      if (piRes.ok) {
        const piData = await piRes.json();
        if (Array.isArray(piData)) setPaymentIntents(piData);
      }
    } catch {}
  };

  useEffect(() => {
    loadWorkspaceData();
  }, [gatewayKey]);

  // ── 1. Execute Instant Switch Transfer (pacs.008 + pacs.002) ──
  const handleSwitchTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const amountCents = Math.round(parseFloat(intAmountUsd) * 100);
      const createRes = await fetch(`${API_BASE_URL}/v1/gateway/payment_intents`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          amount_cents: amountCents,
          currency: intCurrency,
          destination_account_id: intDest,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        setResult({ ok: false, data: createData });
        setLoading(false);
        return;
      }
      const confirmRes = await fetch(`${API_BASE_URL}/v1/payment_intents/${createData.id}/confirm`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({}),
      });
      const confirmData = await confirmRes.json();
      setResult({ ok: confirmRes.ok, data: confirmData });
      if (confirmRes.ok) {
        onSuccess();
        loadWorkspaceData();
      }
    } catch (err: any) {
      setResult({ ok: false, data: { error: err.message } });
    } finally {
      setLoading(false);
    }
  };

  // ── 2. Execute ACH / Wire Origination ──
  const handleAchWire = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/gateway/payments/transfer`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          from_account_id: achFrom,
          to_account_id: achTo,
          amount_cents: Math.round(parseFloat(achAmountUsd) * 100),
          type: achType,
          description: achDesc,
        }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, data });
      if (res.ok) {
        onSuccess();
        loadWorkspaceData();
      }
    } catch (err: any) {
      setResult({ ok: false, data: { error: err.message } });
    } finally {
      setLoading(false);
    }
  };

  // ── 3A. Issue Virtual / Physical Card ──
  const handleIssueCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/gateway/cards/issue`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          cardholder_name: cardName,
          credit_limit_cents: Math.round(parseFloat(cardLimitUsd) * 100),
          currency: cardCurrency,
          type: cardType,
        }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, data });
      if (res.ok) {
        setCardName('');
        onSuccess();
        loadWorkspaceData();
      }
    } catch (err: any) {
      setResult({ ok: false, data: { error: err.message } });
    } finally {
      setLoading(false);
    }
  };

  // ── 3B. Freeze / Unfreeze / Cancel Card ──
  const handleCardStatus = async (cardId: string, newStatus: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/gateway/cards/${cardId}/status`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, data });
      loadWorkspaceData();
    } catch (err: any) {
      setResult({ ok: false, data: { error: err.message } });
    }
  };

  // ── 3C. Authorize Merchant Purchase on Card ──
  const handleAuthorizeCardPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authCardId) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/gateway/cards/${authCardId}/authorize`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          amount_cents: Math.round(parseFloat(authAmountUsd) * 100),
          merchant_name: authMerchant,
          mcc: '5734',
        }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, data });
      if (res.ok) {
        onSuccess();
        loadWorkspaceData();
      }
    } catch (err: any) {
      setResult({ ok: false, data: { error: err.message } });
    } finally {
      setLoading(false);
    }
  };

  // ── 4A. Reverse Settled Payment Intent (pacs.004) ──
  const handleReverseIntent = async (intentId: string) => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/payment_intents/${intentId}/reverse`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          reason_code: reverseReason,
          notes: 'Initiated from Partner Bank Executive Treasury Workstation',
        }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, data });
      if (res.ok) {
        onSuccess();
        loadWorkspaceData();
      }
    } catch (err: any) {
      setResult({ ok: false, data: { error: err.message } });
    } finally {
      setLoading(false);
    }
  };

  // ── 4B. Export ISO 20022 camt.053 XML Statement ──
  const handleExportCamt053 = async () => {
    if (!camtAccountId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/console/accounts/${camtAccountId}/statement_xml`);
      const xml = await res.text();
      setCamtXml(xml);
    } catch (err: any) {
      setCamtXml(`<!-- Error exporting camt.053: ${err.message} -->`);
    }
  };

  const DESKS: { key: ActiveDesk; icon: string; title: string; sub: string }[] = [
    { key: 'switch_intent', icon: '⚡', title: 'Instant Switch Transfer', sub: 'ISO 20022 pacs.008 + pacs.002 RTGS' },
    { key: 'ach_wire',      icon: '🏦', title: 'ACH & Fedwire Desk',      sub: 'Domestic & cross-border account rails' },
    { key: 'card_vault',    icon: '💳', title: 'Card Issuing & Auth Vault', sub: 'Issue cards, freeze & simulate purchases' },
    { key: 'returns_camt',  icon: '↩️', title: 'Returns (pacs.004) & camt.053', sub: 'Contra-entry reversals & XML statements' },
  ];

  const fmtUsd = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <datalist id="member-live-accounts">
        {liveAccounts.map((a, idx) => (
          <option key={`${a.id}-${idx}`} value={a.id}>{a.name} ({a.currency})</option>
        ))}
      </datalist>

      {/* ── 4-DESK SELECTOR BAR ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {DESKS.map(d => {
          const active = activeDesk === d.key;
          return (
            <button
              key={d.key}
              onClick={() => { setActiveDesk(d.key); setResult(null); }}
              style={{
                padding: '16px 18px',
                borderRadius: 14,
                textAlign: 'left',
                cursor: 'pointer',
                background: active ? 'rgba(16, 185, 129, 0.14)' : 'rgba(15, 23, 42, 0.75)',
                border: `2px solid ${active ? '#10b981' : 'var(--border-subtle)'}`,
                color: '#f8fafc',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>{d.icon}</div>
              <div style={{ fontWeight: 800, fontSize: 14, color: active ? '#34d399' : '#f8fafc' }}>{d.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{d.sub}</div>
            </button>
          );
        })}
      </div>

      {/* ── DESK 1: INSTANT INTERBANK SWITCH TRANSFER (pacs.008 + pacs.002) ── */}
      {activeDesk === 'switch_intent' && (
        <div className="card">
          <div className="card-header">
            <div>
              <span className="badge badge-success" style={{ marginBottom: 6 }}>REAL-TIME GROSS SETTLEMENT</span>
              <h3 className="card-title">⚡ Instant Interbank Switch Transfer (pacs.008)</h3>
              <p className="card-subtitle">
                Creates and confirms an interbank payment intent in one atomic flow, returning signed <code style={{ color: '#34d399' }}>pacs.008</code> and <code style={{ color: '#34d399' }}>pacs.002</code> XML payloads.
              </p>
            </div>
          </div>

          <form onSubmit={handleSwitchTransfer} style={{ maxWidth: 680 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Settlement Amount (USD) *</label>
                <input
                  className="form-input mono"
                  type="number"
                  step="0.01"
                  min="0.50"
                  value={intAmountUsd}
                  onChange={e => setIntAmountUsd(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select className="form-select" value={intCurrency} onChange={e => setIntCurrency(e.target.value)}>
                  {['USD', 'EUR', 'GBP', 'NGN', 'ZAR'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Destination Clearing / Partner Account ID *</label>
              <input
                list="member-live-accounts"
                className="form-input mono"
                placeholder="Select or paste destination account UUID"
                value={intDest}
                onChange={e => setIntDest(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-success btn-lg" disabled={loading}>
              {loading ? 'Authorizing & Settling on Switch…' : `⚡ Execute $${intAmountUsd} Switch Transfer →`}
            </button>
          </form>
        </div>
      )}

      {/* ── DESK 2: ACH & WIRE ORIGINATION ── */}
      {activeDesk === 'ach_wire' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">🏦 ACH &amp; Fedwire Origination Desk</h3>
              <p className="card-subtitle">Originate same-day ACH credits, debits, or high-value Fedwire transfers.</p>
            </div>
          </div>

          <form onSubmit={handleAchWire} style={{ maxWidth: 680 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Rail Type</label>
                <select className="form-select" value={achType} onChange={e => setAchType(e.target.value as any)}>
                  <option value="ach_credit">ACH Credit (Push Funds)</option>
                  <option value="ach_debit">ACH Debit (Pull Funds)</option>
                  <option value="wire">High-Value Fedwire Transfer</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Amount (USD) *</label>
                <input
                  className="form-input mono"
                  type="number"
                  step="0.01"
                  value={achAmountUsd}
                  onChange={e => setAchAmountUsd(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Originating Account ID *</label>
                <input
                  list="member-live-accounts"
                  className="form-input mono"
                  value={achFrom}
                  onChange={e => setAchFrom(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Beneficiary Account ID *</label>
                <input
                  list="member-live-accounts"
                  className="form-input mono"
                  value={achTo}
                  onChange={e => setAchTo(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Remittance Description</label>
              <input
                className="form-input"
                value={achDesc}
                onChange={e => setAchDesc(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
              {loading ? 'Originating Transfer…' : '🏦 Submit ACH / Wire Instruction →'}
            </button>
          </form>
        </div>
      )}

      {/* ── DESK 3: VIRTUAL & PHYSICAL CARD ISSUING & LIFECYCLE VAULT ── */}
      {activeDesk === 'card_vault' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          {/* Issue New Card + Simulate Purchase */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 6 }}>💳 Issue New Virtual / Physical Card</h3>
              <p className="card-subtitle" style={{ marginBottom: 16 }}>
                Generates a Luhn-valid PAN, CVV, and expiration date backed by your institution’s clearing shard.
              </p>
              <form onSubmit={handleIssueCard}>
                <div className="form-group">
                  <label className="form-label">Cardholder Full Name *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Chidi Nwosu"
                    value={cardName}
                    onChange={e => setCardName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Spending Limit (USD)</label>
                    <input
                      className="form-input mono"
                      type="number"
                      value={cardLimitUsd}
                      onChange={e => setCardLimitUsd(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Card Form Factor</label>
                    <select className="form-select" value={cardType} onChange={e => setCardType(e.target.value as any)}>
                      <option value="virtual">Virtual Instant Card</option>
                      <option value="physical">Physical EMV Card</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className="btn btn-success" disabled={loading}>
                  {loading ? 'Issuing Card…' : '💳 Issue Card Instantly'}
                </button>
              </form>
            </div>

            {/* Merchant Authorization Simulator */}
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 6 }}>🛍️ Simulate Live Merchant Card Purchase</h3>
              <p className="card-subtitle" style={{ marginBottom: 16 }}>
                Test real-time card limit checking and double-entry ledger settlement on any active card.
              </p>
              <form onSubmit={handleAuthorizeCardPurchase}>
                <div className="form-group">
                  <label className="form-label">Select Issued Card</label>
                  <select className="form-select mono" value={authCardId} onChange={e => setAuthCardId(e.target.value)}>
                    {issuedCards.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.cardholder_name} — •••• {c.last4} ({c.status})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Merchant Name</label>
                    <input className="form-input" value={authMerchant} onChange={e => setAuthMerchant(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Purchase Amount (USD)</label>
                    <input className="form-input mono" type="number" step="0.01" value={authAmountUsd} onChange={e => setAuthAmountUsd(e.target.value)} />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading || !authCardId}>
                  🛍️ Authorize Purchase
                </button>
              </form>
            </div>
          </div>

          {/* Issued Cards Vault */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">🗂️ Issued Cards Vault ({issuedCards.length})</h3>
              <button className="btn btn-secondary btn-sm" onClick={loadWorkspaceData}>🔄 Refresh</button>
            </div>

            {issuedCards.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💳</div>
                <div>No cards issued yet. Issue your first virtual card on the left.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {issuedCards.map((c: any) => (
                  <div
                    key={c.id}
                    style={{
                      padding: '16px',
                      borderRadius: 12,
                      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(3, 7, 18, 0.95))',
                      border: '1px solid var(--border-medium)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 14 }}>{c.cardholder_name}</span>
                      <span className={`badge ${c.status === 'active' ? 'badge-success' : c.status === 'frozen' ? 'badge-warning' : 'badge-danger'}`}>
                        {c.status}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, letterSpacing: '0.12em', color: '#a5b4fc', marginBottom: 8 }}>
                      •••• •••• •••• {c.last4} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>EXP {c.exp_month}/{c.exp_year}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span>Spent: <strong>{fmtUsd(Number(c.spent_cents || 0))}</strong> / {fmtUsd(Number(c.spending_limit_cents || 500000))}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {c.status === 'active' && (
                          <button className="btn btn-secondary btn-sm" onClick={() => handleCardStatus(c.id, 'frozen')}>❄️ Freeze</button>
                        )}
                        {c.status === 'frozen' && (
                          <button className="btn btn-success btn-sm" onClick={() => handleCardStatus(c.id, 'active')}>🔥 Unfreeze</button>
                        )}
                        {c.status !== 'cancelled' && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleCardStatus(c.id, 'cancelled')}>Cancel</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DESK 4: PAYMENT RETURNS (pacs.004) & ISO 20022 camt.053 STATEMENTS ── */}
      {activeDesk === 'returns_camt' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          {/* Left: Payment Intents & 1-Click pacs.004 Reversal */}
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">↩️ Payment Returns &amp; Reversals (ISO 20022 pacs.004)</h3>
                <p className="card-subtitle">Post atomic contra-entry reversals for settled switch transfers.</p>
              </div>
              <select
                className="form-select"
                style={{ width: 150 }}
                value={reverseReason}
                onChange={e => setReverseReason(e.target.value)}
              >
                <option value="CUST">CUST (Customer)</option>
                <option value="DUPL">DUPL (Duplicate)</option>
                <option value="FRAD">FRAD (Fraud)</option>
                <option value="TECH">TECH (Technical)</option>
              </select>
            </div>

            {paymentIntents.length === 0 ? (
              <div className="empty-state">No payment intents recorded yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto' }}>
                {paymentIntents.slice(0, 15).map((pi: any) => (
                  <div
                    key={pi.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                        {fmtUsd(Number(pi.amount || 0))} <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>({pi.id.slice(0, 14)}…)</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        Status: <strong>{pi.status}</strong> · {new Date(pi.created_at).toLocaleString()}
                      </div>
                    </div>
                    {pi.status === 'succeeded' && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleReverseIntent(pi.id)}
                        disabled={loading}
                      >
                        ↩️ Reverse (pacs.004)
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: ISO 20022 camt.053 Statement Generator */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 6 }}>📜 Export ISO 20022 camt.053.001.08 Statement</h3>
            <p className="card-subtitle" style={{ marginBottom: 16 }}>
              Generate an official XML Bank-to-Customer Account Statement for end-of-day treasury reconciliation.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <select
                className="form-select mono"
                value={camtAccountId}
                onChange={e => setCamtAccountId(e.target.value)}
              >
                {liveAccounts.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                ))}
              </select>
              <button type="button" className="btn btn-primary" onClick={handleExportCamt053}>
                📥 Generate XML
              </button>
            </div>
            {camtXml && (
              <pre className="code-block" style={{ maxHeight: 320, overflowY: 'auto', fontSize: 11.5 }}>
                {camtXml}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* ── LIVE RESPONSE & ISO 20022 XML INSPECTOR ── */}
      {result && (
        <div className="card" style={{ border: `1px solid ${result.ok ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}` }}>
          <div className="card-header">
            <span style={{ fontWeight: 800, color: result.ok ? '#34d399' : '#f87171' }}>
              {result.ok ? '✅ Switch Execution Succeeded' : '❌ Switch Execution Error'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setResult(null)}>Dismiss</button>
          </div>
          <pre className="code-block" style={{ margin: 0, maxHeight: 360, overflowY: 'auto' }}>
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
