/**
 * Duel.com Beef (cross-road) — RNG implementation.
 *
 * Algorithm: backward Fisher-Yates shuffle with per-step rejection sampling,
 * the same pattern used by Duel Mines and Keno.
 *
 *   positions = [0, 1, ..., 19]
 *   for i from 19 downto 1:
 *     cursor = 19 - i
 *     range  = i + 1
 *     maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range)
 *     loop:
 *       hash = HMAC-SHA256(key = hex_bytes(serverSeed), message = clientSeed:nonce:cursor)
 *       scan 4-byte chunks of hash:
 *         if chunk < maxFair → j = chunk % range; swap positions[i] ↔ positions[j]; break
 *       else cursor++ and retry
 *   death_points = positions[0..deathPointsCount-1], sorted ascending
 *
 * Key encoding: Buffer.from(serverSeed, 'hex') — hex-decoded bytes, NOT UTF-8.
 * Grid size: 20 (constant across all difficulties).
 * deathPointsCount varies by difficulty: EASY=1, MEDIUM=3, HARD=5, EXPERT=10.
 */

import * as crypto from 'crypto';

export const GRID_SIZE = 20;
export const HOUSE_EDGE = 0.008;  // 0.8% — verified: 1/0.95 × 0.992 = 1.04421… matches API payout tables
const MAX_UINT32 = 0xFFFFFFFF;

/** Death-point count per difficulty, by difficulty_level id (from /cross-road/config). */
export const DEATH_POINTS_BY_DIFFICULTY: Record<number, number> = {
  1: 1,   // EASY   — 19 steps
  2: 3,   // MEDIUM — 17 steps
  3: 5,   // HARD   — 15 steps
  4: 10,  // EXPERT — 10 steps (UI labels this "Extreme")
};

/** Max steps before a round is auto-cashed out (i.e. full traversal). */
export function maxSteps(deathPointsCount: number): number {
  return GRID_SIZE - deathPointsCount;
}

export function computeDeathPointsFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  deathPointsCount: number,
  gridSize = GRID_SIZE,
): number[] {
  if (deathPointsCount >= gridSize) {
    throw new Error(`deathPointsCount (${deathPointsCount}) must be less than gridSize (${gridSize})`);
  }

  const positions: number[] = Array.from({ length: gridSize }, (_, i) => i);

  for (let i = gridSize - 1; i > 0; i--) {
    const range   = i + 1;
    const maxFair = MAX_UINT32 - (MAX_UINT32 % range);
    let cursor    = gridSize - 1 - i;

    while (true) {
      const message = `${clientSeed}:${nonce}:${cursor}`;
      const hmac    = crypto.createHmac('sha256', keyBuffer).update(message).digest('hex');
      let found     = false;

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

  return positions.slice(0, deathPointsCount).sort((a, b) => a - b);
}

export function computeDeathPoints(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  deathPointsCount: number,
  gridSize = GRID_SIZE,
): number[] {
  const key = Buffer.from(serverSeed, 'hex');
  return computeDeathPointsFromBuffer(key, clientSeed, nonce, deathPointsCount, gridSize);
}

/** SHA-256 commit-reveal: verify SHA-256(hex_bytes(serverSeed)) === serverSeedHashed */
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  const seedBytes = Buffer.from(serverSeed, 'hex');
  const computed  = crypto.createHash('sha256').update(seedBytes).digest('hex');
  return computed === serverSeedHashed;
}

/**
 * Survival probability for reaching step k (completing k successful tiles) with
 * m death points on a gridSize=20 board. Hypergeometric:
 *   P(survive k) = C(gridSize - m, k) / C(gridSize, k)
 * Equivalently: (gridSize - m)!/(gridSize - m - k)! × (gridSize - k)!/gridSize!
 */
export function survivalProbability(
  deathPointsCount: number,
  steps: number,
  gridSize = GRID_SIZE,
): number {
  const n = gridSize;
  const m = deathPointsCount;
  const k = steps;
  if (k === 0) return 1;
  if (k > n - m) return 0;
  return comb(n - m, k) / comb(n, k);
}

/**
 * Theoretical payout multiplier at step k — matches Duel's config.payout_tables.
 *   multiplier(k) = (1 - house_edge) × (C(n, k) / C(n - m, k))
 *   where n = gridSize, m = deathPointsCount.
 *
 * Example (EASY, k=1, m=1):
 *   raw    = C(20,1) / C(19,1) = 20/19 ≈ 1.05263158
 *   payout = raw × 0.992             ≈ 1.04421053 (matches config[1][0] exactly)
 */
export function theoreticalMultiplier(
  deathPointsCount: number,
  steps: number,
  houseEdge = HOUSE_EDGE,
  gridSize = GRID_SIZE,
): number {
  const n = gridSize;
  const m = deathPointsCount;
  const k = steps;
  return (comb(n, k) / comb(n - m, k)) * (1 - houseEdge);
}

/** Binomial coefficient C(n, k). Uses floating-point incremental form; OK for n ≤ 20. */
function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}
