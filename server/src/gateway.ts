import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { railDb, systemTenantId, createNotification } from './db';
import { postTransaction, LedgerEntryInput, createAccount } from './ledger';
import { dispatchWebhookEvent } from './webhooks';
import { buildPacs008, buildPacs009 } from './b2b';
import { decryptCredentials, encryptCredentials } from './crypto';
import { executeHttpCallback, executeWeb3RpcTransfer } from './integrations';

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

export default router;
