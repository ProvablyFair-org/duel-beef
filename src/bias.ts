/**
 * THE DRAW BIAS BOUND (profile BEEF-08) — OUR audit code, not Duel's and not part of the RNG.
 *
 * Moved out of src/rng.ts on 20 Oct 2026, when src/rng.ts was replaced by the clean-room rebuild of
 * docs/ALGORITHM.md (whose module interface does not include it). The logic is unchanged from the
 * bound this package has carried since 26 Sep 2026 (the same bound as the ProvablyFair.org Duel Mines
 * audit package, which runs the same shuffle on 25 tiles). It is built ON TOP of the clean module:
 * it probes src/rng.ts drawFromChunk — the single-chunk draw the shuffle calls for every draw — so a
 * change to the rule the shuffle runs is a change to the bound Step 5 prints.
 *
 * For every range the shuffle draws on (2 … gridSize), the accepted window is located by binary
 * search on drawFromChunk itself — not read off maxFairFor — then ~600 probes (both ends of the
 * domain, both sides of the window edge, and a stride across it) confirm the predicate IS
 * "v < window ? v % range : null". Given that shape the per-index counts are exact integer
 * arithmetic: floor(W / range) or that plus one, the larger for the low `W mod range` indices.
 */

import { drawFromChunk, maxFairFor, GRID_SIZE } from './rng';

/** Largest 32-bit chunk value: a chunk is 4 digest bytes read as an unsigned integer. */
const MAX_UINT32 = 0xFFFFFFFF;

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
  const domainSize = MAX_UINT32 + 1;   // 4 bytes read as an unsigned integer: 2^32 values
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
