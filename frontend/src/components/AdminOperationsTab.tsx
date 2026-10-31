import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Mode = 'easy' | 'advanced';

type ServiceKey =
  | 'card_issue'
  | 'fx_convert'
  | 'ach_transfer'
  | 'aml_screen'
  | 'credit_score'
  | 'otp_send'
  | 'partner_register'
  | 'dns_sweep'
  | 'payment_intent';

interface ServiceDef {
  key: ServiceKey;
  icon: string;
  label: string;
  category: string;
  categoryColor: string;
  description: string;
  method: 'POST' | 'GET';
  endpoint: string;
  easyFields: FieldDef[];
  advancedDefault: Record<string, unknown>;
  authType: 'bearer' | 'gateway' | 'none';
}

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'select' | 'textarea';
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Definitions
// ─────────────────────────────────────────────────────────────────────────────

const SERVICES: ServiceDef[] = [
  {
    key: 'partner_register',
    icon: '🏢',
    label: 'Register Partner Bank',
    category: 'Onboarding',
    categoryColor: '#6366f1',
    description: 'Onboard a new member bank or private firm onto the Payrail network. Issues a live gateway API key.',
    method: 'POST',
    endpoint: '/v1/partners/register',
    authType: 'none',
    easyFields: [
      { key: 'legal_name', label: 'Legal Entity Name', type: 'text', placeholder: 'e.g. First National Bank of Commerce', required: true },
      { key: 'routing_code', label: 'BIC / Routing Code', type: 'text', placeholder: 'e.g. FNBCUS33', required: true },
      { key: 'contact_email', label: 'Contact Email', type: 'email', placeholder: 'treasury@yourbank.com', required: true },
      { key: 'admin_password', label: 'Admin Password', type: 'text', placeholder: 'Min 8 chars', required: true },
      {
        key: 'connector_type', label: 'Connection Type', type: 'select', required: true,
        options: [
          { value: 'http_callback', label: '🌐 HTTP Callback (REST webhook)' },
          { value: 'web3_rpc', label: '⚡ Web3 RPC (Blockchain node)' },
          { value: 'none', label: '— None (manual / internal)' },
        ],
      },
      { key: 'callback_url', label: 'Callback URL (optional)', type: 'text', placeholder: 'https://api.yourbank.com/payrail/callback' },
    ],
    advancedDefault: {
      legal_name: '',
      routing_code: '',
      contact_email: '',
      admin_password: '',
      connector_type: 'http_callback',
      callback_url: '',
    },
  },
  {
    key: 'card_issue',
    icon: '💳',
    label: 'Issue Virtual Card',
    category: 'Cards',
    categoryColor: '#ec4899',
    description: 'Issue a ledger-backed virtual payment card for a partner customer. Instantly usable.',
    method: 'POST',
    endpoint: '/v1/gateway/cards/issue',
    authType: 'gateway',
    easyFields: [
      { key: 'cardholder_name', label: 'Cardholder Name', type: 'text', placeholder: 'Enter cardholder full name', required: true },
      { key: 'credit_limit_cents', label: 'Credit Limit (cents)', type: 'number', placeholder: '500000', required: true, hint: '500000 = $5,000.00' },
      {
        key: 'currency', label: 'Currency', type: 'select', required: true,
        options: [
          { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' },
          { value: 'GBP', label: 'GBP' }, { value: 'NGN', label: 'NGN' }, { value: 'GHS', label: 'GHS' },
        ],
      },
    ],
    advancedDefault: { cardholder_name: '', credit_limit_cents: 500000, currency: 'USD' },
  },
  {
    key: 'fx_convert',
    icon: '💱',
    label: 'FX Rate Lookup',
    category: 'Payments',
    categoryColor: '#3b82f6',
    description: 'Fetch live exchange rates for one or more currencies against a base.',
    method: 'GET',
    endpoint: '/v1/fx/rates',
    authType: 'none',
    easyFields: [
      {
        key: 'base', label: 'Base Currency', type: 'select', required: true,
        options: [
          { value: 'USD', label: 'USD – US Dollar' }, { value: 'EUR', label: 'EUR – Euro' },
          { value: 'GBP', label: 'GBP – British Pound' }, { value: 'NGN', label: 'NGN – Naira' },
        ],
      },
      { key: 'symbols', label: 'Target Currencies (comma-separated)', type: 'text', placeholder: 'EUR,GBP,NGN,GHS', required: true },
    ],
    advancedDefault: { base: 'USD', symbols: 'EUR,GBP,NGN,GHS,ZAR,JPY' },
  },
  {
    key: 'ach_transfer',
    icon: '🏦',
    label: 'ACH / Wire Transfer',
    category: 'Payments',
    categoryColor: '#3b82f6',
    description: 'Originate an ACH or wire transfer between member bank clearing accounts.',
    method: 'POST',
    endpoint: '/v1/gateway/ach/initiate',
    authType: 'gateway',
    easyFields: [
      { key: 'from_account_id', label: 'Debit Account ID', type: 'text', placeholder: 'Select or enter source ledger account ID', required: true },
      { key: 'to_account_id', label: 'Credit Account ID', type: 'text', placeholder: 'Select or enter destination ledger account ID', required: true },
      { key: 'amount_cents', label: 'Amount (cents)', type: 'number', placeholder: '100000', required: true, hint: '100000 = $1,000.00' },
      { key: 'description', label: 'Description / Reference', type: 'text', placeholder: 'Interbank settlement transfer', required: true },
      {
        key: 'type', label: 'Transfer Type', type: 'select', required: true,
        options: [
          { value: 'ACH', label: '🏦 ACH (standard)' },
          { value: 'WIRE', label: '⚡ Wire (same-day)' },
        ],
      },
    ],
    advancedDefault: {
      from_account_id: '',
      to_account_id: '',
      amount_cents: 100000,
      description: '',
      type: 'ACH',
    },
  },
  {
    key: 'aml_screen',
    icon: '🛡️',
    label: 'AML / OFAC Screening',
    category: 'Compliance',
    categoryColor: '#f59e0b',
    description: 'Run a real-time OFAC sanctions + AML risk screen against a name or entity.',
    method: 'POST',
    endpoint: '/v1/gateway/aml/screen',
    authType: 'gateway',
    easyFields: [
      { key: 'name', label: 'Full Name or Entity Name', type: 'text', placeholder: 'Enter individual or entity name to screen', required: true },
      { key: 'country', label: 'Country Code (ISO 3166)', type: 'text', placeholder: 'US', hint: 'e.g. US, GB, NG, DE' },
      { key: 'date_of_birth', label: 'Date of Birth (optional)', type: 'text', placeholder: 'YYYY-MM-DD' },
    ],
    advancedDefault: { name: '', country: 'US', date_of_birth: '' },
  },
  {
    key: 'credit_score',
    icon: '📊',
    label: 'Credit Score Lookup',
    category: 'Credit',
    categoryColor: '#10b981',
    description: 'Compute the Payrail credit score for a partner tenant based on ledger history.',
    method: 'POST',
    endpoint: '/v1/gateway/credit/score',
    authType: 'gateway',
    easyFields: [
      { key: 'tenant_id', label: 'Tenant / Partner UUID', type: 'text', placeholder: 'Select or enter partner tenant UUID', required: true },
    ],
    advancedDefault: { tenant_id: '' },
  },
  {
    key: 'otp_send',
    icon: '✉️',
    label: 'Send OTP Verification',
    category: 'Identity',
    categoryColor: '#8b5cf6',
    description: 'Dispatch a one-time password to an email for identity verification or step-up auth.',
    method: 'POST',
    endpoint: '/v1/gateway/otp/send',
    authType: 'gateway',
    easyFields: [
      { key: 'email', label: 'Recipient Email', type: 'email', placeholder: 'Enter recipient email address', required: true },
      {
        key: 'purpose', label: 'Purpose', type: 'select', required: true,
        options: [
          { value: 'login', label: 'Login Verification' },
          { value: 'wire_confirm', label: 'Wire Transfer Confirmation' },
          { value: 'card_activation', label: 'Card Activation' },
          { value: 'kyc', label: 'KYC Step-Up' },
        ],
      },
    ],
    advancedDefault: { email: '', purpose: 'login' },
  },
  {
    key: 'payment_intent',
    icon: '🚀',
    label: 'Create Payment Intent',
    category: 'Payments',
    categoryColor: '#3b82f6',
    description: 'First step in the payment flow — creates a signed payment intent for confirmation.',
    method: 'POST',
    endpoint: '/v1/payment_intents',
    authType: 'bearer',
    easyFields: [
      { key: 'amount', label: 'Amount (cents)', type: 'number', placeholder: '50000', required: true, hint: '50000 = $500.00' },
      {
        key: 'currency', label: 'Currency', type: 'select', required: true,
        options: [{ value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }, { value: 'GBP', label: 'GBP' }],
      },
      { key: 'destination_account_id', label: 'Destination Account ID', type: 'text', placeholder: 'Select or enter destination ledger account ID', required: true },
    ],
    advancedDefault: { amount: 50000, currency: 'USD', destination_account_id: '' },
  },
  {
    key: 'dns_sweep',
    icon: '⚡',
    label: 'Trigger DNS Settlement Sweep',
    category: 'Settlement',
    categoryColor: '#06b6d4',
    description: 'Compute net positions across all member banks and execute deferred net settlement.',
    method: 'POST',
    endpoint: '/v1/settlements/dns_sweep',
    authType: 'bearer',
    easyFields: [],
    advancedDefault: {},
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getAuthHeaders(authType: ServiceDef['authType'], gatewayKey: string): Record<string, string> {
  const token = localStorage.getItem('payrail_token') || '';
  switch (authType) {
    case 'bearer': return { Authorization: `Bearer ${token}` };
    case 'gateway': return { 'X-Gateway-API-Key': gatewayKey };
    default: return {};
  }
}

function syntaxHighlight(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `<span style="color:#93c5fd">${match}</span>`;
        return `<span style="color:#86efac">${match}</span>`;
      }
      if (/true|false/.test(match)) return `<span style="color:#fbbf24">${match}</span>`;
      if (/null/.test(match)) return `<span style="color:#f87171">${match}</span>`;
      return `<span style="color:#c4b5fd">${match}</span>`;
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ServicePanel
// ─────────────────────────────────────────────────────────────────────────────

function ServicePanel({
  svc,
  mode,
  gatewayKey,
}: {
  svc: ServiceDef;
  mode: Mode;
  gatewayKey: string;
}) {
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    svc.easyFields.forEach((f) => {
      const adv = svc.advancedDefault[f.key];
      defaults[f.key] = adv !== undefined ? String(adv) : '';
    });
    return defaults;
  });
  const [advBody, setAdvBody] = useState(JSON.stringify(svc.advancedDefault, null, 2));
  const [advBodyError, setAdvBodyError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; data: unknown } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const setField = (key: string, value: string) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  const buildPayload = (): Record<string, unknown> | null => {
    if (mode === 'advanced') {
      try {
        return JSON.parse(advBody);
      } catch {
        setAdvBodyError('Invalid JSON — please fix before sending.');
        return null;
      }
    }
    const payload: Record<string, unknown> = {};
    for (const f of svc.easyFields) {
      const v = formData[f.key];
      if (v !== undefined && v !== '') {
        payload[f.key] = f.type === 'number' ? Number(v) : v;
      }
    }
    return payload;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdvBodyError('');
    const payload = buildPayload();
    if (payload === null) return;

    setLoading(true);
    setResult(null);
    try {
      let url = `${API_BASE_URL}${svc.endpoint}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getAuthHeaders(svc.authType, gatewayKey),
      };

      let res: Response;
      if (svc.method === 'GET') {
        const params = new URLSearchParams(payload as Record<string, string>);
        url += `?${params}`;
        res = await fetch(url, { headers });
      } else {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
      }

      const data = await res.json().catch(() => ({ _raw: 'Non-JSON response' }));
      setResult({ ok: res.ok, data });
    } catch (err: any) {
      setResult({ ok: false, data: { error: err.message } });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(result?.data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const bg = `${svc.categoryColor}12`;
  const border = `${svc.categoryColor}30`;

  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${expanded ? svc.categoryColor + '55' : 'rgba(255,255,255,0.07)'}`,
        background: expanded
          ? `linear-gradient(135deg, ${svc.categoryColor}06, rgba(255,255,255,0.01))`
          : 'rgba(255,255,255,0.015)',
        overflow: 'hidden',
        transition: 'border-color 0.2s, background 0.2s',
      }}
    >
      {/* Header */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '18px 24px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            background: bg,
            border: `1px solid ${border}`,
            flexShrink: 0,
          }}
        >
          {svc.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{svc.label}</span>
            <span
              style={{
                padding: '2px 9px',
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                background: bg,
                color: svc.categoryColor,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {svc.category}
            </span>
            <code
              style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.3)',
                background: 'rgba(255,255,255,0.04)',
                padding: '2px 8px',
                borderRadius: 5,
                fontFamily: 'monospace',
              }}
            >
              {svc.method} {svc.endpoint}
            </code>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 3 }}>
            {svc.description}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {result && (
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                background: result.ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                color: result.ok ? '#10b981' : '#ef4444',
              }}
            >
              {result.ok ? '✅ OK' : '❌ Error'}
            </span>
          )}
          <span
            style={{
              color: 'rgba(255,255,255,0.3)',
              fontSize: 22,
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.2s',
              lineHeight: 1,
            }}
          >
            ›
          </span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div
          style={{
            borderTop: `1px solid ${svc.categoryColor}20`,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {mode === 'easy' ? (
              svc.easyFields.length === 0 ? (
                <div
                  style={{
                    background: 'rgba(6,182,212,0.08)',
                    border: '1px solid rgba(6,182,212,0.2)',
                    borderRadius: 10,
                    padding: '16px 20px',
                    fontSize: 14,
                    color: 'rgba(255,255,255,0.65)',
                  }}
                >
                  ⚡ No parameters required — click <strong>Execute</strong> to run immediately.
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 16,
                  }}
                >
                  {svc.easyFields.map((field) => (
                    <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'rgba(255,255,255,0.5)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        {field.label}
                        {field.required && (
                          <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>
                        )}
                      </label>

                      {field.type === 'select' ? (
                        <select
                          value={formData[field.key] || ''}
                          onChange={(e) => setField(field.key, e.target.value)}
                          required={field.required}
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 9,
                            padding: '10px 14px',
                            color: '#fff',
                            fontSize: 14,
                            outline: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="">Select…</option>
                          {field.options?.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'textarea' ? (
                        <textarea
                          value={formData[field.key] || ''}
                          onChange={(e) => setField(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          required={field.required}
                          rows={4}
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 9,
                            padding: '10px 14px',
                            color: '#fff',
                            fontSize: 13,
                            outline: 'none',
                            fontFamily: 'monospace',
                            resize: 'vertical',
                          }}
                        />
                      ) : (
                        <input
                          type={field.type}
                          list={
                            field.key.includes('account_id')
                              ? 'payrail-live-accounts'
                              : field.key === 'tenant_id'
                                ? 'payrail-live-tenants'
                                : undefined
                          }
                          value={formData[field.key] || ''}
                          onChange={(e) => setField(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          required={field.required}
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 9,
                            padding: '10px 14px',
                            color: '#fff',
                            fontSize: 14,
                            outline: 'none',
                          }}
                        />
                      )}

                      {field.hint && (
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                          {field.hint}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              /* Advanced Mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'rgba(255,255,255,0.4)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Request Body (JSON)
                  </span>
                  <button
                    type="button"
                    onClick={() => setAdvBody(JSON.stringify(svc.advancedDefault, null, 2))}
                    style={{
                      fontSize: 11,
                      padding: '3px 10px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.4)',
                      cursor: 'pointer',
                    }}
                  >
                    Reset to Default
                  </button>
                </div>
                <textarea
                  value={advBody}
                  onChange={(e) => {
                    setAdvBody(e.target.value);
                    setAdvBodyError('');
                  }}
                  rows={10}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.45)',
                    border: `1px solid ${advBodyError ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 10,
                    padding: '14px 16px',
                    color: '#86efac',
                    fontFamily: '"Fira Code", "Cascadia Code", monospace',
                    fontSize: 13,
                    outline: 'none',
                    resize: 'vertical',
                    lineHeight: 1.6,
                    boxSizing: 'border-box',
                  }}
                />
                {advBodyError && (
                  <span style={{ fontSize: 12, color: '#ef4444' }}>⚠️ {advBodyError}</span>
                )}
                <div
                  style={{
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: 'rgba(255,255,255,0.35)',
                  }}
                >
                  <span style={{ color: 'rgba(255,255,255,0.2)' }}>Auth Headers: </span>
                  {svc.authType === 'gateway' && (
                    <span style={{ color: '#93c5fd' }}>
                      X-Gateway-API-Key: {gatewayKey || '<not set>'}
                    </span>
                  )}
                  {svc.authType === 'bearer' && (
                    <span style={{ color: '#93c5fd' }}>Authorization: Bearer &lt;session_token&gt;</span>
                  )}
                  {svc.authType === 'none' && (
                    <span style={{ color: '#86efac' }}>No auth required</span>
                  )}
                </div>
              </div>
            )}

            {/* Submit */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: '11px 28px',
                  borderRadius: 10,
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  background: loading
                    ? 'rgba(255,255,255,0.08)'
                    : `linear-gradient(135deg, ${svc.categoryColor}, ${svc.categoryColor}bb)`,
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 14,
                  transition: 'all 0.15s',
                  boxShadow: loading ? 'none' : `0 4px 20px ${svc.categoryColor}40`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {loading ? (
                  <>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        animation: 'spin 0.6s linear infinite',
                      }}
                    />
                    Executing…
                  </>
                ) : (
                  <>
                    {svc.icon} Execute {svc.method}
                  </>
                )}
              </button>

              {result && (
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  style={{
                    padding: '11px 16px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.35)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {/* Response */}
          {result && (
            <div
              style={{
                background: 'rgba(0,0,0,0.5)',
                border: `1px solid ${result.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                borderRadius: 12,
                padding: '16px 20px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: result.ok ? '#10b981' : '#ef4444',
                  }}
                >
                  {result.ok ? '✅ Success Response' : '❌ Error Response'}
                </span>
                <button
                  onClick={handleCopy}
                  style={{
                    fontSize: 11,
                    padding: '3px 10px',
                    borderRadius: 6,
                    background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: copied ? '#10b981' : 'rgba(255,255,255,0.4)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {copied ? '✅ Copied!' : 'Copy'}
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontFamily: '"Fira Code", monospace',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
                dangerouslySetInnerHTML={{
                  __html: syntaxHighlight(JSON.stringify(result.data, null, 2)),
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: AdminOperationsTab
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'All',
  'Onboarding',
  'Payments',
  'Cards',
  'Compliance',
  'Credit',
  'Identity',
  'Settlement',
];

export default function AdminOperationsTab() {
  const [mode, setMode] = useState<Mode>('easy');
  const [filterCategory, setFilterCategory] = useState('All');
  const [gatewayKey, setGatewayKey] = useState(
    localStorage.getItem('payrail_gateway_key') || ''
  );
  const [liveAccounts, setLiveAccounts] = useState<{ id: string; name: string; currency: string }[]>([]);
  const [liveBanks, setLiveBanks] = useState<{ id: string; legal_name: string; routing_code: string }[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE_URL}/console/accounts`),
      fetch(`${API_BASE_URL}/console/banks`),
    ]).then(async ([accRes, bankRes]) => {
      if (accRes.ok) setLiveAccounts(await accRes.json());
      if (bankRes.ok) setLiveBanks(await bankRes.json());
    }).catch(() => {});
  }, []);

  const saveGatewayKey = (k: string) => {
    setGatewayKey(k);
    if (k) localStorage.setItem('payrail_gateway_key', k);
  };

  const filtered =
    filterCategory === 'All'
      ? SERVICES
      : SERVICES.filter((s) => s.category === filterCategory);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        select option { background: #1a1a2e; color: #fff; }
      `}</style>
      <datalist id="payrail-live-accounts">
        {liveAccounts.map((a, idx) => (
          <option key={`${a.id}-${idx}`} value={a.id}>{a.name} ({a.currency})</option>
        ))}
      </datalist>
      <datalist id="payrail-live-tenants">
        {liveBanks.map((b) => (
          <option key={b.id} value={b.id}>{b.legal_name} ({b.routing_code})</option>
        ))}
      </datalist>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
            🎛️ Admin Operations Center
          </h2>
          <p
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 14,
              marginTop: 6,
              marginBottom: 0,
            }}
          >
            Execute any Payrail BaaS service directly from the admin console — no code required.
          </p>
        </div>

        {/* Mode Toggle */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.04)',
            padding: 4,
            borderRadius: 12,
            gap: 4,
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {(['easy', 'advanced'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '9px 22px',
                borderRadius: 9,
                border: mode === m && m === 'advanced' ? '1px solid rgba(99,102,241,0.4)' : 'none',
                cursor: 'pointer',
                background:
                  mode === m
                    ? m === 'easy'
                      ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                      : 'rgba(15,23,42,0.8)'
                    : 'transparent',
                color: mode === m ? '#fff' : 'rgba(255,255,255,0.35)',
                fontWeight: 700,
                fontSize: 13,
                transition: 'all 0.15s',
                boxShadow: mode === m ? '0 2px 12px rgba(99,102,241,0.3)' : 'none',
              }}
            >
              {m === 'easy' ? '⚡ Easy Mode' : '🛠️ Advanced Mode'}
            </button>
          ))}
        </div>
      </div>

      {/* Mode Banner */}
      <div
        style={{
          padding: '14px 20px',
          borderRadius: 12,
          background: mode === 'easy' ? 'rgba(99,102,241,0.1)' : 'rgba(15,23,42,0.5)',
          border: `1px solid ${mode === 'easy' ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.15)'}`,
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>
          {mode === 'easy' ? '⚡' : '🛠️'}
        </span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            {mode === 'easy'
              ? 'Easy Mode — Guided Forms'
              : 'Advanced Mode — Raw API Control'}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
            {mode === 'easy'
              ? 'Fill in labeled fields and click Execute. Perfect for day-to-day operations with no JSON knowledge required.'
              : 'Edit the full JSON request body directly. All parameters exposed. Auth headers shown transparently. Ideal for complex or non-standard calls.'}
          </div>
        </div>
      </div>

      {/* Gateway Key */}
      <div
        style={{
          padding: '14px 20px',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', fontWeight: 600, whiteSpace: 'nowrap' }}>
          🔑 Gateway API Key:
        </span>
        <input
          type="password"
          value={gatewayKey}
          onChange={(e) => saveGatewayKey(e.target.value)}
          placeholder="gw_key_… (required for gateway-authenticated services)"
          style={{
            flex: 1,
            minWidth: 240,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: '8px 14px',
            color: '#fff',
            fontSize: 13,
            outline: 'none',
            fontFamily: 'monospace',
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: gatewayKey ? '#10b981' : '#f59e0b',
            fontWeight: 700,
          }}
        >
          {gatewayKey ? '✅ Set' : '⚠️ Not Set'}
        </span>
      </div>

      {/* Category Filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              border: '1.5px solid',
              borderColor:
                filterCategory === cat ? '#6366f1' : 'rgba(255,255,255,0.09)',
              background:
                filterCategory === cat ? 'rgba(99,102,241,0.18)' : 'transparent',
              color:
                filterCategory === cat ? '#a5b4fc' : 'rgba(255,255,255,0.35)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Service Panels */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((svc) => (
          <ServicePanel key={svc.key} svc={svc} mode={mode} gatewayKey={gatewayKey} />
        ))}
      </div>

      {/* Footer Warning */}
      <div
        style={{
          padding: '14px 20px',
          borderRadius: 10,
          background: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.15)',
          fontSize: 13,
          color: 'rgba(245,158,11,0.75)',
        }}
      >
        ⚠️ <strong>Admin-only zone.</strong> All operations execute against the live Payrail
        ledger. ACH transfers, card issuance, and settlement sweeps are permanent once confirmed.
      </div>
    </div>
  );
}
