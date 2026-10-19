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
 *
 * OPERATOR SOURCE (since 2026-09-26): Duel's own Beef Verify-tab code, pasted by Paulo from duel.com
 * Verify tab on 2026-09-26, evidence/verify-tab/duel-verify-tab-beef-2026-09-26.js (SHA-256
 * 43ba4dfb…564f6, pinned in src/operator-verifier.ts). "Lxx" is a line of that file. Every citation is
 * listed in OPERATOR_SOURCE_CITES and checked against the pinned bytes by Step 5 and the unit tests, and
 * Step 5 EXECUTES that file on every captured round.
 */

import * as crypto from 'crypto';

/**
 * Each entry: a line of evidence/verify-tab/duel-verify-tab-beef-2026-09-26.js and text that line must
 * contain verbatim. src/operator-verifier.ts checkOperatorCites reads the pinned file and FAILs any entry
 * whose line does not carry its text.
 */
export const OPERATOR_SOURCE_CITES: ReadonlyArray<{ line: number; text: string; ports: string }> = Object.freeze([
  { line: 30, text: 'const keyBytes = hexToBytes(keyHex);', ports: 'HMAC key = hex-decoded server seed' },
  { line: 36, text: "{ name: 'HMAC', hash: 'SHA-256' },", ports: 'HMAC-SHA256' },
  { line: 47, text: 'if (deathPointsCount >= gridSize) throw new Error("deathPointsCount must be less than gridSize");', ports: 'computeDeathPointsFromBuffer guard' },
  { line: 49, text: 'const MAX_UINT32 = 0xFFFFFFFF;', ports: 'MAX_UINT32' },
  { line: 50, text: 'const positions = Array.from({ length: gridSize }, (_, i) => i);', ports: 'positions = [0 … gridSize−1]' },
  { line: 53, text: 'for (let i = gridSize - 1; i > 0; i--) {', ports: 'backward Fisher-Yates' },
  { line: 54, text: 'const range = i + 1;', ports: 'range' },
  { line: 55, text: 'const maxFair = MAX_UINT32 - (MAX_UINT32 % range);', ports: 'maxFairFor' },
  { line: 56, text: 'let cursor = gridSize - 1 - i;', ports: 'cursor = gridSize − 1 − i' },
  { line: 62, text: 'new TextEncoder().encode(`${clientSeed}:${nonce}:${cursor}`)', ports: 'message = clientSeed:nonce:cursor' },
  { line: 66, text: 'for (let off = 0; off + 8 <= hash.length; off += 8) {', ports: 'eight 4-byte chunks, first to last' },
  { line: 67, text: 'const value = parseInt(hash.slice(off, off + 8), 16);', ports: 'chunk read as a big-endian uint32' },
  { line: 68, text: 'if (value < maxFair) {', ports: 'drawFromChunk acceptance' },
  { line: 69, text: 'const j = value % range;', ports: 'drawFromChunk index' },
  { line: 70, text: '[positions[i], positions[j]] = [positions[j], positions[i]];', ports: 'swap' },
  { line: 77, text: 'cursor++; // otherwise try a new cursor', ports: 'every chunk rejected → next cursor' },
  { line: 82, text: 'return positions.slice(0, deathPointsCount).sort((a, b) => a - b);', ports: 'death points = first m, sorted' },
]);

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

/**
 * Exclusive upper end of the accepted chunk window for one shuffle step on `range` tiles: a 32-bit
 * chunk v is accepted iff v < maxFairFor(range). By construction a whole number of ranges, which is
 * what makes the step exactly uniform — Step 5 (BEEF-08) re-derives that from drawFromChunk below
 * rather than trusting this sentence. (Ported 2026-09-26 from Duel Mines src/rng.ts, same algorithm.)
 */
export function maxFairFor(range: number): number {
  return MAX_UINT32 - (MAX_UINT32 % range);
}

/**
 * THE SINGLE-CHUNK DRAW the shuffle uses — the one place the acceptance rule and the chunk-to-index
 * mapping live. Returns the swap index j in [0, range), or null when the chunk falls in the rejected
 * tail. drawBiasBound probes THIS function, so a change to the rule the shuffle runs is a change to
 * the bound Step 5 prints.
 */
export function drawFromChunk(value: number, range: number): number | null {
  return value < maxFairFor(range) ? value % range : null;
}

/** Optional census filled by the shuffle: how often the rejection branch was actually taken. */
export interface DrawCensus {
  /** Shuffle steps executed (gridSize − 1 per round). */
  draws: number;
  /** 4-byte chunks read, accepted or not. */
  chunksRead: number;
  /** Chunks that fell in a rejected tail. */
  rejectedChunks: number;
  /** Times all 8 chunks of one HMAC were rejected and the cursor advanced. */
  cursorAdvances: number;
}

export function newDrawCensus(): DrawCensus {
  return { draws: 0, chunksRead: 0, rejectedChunks: 0, cursorAdvances: 0 };
}

export function computeDeathPointsFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  deathPointsCount: number,
  gridSize = GRID_SIZE,
  census?: DrawCensus,
): number[] {
  if (deathPointsCount >= gridSize) {
    throw new Error(`deathPointsCount (${deathPointsCount}) must be less than gridSize (${gridSize})`);
  }
  return computePermutationFromBuffer(keyBuffer, clientSeed, nonce, gridSize, census)
    .slice(0, deathPointsCount).sort((a, b) => a - b);
}

/**
 * The FULL shuffled board, before the death-point projection. Every difficulty draws the same
 * 20-tile permutation and keeps its first m tiles, so the permutation is the complete output of
 * the RNG for one (serverSeed, clientSeed, nonce). Step 6 compares this, not the projection: a
 * 1-of-20 projection (EASY) repeats under a different client seed 5% of the time by chance
 * alone, so the projection cannot tell "the client seed is an input" from "it is not".
 */
export function computePermutationFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  gridSize = GRID_SIZE,
  census?: DrawCensus,
): number[] {
  const positions: number[] = Array.from({ length: gridSize }, (_, i) => i);

  for (let i = gridSize - 1; i > 0; i--) {
    const range   = i + 1;
    let cursor    = gridSize - 1 - i;
    if (census) census.draws++;

    while (true) {
      const message = `${clientSeed}:${nonce}:${cursor}`;
      const hmac    = crypto.createHmac('sha256', keyBuffer).update(message).digest('hex');
      let found     = false;

      for (let off = 0; off + 8 <= hmac.length; off += 8) {
        const value = parseInt(hmac.substring(off, off + 8), 16);
        if (census) census.chunksRead++;
        const j = drawFromChunk(value, range);
        if (j !== null) {
          [positions[i], positions[j]] = [positions[j], positions[i]];
          found = true;
          break;
        }
        if (census) census.rejectedChunks++;
      }

      if (found) break;
      if (census) census.cursorAdvances++;
      cursor++;
    }
  }

  return positions;
}

/** One range's row of the draw-bias bound. */
export interface RangeBias {
  range: number;
  /** maxFairFor(range) — the constant the acceptance rule is written against. */
  maxFair: number;
  /** The accepted window's exclusive end AS MEASURED from drawFromChunk (binary search). */
  acceptedWindow: number;
  /** Chunk values in the rejected tail [acceptedWindow, 2^32). */
  rejectedValues: number;
  rejectionProbabilityPerChunk: number;
  /** acceptedWindow mod range: 0 ⇔ every index receives the same number of accepted values. */
  remainder: number;
  minIndexCount: number;
  maxIndexCount: number;
  /** max over j of |P(j | accepted) − 1/range|. */
  bias: number;
  /** P(max) / P(min) − 1. */
  relativeBias: number;
  /** The same two figures for the UNCORRECTED draw (plain v mod range over all 2^32 values). */
  uncorrectedBias: number;
  uncorrectedRelativeBias: number;
  /** Probes where drawFromChunk disagreed with "v < acceptedWindow ? v % range : null". */
  predicateProbeFailures: number;
  exact: boolean;
}

/**
 * THE DRAW BIAS BOUND, MEASURED FROM THE FUNCTION THE SHUFFLE CALLS (profile BEEF-08; ported
 * 2026-09-26 from Duel Mines src/rng.ts drawBiasBound, which runs the same shuffle on 25 tiles).
 *
 * For every range the shuffle draws on (2 … gridSize), the accepted window is located by binary
 * search on drawFromChunk itself — not read off maxFairFor — then ~600 probes (both ends of the
 * domain, both sides of the window edge, and a stride across it) confirm the predicate IS
 * "v < window ? v % range : null". Given that shape the per-index counts are exact integer
 * arithmetic: floor(W / range) or that plus one, the larger for the low `W mod range` indices.
 */
export function drawBiasBound(gridSize = GRID_SIZE): {
  algorithm: 'rejection-sampling';
  domainSize: number;
  ranges: RangeBias[];
  worstBias: number;
  worstRelativeBias: number;
  worstUncorrectedBias: number;
  worstUncorrectedRelativeBias: number;
  inexactRanges: number[];
  predicateProbeFailures: number;
  /** Expected rejected chunks per round: Σ_r p_r / (1 − p_r) over the gridSize − 1 steps. */
  expectedRejectedChunksPerRound: number;
} {
  const domainSize = MAX_UINT32 + 1;   // parseInt of 8 hex chars: 2^32 values
  const ranges: RangeBias[] = [];
  for (let range = 2; range <= gridSize; range++) {
    let lo = 0, hi = domainSize;
    if (drawFromChunk(0, range) === null) hi = 0;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (drawFromChunk(mid, range) !== null) lo = mid; else hi = mid;
    }
    const W = hi === 0 ? 0 : (drawFromChunk(lo, range) !== null ? lo + 1 : lo);

    const expect = (v: number): number | null => (v < W ? v % range : null);
    const probes = new Set<number>();
    for (let d = 0; d < 100; d++) {
      probes.add(d);
      probes.add(MAX_UINT32 - d);
      if (W - 1 - d >= 0) probes.add(W - 1 - d);
      if (W + d <= MAX_UINT32) probes.add(W + d);
    }
    for (let k = 0; k < 200; k++) probes.add(Math.floor(k * (domainSize / 200)) + (k % range));
    let predicateProbeFailures = 0;
    for (const v of probes) {
      if (v < 0 || v > MAX_UINT32) continue;
      if (drawFromChunk(v, range) !== expect(v)) predicateProbeFailures++;
    }

    const remainder = W % range;
    const minIndexCount = Math.floor(W / range);
    const maxIndexCount = remainder === 0 ? minIndexCount : minIndexCount + 1;
    const bias = W === 0 ? 1
      : Math.max(maxIndexCount * range - W, W - minIndexCount * range) / (W * range);
    const relativeBias = minIndexCount === 0 ? Infinity : maxIndexCount / minIndexCount - 1;

    const uRem = domainSize % range;
    const uMin = Math.floor(domainSize / range);
    const uMax = uRem === 0 ? uMin : uMin + 1;
    const uncorrectedBias = Math.max(uMax * range - domainSize, domainSize - uMin * range) / (domainSize * range);
    const uncorrectedRelativeBias = uMax / uMin - 1;

    const rejectedValues = domainSize - W;
    ranges.push({
      range, maxFair: maxFairFor(range), acceptedWindow: W, rejectedValues,
      rejectionProbabilityPerChunk: rejectedValues / domainSize,
      remainder, minIndexCount, maxIndexCount, bias, relativeBias,
      uncorrectedBias, uncorrectedRelativeBias, predicateProbeFailures,
      exact: remainder === 0 && W > 0 && predicateProbeFailures === 0,
    });
  }
  return {
    algorithm: 'rejection-sampling',
    domainSize,
    ranges,
    worstBias: Math.max(...ranges.map(r => r.bias)),
    worstRelativeBias: Math.max(...ranges.map(r => r.relativeBias)),
    worstUncorrectedBias: Math.max(...ranges.map(r => r.uncorrectedBias)),
    worstUncorrectedRelativeBias: Math.max(...ranges.map(r => r.uncorrectedRelativeBias)),
    inexactRanges: ranges.filter(r => !r.exact).map(r => r.range),
    predicateProbeFailures: ranges.reduce((n, r) => n + r.predicateProbeFailures, 0),
    expectedRejectedChunksPerRound: ranges.reduce(
      (n, r) => n + r.rejectionProbabilityPerChunk / (1 - r.rejectionProbabilityPerChunk), 0),
  };
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
