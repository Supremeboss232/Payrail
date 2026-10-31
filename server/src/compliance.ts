import * as https from 'https';
import * as crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// OFAC SDN Local Cache
// Downloads the OFAC SDN (Specially Designated Nationals) list from
// the U.S. Treasury and caches it in memory. Updated every 24 hours.
// Falls back to ComplyAdvantage if COMPLY_ADVANTAGE_API_KEY is configured.
// ─────────────────────────────────────────────────────────────────────────────

let sdnCache: string[] = [];
let lastSdnFetch: number = 0;
const SDN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';

/**
 * Downloads and parses the OFAC SDN CSV list.
 * Extracts entity names (column 1) into a normalized array for fast substring matching.
 */
async function refreshSdnList(): Promise<void> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    https.get(SDN_URL, (res) => {
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const lines = raw.split('\n');
        sdnCache = lines
          .map((line) => {
            // Column 1 (index 1) is the entity name in the OFAC SDN CSV
            const cols = line.split(',');
            return cols[1] ? cols[1].replace(/"/g, '').trim().toUpperCase() : '';
          })
          .filter(Boolean);
        lastSdnFetch = Date.now();
        console.log(`[Compliance] OFAC SDN list refreshed. ${sdnCache.length} entries cached.`);
        resolve();
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Ensures the SDN list is loaded and fresh.
 */
export async function ensureSdnLoaded(): Promise<void> {
  if (sdnCache.length === 0 || Date.now() - lastSdnFetch > SDN_TTL_MS) {
    try {
      await refreshSdnList();
    } catch (err: any) {
      console.warn(`[Compliance] Failed to fetch OFAC SDN list: ${err.message}. Screening will be skipped.`);
    }
  }
}

/**
 * Checks a name against the locally cached OFAC SDN list.
 */
function checkLocalOfac(name: string): { matched: boolean; matchedEntry?: string } {
  if (!name || sdnCache.length === 0) return { matched: false };
  const normalized = name.toUpperCase().trim();
  const matched = sdnCache.find(
    (entry) => entry.includes(normalized) || normalized.includes(entry)
  );
  return { matched: !!matched, matchedEntry: matched };
}

// ─────────────────────────────────────────────────────────────────────────────
// ComplyAdvantage API Integration
// ─────────────────────────────────────────────────────────────────────────────

interface ComplyAdvantageResult {
  matched: boolean;
  matchStatus: string;
  entityName?: string;
  searchId?: string;
}

async function screenViaComplyAdvantage(name: string): Promise<ComplyAdvantageResult> {
  const apiKey = process.env.COMPLY_ADVANTAGE_API_KEY;
  const baseUrl = process.env.COMPLY_ADVANTAGE_BASE_URL || 'https://api.complyadvantage.com';

  if (!apiKey) {
    throw new Error('COMPLY_ADVANTAGE_API_KEY is not configured.');
  }

  const response = await fetch(`${baseUrl}/searches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${apiKey}`,
    },
    body: JSON.stringify({
      search_term: name,
      fuzziness: 0.7,
      filters: { types: ['sanction', 'warning', 'fitness-probity', 'pep'] },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ComplyAdvantage API error ${response.status}: ${body}`);
  }

  const data = await response.json() as any;
  const matchStatus: string = data?.content?.data?.match_status || 'no_match';
  const hits: any[] = data?.content?.data?.hits || [];

  return {
    matched: matchStatus === 'potential_match' || matchStatus === 'true_positive',
    matchStatus,
    entityName: hits[0]?.doc?.name,
    searchId: data?.content?.data?.id?.toString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface ScreeningResult {
  passed: boolean;
  engine: 'comply_advantage' | 'ofac_local' | 'skipped';
  matchStatus: string;
  details?: string;
}

/**
 * Screens a payment participant against sanction lists.
 * Prefers ComplyAdvantage if configured; falls back to local OFAC SDN list.
 *
 * @param name - The legal name of the entity being screened
 * @returns ScreeningResult with pass/fail and details
 */
export async function screenParticipant(name: string): Promise<ScreeningResult> {
  if (!name || name.trim().length < 2) {
    return { passed: true, engine: 'skipped', matchStatus: 'no_name_provided' };
  }

  // Prefer ComplyAdvantage if configured
  if (process.env.COMPLY_ADVANTAGE_API_KEY) {
    try {
      const result = await screenViaComplyAdvantage(name);
      return {
        passed: !result.matched,
        engine: 'comply_advantage',
        matchStatus: result.matchStatus,
        details: result.matched
          ? `Potential match: "${result.entityName}" (Search ID: ${result.searchId})`
          : undefined,
      };
    } catch (err: any) {
      console.warn(`[Compliance] ComplyAdvantage call failed: ${err.message}. Falling back to local OFAC.`);
    }
  }

  // Fall back to local OFAC SDN list
  await ensureSdnLoaded();
  if (sdnCache.length === 0) {
    // SDN list unavailable — do not block but log
    console.warn('[Compliance] OFAC SDN list unavailable. Transaction screening skipped.');
    return { passed: true, engine: 'skipped', matchStatus: 'sdn_unavailable' };
  }

  const { matched, matchedEntry } = checkLocalOfac(name);
  return {
    passed: !matched,
    engine: 'ofac_local',
    matchStatus: matched ? 'potential_match' : 'no_match',
    details: matched ? `OFAC SDN match: "${matchedEntry}"` : undefined,
  };
}

/**
 * Screens both payer and payee in a payment.
 * Returns false and a reason if either party fails.
 */
export async function screenPayment(
  payerName: string,
  payeeName: string
): Promise<{ passed: boolean; reason?: string; results: { payer: ScreeningResult; payee: ScreeningResult } }> {
  const [payerResult, payeeResult] = await Promise.all([
    screenParticipant(payerName),
    screenParticipant(payeeName),
  ]);

  if (!payerResult.passed) {
    return {
      passed: false,
      reason: `Payer "${payerName}" failed compliance screening: ${payerResult.details || payerResult.matchStatus}`,
      results: { payer: payerResult, payee: payeeResult },
    };
  }

  if (!payeeResult.passed) {
    return {
      passed: false,
      reason: `Payee "${payeeName}" failed compliance screening: ${payeeResult.details || payeeResult.matchStatus}`,
      results: { payer: payerResult, payee: payeeResult },
    };
  }

  return {
    passed: true,
    results: { payer: payerResult, payee: payeeResult },
  };
}

/**
 * Returns the current compliance engine status for the /v1/providers/status endpoint.
 */
export function getComplianceStatus(): {
  engine: string;
  sdnEntriesCached: number;
  lastRefreshed: string | null;
} {
  return {
    engine: process.env.COMPLY_ADVANTAGE_API_KEY ? 'comply_advantage' : 'ofac_local',
    sdnEntriesCached: sdnCache.length,
    lastRefreshed: lastSdnFetch ? new Date(lastSdnFetch).toISOString() : null,
  };
}
