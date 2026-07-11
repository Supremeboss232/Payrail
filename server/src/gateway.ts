import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { railDb } from './db';
import { postTransaction, LedgerEntryInput } from './ledger';
import { dispatchWebhookEvent } from './webhooks';
import { buildPacs008, buildPacs009 } from './b2b';

const router = Router();

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
 * POST /v1/payment_intents
 * Creates a Stripe-like Payment Intent
 */
router.post('/payment_intents', async (req: Request, res: Response) => {
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
 * POST /v1/payment_intents/:id/confirm
 * Confirms a Payment Intent, executing the ledger transfers and swapping the funding source if failure occurs.
 */
router.post('/payment_intents/:id/confirm', async (req: Request, res: Response) => {
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
      swapLogs.push(`Attempting payment using funding source: ${fs.name} (${fs.type}).`);

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

        // Perform balance check. If Asset, we ensure it has sufficient balance to be debited
        // We simulate a transaction failure if balance is too low
        if (sourceAcc.balance < pi.amount) {
          throw new Error(`Insufficient funds: ${sourceAcc.name} has balance of ${sourceAcc.balance} cents, payment requires ${pi.amount} cents.`);
        }

        // Post ledger entries atomically
        // Debit: Merchant Destination Account (Asset or Wallet increases)
        // Credit: Funding Source Account (Asset decreases / liability increases)
        // Wait, let's map:
        // Double entry: Debit Destination, Credit Source
        // For Assets: Credit reduces balance (Source account balance goes down). Debit increases balance (Merchant Destination balance goes up).
        const entries: LedgerEntryInput[] = [
          {
            accountId: pi.destination_account_id,
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

        const tenantId = (req as any).tenant ? (req as any).tenant.id : null;

        await postTransaction(
          `Payment Intent confirm: ${pi.id} via ${fs.name}`,
          'api',
          entries,
          pi.id,
          pi.id,
          tenantId
        );

        successfulFs = fs;
        swapLogs.push(`Payment succeeded via ${fs.name}.`);
        break; // Stop loop since it succeeded!
      } catch (err: any) {
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
  const { name, type, account_id, priority = 0 } = req.body;

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
      sql: `INSERT INTO funding_sources (id, name, type, account_id, priority, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      args: [id, name, type, account_id, priority, createdAt],
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
  if (!id || !legal_name || !routing_code || !public_key_pem) {
    res.status(400).json({ error: 'id, legal_name, routing_code, and public_key_pem are required.' });
    return;
  }
  const createdAt = new Date().toISOString();
  try {
    await railDb.execute({
      sql: `INSERT INTO tenants (id, legal_name, routing_code, api_status, public_key_pem, created_at)
            VALUES (?, ?, ?, 'active', ?, ?)`,
      args: [id, legal_name, routing_code, public_key_pem, createdAt]
    });
    res.status(201).json({ id, legal_name, routing_code, status: 'active', created_at: createdAt });
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
  const { source_bic, dest_bic, amount, currency } = req.body;
  if (!source_bic || !dest_bic || !amount || !currency) {
    res.status(400).json({ error: 'source_bic, dest_bic, amount, and currency are required.' });
    return;
  }

  try {
    const sourceAccResult = await railDb.execute({
      sql: 'SELECT id FROM accounts WHERE tenant_id = (SELECT id FROM tenants WHERE routing_code = ?)',
      args: [source_bic]
    });
    const destAccResult = await railDb.execute({
      sql: 'SELECT id FROM accounts WHERE tenant_id = (SELECT id FROM tenants WHERE routing_code = ?)',
      args: [dest_bic]
    });

    if (sourceAccResult.rows.length === 0 || destAccResult.rows.length === 0) {
      res.status(400).json({ error: `Clearing accounts not found for routing BICs: ${source_bic} -> ${dest_bic}` });
      return;
    }

    const sourceAccountId = (sourceAccResult.rows[0] as any).id;
    const destAccountId = (destAccResult.rows[0] as any).id;

    const entries: LedgerEntryInput[] = [
      { accountId: destAccountId, type: 'debit', amount, currency: currency.toUpperCase() },
      { accountId: sourceAccountId, type: 'credit', amount, currency: currency.toUpperCase() }
    ];

    const tx = await postTransaction(
      `Deferred Net Settlement (DNS) Sweep: ${source_bic} -> ${dest_bic}`,
      'system',
      entries,
      `dns_${Date.now()}`,
      null,
      null // System-level settlement transaction
    );

    const pacs009Xml = buildPacs009(tx.id, amount, currency.toUpperCase(), source_bic, dest_bic);

    res.status(201).json({
      success: true,
      transaction: tx,
      pacs_009_xml: pacs009Xml
    });
  } catch (error: any) {
    console.error('DNS Sweep Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
