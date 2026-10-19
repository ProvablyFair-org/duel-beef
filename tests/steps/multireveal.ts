/**
 * Steps 20–22: Phase E Multi-Step Verification
 *
 * Phase E captures bets where the player takes multiple steps (k > 1) before
 * cashing out or hitting a death point. This resolves the k=1-only limitation
 * of the baseline phases A–D.
 *
 * Step 20: Multi-step multiplier chain — verify step_results[i].multiplier
 *          matches C(20,k)/C(20-m,k) at each step k.
 * Step 21: Death-point recomputation — recompute death points from
 *          (serverSeed, clientSeed, nonce) for all Phase E bets with revealed seeds.
 * Step 22: Cash-out payout correctness (k>1) — verify amount_won = amount × multiplier × (1 - edge)
 *          for all winning Phase E bets that cashed out at k > 1.
 */

import { step, moneyTol } from './context';
import type { StepResult } from './context';
import type { BeefGame } from '../../src/types';
import {
  theoreticalMultiplier,
  computeDeathPoints,
  DEATH_POINTS_BY_DIFFICULTY,
  HOUSE_EDGE,
} from '../../src/rng';
import { exactMultiplier, relativeDeviation, MULT_REL_TOL } from '../../src/exact';
import {
  EXPECTED_PHASE_E_BETS,
  EXPECTED_PHASE_E_BETS_BY_PHASE,
  EXPECTED_PHASE_E_TARGETS,
} from '../../src/loader';

export function run(
  phaseEBets: BeefGame[],
  seedMap: Map<string, string>,
): StepResult[] {
  // ZERO POPULATION IS A FAIL. These three steps used to return FLAG when Phase E was absent and
  // FLAG again on zero checked, so deleting the only data that exercises k > 1 downgraded the
  // audit to a Conditional Pass instead of failing it. Every count below is bound to the Phase E
  // population in src/loader.ts.
  if (phaseEBets.length === 0) {
    return [
      step(20, 'Multi-Step Multiplier Chain (Phase E)', 'FAIL', `No Phase E data: 0 of ${EXPECTED_PHASE_E_BETS} planned bets`),
      step(21, 'Death-Point Recomputation (Phase E)', 'FAIL', `No Phase E data: 0 of ${EXPECTED_PHASE_E_BETS} planned bets`),
      step(22, 'Cash-Out Payout Correctness (k>1)', 'FAIL', `No Phase E data: 0 of ${EXPECTED_PHASE_E_BETS} planned bets`),
    ];
  }

  const popIssues: string[] = [];
  if (phaseEBets.length !== EXPECTED_PHASE_E_BETS) popIssues.push(`Phase E bets ${phaseEBets.length} != ${EXPECTED_PHASE_E_BETS}`);
  const byPhase: Record<string, number> = {};
  for (const b of phaseEBets) byPhase[b.phase] = (byPhase[b.phase] ?? 0) + 1;
  for (const [ph, n] of Object.entries(EXPECTED_PHASE_E_BETS_BY_PHASE)) {
    if ((byPhase[ph] ?? 0) !== n) popIssues.push(`Phase ${ph} bets ${byPhase[ph] ?? 0} != ${n}`);
  }

  // ── Step 20: Multi-step multiplier chain ──────────────────────────────────────
  // For each Phase E bet with step_results, verify that step_results[i].multiplier
  // matches the theoretical raw multiplier C(20,k)/C(20-m,k) at each step k.
  let s20Checked = 0;
  let s20Errors  = 0;
  let s20Worst   = 0;
  const kCoverage = new Set<string>(); // "difficulty:k" coverage tracker

  let s20NoSteps = 0;
  for (const b of phaseEBets) {
    // Every Phase E bet took at least one step, so a bet with no step record, or a record whose
    // length disagrees with reached_k, is missing evidence — counted, not skipped.
    const reached = b.response.reached_k ?? (b.response.current_step || []).length;
    if (!b.step_results || b.step_results.length === 0 || b.step_results.length !== reached) { s20NoSteps++; continue; }
    const dpc = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    for (const sr of b.step_results) {
      // Death steps show the PREVIOUS step's multiplier (what the player had
      // before dying), not a valid multiplier for the death step itself. Skip.
      if (sr.is_death || sr.status === 2) continue;

      const k = sr.step; // 1-based step count
      // Exact rational vs the served 18-dp string at MULT_REL_TOL (src/exact.ts) — replaced an
      // ABSOLUTE 1e-6 on parsed doubles (2026-09-26). The operator's k > 1 rungs carry double error.
      const dev = relativeDeviation(sr.multiplier, exactMultiplier(dpc, k, false));
      s20Worst = Math.max(s20Worst, dev);
      s20Checked++;
      kCoverage.add(`d${b.response.difficulty_level}:k${k}`);
      if (!(dev <= MULT_REL_TOL)) s20Errors++;
    }
  }

  const s20Ok = popIssues.length === 0 && s20NoSteps === 0 && s20Checked > 0 && s20Errors === 0;
  const s20 = step(20, 'Multi-Step Multiplier Chain (Phase E)',
    s20Ok ? 'PASS' : 'FAIL',
    `${s20Checked} step-multiplier pairs checked across ${phaseEBets.length} bets (${s20NoSteps} without a complete step record); ` +
    `${kCoverage.size} distinct (difficulty, k) combos; exact rational at relative ${MULT_REL_TOL.toExponential(0)} (worst deviation in this step's data block); ${s20Errors} mismatches` +
    (popIssues.length > 0 ? `; POPULATION MISMATCH: ${popIssues.join('; ')}` : ''),
    { checked: s20Checked, mismatches: s20Errors, relTol: MULT_REL_TOL, worstRelativeDeviation: s20Worst },
  );

  // ── Step 21: Death-point recomputation (Phase E) ──────────────────────────────
  // Recompute death points from (serverSeed, clientSeed, nonce) for Phase E bets
  // that have a revealed server seed, and verify they match mines_positions.
  let s21Verified   = 0;
  let s21Mismatches = 0;
  let s21Skipped    = 0;

  for (const b of phaseEBets) {
    const serverSeed = seedMap.get(b.seed.serverSeedHashed);
    if (!serverSeed) { s21Skipped++; continue; }

    const dpc = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    const computed = computeDeathPoints(serverSeed, b.seed.clientSeed, b.seed.nonce, dpc);
    const actual   = [...b.response.mines_positions].sort((a, c) => a - c);

    if (computed.length !== actual.length || !computed.every((v, i) => v === actual[i])) {
      s21Mismatches++;
    }
    s21Verified++;
  }

  const s21Ok = popIssues.length === 0 && s21Skipped === 0 && s21Verified === phaseEBets.length && s21Mismatches === 0;
  const s21 = step(21, 'Death-Point Recomputation (Phase E)',
    s21Ok ? 'PASS' : 'FAIL',
    `${s21Verified}/${phaseEBets.length} Phase E bets verified (${s21Skipped} skipped — unrevealed seed); ${s21Mismatches} mismatches` +
    (popIssues.length > 0 ? `; POPULATION MISMATCH: ${popIssues.join('; ')}` : ''),
  );

  // ── Step 22: Cash-out payout correctness (k>1) ───────────────────────────────
  // For winning Phase E bets that cashed out at k > 1, verify:
  //   amount_won ≈ amount × raw_multiplier × (1 - HOUSE_EDGE)
  let s22Checked = 0;
  let s22Errors  = 0;
  const kPayouts = new Map<number, number>(); // k → count of verified payouts

  // Bound to the plan: every Phase E sub-phase cashes out at a target_k > 1 (src/loader.ts
  // EXPECTED_PHASE_E_TARGETS), so EVERY Phase E win must be a k > 1 cash-out at its target.
  // A win that stopped short, overshot, or sits at k ≤ 1 is not skipped — it is a failure.
  let s22Wins = 0;
  let s22OffTarget = 0;
  // Every Phase E LOSS must credit exactly "0" (added 2026-09-26, profile BEEF-11): before this the
  // Phase E losses carried no payout assertion anywhere — Step 7 reads the primary file only.
  let s22Losses = 0, s22LossErrors = 0;
  for (const b of phaseEBets) {
    if (b.response.outcome !== 'win') { s22Losses++; if (b.response.amount_won !== '0') s22LossErrors++; continue; }
    s22Wins++;
    const reachedK = b.response.reached_k ?? (b.response.current_step || []).length;
    const plan = EXPECTED_PHASE_E_TARGETS[b.phase];
    if (!plan || plan.difficulty !== b.response.difficulty_level
        || b.request.target_k !== plan.targetK || reachedK !== plan.targetK || reachedK <= 1) {
      s22OffTarget++;
      continue;
    }

    const amt = parseFloat(b.response.amount_currency || b.request.amount);
    const rawMult = parseFloat(b.response.multiplier);
    const expectedWon = amt * rawMult * (1 - HOUSE_EDGE);
    const actualWon   = parseFloat(b.response.amount_won);

    s22Checked++;
    kPayouts.set(reachedK, (kPayouts.get(reachedK) || 0) + 1);

    // Money comparison: the shared relative tolerance from tests/steps/context.ts, not a
    // per-step absolute bound. `1e-6` here was two orders looser still than Step 7's old 1e-8.
    if (!Number.isFinite(actualWon) || Math.abs(expectedWon - actualWon) > moneyTol(expectedWon)) s22Errors++;
  }

  // Build k-distribution summary
  const kSummary = [...kPayouts.entries()]
    .sort((a, c) => a[0] - c[0])
    .map(([k, n]) => `k=${k}:${n}`)
    .join(', ');

  const s22Ok = popIssues.length === 0 && s22Checked > 0 && s22Checked === s22Wins && s22OffTarget === 0 && s22Errors === 0
    && s22Losses + s22Wins === EXPECTED_PHASE_E_BETS && s22LossErrors === 0;
  const s22 = step(22, 'Cash-Out Payout Correctness (k>1)',
    s22Ok ? 'PASS' : 'FAIL',
    `${s22Checked}/${s22Wins} winning Phase E bets verified at their planned target k>1 (${s22OffTarget} off-plan); ${s22Errors} errors; distribution: ${kSummary || 'none'}; `
    + `${s22Losses - s22LossErrors}/${s22Losses} Phase E losses credit exactly "0"` +
    (popIssues.length > 0 ? `; POPULATION MISMATCH: ${popIssues.join('; ')}` : ''),
  );

  return [s20, s21, s22];
}
