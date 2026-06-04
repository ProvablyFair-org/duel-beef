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

import { step } from './context';
import type { StepResult } from './context';
import type { BeefGame } from '../../src/types';
import {
  theoreticalMultiplier,
  computeDeathPoints,
  DEATH_POINTS_BY_DIFFICULTY,
  HOUSE_EDGE,
} from '../../src/rng';

export function run(
  phaseEBets: BeefGame[],
  seedMap: Map<string, string>,
): StepResult[] {
  if (phaseEBets.length === 0) {
    return [
      step(20, 'Multi-Step Multiplier Chain (Phase E)', 'FLAG', 'No Phase E data available'),
      step(21, 'Death-Point Recomputation (Phase E)', 'FLAG', 'No Phase E data available'),
      step(22, 'Cash-Out Payout Correctness (k>1)', 'FLAG', 'No Phase E data available'),
    ];
  }

  // ── Step 20: Multi-step multiplier chain ──────────────────────────────────────
  // For each Phase E bet with step_results, verify that step_results[i].multiplier
  // matches the theoretical raw multiplier C(20,k)/C(20-m,k) at each step k.
  let s20Checked = 0;
  let s20Errors  = 0;
  const kCoverage = new Set<string>(); // "difficulty:k" coverage tracker

  for (const b of phaseEBets) {
    if (!b.step_results || b.step_results.length === 0) continue;
    const dpc = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    for (const sr of b.step_results) {
      // Death steps show the PREVIOUS step's multiplier (what the player had
      // before dying), not a valid multiplier for the death step itself. Skip.
      if (sr.is_death || sr.status === 2) continue;

      const k = sr.step; // 1-based step count
      const expectedRaw = theoreticalMultiplier(dpc, k, 0); // raw, no edge
      const actualRaw   = parseFloat(sr.multiplier ?? '0');
      s20Checked++;
      kCoverage.add(`d${b.response.difficulty_level}:k${k}`);
      if (Math.abs(expectedRaw - actualRaw) > 1e-6) s20Errors++;
    }
  }

  const s20 = step(20, 'Multi-Step Multiplier Chain (Phase E)',
    s20Errors === 0 && s20Checked > 0 ? 'PASS' : s20Checked === 0 ? 'FLAG' : 'FAIL',
    `${s20Checked} step-multiplier pairs checked across ${phaseEBets.length} bets; ` +
    `${kCoverage.size} distinct (difficulty, k) combos; ${s20Errors} mismatches`,
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

  const s21 = step(21, 'Death-Point Recomputation (Phase E)',
    s21Mismatches === 0 && s21Verified > 0 ? 'PASS' : s21Verified === 0 ? 'FLAG' : 'FAIL',
    `${s21Verified}/${phaseEBets.length} Phase E bets verified (${s21Skipped} skipped — unrevealed seed); ${s21Mismatches} mismatches`,
  );

  // ── Step 22: Cash-out payout correctness (k>1) ───────────────────────────────
  // For winning Phase E bets that cashed out at k > 1, verify:
  //   amount_won ≈ amount × raw_multiplier × (1 - HOUSE_EDGE)
  let s22Checked = 0;
  let s22Errors  = 0;
  const kPayouts = new Map<number, number>(); // k → count of verified payouts

  for (const b of phaseEBets) {
    if (b.response.outcome !== 'win') continue;
    const reachedK = b.response.reached_k ?? (b.response.current_step || []).length;
    if (reachedK <= 1) continue; // k=1 already verified in Step 7

    const amt = parseFloat(b.response.amount_currency || b.request.amount);
    const rawMult = parseFloat(b.response.multiplier);
    const expectedWon = amt * rawMult * (1 - HOUSE_EDGE);
    const actualWon   = parseFloat(b.response.amount_won);

    s22Checked++;
    kPayouts.set(reachedK, (kPayouts.get(reachedK) || 0) + 1);

    if (Math.abs(expectedWon - actualWon) > 1e-6) s22Errors++;
  }

  // Build k-distribution summary
  const kSummary = [...kPayouts.entries()]
    .sort((a, c) => a[0] - c[0])
    .map(([k, n]) => `k=${k}:${n}`)
    .join(', ');

  const s22 = step(22, 'Cash-Out Payout Correctness (k>1)',
    s22Errors === 0 && s22Checked > 0 ? 'PASS' : s22Checked === 0 ? 'FLAG' : 'FAIL',
    `${s22Checked} winning Phase E bets at k>1 verified; ${s22Errors} errors; distribution: ${kSummary || 'none'}`,
  );

  return [s20, s21, s22];
}
