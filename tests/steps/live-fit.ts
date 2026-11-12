/**
 * Step 25 — Live-Sample Fit (profile BEEF-22). Added 2026-09-26, the Duel Crash Step 18 pattern.
 *
 * INFORMATIONAL AND VERDICT-LIGHT BY DESIGN. 6,450 captured rounds are too few to prove a distribution —
 * Step 5's recomputation of every round and the 4,000,000-round simulation (Step 18) do that — but a
 * scored step whose statistics REACT to the live sample means a corrupted or reordered sample cannot pass
 * silently. Two families, every test at the Bonferroni level LIVE_FIT_ALPHA / (number of tests):
 *
 *  1. DEATH-POINT POSITIONS vs the uniform 20-tile lattice, per difficulty, over every round of both
 *     files (the served mines_positions, which Steps 5 and 21 prove equal to the recomputation). A round
 *     places m DISTINCT death points, so tile counts are not multinomial: each tile's indicator has
 *     variance p(1−p) with p = m/20 and pairwise covariance −p(1−p)/19, so the Pearson statistic on the
 *     20 tile counts is asymptotically (20 − m)/19 · χ²(19). The step scores Pearson × 19/(20 − m)
 *     against χ²(19) — the without-replacement correction (exact for m = 1, where it is 1).
 *
 *  2. WIN RATES vs the binomial, per group: the four primary difficulties (every primary bet is one step,
 *     P(win) = (20 − m)/20) and the four Phase E sub-phases (one difficulty to one target depth each,
 *     P(win) = C(20−m,k)/C(20,k) at k = target_k). Two-sided exact binomial p-value.
 *
 * A deviation turns the step to INFO — never to FLAG or FAIL: profile policy INFORMATIONAL (adopted
 * 2026-09-29), reported, never counted, verdict unchanged. The measured statistics live in `data`; the
 * sentence states the bounds.
 */

import type { StepResult, BeefGame } from '../../src/types';
import { step } from './context';
import { DIFFICULTY_LEVELS, EXPECTED_BETS, EXPECTED_PHASE_E_BETS, EXPECTED_PHASE_E_TARGETS, LIVE_FIT_ALPHA } from '../../src/loader';
import { DEATH_POINTS_BY_DIFFICULTY, GRID_SIZE, survivalProbability } from '../../src/rng';
import { chiSquaredPValue, binomSurvival } from '../../src/stats';

function twoSidedBinomial(k: number, n: number, p: number): number {
  const upper = binomSurvival(k, n, p);            // P(X ≥ k)
  const lower = 1 - binomSurvival(k + 1, n, p);    // P(X ≤ k)
  return Math.min(1, 2 * Math.min(upper, lower));
}

export function run(primary: BeefGame[], phaseE: BeefGame[]): StepResult[] {
  const popOk = primary.length === EXPECTED_BETS && phaseE.length === EXPECTED_PHASE_E_BETS;
  const nTests = DIFFICULTY_LEVELS.length + DIFFICULTY_LEVELS.length + Object.keys(EXPECTED_PHASE_E_TARGETS).length;
  const alpha = LIVE_FIT_ALPHA / nTests;
  const problems: string[] = [];
  if (!popOk) problems.push(`${primary.length} + ${phaseE.length} rounds, ${EXPECTED_BETS} + ${EXPECTED_PHASE_E_BETS} declared`);

  // ── 1. Death-point positions per difficulty ─────────────────────────────────────────────────────
  const positions: Record<string, { rounds: number; pearson: number; corrected: number; df: number; p: number }> = {};
  for (const d of DIFFICULTY_LEVELS) {
    const m = DEATH_POINTS_BY_DIFFICULTY[d];
    const counts = new Array(GRID_SIZE).fill(0);
    let rounds = 0, malformed = 0;
    for (const b of [...primary, ...phaseE]) {
      if (b.response.difficulty_level !== d) continue;
      rounds++;
      const mp = b.response.mines_positions ?? [];
      if (mp.length !== m || new Set(mp).size !== m) { malformed++; continue; }
      for (const t of mp) {
        if (!Number.isInteger(t) || t < 0 || t >= GRID_SIZE) { malformed++; continue; }
        counts[t]++;
      }
    }
    if (malformed > 0) problems.push(`difficulty ${d}: ${malformed} round(s) without ${m} distinct in-range death points`);
    const expected = (rounds * m) / GRID_SIZE;
    const pearson = expected > 0 ? counts.reduce((s, o) => s + (o - expected) ** 2 / expected, 0) : 0;
    const corrected = pearson * (GRID_SIZE - 1) / (GRID_SIZE - m);
    const df = GRID_SIZE - 1;
    const p = chiSquaredPValue(corrected, df);
    positions[`difficulty${d}`] = { rounds, pearson, corrected, df, p };
    if (rounds === 0) problems.push(`difficulty ${d}: no rounds`);
    else if (p < alpha) problems.push(`difficulty ${d} death-point positions p below ${alpha}`);
  }

  // ── 2. Win rates vs the binomial ────────────────────────────────────────────────────────────────
  const winRates: Record<string, { n: number; wins: number; pWin: number; p: number }> = {};
  for (const d of DIFFICULTY_LEVELS) {
    const g = primary.filter(b => b.response.difficulty_level === d);
    const wins = g.filter(b => b.response.outcome === 'win').length;
    const pWin = survivalProbability(DEATH_POINTS_BY_DIFFICULTY[d], 1);
    const p = g.length ? twoSidedBinomial(wins, g.length, pWin) : 0;
    winRates[`primary-difficulty${d}`] = { n: g.length, wins, pWin, p };
    if (g.length === 0) problems.push(`primary difficulty ${d}: no rounds`);
    else if (p < alpha) problems.push(`primary difficulty ${d} win rate p below ${alpha}`);
  }
  for (const [ph, t] of Object.entries(EXPECTED_PHASE_E_TARGETS)) {
    const g = phaseE.filter(b => b.phase === ph);
    const wins = g.filter(b => b.response.outcome === 'win').length;
    const pWin = survivalProbability(DEATH_POINTS_BY_DIFFICULTY[t.difficulty], t.targetK);
    const p = g.length ? twoSidedBinomial(wins, g.length, pWin) : 0;
    winRates[ph] = { n: g.length, wins, pWin, p };
    if (g.length === 0) problems.push(`${ph}: no rounds`);
    else if (p < alpha) problems.push(`${ph} win rate p below ${alpha}`);
  }

  const ok = problems.length === 0;
  return [step(25, 'Live-Sample Fit (informational, BEEF-22)',
    ok ? 'PASS' : 'INFO',
    ok
      ? `the ${primary.length + phaseE.length} live rounds' death-point positions fit the uniform 20-tile lattice per difficulty (without-replacement-corrected χ², df 19) and the win rates of the 4 primary difficulties and the 4 Phase E sub-phases fit the binomial (two-sided exact); all ${nTests} tests p ≥ ${alpha} (Bonferroni ${LIVE_FIT_ALPHA}/${nTests}); informational — the distribution is proven by Steps 5, 16 and 18. Statistics in this step's data block.`
      : `live-sample deviation (INFO, informational — reported, not counted, verdict unchanged): ${problems.join('; ')}`,
    { tests: nTests, alpha, positions, winRates },
  )];
}
