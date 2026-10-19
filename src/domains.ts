/**
 * Duel.com Beef — VALUE DOMAINS for every numeric leaf of the committed JSON artifacts of record
 * (`outputs/simulation-results.json`, `outputs/chi-squared-results.json`, `outputs/determinism-log.json`).
 * Profile BEEF-27.
 *
 * Ported from the Duel Crash package's src/domains.ts (itself ported from Duel Dice), 2026-09-26. The
 * SHA-256 pin (Step 23) proves the bytes have not moved since we pinned them; it cannot tell a genuine
 * figure from a physically impossible one that a forger wrote and re-pinned. Step 23 therefore also
 * validates every numeric leaf against a domain declared here, in BOTH directions: every leaf satisfies
 * its domain, and every leaf path is covered by a rule (a new, undeclared numeric field fails). Every
 * bound comes from src/ (src/loader.ts, src/rng.ts), NEVER from the artifact being checked. The domains
 * encode physical possibility, not plausibility: nothing here rejects a value for being surprising.
 */

import {
  EXPECTED_BETS, EXPECTED_EPOCHS, DIFFICULTY_LEVELS,
  SIM_DIFFICULTIES, SIM_ROUNDS_PER_CONFIG, SIM_NONCES_PER_SEED, SIM_EPOCH_LENGTH,
  SIM_CONVERGENCE_SAMPLES, SIM_PASS2_DIFFICULTY,
} from './loader';
import { GRID_SIZE, HOUSE_EDGE, DEATH_POINTS_BY_DIFFICULTY, theoreticalMultiplier } from './rng';

export interface Domain {
  readonly label: string;
  readonly ok: (v: number) => boolean;
}

const D = (label: string, ok: (v: number) => boolean): Domain => ({ label, ok });

// ── Primitive domains ────────────────────────────────────────────────────────────────────────────

/** Any real number that is not NaN/Infinity. Used only where the quantity has no physical bound (z-scores). */
export const FINITE = D('a finite number', v => Number.isFinite(v));
export const NONNEG_REAL = D('a non-negative real', v => Number.isFinite(v) && v >= 0);
export const PROBABILITY = D('a probability in [0,1]', v => Number.isFinite(v) && v >= 0 && v <= 1);
export const CORRELATION = D('a correlation in [-1,1]', v => Number.isFinite(v) && v >= -1 && v <= 1);
/** A chi-squared statistic is a sum of squares over positive expectations. */
export const CHI_SQUARED = D('a non-negative chi-squared statistic', v => Number.isFinite(v) && v >= 0);

export const exactly = (target: number, what: string): Domain =>
  D(`exactly ${target} (${what})`, v => v === target);

export const intAtMost = (max: number, what: string): Domain =>
  D(`an integer in [0, ${max}] (${what})`, v => Number.isInteger(v) && v >= 0 && v <= max);

export const intBetween = (lo: number, hi: number, what: string): Domain =>
  D(`an integer in [${lo}, ${hi}] (${what})`, v => Number.isInteger(v) && v >= lo && v <= hi);

export const realBetween = (lo: number, hi: number, what: string): Domain =>
  D(`a real in [${lo}, ${hi}] (${what})`, v => Number.isFinite(v) && v >= lo && v <= hi);

export const oneOf = (set: readonly number[], what: string): Domain =>
  D(`one of {${set.join(', ')}} (${what})`, v => set.includes(v));

/** A computed identity held to double rounding: |v − target| ≤ 1e-12 (the value is a product of two doubles). */
export const identity = (target: number, what: string): Domain =>
  D(`${target} within 1e-12 (${what})`, v => Number.isFinite(v) && Math.abs(v - target) <= 1e-12);

// ── The rule table ────────────────────────────────────────────────────────────────────────────────

export interface Rule {
  /** Matches a COLLAPSED leaf path: array indices are rendered as `[]`. */
  readonly path: RegExp;
  readonly domain: Domain;
}

/** Collapse `a.b[3].c` to `a.b[].c` so one rule covers every element of a list. */
export function collapsePath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

/**
 * Every numeric leaf of each committed artifact, with the domain it physically admits.
 * Ordering matters: the FIRST matching rule wins, so narrower (anchored) patterns come first.
 */
export function domainRules(): Record<string, Rule[]> {
  const configs = SIM_DIFFICULTIES.length;
  const dpcSet = SIM_DIFFICULTIES.map(d => DEATH_POINTS_BY_DIFFICULTY[d]);
  const rtp = 1 - HOUSE_EDGE;
  // Pass 1 plays one step per round and pays theoreticalMultiplier(m, 1) or 0, so an average payout
  // lies in [0, the largest one-step multiplier over the simulated difficulties].
  const maxOneStep = Math.max(...dpcSet.map(m => theoreticalMultiplier(m, 1, HOUSE_EDGE)));
  const avgPayout = realBetween(0, maxOneStep, 'an attainable average one-step payout');
  const pass2Dpc = DEATH_POINTS_BY_DIFFICULTY[SIM_PASS2_DIFFICULTY];
  const lateTotal = SIM_NONCES_PER_SEED - SIM_EPOCH_LENGTH;
  return {
    // ── outputs/simulation-results.json ────────────────────────────────────────────────────────────
    'simulation-results.json': [
      { path: /^\.pass1_fresh_seeds\.configs$/, domain: exactly(configs, 'SIM_DIFFICULTIES.length') },
      { path: /^\.pass1_fresh_seeds\.roundsPerConfig$/, domain: exactly(SIM_ROUNDS_PER_CONFIG, 'SIM_ROUNDS_PER_CONFIG') },
      { path: /^\.pass1_fresh_seeds\.totalRounds$/, domain: exactly(configs * SIM_ROUNDS_PER_CONFIG, 'configs × SIM_ROUNDS_PER_CONFIG') },
      { path: /^\.pass1_fresh_seeds\.avgTheoreticalRTP$/, domain: identity(rtp, '1 − HOUSE_EDGE') },
      { path: /^\.pass1_fresh_seeds\.avgSimulatedRTP$/, domain: avgPayout },
      { path: /^\.pass1_fresh_seeds\.chi2FailsAtAlpha01$/, domain: intAtMost(configs, 'a count of configs') },
      { path: /^\.pass1_fresh_seeds\.chi2FailsBonferroni$/, domain: intAtMost(configs, 'a count of configs') },
      { path: /^\.pass1_fresh_seeds\.bonferroniAlpha$/, domain: exactly(0.01 / configs, '0.01 / configs') },
      { path: /^\.pass1_fresh_seeds\.serialIndependenceFails$/, domain: intAtMost(configs, 'a count of configs') },
      { path: /^\.pass1_fresh_seeds\.convergence\[\]\.roundsPerConfig$/, domain: oneOf(SIM_CONVERGENCE_SAMPLES, 'SIM_CONVERGENCE_SAMPLES') },
      { path: /^\.pass1_fresh_seeds\.convergence\[\]\.meanRTP$/, domain: avgPayout },
      { path: /^\.pass1_fresh_seeds\.convergence\[\]\.stdDev$/, domain: NONNEG_REAL },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.difficulty$/, domain: oneOf(SIM_DIFFICULTIES, 'SIM_DIFFICULTIES') },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.deathPointsCount$/, domain: oneOf(dpcSet, 'DEATH_POINTS_BY_DIFFICULTY') },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.theoreticalRTP$/, domain: identity(rtp, '1 − HOUSE_EDGE') },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.simulatedRTP$/, domain: avgPayout },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.winRate$/, domain: PROBABILITY },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.theoreticalWin$/, domain: PROBABILITY },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.positionChi2$/, domain: CHI_SQUARED },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.positionDf$/, domain: exactly(GRID_SIZE - 1, 'GRID_SIZE − 1 position bins') },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.positionPValue$/, domain: PROBABILITY },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.r1$/, domain: CORRELATION },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.r1Z$/, domain: FINITE },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.runsZ$/, domain: FINITE },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.runsPValue$/, domain: PROBABILITY },
      { path: /^\.pass2_casino_seeds\.seeds_tested$/, domain: exactly(EXPECTED_EPOCHS, 'EXPECTED_EPOCHS bet-bearing seeds') },
      { path: /^\.pass2_casino_seeds\.difficulty$/, domain: exactly(SIM_PASS2_DIFFICULTY, 'SIM_PASS2_DIFFICULTY') },
      { path: /^\.pass2_casino_seeds\.death_points_count$/, domain: exactly(pass2Dpc, 'DEATH_POINTS_BY_DIFFICULTY[SIM_PASS2_DIFFICULTY]') },
      { path: /^\.pass2_casino_seeds\.theoretical_win_chance$/, domain: PROBABILITY },
      { path: /^\.pass2_casino_seeds\.nonces_per_seed$/, domain: exactly(SIM_NONCES_PER_SEED, 'SIM_NONCES_PER_SEED') },
      { path: /^\.pass2_casino_seeds\.epoch_length$/, domain: exactly(SIM_EPOCH_LENGTH, 'SIM_EPOCH_LENGTH') },
      { path: /^\.pass2_casino_seeds\.test_a_chi2_fails_at_alpha01$/, domain: intAtMost(EXPECTED_EPOCHS, 'a count of seeds') },
      { path: /^\.pass2_casino_seeds\.test_a_binomial_pValue$/, domain: PROBABILITY },
      { path: /^\.pass2_casino_seeds\.test_b_cherry_pick_flags$/, domain: intAtMost(EXPECTED_EPOCHS, 'a count of seeds') },
      { path: /^\.pass2_casino_seeds\.test_b_binomial_pValue$/, domain: PROBABILITY },
      { path: /^\.pass2_casino_seeds\.results\[\]\.difficulty$/, domain: exactly(SIM_PASS2_DIFFICULTY, 'SIM_PASS2_DIFFICULTY') },
      { path: /^\.pass2_casino_seeds\.results\[\]\.deathPointsCount$/, domain: exactly(pass2Dpc, 'the Pass 2 death-point count') },
      { path: /^\.pass2_casino_seeds\.results\[\]\.earlyWins$/, domain: intAtMost(SIM_EPOCH_LENGTH, 'wins within the early window') },
      { path: /^\.pass2_casino_seeds\.results\[\]\.earlyTotal$/, domain: exactly(SIM_EPOCH_LENGTH, 'SIM_EPOCH_LENGTH') },
      { path: /^\.pass2_casino_seeds\.results\[\]\.earlyP$/, domain: PROBABILITY },
      { path: /^\.pass2_casino_seeds\.results\[\]\.lateWins$/, domain: intAtMost(lateTotal, 'wins within the late window') },
      { path: /^\.pass2_casino_seeds\.results\[\]\.lateTotal$/, domain: exactly(lateTotal, 'SIM_NONCES_PER_SEED − SIM_EPOCH_LENGTH') },
      { path: /^\.pass2_casino_seeds\.results\[\]\.lateP$/, domain: PROBABILITY },
    ],

    // ── outputs/chi-squared-results.json (Step 12's per-difficulty win-rate groups) ────────────────
    'chi-squared-results.json': [
      { path: /^\.groups\[\]\.difficulty$/, domain: oneOf(DIFFICULTY_LEVELS, 'DIFFICULTY_LEVELS') },
      { path: /^\.groups\[\]\.wins$/, domain: intAtMost(EXPECTED_BETS, 'a count within the audited bets') },
      { path: /^\.groups\[\]\.expWins$/, domain: realBetween(0, EXPECTED_BETS, 'an expectation within the audited bets') },
      { path: /^\.groups\[\]\.total$/, domain: intBetween(1, EXPECTED_BETS, 'a non-empty count within the audited bets') },
      { path: /^\.groups\[\]\.pValue$/, domain: PROBABILITY },
    ],

    // ── outputs/determinism-log.json (Step 5's recomputation tally) ────────────────────────────────
    'determinism-log.json': [
      { path: /^\.verified$/, domain: intAtMost(EXPECTED_BETS, 'a count within the audited bets') },
      { path: /^\.mismatches$/, domain: intAtMost(EXPECTED_BETS, 'a count within the audited bets') },
      { path: /^\.skipped$/, domain: intAtMost(EXPECTED_BETS, 'a count within the audited bets') },
    ],
  };
}

export interface DomainViolation {
  path: string;
  value: number;
  expected: string;
}

/** Collect every numeric leaf of `doc` as `[collapsedPath, value]`. */
export function numericLeaves(doc: unknown, path = '', out: [string, number][] = []): [string, number][] {
  if (typeof doc === 'number') { out.push([collapsePath(path), doc]); return out; }
  if (doc === null || typeof doc !== 'object') return out;
  if (Array.isArray(doc)) {
    doc.forEach((v, i) => numericLeaves(v, `${path}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) numericLeaves(v, `${path}.${k}`, out);
  return out;
}

/**
 * Validate every numeric leaf of `doc` against `rules`. A leaf matched by NO rule is a violation in its
 * own right (`uncovered`): an unbounded new field is precisely how this class reopens.
 */
export function validateDomains(doc: unknown, rules: Rule[]): { violations: DomainViolation[]; uncovered: string[]; checked: number } {
  const violations: DomainViolation[] = [];
  const uncovered: string[] = [];
  const leaves = numericLeaves(doc);
  for (const [p, v] of leaves) {
    const rule = rules.find(r => r.path.test(p));
    if (!rule) {
      if (!uncovered.includes(p)) uncovered.push(p);
      continue;
    }
    if (!rule.domain.ok(v)) violations.push({ path: p, value: v, expected: rule.domain.label });
  }
  return { violations, uncovered, checked: leaves.length };
}

/** One-line summaries for a step's detail string. */
export function describeDomainFailures(artifact: string, r: { violations: DomainViolation[]; uncovered: string[] }): string[] {
  const out: string[] = [];
  for (const v of r.violations.slice(0, 4)) out.push(`${artifact}${v.path} = ${v.value} is not ${v.expected}`);
  if (r.violations.length > 4) out.push(`${artifact}: +${r.violations.length - 4} more impossible value(s)`);
  for (const p of r.uncovered.slice(0, 4)) out.push(`${artifact}${p} has no declared value domain (add one in src/domains.ts)`);
  if (r.uncovered.length > 4) out.push(`${artifact}: +${r.uncovered.length - 4} more undeclared field(s)`);
  return out;
}
