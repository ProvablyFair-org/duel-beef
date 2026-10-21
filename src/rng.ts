/**
 * PROVENANCE (header added on integration, 20 Oct 2026; everything below this comment is the
 * clean-room module byte for byte).
 *
 * This module was REBUILT FROM A WRITTEN SPECIFICATION, not ported from Duel's code:
 *   spec      docs/ALGORITHM.md, a copy of games/beef/ALGORITHM.md in the ProvablyFair.org audit
 *             framework (SHA-256 57daebfd…f7b6). Written from Duel's public pages, the standard
 *             provably-fair construction, Duel's public Beef config and the 6,450 live rounds, without
 *             opening Duel's code (its §8 lists every file read).
 *   rebuild   written by an implementer who read ONLY that spec and a module-interface file, and
 *             never opened Duel's code, its Verify-tab file, or this package's earlier src/rng.ts.
 *   self-test tests/beef/RngSpecTests.ts (the spec's §5 vectors and properties).
 *
 * Duel's published Verify-tab code (evidence/verify-tab/duel-verify-tab-beef-2026-09-26.js, E06) is
 * NOT the source of this module. It is run byte for byte as a SECOND CHECK, by Step 5 and the unit
 * tests (src/operator-verifier.ts), next to the ProvablyFair.org docs-site verifier.
 *
 * Three-way agreement measured on integration (20 Oct 2026, both datasets, 6,450 rounds): this module
 * vs the live rounds, commitment 6,450/6,450 (131/131 commitments), death points 6,450/6,450, and the
 * win/loss, path and phase-E reached_k derived from them 6,450/6,450 and 450/450; vs Duel's Verify-tab
 * code 6,450/6,450 death points; vs the provablyfair.org live verifier: not measured, this package has
 * no live-site runner for Beef (the docs-site derive.js agrees on 6,450/6,450).
 *
 * Where this module and Duel's Verify-tab code can differ (no captured round reaches either):
 *   - ranges 2, 4, 8 and 16: this module accepts every 32-bit chunk (LIMIT = 2^32); Duel's code
 *     rejects the top `range` values (maxFair = 0xFFFFFFFF − (0xFFFFFFFF mod range) = 2^32 − range)
 *     and moves to the next chunk. Both windows are whole numbers of ranges.
 *   - all 8 chunks of a draw rejected (spec open point O1, ≤ 4 × 10⁻⁶⁸ per draw): this module
 *     throws; Duel's code increments the HMAC counter and draws again.
 */
/**
 * Beef (Duel API name: cross-road) outcome derivation, written from
 * ALGORITHM.md and INTERFACE.md only. Section references (§) point at ALGORITHM.md.
 */
import { createHash, createHmac } from "crypto";

/** §0: the road has 20 tiles, numbered 0..19 in walking order. */
export const GRID_SIZE: number = 20;

/** §3.1: reference edge, 0.8 %. */
export const HOUSE_EDGE: number = 0.008;

/** §0 table: difficulty id -> number of death points m. */
export const DEATH_POINTS_BY_DIFFICULTY: Record<number, number> = {
  1: 1, // EASY
  2: 3, // MEDIUM
  3: 5, // HARD
  4: 10, // EXPERT
};

const TWO_POW_32 = 0x1_0000_0000; // 2^32
const CHUNKS_PER_DIGEST = 8; // §2 Step 2: chunk offsets 0, 4, ..., 28 of a 32-byte digest

function assertInt(name: string, v: number, min: number, max: number): void {
  if (!Number.isSafeInteger(v) || v < min || v > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${String(v)}`);
  }
}

/** §0: CONFIG `steps` = 20 - m, i.e. the safe tiles on the road. */
export function maxSteps(deathPointsCount: number): number {
  assertInt("deathPointsCount", deathPointsCount, 0, GRID_SIZE);
  return GRID_SIZE - deathPointsCount;
}

/** §2 Step 2: LIMIT(r) = floor(2^32 / r) * r; chunk values at or above it are rejected. */
export function maxFairFor(range: number): number {
  assertInt("range", range, 1, TWO_POW_32);
  return Math.floor(TWO_POW_32 / range) * range;
}

/**
 * §2 Step 2: one 32-bit chunk to an index in [0, range), or null when the chunk
 * falls in the biased tail (v >= LIMIT(range)).
 */
export function drawFromChunk(value: number, range: number): number | null {
  assertInt("value", value, 0, TWO_POW_32 - 1);
  if (value >= maxFairFor(range)) return null;
  return value % range;
}

export interface DrawCensus {
  draws: number;
  chunksRead: number;
  rejectedChunks: number;
  /** Here: each move from one 4-byte chunk to the next chunk of the same digest (§2 Step 2 loop). */
  cursorAdvances: number;
}

export function newDrawCensus(): DrawCensus {
  return { draws: 0, chunksRead: 0, rejectedChunks: 0, cursorAdvances: 0 };
}

/**
 * §2 Steps 1-2 for one draw t: a fresh HMAC per draw, then the first accepted
 * big-endian u32 chunk of that digest, reduced mod range.
 */
function drawIndex(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  t: number,
  range: number,
  census: DrawCensus | undefined,
): number {
  // §2 Step 1: message is UTF-8 of "clientSeed:nonce:t", all numbers plain base 10.
  const message = Buffer.from(`${clientSeed}:${nonce.toString(10)}:${t.toString(10)}`, "utf8");
  const digest = createHmac("sha256", keyBuffer).update(message).digest();
  for (let c = 0; c < CHUNKS_PER_DIGEST; c++) {
    if (c > 0 && census) census.cursorAdvances++;
    // §2 Step 2: bytes c*4 .. c*4+3 as an unsigned big-endian 32-bit integer.
    const v = digest.readUInt32BE(c * 4);
    if (census) census.chunksRead++;
    const idx = drawFromChunk(v, range);
    if (idx !== null) {
      if (census) census.draws++;
      return idx;
    }
    if (census) census.rejectedChunks++;
  }
  // §6 O1: the spec leaves "all 8 chunks rejected" unsettled; refuse to guess.
  throw new Error(
    `all ${CHUNKS_PER_DIGEST} chunks rejected for draw t=${t} (range ${range}); behaviour unspecified (ALGORITHM.md O1)`,
  );
}

function validateCommon(keyBuffer: Buffer, clientSeed: string, nonce: number, gridSize: number): void {
  if (!Buffer.isBuffer(keyBuffer)) throw new TypeError("keyBuffer must be a Buffer");
  if (typeof clientSeed !== "string") throw new TypeError("clientSeed must be a string");
  assertInt("nonce", nonce, 0, Number.MAX_SAFE_INTEGER);
  assertInt("gridSize", gridSize, 1, TWO_POW_32);
}

/**
 * §2 Step 3: backward Fisher-Yates over [0 .. gridSize-1]. Draw t (t = 0 .. gridSize-2)
 * swaps slot i = gridSize-1-t with a slot j drawn over range i+1.
 */
export function computePermutationFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  gridSize: number = GRID_SIZE,
  census?: DrawCensus,
): number[] {
  validateCommon(keyBuffer, clientSeed, nonce, gridSize);
  const a: number[] = Array.from({ length: gridSize }, (_, n) => n);
  for (let t = 0; t <= gridSize - 2; t++) {
    const i = gridSize - 1 - t;
    const j = drawIndex(keyBuffer, clientSeed, nonce, t, i + 1, census);
    const tmp = a[i] as number;
    a[i] = a[j] as number;
    a[j] = tmp;
  }
  return a;
}

/**
 * §2 Step 3 (last line): death points are the tile VALUES held in the first m
 * slots of the shuffled array. Returned sorted ascending (the spec treats them
 * as a set; §2 notes the capture records the set sorted).
 */
export function computeDeathPointsFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  deathPointsCount: number,
  gridSize: number = GRID_SIZE,
  census?: DrawCensus,
): number[] {
  validateCommon(keyBuffer, clientSeed, nonce, gridSize);
  assertInt("deathPointsCount", deathPointsCount, 0, gridSize);
  const a = computePermutationFromBuffer(keyBuffer, clientSeed, nonce, gridSize, census);
  return a.slice(0, deathPointsCount).sort((x, y) => x - y);
}

/** §1.1: the server seed is 64 hex characters encoding 32 bytes. */
function decodeServerSeed(serverSeed: string): Buffer {
  if (typeof serverSeed !== "string" || !/^[0-9a-fA-F]{64}$/.test(serverSeed)) {
    throw new TypeError("serverSeed must be 64 hexadecimal characters");
  }
  return Buffer.from(serverSeed, "hex");
}

/** §2 Step 1: the HMAC key is the hex-decoded server seed (32 raw bytes). */
export function computeDeathPoints(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  deathPointsCount: number,
  gridSize: number = GRID_SIZE,
): number[] {
  return computeDeathPointsFromBuffer(decodeServerSeed(serverSeed), clientSeed, nonce, deathPointsCount, gridSize);
}

/**
 * §1.2: commitment = lowercase hex of SHA-256 over the 32 decoded bytes (not the
 * ASCII hex text). Returns false for a malformed seed instead of throwing.
 */
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  let key: Buffer;
  try {
    key = decodeServerSeed(serverSeed);
  } catch {
    return false;
  }
  if (typeof serverSeedHashed !== "string") return false;
  const computed = createHash("sha256").update(key).digest("hex");
  return computed === serverSeedHashed.toLowerCase();
}

/** Exact binomial coefficient as a BigInt (0 when k > n). */
function binom(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  const kk = Math.min(k, n - k);
  let r = 1n;
  for (let i = 1; i <= kk; i++) {
    r = (r * BigInt(n - kk + i)) / BigInt(i); // exact at every step
  }
  return r;
}

/**
 * §3.1: P(survive k steps | m) = C(g - m, k) / C(g, k). Both binomials are
 * computed exactly, so the only rounding is the final division.
 */
export function survivalProbability(deathPointsCount: number, steps: number, gridSize: number = GRID_SIZE): number {
  assertInt("gridSize", gridSize, 1, 1000);
  assertInt("deathPointsCount", deathPointsCount, 0, gridSize);
  assertInt("steps", steps, 0, gridSize);
  const num = binom(gridSize - deathPointsCount, steps);
  if (num === 0n) return 0;
  return Number(num) / Number(binom(gridSize, steps));
}

/**
 * §3.1: multiplier = (1 - e) / P(survive). This is the exact reference, not the
 * fixed-precision chain Duel serves (§3.2). Throws where survival is impossible.
 */
export function theoreticalMultiplier(
  deathPointsCount: number,
  steps: number,
  houseEdge: number = HOUSE_EDGE,
  gridSize: number = GRID_SIZE,
): number {
  if (!Number.isFinite(houseEdge) || houseEdge < 0 || houseEdge >= 1) {
    throw new RangeError("houseEdge must be in [0, 1)");
  }
  const p = survivalProbability(deathPointsCount, steps, gridSize);
  if (p === 0) throw new RangeError(`cannot survive ${steps} steps with ${deathPointsCount} death points`);
  // Divide the exact integers once rather than 1/p, to keep a single rounding.
  const num = binom(gridSize, steps);
  const den = binom(gridSize - deathPointsCount, steps);
  return ((1 - houseEdge) * Number(num)) / Number(den);
}
