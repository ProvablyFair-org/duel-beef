/**
 * Step 24 — Multiplier Monotonicity & Bounds (profile BEEF-14). Added 2026-09-26.
 *
 * FLAG-ONLY BY POLICY (R2): a violation is disclosed, never failed. Two halves:
 *
 *  1. THE TABLE. Every (difficulty, k) cell of the declared closed form C(20,k)/C(20−m,k) × 992/1000
 *     (src/exact.ts, exact rationals — no double anywhere) for k = 1 … 20 − m: strictly increasing in
 *     depth k at every difficulty, and strictly increasing in difficulty (death-point count m) at every
 *     depth k that more than one difficulty reaches. Counts are bound: 61 cells, 57 depth pairs,
 *     42 difficulty pairs, all derived from DEATH_POINTS_BY_DIFFICULTY and GRID — never from the data.
 *
 *  2. THE SERVED VALUES. Every served multiplier Steps 8 and 20 bind to the formula — the raw
 *     `multiplier` and paid `no_house_edge_multiplier` of every primary win (k = 1) and the raw
 *     `multiplier` of every non-death Phase E rung — grouped by (difficulty, k): each observed cell
 *     must sit strictly above the observed cell one step shallower and one difficulty lower
 *     (max of the lower cell < min of the higher cell, compared exactly as decimals).
 *
 * THE CAP. declarations/duel.beef.json gameModel.limits.maxOdds is null: Duel declares no max-odds cap
 * for Beef and none is published in the package, so there is no cap to hold a served value against and
 * no formula cell to disclose as above one. The step says so and prints the largest served and formula
 * multipliers so the gap is measurable. It does not invent a cap.
 */

import type { StepResult, BeefGame } from '../../src/types';
import { step } from './context';
import { DIFFICULTY_LEVELS } from '../../src/loader';
import { DEATH_POINTS_BY_DIFFICULTY } from '../../src/rng';
import { GRID, exactMultiplier, compareRational, parseDecimal, Rational } from '../../src/exact';

/** Declared max-odds cap for Beef (declarations/duel.beef.json gameModel.limits.maxOdds): none. */
export const DECLARED_MAX_ODDS: number | null = null;

function asRational(s: string | null | undefined): Rational | null {
  if (typeof s !== 'string') return null;
  try { const d = parseDecimal(s); return { num: d.int, den: 10n ** BigInt(d.scale) }; } catch { return null; }
}

type Cell = { min: Rational; max: Rational; n: number };

function addServed(cells: Map<string, Cell>, key: string, r: Rational): void {
  const c = cells.get(key);
  if (!c) { cells.set(key, { min: r, max: r, n: 1 }); return; }
  if (compareRational(r, c.min) < 0) c.min = r;
  if (compareRational(r, c.max) > 0) c.max = r;
  c.n++;
}

export function run(primary: BeefGame[], phaseE: BeefGame[]): StepResult[] {
  const violations: string[] = [];

  // ── 1. The declared table ────────────────────────────────────────────────────────────────────────
  const diffs = [...DIFFICULTY_LEVELS].sort((a, b) => DEATH_POINTS_BY_DIFFICULTY[a] - DEATH_POINTS_BY_DIFFICULTY[b]);
  const maxK = (d: number): number => GRID - DEATH_POINTS_BY_DIFFICULTY[d];
  let cells = 0, depthPairs = 0, diffPairs = 0;
  let formulaMax: Rational = { num: 0n, den: 1n };
  for (const d of diffs) {
    const m = DEATH_POINTS_BY_DIFFICULTY[d];
    for (let k = 1; k <= maxK(d); k++) {
      cells++;
      const cur = exactMultiplier(m, k, true);
      if (compareRational(cur, formulaMax) > 0) formulaMax = cur;
      if (k > 1) {
        depthPairs++;
        if (compareRational(exactMultiplier(m, k - 1, true), cur) >= 0) violations.push(`formula: difficulty ${d} k=${k} is not above k=${k - 1}`);
      }
    }
  }
  for (let i = 1; i < diffs.length; i++) {
    const lo = diffs[i - 1], hi = diffs[i];
    for (let k = 1; k <= maxK(hi); k++) {
      diffPairs++;
      const a = exactMultiplier(DEATH_POINTS_BY_DIFFICULTY[lo], k, true);
      const b = exactMultiplier(DEATH_POINTS_BY_DIFFICULTY[hi], k, true);
      if (compareRational(a, b) >= 0) violations.push(`formula: k=${k} difficulty ${hi} is not above difficulty ${lo}`);
    }
  }
  const expectedCells = diffs.reduce((s, d) => s + maxK(d), 0);
  const expectedDepthPairs = expectedCells - diffs.length;
  const expectedDiffPairs = diffs.slice(1).reduce((s, d) => s + maxK(d), 0);
  if (cells !== expectedCells || depthPairs !== expectedDepthPairs || diffPairs !== expectedDiffPairs) {
    violations.push(`formula coverage ${cells}/${depthPairs}/${diffPairs} cells/depth/difficulty pairs, expected ${expectedCells}/${expectedDepthPairs}/${expectedDiffPairs}`);
  }

  // ── 2. The served values ─────────────────────────────────────────────────────────────────────────
  const raw = new Map<string, Cell>();
  const paid = new Map<string, Cell>();
  let servedRaw = 0, servedPaid = 0, unparsable = 0;
  let servedMax: Rational = { num: 0n, den: 1n };
  const note = (r: Rational): void => { if (compareRational(r, servedMax) > 0) servedMax = r; };
  for (const b of primary) {
    if (b.response.outcome !== 'win') continue;
    const d = b.response.difficulty_level;
    const r = asRational(b.response.multiplier);
    const p = asRational(b.response.no_house_edge_multiplier);
    if (!r || !p) { unparsable++; continue; }
    addServed(raw, `${d}:1`, r); servedRaw++;
    addServed(paid, `${d}:1`, p); servedPaid++; note(p);
  }
  for (const b of phaseE) {
    const d = b.response.difficulty_level;
    for (const s of b.step_results ?? []) {
      if (s.is_death) continue;
      const r = asRational(s.multiplier);
      if (!r) { unparsable++; continue; }
      addServed(raw, `${d}:${s.step}`, r); servedRaw++;
    }
  }
  if (unparsable > 0) violations.push(`${unparsable} served multiplier(s) are not plain decimals`);
  if (servedRaw === 0 || servedPaid === 0) violations.push('no served multiplier was checked');

  let servedDepthPairs = 0, servedDiffPairs = 0;
  const check = (label: string, cellsOf: Map<string, Cell>): void => {
    for (const [key, c] of cellsOf) {
      const [d, k] = key.split(':').map(Number);
      const shallower = cellsOf.get(`${d}:${k - 1}`);
      if (shallower) {
        servedDepthPairs++;
        if (compareRational(shallower.max, c.min) >= 0) violations.push(`served ${label}: difficulty ${d} k=${k} is not above k=${k - 1}`);
      }
      const i = diffs.indexOf(d as 1 | 2 | 3 | 4);
      if (i > 0) {
        const lower = cellsOf.get(`${diffs[i - 1]}:${k}`);
        if (lower) {
          servedDiffPairs++;
          if (compareRational(lower.max, c.min) >= 0) violations.push(`served ${label}: k=${k} difficulty ${d} is not above difficulty ${diffs[i - 1]}`);
        }
      }
    }
  };
  check('raw', raw);
  check('paid', paid);

  const ok = violations.length === 0;
  const toNum = (r: Rational): number => Number(r.num * 10n ** 12n / r.den) / 1e12;
  return [step(24, 'Multiplier Monotonicity & Bounds (BEEF-14)',
    ok ? 'PASS' : 'FLAG',
    ok
      ? `declared table: all ${cells} (difficulty, k) cells of C(20,k)/C(20−m,k) × 992/1000 compared exactly — strictly increasing in depth on ${depthPairs}/${depthPairs} pairs and in difficulty on ${diffPairs}/${diffPairs} pairs; served: ${servedRaw} raw + ${servedPaid} paid multipliers in ${raw.size} observed cells, strictly increasing on ${servedDepthPairs} depth and ${servedDiffPairs} difficulty pairs of observed cells; cap: none declared (declarations/duel.beef.json gameModel.limits.maxOdds = null), so no served value or formula cell can exceed one — largest served and formula multipliers are in this step's data block`
      : `MONOTONICITY/BOUNDS (FLAG, disclosed per R2): ${violations.slice(0, 5).join('; ')}${violations.length > 5 ? `; +${violations.length - 5} more` : ''}`,
    {
      formulaCells: cells, formulaDepthPairs: depthPairs, formulaDifficultyPairs: diffPairs,
      servedRaw, servedPaid, observedCells: raw.size, servedDepthPairs, servedDifficultyPairs: servedDiffPairs,
      declaredMaxOdds: DECLARED_MAX_ODDS, largestServedPaidMultiplier: toNum(servedMax), largestFormulaMultiplier: toNum(formulaMax),
      violations,
    },
  )];
}
