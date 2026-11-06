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
 * Computes Jaro-Winkler similarity (0.0 to 1.0) between two uppercase strings.
 */
function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t /= 2;

  const jaro = (matches / len1 + matches / len2 + (matches - t) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, len1, len2); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Checks a name against the locally cached OFAC SDN list using word-boundary
 * token matching and Jaro-Winkler similarity (threshold >= 0.90) to prevent
 * short-name substring false positives while catching true sanctioned entities.
 */
function checkLocalOfac(name: string): { matched: boolean; matchedEntry?: string } {
  if (!name || sdnCache.length === 0) return { matched: false };
  const normalized = name.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length < 4) return { matched: false };

  const queryTokens = normalized.split(' ').filter((t) => t.length >= 3);
  if (queryTokens.length === 0) return { matched: false };

  const matched = sdnCache.find((rawEntry) => {
    const entry = rawEntry.replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!entry || entry.length < 4) return false;

    // 1. Exact full-name match
    if (entry === normalized) return true;

    // 2. High Jaro-Winkler similarity across full entity strings (for 6+ char names)
    if (normalized.length >= 6 && Math.abs(entry.length - normalized.length) <= 5) {
      if (jaroWinkler(normalized, entry) >= 0.91) return true;
    }

    // 3. Multi-token exact word match (require at least 2 distinct tokens of >=4 chars to match)
    if (queryTokens.length >= 2) {
      const entryTokens = new Set(entry.split(' '));
      const significantQueryTokens = queryTokens.filter((t) => t.length >= 4);
      if (
        significantQueryTokens.length >= 2 &&
        significantQueryTokens.every((t) => entryTokens.has(t))
      ) {
        return true;
      }
    }

    return false;
  });
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
