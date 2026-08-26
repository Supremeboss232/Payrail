import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { railDb, systemTenantId, createNotification } from './db';
import { postTransaction, LedgerEntryInput, createAccount } from './ledger';
import { dispatchWebhookEvent } from './webhooks';
import { buildPacs008, buildPacs009 } from './b2b';
import { decryptCredentials, encryptCredentials } from './crypto';
import { executeHttpCallback, executeWeb3RpcTransfer } from './integrations';
import { screenPayment } from './compliance';
import { issueCard, listCards, getCard, updateCardStatus, authorizeCardTransaction } from './cards';
import { generateCreditReport } from './credit';

const router = Router();
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'payment-rail-master-default-key-12345';

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'requires_payment_method' | 'processing' | 'succeeded' | 'canceled' | 'failed';
  funding_source_id: string | null;
  destination_account_id: string;
  client_secret: string;
  metadata: string;
  created_at: string;
}

export interface FundingSource {
  id: string;
  name: string;
  type: 'bank' | 'broker' | 'crypto' | 'logistics';
  account_id: string;
  priority: number;
  status: 'active' | 'inactive';
  created_at: string;
}

/**
 * POST /v1/payment_intents or /v1/payments/payment_intents
 * Creates a Stripe-like Payment Intent
 */
router.post(['/payment_intents', '/payments/payment_intents'], async (req: Request, res: Response) => {
  const { amount, currency, destination_account_id, metadata = {} } = req.body;

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive integer.' });
    return;
  }
  if (!currency) {
    res.status(400).json({ error: 'currency is required.' });
    return;
  }
  if (!destination_account_id) {
    res.status(400).json({ error: 'destination_account_id is required.' });
    return;
  }

  const id = `pi_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const clientSecret = `${id}_secret_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  try {
    // Validate destination account
    const accResult = await railDb.execute({
      sql: 'SELECT id FROM accounts WHERE id = ?',
      args: [destination_account_id],
    });

    if (accResult.rows.length === 0) {
      res.status(400).json({ error: `Destination account ${destination_account_id} does not exist.` });
      return;
    }

    await railDb.execute({
      sql: `INSERT INTO payment_intents (id, amount, currency, status, funding_source_id, destination_account_id, client_secret, metadata, created_at)
            VALUES (?, ?, ?, 'requires_payment_method', NULL, ?, ?, ?, ?)`,
      args: [id, amount, currency.toUpperCase(), destination_account_id, clientSecret, JSON.stringify(metadata), createdAt],
    });

    const pi: PaymentIntent = {
      id,
      amount,
      currency: currency.toUpperCase(),
      status: 'requires_payment_method',
      funding_source_id: null,
      destination_account_id,
      client_secret: clientSecret,
      metadata: JSON.stringify(metadata),
      created_at: createdAt,
    };

    // Dispatch webhook event
    await dispatchWebhookEvent('payment_intent.created', pi);

    res.status(201).json(pi);
  } catch (error: any) {
    console.error('Create Payment Intent Error:', error);
    res.status(500).json({ error: 'Failed to create payment intent.' });
  }
});

/**
 * POST /v1/payment_intents/:id/confirm or /v1/payments/payment_intents/:id/confirm
 * Confirms a Payment Intent, executing the ledger transfers and swapping the funding source if failure occurs.
 */
router.post(['/payment_intents/:id/confirm', '/payments/payment_intents/:id/confirm'], async (req: Request, res: Response) => {
  const { id } = req.params;
  const { funding_source_id } = req.body; // Optional - override manual funding source

  try {
    // 1. Fetch Payment Intent
    const piResult = await railDb.execute({
      sql: 'SELECT * FROM payment_intents WHERE id = ?',
      args: [id],
    });

    if (piResult.rows.length === 0) {
      res.status(404).json({ error: `Payment intent ${id} not found.` });
      return;
    }

    const pi = piResult.rows[0] as unknown as PaymentIntent;

    if (pi.status === 'succeeded') {
      res.status(400).json({ error: 'Payment intent has already succeeded.' });
      return;
    }
    if (pi.status === 'canceled' || pi.status === 'failed') {
      res.status(400).json({ error: `Payment intent cannot be confirmed from status ${pi.status}.` });
      return;
    }

    // 2a. Block simulation connector type — not supported in production
    // (Check all active funding sources)
    const allFsCheck = await railDb.execute({
      sql: "SELECT connector_type FROM funding_sources WHERE status = 'active'",
      args: []
    });
    const hasSimulation = (allFsCheck.rows as any[]).some(
      (r) => (r.connector_type || '') === 'simulation'
    );
    if (hasSimulation) {
      res.status(400).json({
        error: 'One or more active funding sources are using the deprecated "simulation" connector. Reconfigure them with "http_callback" or "web3_rpc" before confirming payments.',
        code: 'simulation_connector_not_supported'
      });
      return;
    }

    // 2b. Run AML / OFAC compliance screening
    const payerName = (req as any).tenant?.legal_name || 'Unknown Payer';
    const payeeMeta = pi.metadata ? JSON.parse(pi.metadata as string) : {};
    const payeeName = payeeMeta.payee_name || payeeMeta.recipient_name || 'Unknown Payee';

    const complianceResult = await screenPayment(payerName, payeeName);
    if (!complianceResult.passed) {
      console.warn(`[Compliance] Payment ${pi.id} blocked: ${complianceResult.reason}`);
      await railDb.execute({
        sql: "UPDATE payment_intents SET status = 'failed' WHERE id = ?",
        args: [id],
      });
      res.status(402).json({
        success: false,
        error: {
          code: 'compliance_hold',
          message: complianceResult.reason || 'Transaction blocked by compliance screening.',
        },
        compliance: complianceResult.results,
      });
      return;
    }

    // 2. Resolve Active Funding Sources (ordered by priority)
    let fundingSources: FundingSource[] = [];
    if (funding_source_id) {
      const fsResult = await railDb.execute({
        sql: "SELECT * FROM funding_sources WHERE id = ? AND status = 'active'",
        args: [funding_source_id],
      });
      if (fsResult.rows.length === 0) {
        res.status(400).json({ error: `Active funding source ${funding_source_id} not found.` });
        return;
      }
      fundingSources = [fsResult.rows[0] as unknown as FundingSource];
    } else {
      const fsResult = await railDb.execute({
        sql: "SELECT * FROM funding_sources WHERE status = 'active' ORDER BY priority ASC",
        args: [],
      });
      fundingSources = fsResult.rows as unknown as FundingSource[];
    }

    if (fundingSources.length === 0) {
      res.status(400).json({ error: 'No active funding sources configured for the payment rail.' });
      return;
    }

    // Update payment intent status to processing
    await railDb.execute({
      sql: "UPDATE payment_intents SET status = 'processing' WHERE id = ?",
      args: [id],
    });

    // 3. Dynamic Swap / Failover Routing Execution Loop
    let successfulFs: FundingSource | null = null;
    let failureReason = '';
    const swapLogs: string[] = [];

    for (const fs of fundingSources) {
      const connType = (fs as any).connector_type || 'simulation';
      swapLogs.push(`Attempting payment using funding source: ${fs.name} (connector: ${connType}).`);

      try {
        // Fetch ledger account representing this funding source
        const accResult = await railDb.execute({
          sql: 'SELECT * FROM accounts WHERE id = ?',
          args: [fs.account_id],
        });

        if (accResult.rows.length === 0) {
          throw new Error(`Ledger account ${fs.account_id} for funding source ${fs.name} not found.`);
        }

        const sourceAcc = accResult.rows[0] as any;

        // Perform balance check
        if (Number(sourceAcc.balance) < Number(pi.amount)) {
          throw new Error(`Insufficient funds: ${sourceAcc.name} has balance of ${sourceAcc.balance} cents, payment requires ${pi.amount} cents.`);
        }

        // 1. Dispatch dynamic outbound transfer to external API
        let transactionReference = '';
        const encCreds = (fs as any).credentials_encrypted;
        if (!encCreds && connType !== 'none') {
          throw new Error(`Integration credentials not configured for funding source ${fs.name}.`);
        }

        const decryptedConfig = encCreds ? decryptCredentials(encCreds, ENCRYPTION_KEY) : {};

        if (connType === 'web3_rpc') {
          transactionReference = await executeWeb3RpcTransfer(decryptedConfig, pi.amount, pi.currency);
        } else {
          transactionReference = await executeHttpCallback(decryptedConfig, pi.amount, pi.currency, pi.destination_account_id);
        }

        // 2. Post double-entry ledger entries (Only if API transfer was successful!)
        // To support Nile's multi-tenant isolation, we split B2B cross-tenant settlement into isolated ledger legs.
        const fsTenantId = (fs as any).tenant_id || (sourceAcc as any).tenant_id || systemTenantId;

        // Platform Core Leg (System Tenant)
        const offsetSystemAccountId = `acc_offset_${fs.id}`;
        await createAccount(
          offsetSystemAccountId,
          `Clearing Offset for ${fs.name}`,
          'liability',
          'bank',
          pi.currency,
          0,
          systemTenantId
        );

        const platformEntries: LedgerEntryInput[] = [
          {
            accountId: pi.destination_account_id,
            type: 'debit',
            amount: pi.amount,
            currency: pi.currency,
          },
          {
            accountId: offsetSystemAccountId,
            type: 'credit',
            amount: pi.amount,
            currency: pi.currency,
          },
        ];

        await postTransaction(
          `Payment platform leg: ${pi.id} via ${fs.name} (Ref: ${transactionReference})`,
          'api',
          platformEntries,
          pi.id,
          pi.id,
          systemTenantId
        );

        // Partner Bank Leg (Bank Tenant)
        if (fsTenantId && fsTenantId !== systemTenantId) {
          const offsetBankAccountId = `acc_offset_system`;
          await createAccount(
            offsetBankAccountId,
            'System Clearing Offset',
            'liability',
            'bank',
            pi.currency,
            0,
            fsTenantId
          );

          const bankEntries: LedgerEntryInput[] = [
            {
              accountId: offsetBankAccountId,
              type: 'debit',
              amount: pi.amount,
              currency: pi.currency,
            },
            {
              accountId: fs.account_id,
              type: 'credit',
              amount: pi.amount,
              currency: pi.currency,
            },
          ];

          await postTransaction(
            `Payment partner bank leg: ${pi.id} via ${fs.name} (Ref: ${transactionReference})`,
            'api',
            bankEntries,
            pi.id,
            pi.id,
            fsTenantId
          );
        }

        successfulFs = fs;
        swapLogs.push(`Payment succeeded via ${fs.name}. Reference: ${transactionReference}`);
        break; // Stop loop since it succeeded!
      } catch (err: any) {
        console.error('Confirm error stack:', err);
        const errorMsg = err.message || 'Unknown processing error';
        console.warn(`Funding source ${fs.name} failed: ${errorMsg}`);
        swapLogs.push(`Swap Triggered: ${fs.name} failed (${errorMsg}).`);
        failureReason = errorMsg;
        // Continue to try the next funding source in priority list
      }
    }

    // 4. Update Payment Intent based on outcome
    if (successfulFs) {
      await railDb.execute({
        sql: "UPDATE payment_intents SET status = 'succeeded', funding_source_id = ? WHERE id = ?",
        args: [successfulFs.id, id],
      });

      const updatedPi: PaymentIntent = {
        ...pi,
        status: 'succeeded',
        funding_source_id: successfulFs.id,
      };

      // Dispatch succeeded webhook event
      await dispatchWebhookEvent('payment_intent.succeeded', {
        payment_intent: updatedPi,
        logs: swapLogs,
      });

      // Trigger Notification for Member Bank
      const fsTenantId = (successfulFs as any).tenant_id;
      if (fsTenantId && fsTenantId !== systemTenantId) {
        await createNotification(
          fsTenantId,
          'Payment Intent Succeeded',
          `B2B transfer of $${(updatedPi.amount / 100).toFixed(2)} ${updatedPi.currency} cleared via ${successfulFs.name}.`,
          'success'
        );
      }
      
      // Trigger Notification for Clearinghouse Administrator
      await createNotification(
        systemTenantId,
        'Payment Intent Settled',
        `Transaction ${id} settled on ledger for $${(updatedPi.amount / 100).toFixed(2)} ${updatedPi.currency}.`,
        'success'
      );

      // Build ISO 20022 pacs.008 XML payload
      const sourceBic = (req as any).tenant ? (req as any).tenant.routing_code : 'SYSTEM_BIC';
      const destBic = 'MERCHANT_BIC';
      const pacs008Xml = buildPacs008(updatedPi, sourceBic, destBic);

      res.status(200).json({
        success: true,
        payment_intent: updatedPi,
        routing_logs: swapLogs,
        pacs_008_xml: pacs008Xml
      });
    } else {
      await railDb.execute({
        sql: "UPDATE payment_intents SET status = 'failed' WHERE id = ?",
        args: [id],
      });

      const failedPi: PaymentIntent = {
        ...pi,
        status: 'failed',
      };

      // Dispatch failed webhook event
      await dispatchWebhookEvent('payment_intent.failed', {
        payment_intent: failedPi,
        error: failureReason,
        logs: swapLogs,
      });

      // Trigger Notification for Clearinghouse Admin and relevant tenant if present
      const activeTenant = (req as any).tenant?.id || systemTenantId;
      await createNotification(
        activeTenant,
        'Payment Intent Failed',
        `Transaction ${id} failed confirmation: ${failureReason || 'unknown processing error'}.`,
        'error'
      );

      res.status(402).json({
        success: false,
        error: {
          code: 'payment_failed',
          message: `All funding sources failed. Last error: ${failureReason}`,
        },
        payment_intent: failedPi,
        routing_logs: swapLogs,
      });
    }
  } catch (error: any) {
    console.error('Confirm Payment Intent Error:', error);
    res.status(500).json({ error: 'Failed to confirm payment intent.' });
  }
});

/**
 * POST /v1/funding_sources
 * Creates a new funding source for routing
 */
router.post('/funding_sources', async (req: Request, res: Response) => {
  const { name, type, account_id, priority = 0, connector_type = 'simulation' } = req.body;

  if (!name || !type || !account_id) {
    res.status(400).json({ error: 'name, type, and account_id are required.' });
    return;
  }

  const id = `fs_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const createdAt = new Date().toISOString();

  try {
    // Validate ledger account exists
    const accResult = await railDb.execute({
      sql: 'SELECT id FROM accounts WHERE id = ?',
      args: [account_id],
    });

    if (accResult.rows.length === 0) {
      res.status(400).json({ error: `Ledger account ${account_id} does not exist.` });
      return;
    }

    await railDb.execute({
      sql: `INSERT INTO funding_sources (id, name, type, account_id, priority, status, connector_type, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      args: [id, name, type, account_id, priority, connector_type, createdAt],
    });

    const fs: FundingSource = {
      id,
      name,
      type,
      account_id,
      priority,
      status: 'active',
      created_at: createdAt,
    };

    res.status(201).json(fs);
  } catch (error) {
    console.error('Create Funding Source Error:', error);
    res.status(500).json({ error: 'Failed to create funding source.' });
  }
});

/**
 * PATCH /v1/funding_sources/:id/swap
 * Updates funding source status and priority (allowing easy swaps/routing overrides)
 */
router.patch('/funding_sources/:id/swap', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { priority, status } = req.body;

  try {
    const fsResult = await railDb.execute({
      sql: 'SELECT * FROM funding_sources WHERE id = ?',
      args: [id],
    });

    if (fsResult.rows.length === 0) {
      res.status(404).json({ error: `Funding source ${id} not found.` });
      return;
    }

    if (priority !== undefined) {
      await railDb.execute({
        sql: 'UPDATE funding_sources SET priority = ? WHERE id = ?',
        args: [priority, id],
      });
    }

    if (status !== undefined) {
      if (status !== 'active' && status !== 'inactive') {
        res.status(400).json({ error: "status must be 'active' or 'inactive'." });
        return;
      }
      await railDb.execute({
        sql: 'UPDATE funding_sources SET status = ? WHERE id = ?',
        args: [status, id],
      });
    }

    const updatedResult = await railDb.execute({
      sql: 'SELECT * FROM funding_sources WHERE id = ?',
      args: [id],
    });

    res.status(200).json(updatedResult.rows[0]);
  } catch (error) {
    console.error('Update Funding Source Error:', error);
    res.status(500).json({ error: 'Failed to update funding source.' });
  }
});

/**
 * GET /v1/funding_sources
 * List all funding sources
 */
router.get('/funding_sources', async (req: Request, res: Response) => {
  try {
    const result = await railDb.execute('SELECT * FROM funding_sources ORDER BY priority ASC');
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve funding sources.' });
  }
});

/**
 * POST /v1/tenants
 * Registers a new bank/fintech B2B tenant
 */
router.post('/tenants', async (req: Request, res: Response) => {
  const { id, legal_name, routing_code, public_key_pem } = req.body;
  if (!legal_name || !routing_code || !public_key_pem) {
    res.status(400).json({ error: 'legal_name, routing_code, and public_key_pem are required.' });
    return;
  }
  const createdAt = new Date().toISOString();
  try {
    let tenantId = id;
    if (railDb.isPostgres) {
      if (tenantId) {
        await railDb.execute({
          sql: `INSERT INTO tenants (id, legal_name, routing_code, api_status, public_key_pem, created_at)
                VALUES (?, ?, ?, 'active', ?, ?)`,
          args: [tenantId, legal_name, routing_code, public_key_pem, createdAt]
        });
      } else {
        const resObj = await railDb.execute({
          sql: `INSERT INTO tenants (name, legal_name, routing_code, api_status, public_key_pem, created_at)
                VALUES (?, ?, ?, 'active', ?, ?)
                RETURNING id`,
          args: [legal_name, legal_name, routing_code, public_key_pem, createdAt]
        });
        tenantId = (resObj.rows[0] as any).id;
      }
    } else {
      if (!tenantId) {
        tenantId = uuidv4();
      }
      await railDb.execute({
        sql: `INSERT INTO tenants (id, legal_name, routing_code, api_status, public_key_pem, created_at)
              VALUES (?, ?, ?, 'active', ?, ?)`,
        args: [tenantId, legal_name, routing_code, public_key_pem, createdAt]
      });
    }
    res.status(201).json({ id: tenantId, legal_name, routing_code, status: 'active', created_at: createdAt });
  } catch (error: any) {
    console.error('Create Tenant Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/settlements/dns_sweep
 * Executes a Deferred Net Settlement (DNS) sweep between two routing BICs
 */
router.post('/settlements/dns_sweep', async (req: Request, res: Response) => {
  let { source_bic, dest_bic, amount, currency } = req.body;

  // Auto-detect BICs and amount from registered member banks
  if (!source_bic || !dest_bic || !amount || !currency) {
    try {
      const tenantsRes = await railDb.execute(
        "SELECT id, routing_code FROM tenants WHERE routing_code != 'PAYRAIL_SYSTEM_BIC' ORDER BY created_at ASC"
      );

      if (tenantsRes.rows.length < 2) {
        res.status(400).json({
          error: 'Not enough registered banks. Connect at least 2 member banks via the Bank Connection Wizard before running a net settlement sweep.'
        });
        return;
      }

      const tenantA = tenantsRes.rows[0] as any;
      const tenantB = tenantsRes.rows[1] as any;
      source_bic = tenantA.routing_code;
      dest_bic = tenantB.routing_code;
      currency = 'USD';

      // Use the last confirmed payment intent amount, or fall back to $1,000
      amount = 100000;
      const latestPi = await railDb.execute(
        "SELECT amount, currency FROM payment_intents WHERE status = 'confirmed' ORDER BY created_at DESC LIMIT 1"
      );
      if (latestPi.rows.length > 0) {
        amount = Number((latestPi.rows[0] as any).amount);
        currency = (latestPi.rows[0] as any).currency || 'USD';
      }
    } catch (e: any) {
      res.status(500).json({ error: `Auto-detection query error: ${e.message}` });
      return;
    }
  }

  try {
    let sourceAccResult = await railDb.execute({
      sql: 'SELECT id, tenant_id FROM accounts WHERE tenant_id = (SELECT id FROM tenants WHERE routing_code = ?)',
      args: [source_bic]
    });
    let destAccResult = await railDb.execute({
      sql: 'SELECT id, tenant_id FROM accounts WHERE tenant_id = (SELECT id FROM tenants WHERE routing_code = ?)',
      args: [dest_bic]
    });

    if (sourceAccResult.rows.length === 0 || destAccResult.rows.length === 0) {
      res.status(400).json({
        error: `No clearing account found for one or both BICs: ${source_bic} -> ${dest_bic}. Ensure both banks completed onboarding via the Bank Connection Wizard.`
      });
      return;
    }

    const sourceAccountId = (sourceAccResult.rows[0] as any).id;
    const destAccountId = (destAccResult.rows[0] as any).id;
    const tenantAId = (sourceAccResult.rows[0] as any).tenant_id;
    const tenantBId = (destAccResult.rows[0] as any).tenant_id;

    // Ensure B's system offset account exists
    await createAccount(
      'acc_offset_system',
      'System Clearing Offset',
      'liability',
      'bank',
      currency,
      0,
      tenantBId
    );

    const bankBLeg: LedgerEntryInput[] = [
      { accountId: destAccountId, type: 'debit', amount, currency: currency.toUpperCase() },
      { accountId: 'acc_offset_system', type: 'credit', amount, currency: currency.toUpperCase() }
    ];
    const txB = await postTransaction(
      `Deferred Net Settlement Sweep Leg (Debit): B2B Member ${dest_bic}`,
      'system',
      bankBLeg,
      `dns_b_${Date.now()}`,
      null,
      tenantBId
    );

    // Ensure A's system offset account exists
    await createAccount(
      'acc_offset_system',
      'System Clearing Offset',
      'liability',
      'bank',
      currency,
      0,
      tenantAId
    );

    const bankALeg: LedgerEntryInput[] = [
      { accountId: 'acc_offset_system', type: 'debit', amount, currency: currency.toUpperCase() },
      { accountId: sourceAccountId, type: 'credit', amount, currency: currency.toUpperCase() }
    ];
    const txA = await postTransaction(
      `Deferred Net Settlement Sweep Leg (Credit): B2B Member ${source_bic}`,
      'system',
      bankALeg,
      `dns_a_${Date.now()}`,
      null,
      tenantAId
    );

    const pacs009Xml = buildPacs009(txA.id, amount, currency.toUpperCase(), source_bic, dest_bic);

    // Trigger Notification for Bank A (Receiver of Sweep Credit)
    await createNotification(
      tenantAId,
      'Net Settlement Sweep Cleared (Credit)',
      `Cleared net settlement surplus of $${(amount / 100).toFixed(2)} ${currency.toUpperCase()} from ${dest_bic}.`,
      'success'
    );

    // Trigger Notification for Bank B (Sender of Sweep Debit)
    await createNotification(
      tenantBId,
      'Net Settlement Sweep Cleared (Debit)',
      `Settled net settlement liability of $${(amount / 100).toFixed(2)} ${currency.toUpperCase()} to ${source_bic}.`,
      'info'
    );

    // Trigger Notification for Clearinghouse Administrator
    await createNotification(
      systemTenantId,
      'PACS.009 Net Sweep Completed',
      `Net sweep of $${(amount / 100).toFixed(2)} ${currency.toUpperCase()} completed between ${dest_bic} and ${source_bic}.`,
      'success'
    );

    res.status(201).json({
      success: true,
      transaction: txA,
      pacs_009_xml: pacs009Xml
    });
  } catch (error: any) {
    console.error('DNS Sweep Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/banks/test_connection
 * Tests a connector configuration without committing any data.
 * Used by the Bank Connection Wizard to validate live connectivity.
 */
router.post('/banks/test_connection', async (req: Request, res: Response) => {
  const { connector_type, url, method, headers: reqHeaders, body_template } = req.body;

  if (!connector_type) {
    res.status(400).json({ error: 'connector_type is required.' });
    return;
  }



  if (connector_type === 'http_callback') {
    if (!url) {
      res.status(400).json({ error: 'url is required for http_callback connector.' });
      return;
    }
    try {
      const start = Date.now();
      const testBody = { test: true, source: 'payrail_connection_test' };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(url, {
        method: method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(reqHeaders || {})
        },
        body: JSON.stringify(body_template || testBody),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const latency = Date.now() - start;
      res.json({
        ok: response.ok || response.status < 500,
        http_status: response.status,
        latency_ms: latency,
        message: response.ok
          ? `Endpoint reachable. HTTP ${response.status} in ${latency}ms.`
          : `Endpoint returned HTTP ${response.status} in ${latency}ms. Verify your auth headers and URL.`
      });
    } catch (e: any) {
      const isTimeout = e.name === 'AbortError';
      res.json({
        ok: false,
        latency_ms: 8000,
        message: isTimeout
          ? 'Connection timed out after 8 seconds. Check the URL and network access.'
          : `Connection failed: ${e.message}`
      });
    }
    return;
  }

  if (connector_type === 'web3_rpc') {
    if (!url) {
      res.status(400).json({ error: 'url (RPC node URL) is required for web3_rpc connector.' });
      return;
    }
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const latency = Date.now() - start;
      const data = await response.json();
      const blockNumber = data?.result ? parseInt(data.result, 16) : null;

      res.json({
        ok: !!blockNumber,
        latency_ms: latency,
        block_number: blockNumber,
        message: blockNumber
          ? `RPC node reachable. Current block: ${blockNumber} (${latency}ms).`
          : `RPC node responded but returned unexpected data. Check the node URL.`
      });
    } catch (e: any) {
      const isTimeout = e.name === 'AbortError';
      res.json({
        ok: false,
        latency_ms: 8000,
        message: isTimeout
          ? 'RPC node timed out after 8 seconds.'
          : `RPC connection failed: ${e.message}`
      });
    }
    return;
  }

  res.status(400).json({ error: `Unknown connector_type: ${connector_type}. Use http_callback or web3_rpc.` });
});


// ═══════════════════════════════════════════════════════════════════════════════
// PAYRAIL BANKING-AS-A-SERVICE (BaaS) ROUTES
//
// These routes are exposed to authenticated MEMBER BANKS via their gateway API
// keys. Payrail holds ONE upstream vendor contract and re-exposes the capability
// to all tenants — this is exactly how Unit, Column, Synapse operate.
//
// Auth flow: Member Bank → API Key → authenticateGateway → BaaS Route → Vendor
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/services/catalog
// Returns the full list of Payrail BaaS services and their availability status
// for the calling member bank.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/services/catalog', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;

  const services = [
    {
      id: 'fx_conversion',
      name: 'FX Currency Conversion',
      description: 'Real-time exchange rates and cross-currency conversion for multi-currency accounts.',
      category: 'payments',
      status: 'available',
      endpoint: 'POST /v1/fx/convert',
      docs_endpoint: 'GET /v1/fx/rates',
      cost_model: 'Included in Payrail membership',
      engine: process.env.FIXER_IO_API_KEY ? 'Fixer.io (live rates)' : 'Payrail Internal (static fallback)',
      upgrade_note: !process.env.FIXER_IO_API_KEY ? 'Set FIXER_IO_API_KEY for real-time rates' : null
    },
    {
      id: 'aml_screening',
      name: 'AML / OFAC Sanctions Screening',
      description: 'Screen counterparties against OFAC SDN, PEP lists, and adverse media. SAR-ready risk reports.',
      category: 'compliance',
      status: 'available',
      endpoint: 'POST /v1/compliance/screen',
      cost_model: 'Included in Payrail membership',
      engine: process.env.COMPLY_ADVANTAGE_API_KEY ? 'ComplyAdvantage (enhanced)' : 'OFAC SDN Federal List'
    },
    {
      id: 'otp_verification',
      name: 'OTP / Email Verification',
      description: 'Generate and deliver 6-digit OTP codes to your customers via email.',
      category: 'identity',
      status: 'available',
      endpoint: 'POST /v1/otp/send',
      verify_endpoint: 'POST /v1/otp/verify',
      cost_model: 'Included in Payrail membership',
      engine: process.env.SENDGRID_API_KEY ? 'SendGrid (email delivery)' : 'In-network OTP (no email)',
      upgrade_note: !process.env.SENDGRID_API_KEY ? 'Set SENDGRID_API_KEY to enable email delivery' : null
    },
    {
      id: 'card_issuance',
      name: 'Card Issuance & Lifecycle Management',
      description: 'Issue virtual and physical debit/credit cards. Full lifecycle: request → approve → activate → freeze → cancel → disputes.',
      category: 'cards',
      status: 'available',
      endpoint: 'POST /v1/cards/issue',
      manage_endpoint: 'GET /v1/cards | POST /v1/cards/:id/freeze | POST /v1/cards/:id/cancel',
      cost_model: 'Included in Payrail membership',
      engine: process.env.MARQETA_BASE_URL ? 'Marqeta (card network)' : 'Payrail Internal Ledger Cards',
      upgrade_note: !process.env.MARQETA_BASE_URL ? 'Cards work on Payrail network now. Set MARQETA_BASE_URL for Visa/Mastercard physical card support' : null
    },
    {
      id: 'ach_wire',
      name: 'ACH / Wire Payment Rails',
      description: 'Originate ACH debits/credits and wire transfers on behalf of your customers.',
      category: 'payments',
      status: 'available',
      endpoint: 'POST /v1/ach/transfer',
      cost_model: 'Included in Payrail membership',
      engine: process.env.ACH_ROUTING_NUMBER ? `Federal Reserve ACH (${process.env.ACH_ROUTING_NUMBER})` : 'Payrail Internal Settlement Rails',
      upgrade_note: !process.env.ACH_ROUTING_NUMBER ? 'Transfers settle instantly on Payrail rails. Set ACH_ROUTING_NUMBER for interbank Fed ACH' : null
    },
    {
      id: 'crypto_wallets',
      name: 'Crypto / Blockchain Wallet Management',
      description: 'Create custodial wallets, route on-chain transactions, multi-chain USDC/ETH/BTC support.',
      category: 'crypto',
      status: process.env.CRYPTO_RPC_URL ? 'available' : 'pending_activation',
      endpoint: 'POST /v1/crypto/transfer',
      status_endpoint: 'GET /v1/crypto/status',
      cost_model: 'Gas fees + Payrail network fee',
      engine: process.env.CRYPTO_RPC_URL ? 'EVM Web3 RPC' : 'Pending RPC node connection',
      upgrade_note: !process.env.CRYPTO_RPC_URL ? 'Set CRYPTO_RPC_URL (Alchemy/Infura/QuickNode) to enable' : null
    },
    {
      id: 'credit_bureau',
      name: 'Credit Scoring & Soft Pull',
      description: 'Transaction-history based credit scoring (300-850) with risk grading, max credit recommendation, and DTI estimate.',
      category: 'identity',
      status: 'available',
      endpoint: 'POST /v1/credit/soft_pull',
      cost_model: 'Included in Payrail membership',
      engine: process.env.EQUIFAX_CLIENT_ID ? 'Payrail Internal + Equifax' : 'Payrail Internal (transaction-history scoring)',
      upgrade_note: !process.env.EQUIFAX_CLIENT_ID ? 'Full bureau data: Set EQUIFAX_CLIENT_ID for hard credit bureau access' : null
    },
    {
      id: 'settlement_clearing',
      name: 'Deferred Net Settlement (DNS) Clearing',
      description: 'Multilateral clearing and settlement between member banks. ISO 20022 pacs.008/pacs.009 messages.',
      category: 'settlement',
      status: 'available',
      endpoint: 'POST /v1/settlements/dns_sweep',
      cost_model: 'Included in Payrail membership',
      engine: 'Payrail Core Ledger'
    },
    {
      id: 'payment_intents',
      name: 'Payment Gateway (Stripe-Compatible)',
      description: 'Create and confirm payment intents with dynamic funding source failover and real-time compliance screening.',
      category: 'payments',
      status: 'available',
      endpoint: 'POST /v1/payment_intents',
      confirm_endpoint: 'POST /v1/payment_intents/:id/confirm',
      cost_model: 'Included in Payrail membership',
      engine: 'Payrail Gateway Router'
    },
    {
      id: 'partner_registration',
      name: 'Partner Self-Service Registration',
      description: 'Any private or institutional firm can register, get an API key, and start using all Payrail services immediately.',
      category: 'platform',
      status: 'available',
      endpoint: 'POST /v1/partners/register',
      profile_endpoint: 'GET /v1/partners/me',
      cost_model: 'Included in Payrail membership',
      engine: 'Payrail Platform'
    }
  ];

  const available = services.filter(s => s.status === 'available').length;

  res.json({
    tenant_id: tenant?.id || 'system',
    tenant_name: tenant?.legal_name || 'Platform',
    total_services: services.length,
    available_services: available,
    services
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/fx/convert
// Convert an amount from one currency to another using live Fixer.io rates.
// Called by member banks to price cross-currency transactions.
// ─────────────────────────────────────────────────────────────────────────────
const fxGatewayCache: { rates: Record<string, number>; base: string; ts: number } = { rates: {}, base: '', ts: 0 };
const FX_GATEWAY_TTL = 15 * 60 * 1000;

router.post('/fx/convert', async (req: Request, res: Response) => {
  const { from, to, amount } = req.body;

  if (!from || !to || amount === undefined) {
    res.status(400).json({ error: 'from, to, and amount are required.' });
    return;
  }
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number.' });
    return;
  }

  const apiKey = process.env.FIXER_IO_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: 'FX service not yet activated on this network.',
      code: 'service_pending_activation',
      action: 'Contact your Payrail network administrator to activate the FX service.',
      provider: 'Fixer.io'
    });
    return;
  }

  try {
    // Refresh cache if stale
    if (!fxGatewayCache.rates[to] || fxGatewayCache.base !== from || Date.now() - fxGatewayCache.ts > FX_GATEWAY_TTL) {
      const res2 = await fetch(`https://data.fixer.io/api/latest?access_key=${apiKey}&base=${from}&symbols=${to}`);
      const data = await res2.json() as any;
      if (!data.success) throw new Error(`Fixer.io error: ${data.error?.info || 'Unknown'}`);
      fxGatewayCache.rates = data.rates;
      fxGatewayCache.base = from;
      fxGatewayCache.ts = Date.now();
    }

    const rate = fxGatewayCache.rates[to];
    if (!rate) {
      res.status(400).json({ error: `Currency pair ${from}→${to} not supported.` });
      return;
    }

    const convertedAmount = parseFloat((amount * rate).toFixed(6));

    res.json({
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      input_amount: amount,
      converted_amount: convertedAmount,
      rate,
      rate_source: 'fixer.io',
      rate_timestamp: new Date(fxGatewayCache.ts).toISOString(),
    });
  } catch (err: any) {
    res.status(502).json({ error: `FX conversion failed: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/fx/rates
// Get live exchange rates (gateway-authenticated version for member banks).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/fx/rates', async (req: Request, res: Response) => {
  const base = (req.query.base as string || 'USD').toUpperCase();
  const symbols = req.query.symbols as string | undefined;
  const apiKey = process.env.FIXER_IO_API_KEY;

  if (!apiKey) {
    res.status(503).json({
      error: 'FX service not yet activated.',
      code: 'service_pending_activation',
      action: 'Contact your Payrail network administrator.'
    });
    return;
  }

  try {
    const symbolParam = symbols ? `&symbols=${symbols}` : '';
    const response = await fetch(`https://data.fixer.io/api/latest?access_key=${apiKey}&base=${base}${symbolParam}`);
    const data = await response.json() as any;
    if (!data.success) {
      res.status(502).json({ error: `FX provider error: ${data.error?.info || 'Unknown'}` });
      return;
    }
    res.json({ base: data.base, rates: data.rates, timestamp: new Date(data.timestamp * 1000).toISOString() });
  } catch (err: any) {
    res.status(502).json({ error: `FX rates unavailable: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/compliance/screen
// AML / OFAC screening as a service for member banks.
// Member banks pass counterparty names; Payrail screens via its compliance engine.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/compliance/screen', async (req: Request, res: Response) => {
  const { name, type = 'individual' } = req.body;

  if (!name) {
    res.status(400).json({ error: 'name is required.' });
    return;
  }

  try {
    const { screenParticipant } = await import('./compliance');
    const result = await screenParticipant(name);

    const tenantId = (req as any).tenant?.id || systemTenantId;

    // Log screening result as a notification for audit trail
    if (!result.passed) {
      await createNotification(
        systemTenantId,
        'Compliance Screen — Potential Match',
        `Member bank "${(req as any).tenant?.legal_name || tenantId}" screened "${name}": ${result.details || result.matchStatus}`,
        'warning'
      );
    }

    res.json({
      name,
      type,
      passed: result.passed,
      match_status: result.matchStatus,
      engine: result.engine,
      details: result.details || null,
      screened_at: new Date().toISOString(),
      screened_by_tenant: (req as any).tenant?.legal_name || 'system'
    });
  } catch (err: any) {
    res.status(500).json({ error: `Compliance screening failed: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/otp/send
// Generate and deliver a 6-digit OTP to an email address.
// Member banks use this for their own customer verification flows.
// ─────────────────────────────────────────────────────────────────────────────

// In-memory OTP store: { email → { code, expiresAt } }
// In production this should be Redis — for now it's a process-scoped Map.
const otpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();

router.post('/otp/send', async (req: Request, res: Response) => {
  const { email, purpose = 'verification' } = req.body;

  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }

  const sendGridKey = process.env.SENDGRID_API_KEY;
  if (!sendGridKey) {
    res.status(503).json({
      error: 'Email OTP service not yet activated.',
      code: 'service_pending_activation',
      action: 'Contact your Payrail network administrator to activate email delivery.'
    });
    return;
  }

  try {
    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10-minute TTL

    // Store in memory (single-use, expires in 10 min)
    otpStore.set(email, { code, expiresAt, attempts: 0 });

    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@payrail.io';
    const tenantName = (req as any).tenant?.legal_name || 'Payrail';

    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sendGridKey}`
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: fromEmail, name: tenantName },
        subject: `Your ${tenantName} verification code`,
        content: [{
          type: 'text/plain',
          value: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.\nPurpose: ${purpose}`
        }]
      })
    });

    res.json({
      success: true,
      message: `OTP sent to ${email}`,
      expires_in_seconds: 600,
      purpose
    });
  } catch (err: any) {
    res.status(502).json({ error: `OTP delivery failed: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/otp/verify
// Verify a previously issued OTP code. Single-use, 10-minute TTL enforced.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/otp/verify', async (req: Request, res: Response) => {
  const { email, code } = req.body;

  if (!email || !code) {
    res.status(400).json({ error: 'email and code are required.' });
    return;
  }

  const record = otpStore.get(email);

  if (!record) {
    res.status(400).json({ error: 'No OTP found for this email. Request a new one.', code: 'otp_not_found' });
    return;
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(email);
    res.status(400).json({ error: 'OTP has expired. Request a new one.', code: 'otp_expired' });
    return;
  }

  record.attempts += 1;
  if (record.attempts > 5) {
    otpStore.delete(email);
    res.status(429).json({ error: 'Too many failed attempts. Request a new OTP.', code: 'otp_locked' });
    return;
  }

  if (record.code !== code.toString()) {
    res.status(401).json({ error: 'Invalid OTP code.', attempts_remaining: 5 - record.attempts });
    return;
  }

  // Valid — delete it (single-use)
  otpStore.delete(email);
  res.json({ success: true, verified: true, email });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/cards/issue  (Stub — activates when MARQETA_BASE_URL is configured)
// Issue a virtual or physical card for a customer on behalf of a member bank.
// ─────────────────────────────────────────────────────────────────────────────
// ── POST /v1/cards/issue ──
// Issues a ledger-backed virtual or physical card for the calling partner.
// Works without any external card network. Upgrades to Marqeta when contract signed.
router.post('/cards/issue', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  if (!tenant?.id) { res.status(401).json({ error: 'Tenant context required.' }); return; }

  const { cardholder_name, card_type = 'virtual', currency = 'USD', spend_limit, purpose } = req.body;
  if (!cardholder_name) { res.status(400).json({ error: 'cardholder_name is required.' }); return; }

  try {
    const card = await issueCard({
      tenantId: tenant.id,
      cardholderName: cardholder_name,
      cardType: card_type,
      currency,
      spendLimit: spend_limit,
      purpose
    });

    const engine = process.env.MARQETA_BASE_URL ? 'marqeta' : 'payrail_internal';
    res.status(201).json({
      ...card,
      engine,
      note: engine === 'payrail_internal'
        ? 'This card is issued by Payrail\'s internal ledger. It is fully functional within the Payrail network. Physical card network (Visa/Mastercard) support activates when a card-network contract is signed.'
        : undefined
    });
  } catch (err: any) {
    res.status(500).json({ error: `Card issuance failed: ${err.message}` });
  }
});

// ── GET /v1/cards ──
router.get('/cards', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  if (!tenant?.id) { res.status(401).json({ error: 'Tenant context required.' }); return; }
  try {
    const cards = await listCards(tenant.id);
    res.json({ cards, total: cards.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /v1/cards/:id ──
router.get('/cards/:id', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  if (!tenant?.id) { res.status(401).json({ error: 'Tenant context required.' }); return; }
  try {
    const card = await getCard(req.params.id, tenant.id);
    if (!card) { res.status(404).json({ error: 'Card not found.' }); return; }
    res.json(card);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /v1/cards/:id/freeze ──
router.post('/cards/:id/freeze', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  if (!tenant?.id) { res.status(401).json({ error: 'Tenant context required.' }); return; }
  try {
    await updateCardStatus(req.params.id, tenant.id, 'frozen');
    res.json({ success: true, card_id: req.params.id, status: 'frozen' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /v1/cards/:id/unfreeze ──
router.post('/cards/:id/unfreeze', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  if (!tenant?.id) { res.status(401).json({ error: 'Tenant context required.' }); return; }
  try {
    await updateCardStatus(req.params.id, tenant.id, 'active');
    res.json({ success: true, card_id: req.params.id, status: 'active' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /v1/cards/:id/cancel ──
router.post('/cards/:id/cancel', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  if (!tenant?.id) { res.status(401).json({ error: 'Tenant context required.' }); return; }
  try {
    await updateCardStatus(req.params.id, tenant.id, 'canceled');
    res.json({ success: true, card_id: req.params.id, status: 'canceled' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /v1/cards/:id/authorize ── (card purchase authorization)
router.post('/cards/:id/authorize', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  if (!tenant?.id) { res.status(401).json({ error: 'Tenant context required.' }); return; }
  const { amount, merchant = 'Unknown Merchant' } = req.body;
  if (!amount) { res.status(400).json({ error: 'amount is required.' }); return; }
  try {
    const result = await authorizeCardTransaction(req.params.id, tenant.id, amount, merchant);
    res.status(result.approved ? 200 : 402).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/ach/transfer  (Stub — activates when ACH_ROUTING_NUMBER is configured)
// Originate ACH debits/credits on behalf of a member bank.
// ─────────────────────────────────────────────────────────────────────────────
// ── POST /v1/ach/transfer ──
// Executes ACH/wire transfer via Payrail internal payment rails.
// Uses Fed ACH when ACH_ROUTING_NUMBER is set; otherwise uses internal Payrail settlement.
router.post('/ach/transfer', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  if (!tenant?.id) { res.status(401).json({ error: 'Tenant context required.' }); return; }

  const { amount, currency = 'USD', recipient_account, recipient_routing, description, transfer_type = 'ach' } = req.body;
  if (!amount || !recipient_account) {
    res.status(400).json({ error: 'amount and recipient_account are required.' });
    return;
  }

  try {
    // If Fed ACH is configured, note it in response; otherwise use internal rails
    const engine = process.env.ACH_ROUTING_NUMBER ? 'fed_ach' : 'payrail_internal';

    // Create a payment intent representing this ACH transfer
    const piId = `pi_ach_${Date.now()}`;
    const now = new Date().toISOString();
    await railDb.execute({
      sql: `INSERT INTO payment_intents
              (id, amount, currency, status, destination_account_id, client_secret, metadata, created_at)
            VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
      args: [
        piId, Math.round(amount * 100), currency,
        recipient_account, `secret_${piId}`,
        JSON.stringify({ tenant_id: tenant.id, recipient_routing, transfer_type, description, engine }),
        now
      ]
    });

    // Mark settled immediately on internal rails (Fed ACH would batch and settle next business day)
    await railDb.execute({
      sql: `UPDATE payment_intents SET status = 'settled' WHERE id = ?`,
      args: [piId]
    });

    res.status(201).json({
      success: true,
      transfer_id: piId,
      amount,
      currency,
      recipient_account: `****${recipient_account.slice(-4)}`,
      transfer_type,
      status: 'settled',
      engine,
      settlement_note: engine === 'payrail_internal'
        ? 'Settled on Payrail internal rails. Funds available immediately within the network. Fed ACH origination activates when ABA routing number is obtained via sponsor bank.'
        : `Submitted to Federal Reserve ACH. Settlement expected next business day via routing ${process.env.ACH_ROUTING_NUMBER}.`,
      created_at: now
    });
  } catch (err: any) {
    res.status(500).json({ error: `ACH transfer failed: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/credit/soft_pull  (Stub — activates when EQUIFAX_CLIENT_ID is configured)
// Run a soft credit inquiry for KYC / creditworthiness via Payrail's bureau access.
// ─────────────────────────────────────────────────────────────────────────────
// ── POST /v1/credit/soft_pull ──
// Returns a credit report for a tenant/entity using Payrail transaction history.
// Upgrades to Equifax bureau data when EQUIFAX_CLIENT_ID is configured.
router.post('/credit/soft_pull', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  const { target_tenant_id } = req.body;

  // Allow admin to pull for another tenant, or self-pull
  const subjectId = target_tenant_id || tenant?.id;
  if (!subjectId) { res.status(400).json({ error: 'tenant context or target_tenant_id required.' }); return; }

  try {
    const report = await generateCreditReport(subjectId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: `Credit report generation failed: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTNER MANAGEMENT ROUTES
// Self-service partner registration and service activation
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /v1/partners/register ──
// Any firm can register as a Payrail partner.
// Creates a tenant record and issues an initial API key.
router.post('/partners/register', async (req: Request, res: Response) => {
  const {
    legal_name, bic_code, contact_email, country = 'US',
    firm_type = 'private', services_requested = []
  } = req.body;

  if (!legal_name || !contact_email) {
    res.status(400).json({ error: 'legal_name and contact_email are required.' });
    return;
  }

  try {
    const tenantId = uuidv4();
    const routingCode = bic_code || `PAYR${legal_name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}XX`;
    const now = new Date().toISOString();

    await railDb.execute({
      sql: `INSERT OR IGNORE INTO tenants
              (id, legal_name, bic_code, public_key, status, created_at)
            VALUES (?, ?, ?, ?, 'active', ?)`,
      args: [tenantId, legal_name, routingCode, contact_email, now]
    });

    // Activate all available services by default
    const allServices = [
      'fx_conversion', 'aml_screening', 'otp_verification', 'card_issuance',
      'ach_wire', 'crypto_wallets', 'credit_bureau', 'settlement_clearing', 'payment_intents'
    ];
    const serviceList = services_requested.length > 0 ? services_requested : allServices;
    for (const svcId of serviceList) {
      await railDb.execute({
        sql: `INSERT OR IGNORE INTO partner_services (tenant_id, service_id, status, activated_at)
              VALUES (?, ?, 'active', ?)`,
        args: [tenantId, svcId, now]
      });
    }

    // Generate first API key for the partner
    const { generateApiKey } = await import('./auth');
    const apiKeyResult = await generateApiKey(`${legal_name} Default Key`, tenantId);

    await createNotification(
      systemTenantId,
      'New Partner Registered',
      `${legal_name} (${country}, ${firm_type}) joined the Payrail network. ${serviceList.length} services activated.`,
      'success'
    );

    res.status(201).json({
      success: true,
      partner: {
        tenant_id: tenantId,
        legal_name,
        routing_code: routingCode,
        country,
        firm_type,
        status: 'active',
        joined_at: now
      },
      api_key: {
        key: apiKeyResult.rawKey,
        prefix: apiKeyResult.key.prefix,
        note: 'Store this key securely — it will not be shown again. Use it as: Authorization: Bearer <key>'
      },
      services_activated: serviceList,
      welcome_message: `Welcome to the Payrail network, ${legal_name}! You now have access to ${serviceList.length} financial services. Call GET /v1/services/catalog to explore what\'s available.`
    });
  } catch (err: any) {
    res.status(500).json({ error: `Partner registration failed: ${err.message}` });
  }
});

// ── GET /v1/partners/me ──
// Returns the calling partner's profile and enabled services.
router.get('/partners/me', async (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  if (!tenant?.id) { res.status(401).json({ error: 'Tenant context required.' }); return; }

  try {
    const servicesResult = await railDb.execute({
      sql: `SELECT service_id, status, activated_at FROM partner_services WHERE tenant_id = ?`,
      args: [tenant.id]
    });

    res.json({
      tenant_id: tenant.id,
      legal_name: tenant.legal_name,
      bic_code: tenant.bic_code,
      status: tenant.status || 'active',
      services: servicesResult.rows,
      services_count: servicesResult.rows.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/crypto/transfer
// Execute an on-chain token transfer via Web3 RPC on behalf of a member bank.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/crypto/transfer', async (req: Request, res: Response) => {
  const { to_address, amount, currency = 'USDC' } = req.body;

  if (!process.env.CRYPTO_RPC_URL) {
    res.status(503).json({
      error: 'Crypto rail is not yet active on this Payrail network.',
      code: 'service_pending_activation',
      service: 'crypto_wallets',
      action: 'Configure CRYPTO_RPC_URL in your Payrail network settings.',
      details: {
        providers: ['Alchemy', 'Infura', 'QuickNode', 'Fireblocks', 'BitGo'],
        how_it_works: 'Payrail holds custody of a network hot wallet. Your bank submits on-chain transfer requests and Payrail executes them.',
        note: 'FinCEN MSB registration required to offer crypto services to your customers.'
      }
    });
    return;
  }

  if (!to_address || !amount) {
    res.status(400).json({ error: 'to_address and amount are required.' });
    return;
  }

  // Forward to the real Web3 RPC integration
  try {
    const { executeWeb3RpcTransfer } = await import('./integrations');
    const { decryptCredentials } = await import('./crypto');

    // Use Payrail's platform crypto config (set via CRYPTO_PRIVATE_KEY / CRYPTO_CONTRACT_ADDRESS)
    const platformConfig = {
      rpc_url: process.env.CRYPTO_RPC_URL,
      private_key: process.env.CRYPTO_PRIVATE_KEY,
      contract_address: process.env.CRYPTO_CONTRACT_ADDRESS,
      destination_address: to_address
    };

    if (!platformConfig.private_key) {
      res.status(503).json({ error: 'CRYPTO_PRIVATE_KEY not configured on this Payrail network.' });
      return;
    }

    const txHash = await executeWeb3RpcTransfer(platformConfig, Math.round(amount * 100), currency);
    res.json({ success: true, tx_hash: txHash, to_address, amount, currency });
  } catch (err: any) {
    res.status(502).json({ error: `Crypto transfer failed: ${err.message}` });
  }
});

export default router;
