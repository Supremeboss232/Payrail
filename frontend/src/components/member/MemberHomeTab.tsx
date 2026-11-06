import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../App';
import type { MemberTab } from './MemberLayout';

interface Props {
  user: any;
  gatewayKey: string;
  refreshTrigger: number;
  onNavigateTab?: (tab: MemberTab) => void;
  onRefresh?: () => void;
}

interface ServiceStatus {
  name: string;
  status: string;
  configured: boolean;
}

export default function MemberHomeTab({ user, gatewayKey, refreshTrigger, onNavigateTab, onRefresh }: Props) {
  const [balance, setBalance] = useState(0);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [txCount, setTxCount] = useState(0);
  const [webhookCount, setWebhookCount] = useState(0);
  const [serviceCount, setServiceCount] = useState(9);
  const [providers, setProviders] = useState<Record<string, ServiceStatus>>({});
  const [loading, setLoading] = useState(true);
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  // Self-Service Settlement Mode & Webhook Configurator state
  const [myBank, setMyBank] = useState<any>(null);
  const [settlementMode, setSettlementMode] = useState<'rtgs_webhook' | 'prefunded_pool'>('rtgs_webhook');
  const [connectorType, setConnectorType] = useState<'http_callback' | 'web3_rpc'>('http_callback');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [savingConnector, setSavingConnector] = useState(false);
  const [connectorMsg, setConnectorMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pingLoading, setPingLoading] = useState(false);

  // Self-Service Reserve Liquidity Deposit state
  const [depositAccount, setDepositAccount] = useState('');
  const [depositAmountUsd, setDepositAmountUsd] = useState('25000');
  const [depositing, setDepositing] = useState(false);
  const [depositMsg, setDepositMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const bic = user?.routingCode || user?.routing_code || '';

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE_URL}/console/accounts`),
      fetch(`${API_BASE_URL}/console/transactions`),
      fetch(`${API_BASE_URL}/v1/services/catalog`),
      fetch(`${API_BASE_URL}/v1/providers/status`),
      fetch(`${API_BASE_URL}/console/webhook_endpoints`),
      fetch(`${API_BASE_URL}/console/banks`),
    ])
      .then(async ([accsRes, txsRes, catalogRes, statusRes, whRes, banksRes]) => {
        if (accsRes.ok) {
          const d = await accsRes.json();
          if (Array.isArray(d)) {
            setAccounts(d);
            setBalance(d.reduce((s: number, a: any) => s + Number(a.balance || 0), 0));
            const assetAcc = d.find((a: any) => a.type === 'asset') || d[0];
            if (assetAcc && !depositAccount) setDepositAccount(assetAcc.id);
          }
        }
        if (txsRes.ok) {
          const d = await txsRes.json();
          setTxCount(Array.isArray(d) ? d.length : 0);
        }
        if (catalogRes.ok) {
          const d = await catalogRes.json();
          setServiceCount(d.available_services || 9);
        }
        if (statusRes.ok) {
          const d = await statusRes.json();
          setProviders(d.services || {});
        }
        if (whRes.ok) {
          const d = await whRes.json();
          setWebhookCount(Array.isArray(d) ? d.length : 0);
        }
        if (banksRes.ok) {
          const banks = await banksRes.json();
          if (Array.isArray(banks)) {
            const found = banks.find((b: any) => b.routing_code === bic || b.id === user?.tenantId) || banks[0];
            if (found) {
              setMyBank(found);
              setSettlementMode(found.settlement_mode === 'prefunded_pool' ? 'prefunded_pool' : 'rtgs_webhook');
              setConnectorType(found.connector_type === 'web3_rpc' ? 'web3_rpc' : 'http_callback');
              setEndpointUrl(found.endpoint_url || '');
            }
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshTrigger, bic, user?.tenantId]);

  const handleSaveConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myBank?.id) return;
    setSavingConnector(true);
    setConnectorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/console/banks/${myBank.id}/connector`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector_type: connectorType,
          settlement_mode: settlementMode,
          url: endpointUrl,
          auth_header: authHeader || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update connector');
      setConnectorMsg({
        ok: true,
        text: `✅ Saved! Settlement mode is now ${settlementMode === 'rtgs_webhook' ? 'Direct Host RTGS Webhook (Zero Pre-Funding)' : 'Pre-Funded Reserve Pool'}.`,
      });
      onRefresh?.();
    } catch (err: any) {
      setConnectorMsg({ ok: false, text: `❌ ${err.message}` });
    } finally {
      setSavingConnector(false);
    }
  };

  const handlePingHost = async () => {
    if (!myBank?.id) return;
    setPingLoading(true);
    setConnectorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/console/banks/${myBank.id}/test_connection`, {
        method: 'POST',
      });
      const data = await res.json();
      setConnectorMsg({
        ok: !!data.ok,
        text: `${data.ok ? '✅ Host Reachable:' : '⚠️ Ping Alert:'} ${data.message} ${data.latency_ms ? `(${data.latency_ms}ms)` : ''}`,
      });
    } catch (err: any) {
      setConnectorMsg({ ok: false, text: `❌ Ping error: ${err.message}` });
    } finally {
      setPingLoading(false);
    }
  };

  const handleDepositLiquidity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositAccount) return;
    setDepositing(true);
    setDepositMsg(null);
    try {
      const amountCents = Math.round(parseFloat(depositAmountUsd) * 100);
      const res = await fetch(`${API_BASE_URL}/console/seed_funds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: depositAccount,
          amount_cents: amountCents,
          currency: 'USD',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to credit reserve liquidity');
      setDepositMsg({
        ok: true,
        text: `✅ Credited $${Number(depositAmountUsd).toLocaleString()} into clearing account!`,
      });
      onRefresh?.();
    } catch (err: any) {
      setDepositMsg({ ok: false, text: `❌ ${err.message}` });
    } finally {
      setDepositing(false);
    }
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(gatewayKey).then(() => {
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    });
  };

  const maskedKey = gatewayKey ? `${gatewayKey.slice(0, 8)}••••••••••••${gatewayKey.slice(-4)}` : 'Not set — generate in Gateway Keys tab';
  const fmt = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
  const svcList = Object.entries(providers).map(([key, s]) => ({ key, ...s }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ─── TOP EXECUTIVE SUMMARY CARDS ─── */}
      {loading ? (
        <div className="stat-grid">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton" style={{ height: 96, borderRadius: 14 }} />
          ))}
        </div>
      ) : (
        <div className="stat-grid">
          <div className="stat-card" style={{ borderLeft: '3px solid #10b981' }}>
            <span className="stat-label">Switch Clearing Position</span>
            <span className="stat-value" style={{ color: balance >= 0 ? '#34d399' : '#fbbf24' }}>{fmt(balance)}</span>
            <span className="stat-sub">
              {settlementMode === 'rtgs_webhook' ? '⚡ Direct Host RTGS Active (No pre-funding required)' : '🏦 Pre-Funded Reserve Pool Mode'}
            </span>
          </div>

          <div className="stat-card" style={{ borderLeft: '3px solid #06b6d4' }}>
            <span className="stat-label">Authorization Architecture</span>
            <span className="stat-value" style={{ fontSize: 18, color: settlementMode === 'rtgs_webhook' ? '#34d399' : '#818cf8' }}>
              {settlementMode === 'rtgs_webhook' ? 'Direct Host RTGS' : 'Pre-Funded Pool'}
            </span>
            <span className="stat-sub">
              {connectorType === 'http_callback' ? 'REST / ISO 20022 Webhook' : 'EVM Web3 JSON-RPC'}
            </span>
          </div>

          <div className="stat-card" style={{ borderLeft: '3px solid #6366f1' }}>
            <span className="stat-label">Posted Journal Entries</span>
            <span className="stat-value" style={{ color: '#a5b4fc' }}>{txCount}</span>
            <span className="stat-sub">SHA-256 Merkle-chained ledger</span>
          </div>

          <div className="stat-card" style={{ borderLeft: '3px solid #f59e0b' }}>
            <span className="stat-label">Unlocked BaaS Engines</span>
            <span className="stat-value" style={{ color: '#fbbf24' }}>{serviceCount} / 9</span>
            <span className="stat-sub">{webhookCount} active webhook subscriptions</span>
          </div>
        </div>
      )}

      {/* ─── ROW 1: SELF-SERVICE SETTLEMENT MODE CONFIGURATOR + RESERVE LIQUIDITY INJECTION ─── */}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* Left: Self-Service Settlement Mode & Core Banking Webhook Configurator */}
        <div className="card" style={{ border: '1px solid rgba(16, 185, 129, 0.3)' }}>
          <div className="card-header">
            <div>
              <span className="badge badge-success" style={{ marginBottom: 6 }}>SOLVES THE SETTLEMENT PARADOX</span>
              <h3 className="card-title">⚡ Self-Service Settlement Mode &amp; Host Webhook</h3>
              <p className="card-subtitle">
                Choose whether Payrail authorizes payments directly against your bank’s core webhook or requires a pre-funded balance on Payrail.
              </p>
            </div>
            {myBank && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handlePingHost}
                disabled={pingLoading}
              >
                {pingLoading ? 'Pinging…' : '📡 Ping Host'}
              </button>
            )}
          </div>

          <form onSubmit={handleSaveConnector}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div
                onClick={() => setSettlementMode('rtgs_webhook')}
                style={{
                  padding: '14px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  background: settlementMode === 'rtgs_webhook' ? 'rgba(16, 185, 129, 0.14)' : 'rgba(255,255,255,0.02)',
                  border: `2px solid ${settlementMode === 'rtgs_webhook' ? '#10b981' : 'var(--border-subtle)'}`,
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 13, color: '#34d399', marginBottom: 4 }}>
                  ⚡ Direct Host RTGS
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  Use your core bank’s internal reserves via webhook. <strong>Zero pre-funded balance required.</strong>
                </div>
              </div>

              <div
                onClick={() => setSettlementMode('prefunded_pool')}
                style={{
                  padding: '14px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  background: settlementMode === 'prefunded_pool' ? 'rgba(99, 102, 241, 0.14)' : 'rgba(255,255,255,0.02)',
                  border: `2px solid ${settlementMode === 'prefunded_pool' ? '#6366f1' : 'var(--border-subtle)'}`,
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 13, color: '#818cf8', marginBottom: 4 }}>
                  🏦 Pre-Funded Pool
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  Enforce pre-funded reserve balance checks on Payrail before releasing transfers.
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Connector Protocol</label>
                <select
                  className="form-select"
                  value={connectorType}
                  onChange={e => setConnectorType(e.target.value as any)}
                >
                  <option value="http_callback">REST / ISO 20022 Webhook</option>
                  <option value="web3_rpc">EVM Web3 / JSON-RPC</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Host Auth Header (Optional)</label>
                <input
                  className="form-input mono"
                  placeholder="Bearer sk_core_bank..."
                  value={authHeader}
                  onChange={e => setAuthHeader(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Core Banking Webhook / RPC Endpoint URL</label>
              <input
                className="form-input mono"
                placeholder="https://api.finanzabank.com/v1/payrail/authorize"
                value={endpointUrl}
                onChange={e => setEndpointUrl(e.target.value)}
                required
              />
            </div>

            {connectorMsg && (
              <div className={`alert ${connectorMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 14 }}>
                {connectorMsg.text}
              </div>
            )}

            <button type="submit" className="btn btn-success" disabled={savingConnector}>
              {savingConnector ? 'Updating Switch Config…' : '💾 Save Settlement Mode & Endpoint'}
            </button>
          </form>
        </div>

        {/* Right: Self-Service Clearing Reserve Liquidity Injection & Quick Launchpad */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">💰 Credit Clearing Reserve Liquidity</h3>
                <p className="card-subtitle">
                  Deposit test or settlement liquidity into your Payrail Base Clearing Account for Pre-Funded Pool transfers or DNS netting.
                </p>
              </div>
            </div>

            <form onSubmit={handleDepositLiquidity}>
              <div className="form-row">
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="form-label">Target Clearing Account</label>
                  <select
                    className="form-select mono"
                    value={depositAccount}
                    onChange={e => setDepositAccount(e.target.value)}
                  >
                    {accounts.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({fmt(Number(a.balance || 0))})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="form-label">Liquidity Deposit (USD)</label>
                  <input
                    className="form-input mono"
                    type="number"
                    min="1"
                    step="0.01"
                    value={depositAmountUsd}
                    onChange={e => setDepositAmountUsd(e.target.value)}
                    required
                  />
                </div>
              </div>

              {depositMsg && (
                <div className={`alert ${depositMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 12 }}>
                  {depositMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="submit" className="btn btn-primary" disabled={depositing}>
                  {depositing ? 'Crediting Reserve…' : `➕ Credit $${Number(depositAmountUsd || 0).toLocaleString()} to Clearing Pool`}
                </button>
                {[10000, 100000, 1000000].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setDepositAmountUsd(String(preset))}
                  >
                    +${(preset / 1000).toLocaleString()}k
                  </button>
                ))}
              </div>
            </form>
          </div>

          {/* Quick Workspace Jump Cards */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>🚀 Executive Treasury Quick Actions</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ justifyContent: 'flex-start', padding: '12px 14px' }}
                onClick={() => onNavigateTab?.('payments')}
              >
                ⚡ Send pacs.008 Switch Transfer
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ justifyContent: 'flex-start', padding: '12px 14px' }}
                onClick={() => onNavigateTab?.('payments')}
              >
                💳 Issue Virtual / Physical Card
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ justifyContent: 'flex-start', padding: '12px 14px' }}
                onClick={() => onNavigateTab?.('services')}
              >
                💱 Live FX &amp; OFAC Screening
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ justifyContent: 'flex-start', padding: '12px 14px' }}
                onClick={() => onNavigateTab?.('payments')}
              >
                ↩️ Reverse Payment (pacs.004)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── ROW 2: GATEWAY API KEY & LIVE BaaS ENGINE HEALTH ─── */}
      <div className="grid-main-aside">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">🔑 Institution Gateway API Key</h3>
              <p className="card-subtitle">
                Authenticate your core bank’s backend calls to Payrail using <code style={{ color: '#34d399' }}>X-Gateway-API-Key</code>.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setKeyRevealed(v => !v)} className="btn btn-secondary btn-sm">
                {keyRevealed ? '🙈 Hide' : '👁️ Reveal'}
              </button>
              <button onClick={handleCopyKey} className="btn btn-secondary btn-sm" disabled={!gatewayKey}>
                {keyCopied ? '✅ Copied' : '📋 Copy Key'}
              </button>
            </div>
          </div>

          <div style={{
            padding: '12px 16px',
            borderRadius: 10,
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: '#34d399',
            marginBottom: 16,
            wordBreak: 'break-all',
          }}>
            {keyRevealed ? (gatewayKey || 'No active key in browser storage — generate one in Gateway Keys tab') : maskedKey}
          </div>

          <pre className="code-block" style={{ margin: 0 }}>
{`# Initiate & Settle an Interbank Transfer from ${user?.legalName || 'Your Bank'}
curl -X POST ${API_BASE_URL}/v1/gateway/payment_intents \\
  -H "X-Gateway-API-Key: ${keyRevealed ? (gatewayKey || 'gw_live_sk_...') : maskedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount_cents": 25000, "currency": "USD", "destination_account_id": "${accounts[0]?.id || 'target_acc_id'}"}'`}
          </pre>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">🔌 Live BaaS Engine Telemetry</h3>
            <span className="badge badge-success">{svcList.length} Engines</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {svcList.map(svc => (
              <div
                key={svc.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{svc.name || svc.key}</span>
                <span className={`badge ${svc.status === 'live' || svc.status === 'available' ? 'badge-success' : 'badge-warning'}`}>
                  {svc.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
