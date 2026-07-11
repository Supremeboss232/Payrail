import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';

export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string; // JSON string array
  status: 'active' | 'disabled';
  created_at: string;
}

export interface WebhookLog {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: string;
  response_status: number | null;
  response_body: string | null;
  delivered_at: string;
}

/**
 * Registers a new webhook URL
 */
export async function createWebhookEndpoint(url: string, events: string[]): Promise<WebhookEndpoint> {
  const id = `we_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const secret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const eventsJson = JSON.stringify(events);

  await db.execute({
    sql: `INSERT INTO webhook_endpoints (id, url, secret, events, status, created_at)
          VALUES (?, ?, ?, ?, 'active', ?)`,
    args: [id, url, secret, eventsJson, createdAt],
  });

  return {
    id,
    url,
    secret,
    events: eventsJson,
    status: 'active',
    created_at: createdAt,
  };
}

/**
 * Gets webhook endpoints
 */
export async function getWebhookEndpoints(): Promise<WebhookEndpoint[]> {
  const result = await db.execute('SELECT * FROM webhook_endpoints ORDER BY created_at DESC');
  return result.rows as unknown as WebhookEndpoint[];
}

/**
 * Deletes a webhook endpoint
 */
export async function deleteWebhookEndpoint(id: string): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM webhook_endpoints WHERE id = ?',
    args: [id],
  });
}

/**
 * Retrieves delivery logs for webhooks
 */
export async function getWebhookLogs(): Promise<WebhookLog[]> {
  const result = await db.execute('SELECT * FROM webhook_delivery_logs ORDER BY delivered_at DESC LIMIT 100');
  return result.rows as unknown as WebhookLog[];
}

/**
 * Dispatches a webhook event asynchronously.
 * Signs the payload using HMAC-SHA256 with the endpoint secret.
 */
export async function dispatchWebhookEvent(eventType: string, data: any): Promise<void> {
  const eventId = `evt_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = {
    id: eventId,
    type: eventType,
    data,
    created_at: new Date().toISOString(),
  };
  const payloadStr = JSON.stringify(payload);

  try {
    const endpoints = await getWebhookEndpoints();
    const activeEndpoints = endpoints.filter(ep => {
      if (ep.status !== 'active') return false;
      const subscribedEvents = JSON.parse(ep.events) as string[];
      return subscribedEvents.includes(eventType) || subscribedEvents.includes('*');
    });

    // Send notifications in parallel (fire-and-forget style to avoid blocking parent flow)
    activeEndpoints.forEach((ep) => {
      // Create HMAC signature: hmac(secret, timestamp + '.' + payload)
      const hmac = crypto.createHmac('sha256', ep.secret);
      hmac.update(`${timestamp}.${payloadStr}`);
      const signature = hmac.digest('hex');
      const signatureHeader = `t=${timestamp},v1=${signature}`;

      // Start delivery chain
      attemptDelivery(ep, payloadStr, eventType, signatureHeader);
    });
  } catch (error) {
    console.error('Error dispatching webhook event:', error);
  }
}

/**
 * Handles Webhook delivery retries with exponential backoff.
 */
async function attemptDelivery(ep: WebhookEndpoint, payloadStr: string, eventType: string, signatureHeader: string, attempt = 1) {
  let responseStatus: number | null = null;
  let responseBody: string = '';

  try {
    const response = await fetch(ep.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Payrail-Signature': signatureHeader,
        'User-Agent': 'Payrail-Webhook-Dispatcher/1.0',
      },
      body: payloadStr,
      // 5 second timeout
      signal: AbortSignal.timeout(5000),
    });

    responseStatus = response.status;
    responseBody = await response.text();
  } catch (err: any) {
    responseStatus = 500;
    responseBody = err.message || 'Network request failed';
  }

  // Log webhook delivery attempt
  const logId = `wl_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  await db.execute({
    sql: `INSERT INTO webhook_delivery_logs (id, endpoint_id, event_type, payload, response_status, response_body, delivered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      logId,
      ep.id,
      eventType,
      payloadStr,
      responseStatus,
      `Attempt #${attempt}: ${responseBody.substring(0, 450)}`, // Cap size and show attempt
      new Date().toISOString(),
    ],
  }).catch(err => {
    console.error('Failed to write webhook log:', err);
  });

  // If status is not 2xx success and attempt count < 5, schedule retry
  if ((responseStatus < 200 || responseStatus >= 300) && attempt < 5) {
    const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s
    setTimeout(() => {
      attemptDelivery(ep, payloadStr, eventType, signatureHeader, attempt + 1);
    }, delayMs);
  }
}
