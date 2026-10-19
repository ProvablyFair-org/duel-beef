import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';

/**
 * Beef (Cross-Road) RNG — port of Duel's HMAC-SHA256 + Fisher-Yates shuffle.
 *
 * Source of truth (audit repo):
 *   https://github.com/ProvablyFair-org/duel-beef/blob/main/src/rng.ts
 *
 * Same shuffle pattern as Mines/Keno but on a 20-tile linear track. The
 * player walks the track step-by-step; landing on a "death point" busts.
 *
 * Algorithm:
 *
 *   positions = [0, 1, ..., 19]
 *   for i from 19 down to 1:
 *     range   = i + 1
 *     maxFair = MAX_U32 - (MAX_U32 % range)
 *     cursor  = 19 - i
 *     loop:
 *       hash = HMAC-SHA256(hexBytes(serverSeed), `${clientSeed}:${nonce}:${cursor}`)
 *       scan 4-byte chunks of hash:
 *         if chunk < maxFair → j = chunk % range; swap positions[i] ↔ positions[j]; break
 *       else cursor++ and retry
 *   deathPoints = positions[0..deathCount-1]   (0-indexed, sorted ascending)
 *
 * Death-point count varies by difficulty (verified against /cross-road/config):
 *   EASY    = 1   (19 safe tiles)
 *   MEDIUM  = 3   (17 safe tiles)
 *   HARD    = 5   (15 safe tiles)
 *   EXPERT  = 10  (10 safe tiles — UI sometimes labels this "Extreme")
 *
 * Paid multiplier (different house edge than mines — 0.8% vs 0.1%):
 *
 *   raw    = C(20, k) / C(20 - m, k)             where m = deaths, k = steps
 *   paid   = raw × 0.992                          ← what Duel actually pays
 *
 * Same Duel API multiplier-naming quirk as mines: the field literally named
 * `multiplier` is the RAW combinatoric value; the field counterintuitively
 * named `no_house_edge_multiplier` is the actual paid multiplier with the
 * 0.8% edge applied. The verifier reports the paid figure.
 *
 * Verified against all 6,000 captured beef bets in the audit dataset:
 *   - death point positions: 6000 / 6000
 *   - paid multipliers (over 4,337 winning bets): 4337 / 4337
 */

const GRID_SIZE = 20;
const MAX_U32 = 0xffffffff;
const HOUSE_EDGE_FACTOR = 0.992;

export const DIFFICULTIES = [
  { id: 'easy',    label: 'Easy',    code: 1, deaths: 1  },
  { id: 'medium',  label: 'Medium',  code: 2, deaths: 3  },
  { id: 'hard',    label: 'Hard',    code: 3, deaths: 5  },
  { id: 'expert',  label: 'Extreme', code: 4, deaths: 10 },
];

export const DIFFICULTY_BY_ID = Object.fromEntries(DIFFICULTIES.map(d => [d.id, d]));
export const DIFFICULTY_BY_CODE = Object.fromEntries(DIFFICULTIES.map(d => [d.code, d]));

export const BEEF_GRID_SIZE = GRID_SIZE;

/**
 * Derive a single Beef bet outcome.
 *
 * @param {Object} p
 * @param {string} p.clientSeed
 * @param {string} p.serverSeed
 * @param {number} p.nonce
 * @param {string} p.difficulty   one of 'easy' | 'medium' | 'hard' | 'expert'
 * @param {number} [p.targetSteps]  optional — bulk mode uses this to compute
 *                                  per-nonce outcome (did first N tiles survive?)
 *
 * @returns {{
 *   deathPositions: number[],     // 0-indexed tile indices of death points
 *   safePositions: number[],      // the 20 - deaths safe tiles
 *   deathCount: number,
 *   firstHmac: string,
 *   maxSteps: number,             // the maximum number of safe steps available
 *   multiplier?: number,          // present only when targetSteps provided;
 *                                 // 0 if any of first targetSteps tiles is a
 *                                 // death point, else paid multiplier at k=targetSteps
 *   busted?: boolean,             // present only when targetSteps provided
 * }}
 */
export function deriveBeef({ clientSeed, serverSeed, nonce, difficulty, targetSteps }) {
  const diff = DIFFICULTY_BY_ID[difficulty] || DIFFICULTY_BY_ID.easy;
  const deathCount = diff.deaths;
  const key = seedKey(serverSeed);
  const positions = Array.from({ length: GRID_SIZE }, (_, i) => i);
  let firstHmac = '';

  for (let i = GRID_SIZE - 1; i > 0; i--) {
    const range = i + 1;
    const maxFair = MAX_U32 - (MAX_U32 % range);
    let cursor = GRID_SIZE - 1 - i;

    while (true) {
      const message = `${clientSeed}:${nonce}:${cursor}`;
      const hmac = hmacSha256Hex(key, message);
      if (cursor === 0 && firstHmac === '') firstHmac = hmac;

      let found = false;
      for (let off = 0; off + 8 <= hmac.length; off += 8) {
        const value = parseInt(hmac.substring(off, off + 8), 16);
        if (value < maxFair) {
          const j = value % range;
          [positions[i], positions[j]] = [positions[j], positions[i]];
          found = true;
          break;
        }
      }
      if (found) break;
      cursor++;
    }
  }

  const deathPositions = positions.slice(0, deathCount).sort((a, b) => a - b);
  const deathSet = new Set(deathPositions);
  const safePositions = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    if (!deathSet.has(i)) safePositions.push(i);
  }

  const out = {
    deathPositions,
    safePositions,
    deathCount,
    firstHmac,
    maxSteps: GRID_SIZE - deathCount,
  };

  // Bulk mode: compute the per-nonce outcome for "walk first N tiles, cash out."
  if (targetSteps != null && targetSteps > 0) {
    let busted = false;
    for (let i = 0; i < targetSteps; i++) {
      if (deathSet.has(i)) {
        busted = true;
        break;
      }
    }
    out.busted = busted;
    out.multiplier = busted ? 0 : cashoutMultiplier(deathCount, targetSteps);
  }

  return out;
}

/**
 * Paid cashout multiplier after `steps` safe steps at a given difficulty.
 *
 *   raw    = C(20, steps) / C(20 - deaths, steps)
 *   paid   = raw * 0.992
 */
export function cashoutMultiplier(deathCount, steps) {
  if (steps < 1) return 0;
  const safeTiles = GRID_SIZE - deathCount;
  if (steps > safeTiles) return 0;
  return (combination(GRID_SIZE, steps) / combination(safeTiles, steps)) * HOUSE_EDGE_FACTOR;
}

function combination(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

function seedKey(serverSeed) {
  if (isHex(serverSeed)) return hexToBytes(serverSeed);
  return utf8Bytes(serverSeed);
}
function isHex(s) {
  return typeof s === 'string' && s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}
function utf8Bytes(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}
