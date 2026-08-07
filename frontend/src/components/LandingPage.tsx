import { useState } from 'react';

interface LandingPageProps {
  onNavigate: (view: 'login' | 'register') => void;
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  const [activeStep, setActiveStep] = useState<number>(0);

  const simulationSteps = [
    {
      title: "1. Pacs.008 Initiation",
      desc: "Bank A signs a transaction using their Secp256k1 private key. The payload is sent to Payrail via a secure B2B RPC request.",
      code: `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">\n  <FIToFICstmrCdtTrf>\n    <GrpHdr>\n      <MsgId>pi_banka_0921</MsgId>\n      <CreDtTm>2026-07-24T17:34:00Z</CreDtTm>\n    </GrpHdr>\n  </FIToFICstmrCdtTrf>\n</Document>`
    },
    {
      title: "2. Clearinghouse Offset",
      desc: "Payrail validates the cryptographic signature against Tenant A's public key, and inserts double-entry offset legs in the ledger.",
      code: `// Double-Entry Ledger Legs\nDebit: Bank_A_Clearing_Account  $500.00\nCredit: Central_Clearing_Account $500.00\nStatus: Pending_Net_Settlement`
    },
    {
      title: "3. Net Sweep (Pacs.009)",
      desc: "The Deferred Net Settlement Sweep aggregates positions, clears the offset, and releases funds to Bank B via a Pacs.009 cover message.",
      code: `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08">\n  <FICdtTrf>\n    <GrpHdr>\n      <MsgId>sweep_operator_981</MsgId>\n      <SttlmInf>\n        <SttlmMtd>COVE</SttlmMtd>\n      </SttlmInf>\n    </GrpHdr>\n  </FICdtTrf>\n</Document>`
    }
  ];

  return (
    <div className="landing-container">
      {/* Dynamic Animated background glows */}
      <div className="landing-glow glow-1" />
      <div className="landing-glow glow-2" />
      <div className="landing-glow glow-3" />

      {/* Header / Navbar */}
      <nav className="landing-nav">
        <div className="nav-logo">
          <span className="logo-icon-glow">⚡</span>
          <span className="logo-text">Payrail</span>
          <span className="badge-beta">ENTERPRISE v2.1</span>
        </div>
        <div className="nav-buttons">
          <button className="btn btn-nav-secondary" onClick={() => onNavigate('login')}>
            Member Portal
          </button>
          <button className="btn btn-nav-primary" onClick={() => onNavigate('register')}>
            Onboard Institution
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="landing-hero">
        <div className="badge-glow">
          <span className="dot-live">●</span> ISO 20022 COMPLIANT DEFERRED NET SETTLEMENT
        </div>
        <h1 className="hero-title">
          Universal Interbank <br />
          <span className="gradient-text">Clearing & Settlement</span>
        </h1>
        <p className="hero-subtitle">
          Payrail is a state-of-the-art multi-tenant double-entry ledger gateway built on Nile PostgreSQL sharded boundaries.
          Securely settle accounts and transfer assets across financial institutions, banks, and private crypto rails.
        </p>
        <div className="hero-cta">
          <button className="btn btn-hero-primary" onClick={() => onNavigate('register')}>
            Register Bank (BIC Onboarding)
          </button>
          <button className="btn btn-hero-secondary" onClick={() => onNavigate('login')}>
            Access Clearinghouse Console
          </button>
        </div>
      </header>

      {/* Real-time Flow Interactive Simulator */}
      <section className="architecture-section">
        <h2 className="section-title">Visual Settlement Sequence Explorer</h2>
        
        <div className="interactive-simulator-card glass">
          <div className="sim-nav">
            {simulationSteps.map((step, idx) => (
              <button 
                key={idx} 
                className={`sim-nav-btn ${activeStep === idx ? 'active' : ''}`}
                onClick={() => setActiveStep(idx)}
              >
                {step.title}
              </button>
            ))}
          </div>

          <div className="sim-body">
            <div className="sim-info">
              <h3>{simulationSteps[activeStep].title}</h3>
              <p>{simulationSteps[activeStep].desc}</p>
              
              {/* Visual SVG Flow Diagram */}
              <div className="svg-flow-container">
                <svg className="flow-svg" viewBox="0 0 400 120">
                  {/* Nodes */}
                  <circle cx="50" cy="60" r="22" className={`node-circle ${activeStep === 0 ? 'highlight-cyan' : ''}`} />
                  <text x="50" y="65" textAnchor="middle" fill="#fff" fontSize="10">Bank A</text>

                  <rect x="160" y="35" width="80" height="50" rx="8" className={`node-rect ${activeStep === 1 ? 'highlight-purple' : ''}`} />
                  <text x="200" y="65" textAnchor="middle" fill="#fff" fontSize="10">Clearinghouse</text>

                  <circle cx="350" cy="60" r="22" className={`node-circle ${activeStep === 2 ? 'highlight-pink' : ''}`} />
                  <text x="350" y="65" textAnchor="middle" fill="#fff" fontSize="10">Bank B</text>

                  {/* Connecting lines */}
                  <path d="M 72 60 L 160 60" className={`flow-path ${activeStep === 0 ? 'active' : ''}`} />
                  <path d="M 240 60 L 328 60" className={`flow-path ${activeStep === 2 ? 'active' : ''}`} />
                </svg>
              </div>
            </div>

            <div className="sim-code">
              <div className="code-header">
                <span className="mac-dot red" />
                <span className="mac-dot yellow" />
                <span className="mac-dot green" />
                <span className="code-title">ISO 20022 payload schema</span>
              </div>
              <pre><code>{simulationSteps[activeStep].code}</code></pre>
            </div>
          </div>
        </div>
      </section>

      {/* Clearinghouse stats ticker */}
      <section className="stats-ticker-section">
        <div className="stats-grid">
          <div className="stat-card glass">
            <span className="stat-num glow-cyan">$4.82B</span>
            <span className="stat-label">Cleared Positions Volume</span>
          </div>
          <div className="stat-card glass">
            <span className="stat-num glow-purple">&lt; 420ms</span>
            <span className="stat-label">Average Ledger Commit Latency</span>
          </div>
          <div className="stat-card glass">
            <span className="stat-num glow-pink">100%</span>
            <span className="stat-label">Secp256k1 Audited Transactions</span>
          </div>
        </div>
      </section>

      {/* Advanced Features Matrix */}
      <section className="features-section">
        <h2 className="section-title">Core Enterprise Rails</h2>
        <div className="features-grid">
          <div className="feature-card glass hover-glow-purple">
            <div className="feature-icon-wrapper">🔒</div>
            <h3>Tenant Sharding & RLS</h3>
            <p>Utilizes row-level security (RLS) on PostgreSQL/Nile boundaries to physically partition banking records. Zero data leakage across institutional tenants.</p>
          </div>

          <div className="feature-card glass hover-glow-cyan">
            <div className="feature-icon-wrapper">🔑</div>
            <h3>Secp256k1 Cryptography</h3>
            <p>All transfer confirmations execute signed handshakes using standard B2B elliptic curve keys. Requests are validated cryptographically against registered public keys.</p>
          </div>

          <div className="feature-card glass hover-glow-pink">
            <div className="feature-icon-wrapper">⛓️</div>
            <h3>Merkle Ledger Journals</h3>
            <p>Every transaction maintains a cryptographically chained Merkle proof, producing a tamper-evident financial log that simplifies external bank audits.</p>
          </div>

          <div className="feature-card glass hover-glow-yellow">
            <div className="feature-icon-wrapper">📡</div>
            <h3>Failover Swapping</h3>
            <p>Built-in dynamic priority matching and routing. Automatically swaps between REST gateway endpoints and Web3 nodes based on live channel health checks.</p>
          </div>
        </div>
      </section>

      {/* CTA Footer Section */}
      <section className="cta-footer-section glass">
        <h2>Ready to connect your banking infrastructure?</h2>
        <p>Integrate via HTTP REST or EVM JSON-RPC nodes. Settle transactions instantly with complete cryptographic validation.</p>
        <button className="btn btn-hero-primary" onClick={() => onNavigate('register')}>
          Start Partner Onboarding
        </button>
      </section>

      <footer className="landing-footer">
        <p>© 2026 Payrail Clearinghouse Inc. All rights reserved. ISO 20022 compliant clearing partner.</p>
      </footer>
    </div>
  );
}
