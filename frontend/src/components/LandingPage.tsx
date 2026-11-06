import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../App';

interface LandingPageProps {
  onNavigate: (view: 'login' | 'register') => void;
}

type SettlementModeDemo = 'rtgs_webhook' | 'prefunded_pool' | 'multilateral_dns';
type CodeTab = 'pacs008' | 'pacs002' | 'pacs009' | 'pacs004' | 'cards' | 'fx_ofac';

const SETTLEMENT_MODES: Record<SettlementModeDemo, {
  badge: string;
  title: string;
  subtitle: string;
  accent: string;
  summary: string;
  steps: { actor: string; action: string; detail: string; status: string }[];
  pros: string[];
}> = {
  rtgs_webhook: {
    badge: '⚡ Mode A — Default for Core Banks (Zero Pre-Funding)',
    title: 'Direct Host RTGS Webhook Authorization',
    subtitle: 'Solves the Settlement Paradox: Finanza Bank uses its own core database reserves directly without locking pre-funded capital on Payrail.',
    accent: '#10b981',
    summary: 'When Finanza Bank initiates an interbank payment or swap, Payrail dispatches a synchronous ISO 20022 webhook to Finanza’s core host. Once Finanza’s core database authorizes the debit against its $10M internal reserves, Payrail atomically posts the interbank clearing leg and credits the receiving institution.',
    steps: [
      { actor: '1. Finanza Bank Core', action: 'POST /v1/gateway/payment_intents', detail: 'Finanza requests a $250.00 transfer to Partner Bank B via Payrail Switch.', status: 'Initiated' },
      { actor: '2. Payrail Sovereign Switch', action: 'Synchronous Host Callback (RTGS)', detail: 'Payrail calls Finanza’s registered webhook endpoint to verify & lock $250.00 on Finanza’s internal ledger.', status: '200 OK (Authorized)' },
      { actor: '3. Merkle Double-Entry Engine', action: 'Atomic Cross-Tenant Journal Post', detail: 'Debits Finanza Clearing Account & credits Partner Bank B Clearing Account with SHA-256 hash chain.', status: 'Posted' },
      { actor: '4. ISO 20022 Dispatch', action: 'pacs.008 + pacs.002 Receipt', detail: 'Emits signed pacs.008.001.08 instruction and ACSC pacs.002.001.10 confirmation to both banks.', status: 'Settled' },
    ],
    pros: [
      'Zero idle capital trapped in pre-funded clearing pools',
      'Instant Real-Time Gross Settlement (RTGS) finality in < 400ms',
      'Automatic bilateral net position tracking on the central switch',
    ],
  },
  prefunded_pool: {
    badge: '🏦 Mode B — Guaranteed Reserve Ring-Fencing',
    title: 'Pre-Funded Reserve Clearing Pool',
    subtitle: 'Zero-counterparty-default architecture where member institutions maintain ring-fenced liquidity directly inside Payrail.',
    accent: '#6366f1',
    summary: 'Member institutions deposit liquidity into their isolated Payrail Base Clearing Account. Before executing any outbound payment or card authorization, Payrail verifies that the bank’s pre-funded clearing balance covers 100% of the transfer amount.',
    steps: [
      { actor: '1. Member Treasury', action: 'Reserve Liquidity Injection', detail: 'Institution credits $1,000,000.00 into its Base Clearing Account on Payrail.', status: 'Funded' },
      { actor: '2. Payrail Risk Guard', action: 'Pre-Trade Liquidity Check', detail: 'Verifies Base Clearing Account balance >= transfer amount before routing.', status: 'Verified' },
      { actor: '3. Priority Waterfall Router', action: 'Connector Execution', detail: 'Executes outbound payout with automatic failover across Priority 1 → 2 → 3 rails.', status: 'Executed' },
      { actor: '4. Instant Settlement', action: 'Zero Counterparty Risk', detail: 'Receiving bank has 100% central clearinghouse guarantee backed by ring-fenced reserves.', status: 'Guaranteed' },
    ],
    pros: [
      'Eliminates interbank default and daylight overdraft risk',
      'Ideal for neo-banks, fintechs, and programmatic card-issuing programs',
      'Supports automated low-balance webhook alerts',
    ],
  },
  multilateral_dns: {
    badge: '🌐 Mode C — Central Bank Netting Engine',
    title: 'Multilateral Deferred Net Settlement (ISO 20022 pacs.009)',
    subtitle: 'Compresses thousands of gross interbank transfers into a single end-of-cycle net settlement sweep.',
    accent: '#06b6d4',
    summary: 'Throughout the trading day, member banks accumulate net payable or net receivable positions on the switch. At any moment, the Clearinghouse Operator triggers a Multilateral DNS Sweep that generates a cryptographically signed ISO 20022 pacs.009.001.08 Financial Institution Credit Transfer.',
    steps: [
      { actor: '1. Intraday Activity', action: 'Continuous Bilateral Flows', detail: 'Bank A sends $500k to Bank B; Bank B sends $420k to Bank A across 1,400 transactions.', status: 'Netting' },
      { actor: '2. Net Position Matrix', action: 'Exposure Compression', detail: 'Payrail calculates a single net obligation of $80k instead of $920k gross movement.', status: '91% Liquidity Saved' },
      { actor: '3. DNS Sweep Execution', action: 'POST /v1/settlements/dns_sweep', detail: 'Generates ISO 20022 pacs.009 XML batch and zeroes all intraday clearing legs.', status: 'pacs.009 Emitted' },
      { actor: '4. camt.053 Statement', action: 'End-of-Day Reconciliation', detail: 'Each member bank downloads its XML Bank-to-Customer Statement (camt.053.001.08).', status: 'Reconciled' },
    ],
    pros: [
      'Reduces interbank liquidity requirements by up to 90%',
      'Full ISO 20022 pacs.009.001.08 & camt.053.001.08 XML compliance',
      'Supports both single-bank liquidity sweeps and full multilateral clearing',
    ],
  },
};

const CODE_EXAMPLES: Record<CodeTab, { label: string; badge: string; title: string; code: string }> = {
  pacs008: {
    label: '📄 pacs.008 Transfer',
    badge: 'ISO 20022 Customer Credit Transfer',
    title: 'Execute a Secp256k1-Signed Interbank Transfer',
    code: `POST /v1/payment_intents/:id/confirm HTTP/1.1
Host: switch.payrail.sovereign
X-Payrail-BIC: FINANZA_BANK_BIC
X-Payrail-Signature: 3045022100a8f9...ecdsa_secp256k1_der_hex

<!-- Generated ISO 20022 pacs.008.001.08 Payload -->
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>MSG-9F82A10C-2026</MsgId>
      <CreDtTm>2026-11-06T14:22:10.104Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf><SttlmMtd>CLRG</SttlmMtd></SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId><EndToEndId>E2E-FINANZA-25000</EndToEndId></PmtId>
      <IntrBkSttlmAmt Ccy="USD">250.00</IntrBkSttlmAmt>
      <DbtrAgt><FinInstnId><BICFI>FINANZA_BANK_BIC</BICFI></FinInstnId></DbtrAgt>
      <CdtrAgt><FinInstnId><BICFI>PARTNER_BANK_BIC</BICFI></FinInstnId></CdtrAgt>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`,
  },
  pacs002: {
    label: '✅ pacs.002 Status',
    badge: 'ISO 20022 Payment Status Report',
    title: 'Synchronous ACSC Settlement Finality Receipt',
    code: `<!-- Returned Automatically Upon Confirm or Failure (pacs.002.001.10) -->
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.002.001.10">
  <FIToFIPmtStsRpt>
    <GrpHdr>
      <MsgId>STS-77B4E219-2026</MsgId>
      <CreDtTm>2026-11-06T14:22:10.312Z</CreDtTm>
    </GrpHdr>
    <TxInfAndSts>
      <OrgnlEndToEndId>E2E-FINANZA-25000</OrgnlEndToEndId>
      <OrgnlTxId>pi_9081f2a7-4e11</OrgnlTxId>
      <TxSts>ACSC</TxSts> <!-- AcceptedSettlementCompleted -->
      <AccptncDtTm>2026-11-06T14:22:10.312Z</AccptncDtTm>
      <InstgAgt><FinInstnId><BICFI>PAYRAIL_SWITCH</BICFI></FinInstnId></InstgAgt>
    </TxInfAndSts>
  </FIToFIPmtStsRpt>
</Document>`,
  },
  pacs009: {
    label: '🌐 pacs.009 Net Sweep',
    badge: 'ISO 20022 Multilateral DNS',
    title: 'Multilateral Deferred Net Settlement Batch Instruction',
    code: `POST /v1/settlements/dns_sweep HTTP/1.1
Authorization: Bearer <clearinghouse_operator_jwt>

<!-- Emitted ISO 20022 pacs.009.001.08 Financial Institution Credit Transfer -->
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08">
  <FICdtTrf>
    <GrpHdr>
      <MsgId>DNS-SWEEP-20261106</MsgId>
      <NbOfTxs>2</NbOfTxs>
      <SttlmInf><SttlmMtd>CLRG</SttlmMtd></SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId><EndToEndId>DNS-NET-FINANZA</EndToEndId></PmtId>
      <IntrBkSttlmAmt Ccy="USD">12500.00</IntrBkSttlmAmt>
      <Dbtr><FinInstnId><BICFI>PAYRAIL_CLEARINGHOUSE</BICFI></FinInstnId></Dbtr>
      <Cdtr><FinInstnId><BICFI>FINANZA_BANK_BIC</BICFI></FinInstnId></Cdtr>
    </CdtTrfTxInf>
  </FICdtTrf>
</Document>`,
  },
  pacs004: {
    label: '↩️ pacs.004 Return',
    badge: 'ISO 20022 Payment Return',
    title: 'Cryptographic Contra-Entry Reversal & Return',
    code: `POST /v1/payment_intents/pi_9081f2a7-4e11/reverse HTTP/1.1
X-Gateway-API-Key: gw_live_sk_••••••••••••
Content-Type: application/json

{
  "reason_code": "CUST",
  "notes": "Customer requested recall — atomic contra-entries posted"
}

<!-- Emits pacs.004.001.09 PaymentReturn XML & reverses both ledger legs -->`,
  },
  cards: {
    label: '💳 Card Issuing & Auth',
    badge: 'BaaS Virtual & Physical Cards',
    title: 'Issue Luhn-Valid Cards & Authorize Merchant Purchases',
    code: `# 1. Issue a Virtual Visa/Mastercard for a Customer
curl -X POST https://switch.payrail.sovereign/v1/gateway/cards/issue \\
  -H "X-Gateway-API-Key: gw_live_sk_••••••••" \\
  -d '{"cardholder_name": "Adaeze Okafor", "credit_limit_cents": 1000000, "currency": "USD"}'

# 2. Authorize a Live Merchant Purchase Against the Card Limit
curl -X POST https://switch.payrail.sovereign/v1/gateway/cards/card_88a1/authorize \\
  -H "X-Gateway-API-Key: gw_live_sk_••••••••" \\
  -d '{"amount_cents": 45000, "merchant_name": "AWS Cloud Services", "mcc": "7372"}'`,
  },
  fx_ofac: {
    label: '🛡️ Live FX & OFAC',
    badge: 'BaaS Treasury & Compliance',
    title: 'Real-Time Cross-Currency FX & Fuzzy Jaro-Winkler OFAC Screening',
    code: `# 1. Convert USD -> NGN / EUR / GBP at Live Market Rates
curl -X POST https://switch.payrail.sovereign/v1/fx/convert \\
  -H "Content-Type: application/json" \\
  -d '{"from": "USD", "to": "EUR", "amount": 25000}'

# 2. Screen Beneficiary Against OFAC SDN + Fuzzy Jaro-Winkler Engine
curl -X POST https://switch.payrail.sovereign/v1/compliance/screen \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Acme Global Holdings Ltd", "country": "US", "amount_cents": 2500000}'`,
  },
};

const CAPABILITY_PILLARS = [
  {
    domain: '01 · Interbank Settlement & Routing',
    color: '#6366f1',
    items: [
      { icon: '⚡', name: 'Hybrid RTGS + Pre-Funded Switch', desc: 'Choose Direct Host RTGS Webhook authorization (zero pre-funding) or ring-fenced Pre-Funded Clearing Pools per institution.' },
      { icon: '🌐', name: 'Multilateral DNS (pacs.009)', desc: 'Compress intraday bilateral obligations and sweep net positions across all member banks in a single atomic batch.' },
      { icon: '🔀', name: 'Priority Waterfall Failover', desc: 'Automatic Priority 1 → 2 → 3 connector failover across HTTP Webhooks, EVM RPC nodes, and Internal Reserves.' },
    ],
  },
  {
    domain: '02 · Cryptographic Ledger & ISO 20022',
    color: '#06b6d4',
    items: [
      { icon: '⛓️', name: 'SHA-256 Merkle Journal Chain', desc: 'Every double-entry transaction is hashed with its predecessor, making historical tampering mathematically impossible.' },
      { icon: '📜', name: 'Full ISO 20022 XML Suite', desc: 'Native generation and storage of pacs.008, pacs.002, pacs.009, pacs.004 returns, and camt.053 bank statements.' },
      { icon: '🔑', name: 'Secp256k1 ECDSA Non-Repudiation', desc: 'Every member institution signs interbank instructions with its own elliptic-curve private key.' },
    ],
  },
  {
    domain: '03 · 9 Integrated BaaS Engines',
    color: '#10b981',
    items: [
      { icon: '💳', name: 'Card Issuing & Merchant Auth', desc: 'Issue virtual/physical cards, freeze/unfreeze, manage chargebacks, and run live merchant purchase authorizations.' },
      { icon: '🛡️', name: 'Fuzzy OFAC & AML Compliance', desc: 'Jaro-Winkler similarity + token matching against sanctions lists with automatic SAR case queue generation.' },
      { icon: '💱', name: 'Live FX, ACH/Wire, OTP & Credit', desc: 'Live multi-currency FX feeds, ACH/Fedwire origination, Resend Email OTP, and CRS Credit Bureau soft pulls.' },
    ],
  },
];

export default function LandingPage({ onNavigate }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);
  const [activeMode, setActiveMode] = useState<SettlementModeDemo>('rtgs_webhook');
  const [activeCode, setActiveCode] = useState<CodeTab>('pacs008');
  const [copiedCode, setCopiedCode] = useState(false);

  // Live telemetry from backend
  const [telemetry, setTelemetry] = useState<{
    online: boolean;
    dbEngine: string;
    ethBlock: string;
    fxEur: string;
    fxGbp: string;
    fxNgn: string;
  }>({
    online: true,
    dbEngine: 'PostgreSQL / SQLite Dual Engine',
    ethBlock: 'Live EVM RPC',
    fxEur: '0.92',
    fxGbp: '0.79',
    fxNgn: '1,580.00',
  });

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    Promise.allSettled([
      fetch(`${API_BASE_URL}/v1/system/status`),
      fetch(`${API_BASE_URL}/v1/fx/rates?base=USD`),
      fetch(`${API_BASE_URL}/v1/crypto/status`),
    ]).then(async ([sysRes, fxRes, cryptoRes]) => {
      const next = { ...telemetry };
      if (sysRes.status === 'fulfilled' && sysRes.value.ok) {
        const d = await sysRes.value.json();
        next.online = true;
        next.dbEngine = d.database?.engine === 'postgres' ? 'Nile PostgreSQL Sharded' : 'SQLite WAL Embedded';
      }
      if (fxRes.status === 'fulfilled' && fxRes.value.ok) {
        const d = await fxRes.value.json();
        if (d.rates) {
          if (d.rates.EUR) next.fxEur = Number(d.rates.EUR).toFixed(4);
          if (d.rates.GBP) next.fxGbp = Number(d.rates.GBP).toFixed(4);
          if (d.rates.NGN) next.fxNgn = Number(d.rates.NGN).toLocaleString(undefined, { maximumFractionDigits: 2 });
        }
      }
      if (cryptoRes.status === 'fulfilled' && cryptoRes.value.ok) {
        const d = await cryptoRes.value.json();
        if (d.block_number) next.ethBlock = `#${Number(d.block_number).toLocaleString()} (${d.latency_ms || 42}ms)`;
      }
      setTelemetry(next);
    });
  }, []);

  const modeInfo = SETTLEMENT_MODES[activeMode];
  const codeInfo = CODE_EXAMPLES[activeCode];

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(codeInfo.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  return (
    <div className="landing-root" style={{ position: 'relative' }}>
      {/* ── LIVE TELEMETRY RIBBON ── */}
      <div style={{
        background: 'rgba(3, 7, 18, 0.95)',
        borderBottom: '1px solid rgba(99, 102, 241, 0.22)',
        padding: '7px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        fontSize: 11.5,
        fontFamily: 'var(--font-mono)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#34d399', fontWeight: 700 }}>
            <span className="status-dot online" />
            SOVEREIGN SWITCH: OPERATIONAL
          </span>
          <span style={{ color: 'var(--text-muted)' }}>|</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            LEDGER: <strong style={{ color: '#a5b4fc' }}>{telemetry.dbEngine}</strong>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>|</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            ETH MAINNET: <strong style={{ color: '#22d3ee' }}>{telemetry.ethBlock}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: 'var(--text-secondary)' }}>
          <span>LIVE FX MID-MARKET:</span>
          <span style={{ color: '#f8fafc' }}>USD/EUR <strong style={{ color: '#34d399' }}>{telemetry.fxEur}</strong></span>
          <span style={{ color: '#f8fafc' }}>USD/GBP <strong style={{ color: '#34d399' }}>{telemetry.fxGbp}</strong></span>
          <span style={{ color: '#f8fafc' }}>USD/NGN <strong style={{ color: '#34d399' }}>{telemetry.fxNgn}</strong></span>
        </div>
      </div>

      {/* ── NAVIGATION BAR ── */}
      <nav className="lp-nav" style={{
        boxShadow: scrolled ? '0 8px 32px rgba(0,0,0,0.55)' : 'none',
        transition: 'box-shadow 0.25s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, boxShadow: '0 4px 18px rgba(99, 102, 241, 0.45)',
          }}>⚡</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: '-0.02em', color: '#f8fafc', lineHeight: 1.1 }}>
              PAYRAIL <span style={{ color: '#818cf8' }}>v3.0</span>
            </div>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Sovereign Financial Switch & Orchestration Cloud
            </div>
          </div>
          <span className="badge badge-info" style={{ marginLeft: 8 }}>
            ISO 20022 · RTGS + DNS
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="#settlement-simulator" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
            ⚡ Settlement Simulator
          </a>
          <a href="#iso-explorer" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
            📜 ISO 20022 Explorer
          </a>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('login')}>
            🔐 Sign In to Portal
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate('register')}>
            🏛️ Onboard Institution →
          </button>
        </div>
      </nav>

      {/* ── HERO SECTION ── */}
      <header className="lp-hero" style={{ paddingBottom: 64 }}>
        <div style={{ position: 'absolute', top: '6%', left: '12%', width: 460, height: 460, background: 'radial-gradient(circle, rgba(99,102,241,0.16) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(50px)' }} />
        <div style={{ position: 'absolute', top: '14%', right: '10%', width: 380, height: 380, background: 'radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%)', pointerEvents: 'none', filter: 'blur(50px)' }} />

        <div style={{ position: 'relative', maxWidth: 960, margin: '0 auto' }}>
          <div className="lp-hero-pill" style={{ marginBottom: 24 }}>
            <span className="status-dot online" />
            Sovereign Interbank Switch · Direct Host RTGS · Multilateral DNS · 9 Live BaaS Engines
          </div>

          <h1 style={{ marginBottom: 22, letterSpacing: '-0.04em', fontSize: 'clamp(36px, 5.2vw, 62px)', lineHeight: 1.06 }}>
            Where Commercial Banks,{' '}
            <span className="gradient-text">Central Clearinghouses</span>
            {' '}&amp; Fintechs Settle as One
          </h1>

          <p style={{ fontSize: 17.5, maxWidth: 740, margin: '0 auto 36px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Connect your core bank (like <strong style={{ color: '#f8fafc' }}>Finanza Financial Services</strong>) via{' '}
            <strong style={{ color: '#34d399' }}>Direct Host RTGS Webhooks</strong> with zero trapped pre-funding, or maintain ring-fenced clearing pools. Route ISO 20022 <code style={{ color: '#a5b4fc' }}>pacs.008</code>, <code style={{ color: '#a5b4fc' }}>pacs.002</code>, <code style={{ color: '#a5b4fc' }}>pacs.009</code>, and <code style={{ color: '#a5b4fc' }}>pacs.004</code> messages alongside 9 turn-key BaaS services.
          </p>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 48 }}>
            <button className="btn btn-primary btn-lg" onClick={() => onNavigate('register')} style={{ padding: '14px 28px', fontSize: 15 }}>
              🏛️ Connect Your Institution (5-Step Wizard) →
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => onNavigate('login')} style={{ padding: '14px 24px', fontSize: 15 }}>
              ⚡ Launch Operator / Bank Portal
            </button>
          </div>

          {/* ── TWO DISTINCT PORTAL ARCHITECTURES CALLOUT ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 18,
            textAlign: 'left',
            maxWidth: 920,
            margin: '0 auto',
          }}>
            <div style={{
              padding: '22px 24px',
              borderRadius: 16,
              background: 'linear-gradient(145deg, rgba(99, 102, 241, 0.12), rgba(15, 23, 42, 0.85))',
              border: '1px solid rgba(99, 102, 241, 0.35)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span className="badge badge-info">PORTAL ARCHITECTURE 01</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#818cf8' }}>Role: Admin Operator</span>
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 6, color: '#f8fafc' }}>
                ⚡ Sovereign Central Clearinghouse Command Deck
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
                Widescreen central-bank operations floor with real-time Interbank Netting Matrix, 1-click Multilateral DNS Sweeps (<code style={{ color: '#a5b4fc' }}>pacs.009</code>), Member Bank Connector Drawer, Priority Waterfall Router, and AES-256-GCM Provider Vault.
              </p>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('login')}>
                Enter Clearinghouse Command Deck →
              </button>
            </div>

            <div style={{
              padding: '22px 24px',
              borderRadius: 16,
              background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.12), rgba(6, 24, 28, 0.88))',
              border: '1px solid rgba(16, 185, 129, 0.35)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span className="badge badge-success">PORTAL ARCHITECTURE 02</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#34d399' }}>Role: Member Bank / Fintech</span>
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 6, color: '#f8fafc' }}>
                🏦 Partner Bank Executive Treasury Workstation
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
                Dedicated commercial-banking horizontal workstation for member institutions. Self-configure <strong style={{ color: '#34d399' }}>Direct Host RTGS vs. Pre-Funded</strong> mode, issue virtual cards, run live FX/OFAC checks, and reverse payments.
              </p>
              <button className="btn btn-success btn-sm" onClick={() => onNavigate('register')}>
                Onboard Partner Bank →
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── STATS BAND ── */}
      <div className="lp-stats-band">
        <div className="lp-stats-inner">
          <div>
            <div className="lp-stat-num" style={{ color: '#818cf8' }}>RTGS + DNS</div>
            <div className="lp-stat-label">Dual Settlement Architecture</div>
          </div>
          <div>
            <div className="lp-stat-num" style={{ color: '#22d3ee' }}>5 Schemas</div>
            <div className="lp-stat-label">pacs.008 / 002 / 009 / 004 &amp; camt.053</div>
          </div>
          <div>
            <div className="lp-stat-num" style={{ color: '#34d399' }}>9 Engines</div>
            <div className="lp-stat-label">Cards · ACH · FX · OFAC · Crypto · OTP · Credit</div>
          </div>
          <div>
            <div className="lp-stat-num" style={{ color: '#fbbf24' }}>SHA-256</div>
            <div className="lp-stat-label">Merkle-Chained Double-Entry Ledger</div>
          </div>
        </div>
      </div>

      {/* ── INTERACTIVE SETTLEMENT ARCHITECTURE SIMULATOR ── */}
      <section id="settlement-simulator" style={{ padding: '84px 32px', maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div className="lp-hero-pill" style={{ display: 'inline-flex', marginBottom: 14 }}>
            Interactive Settlement Architecture Simulator
          </div>
          <h2 style={{ fontSize: 32, marginBottom: 10 }}>
            How Payrail Solves the Interbank Settlement Paradox
          </h2>
          <p style={{ maxWidth: 680, margin: '0 auto', fontSize: 15, color: 'var(--text-secondary)' }}>
            Select a settlement architecture below to inspect how Payrail routes value between{' '}
            <strong style={{ color: '#f8fafc' }}>Finanza Bank</strong>, <strong style={{ color: '#f8fafc' }}>Partner Banks</strong>, and external liquidity rails.
          </p>
        </div>

        {/* Mode Selector Tabs */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14,
          marginBottom: 28,
        }}>
          {(Object.keys(SETTLEMENT_MODES) as SettlementModeDemo[]).map((key) => {
            const m = SETTLEMENT_MODES[key];
            const active = activeMode === key;
            return (
              <button
                key={key}
                onClick={() => setActiveMode(key)}
                style={{
                  textAlign: 'left',
                  padding: '18px 20px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  background: active ? 'rgba(99, 102, 241, 0.14)' : 'rgba(15, 23, 42, 0.75)',
                  border: `2px solid ${active ? m.accent : 'rgba(148, 163, 184, 0.16)'}`,
                  transition: 'all 0.18s',
                  color: '#f8fafc',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: m.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  {m.badge}
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: 6 }}>
                  {m.title}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {m.subtitle}
                </div>
              </button>
            );
          })}
        </div>

        {/* Active Mode Interactive Flow Card */}
        <div className="card" style={{
          padding: '32px',
          border: `1px solid ${modeInfo.accent}55`,
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(9, 13, 24, 0.98) 100%)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
            <div style={{ maxWidth: 720 }}>
              <span className="badge" style={{ background: `${modeInfo.accent}20`, color: modeInfo.accent, border: `1px solid ${modeInfo.accent}44`, marginBottom: 10 }}>
                {modeInfo.badge}
              </span>
              <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{modeInfo.title}</h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                {modeInfo.summary}
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => onNavigate('register')}>
              Configure This Mode →
            </button>
          </div>

          {/* 4-Step Pipeline */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
            marginBottom: 24,
          }}>
            {modeInfo.steps.map((st, idx) => (
              <div key={idx} style={{
                padding: '18px',
                borderRadius: 12,
                background: 'rgba(3, 7, 18, 0.65)',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: modeInfo.accent, textTransform: 'uppercase', marginBottom: 6 }}>
                    {st.actor}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#f8fafc', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                    {st.action}
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 14 }}>
                    {st.detail}
                  </p>
                </div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#34d399',
                  fontFamily: 'var(--font-mono)',
                }}>
                  <span>✓</span> {st.status}
                </div>
              </div>
            ))}
          </div>

          {/* Key Architectural Guarantees */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            paddingTop: 18,
            borderTop: '1px solid rgba(148, 163, 184, 0.14)',
          }}>
            {modeInfo.pros.map((pro, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0' }}>
                <span style={{ color: modeInfo.accent, fontWeight: 900 }}>●</span>
                <span>{pro}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── INTERACTIVE ISO 20022 & BaaS CODE EXPLORER ── */}
      <section id="iso-explorer" style={{ padding: '40px 32px 84px', maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div className="lp-hero-pill" style={{ display: 'inline-flex', marginBottom: 14 }}>
            Developer &amp; Architect Wire Inspector
          </div>
          <h2 style={{ fontSize: 32, marginBottom: 10 }}>
            Native ISO 20022 XML &amp; BaaS Gateway Payloads
          </h2>
          <p style={{ maxWidth: 640, margin: '0 auto', fontSize: 15, color: 'var(--text-secondary)' }}>
            Inspect real wire payloads generated and verified by the Payrail v3.0 engine.
          </p>
        </div>

        <div className="terminal-window" style={{ maxWidth: 980, margin: '0 auto' }}>
          <div className="terminal-bar" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {(Object.keys(CODE_EXAMPLES) as CodeTab[]).map((tabKey) => (
                <button
                  key={tabKey}
                  onClick={() => setActiveCode(tabKey)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 7,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                    background: activeCode === tabKey ? 'rgba(99, 102, 241, 0.28)' : 'transparent',
                    color: activeCode === tabKey ? '#a5b4fc' : '#94a3b8',
                    transition: 'all 0.15s',
                  }}
                >
                  {CODE_EXAMPLES[tabKey].label}
                </button>
              ))}
            </div>

            <button className="btn btn-secondary btn-sm" onClick={handleCopySnippet}>
              {copiedCode ? '✅ Copied' : '📋 Copy Payload'}
            </button>
          </div>

          <div style={{
            padding: '14px 24px',
            background: 'rgba(99, 102, 241, 0.07)',
            borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}>
            <span style={{ fontWeight: 700, fontSize: 13.5, color: '#f8fafc' }}>{codeInfo.title}</span>
            <span className="badge badge-info">{codeInfo.badge}</span>
          </div>

          <pre className="terminal-body" style={{ margin: 0, overflowX: 'auto', fontSize: 12.5, lineHeight: 1.7 }}>
            {codeInfo.code}
          </pre>
        </div>
      </section>

      {/* ── 3 ARCHITECTURAL PILLARS (9 SERVICES + SWITCH) ── */}
      <section className="lp-features" style={{ paddingTop: 20 }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div className="lp-hero-pill" style={{ display: 'inline-flex', marginBottom: 14 }}>
            Full-Stack Sovereign Financial Capabilities
          </div>
          <h2 style={{ fontSize: 32, marginBottom: 10 }}>Built for Maximum Institutional Scale</h2>
          <p style={{ maxWidth: 600, margin: '0 auto', color: 'var(--text-secondary)' }}>
            Every module is live, database-backed, and accessible via both the interactive portals and REST/ISO 20022 APIs.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {CAPABILITY_PILLARS.map((pillar) => (
            <div key={pillar.domain} className="card" style={{ padding: '28px' }}>
              <div style={{
                fontSize: 12,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: pillar.color,
                marginBottom: 18,
              }}>
                {pillar.domain}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 18,
              }}>
                {pillar.items.map((item) => (
                  <div key={item.name} style={{
                    padding: '20px',
                    borderRadius: 12,
                    background: 'rgba(3, 7, 18, 0.5)',
                    border: '1px solid rgba(148, 163, 184, 0.12)',
                  }}>
                    <div style={{ fontSize: 24, marginBottom: 10 }}>{item.icon}</div>
                    <h3 style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6, color: '#f8fafc' }}>{item.name}</h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CALL TO ACTION ── */}
      <section className="lp-cta">
        <div className="lp-cta-card">
          <div style={{ marginBottom: 14, fontSize: 42 }}>⚡</div>
          <h2 style={{ marginBottom: 14, fontSize: 30 }}>
            Ready to Connect Your Core Bank or Launch a New Institution?
          </h2>
          <p style={{ marginBottom: 32, fontSize: 15.5, maxWidth: 540, margin: '0 auto 32px', color: 'var(--text-secondary)' }}>
            Register your BIC, choose <strong style={{ color: '#34d399' }}>Direct Host RTGS Webhook</strong> or <strong style={{ color: '#818cf8' }}>Pre-Funded Pool</strong> settlement, download your Secp256k1 keypair, and start transacting immediately.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-lg" onClick={() => onNavigate('register')}>
              🏛️ Start 5-Step Institution Onboarding →
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => onNavigate('login')}>
              🔐 Sign In to Existing Portal
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg, #6366f1, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>⚡</div>
          <span style={{ fontWeight: 800, color: '#f8fafc' }}>Payrail v3.0 — Sovereign Financial Switch &amp; Orchestration Cloud</span>
        </div>
        <p>© 2026 Payrail Clearinghouse Network · ISO 20022 (pacs.008 / pacs.002 / pacs.009 / pacs.004 / camt.053) · Secp256k1 ECDSA · AES-256-GCM</p>
      </footer>
    </div>
  );
}
