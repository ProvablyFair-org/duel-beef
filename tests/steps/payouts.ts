/**
 * Steps 7–12: Payout Verification
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { theoreticalMultiplier, HOUSE_EDGE, DEATH_POINTS_BY_DIFFICULTY } from '../../src/rng';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseC } = ctx;

  // ── Step 7: Payout math ──────────────────────────────────────────────────────
  // Wins:   amount_won ≈ amount × no_house_edge_multiplier (tolerance 1e-8)
  // Losses: amount_won === '0'
  let payoutErrors = 0;
  for (const b of bets) {
    if (b.response.outcome === 'win') {
      const amt = parseFloat(b.response.amount_currency || b.request.amount);
      const nhe = parseFloat(b.response.no_house_edge_multiplier ?? '0');
      const won = parseFloat(b.response.amount_won);
      if (Math.abs(amt * nhe - won) > 1e-8) payoutErrors++;
    } else {
      if (b.response.amount_won !== '0') payoutErrors++;
    }
  }
  const s7 = step(7, 'Payout Math',
    payoutErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets checked, ${payoutErrors} errors (tolerance 1e-8)`,
  );

  // ── Step 8: Multiplier formula ───────────────────────────────────────────────
  // Raw multiplier    = C(20,k)/C(20-m,k)          = theoreticalMultiplier(m, k, 0)
  // Payout multiplier = raw × (1 − 0.008)           = theoreticalMultiplier(m, k, 0.008)
  // All captured bets are 1-step (k=1).
  let multErrors = 0;
  for (const b of bets) {
    if (b.response.outcome !== 'win') continue;
    const dpc = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    const k = (b.response.current_step || []).length;   // number of steps completed
    const expRaw = theoreticalMultiplier(dpc, k, 0);
    const actRaw = parseFloat(b.response.multiplier);
    if (Math.abs(expRaw - actRaw) > 1e-6) multErrors++;

    const expEdge = theoreticalMultiplier(dpc, k, HOUSE_EDGE);
    const actEdge = parseFloat(b.response.no_house_edge_multiplier ?? '0');
    if (Math.abs(expEdge - actEdge) > 1e-6) multErrors++;
  }
  const wins = bets.filter(b => b.response.outcome === 'win').length;
  const s8 = step(8, 'Multiplier Formula (C(20,k)/C(20−m,k) × edge)',
    multErrors === 0 ? 'PASS' : 'FAIL',
    `${wins} winning bets: multiplier = C(20,k)/C(20−m,k), payout_mult = raw × 0.992 (0.8% edge); ${multErrors} mismatches`,
  );

  // ── Step 9: Win condition ────────────────────────────────────────────────────
  // outcome='win' iff ALL current_step entries NOT in mines_positions
  let condErrors = 0;
  for (const b of bets) {
    const steps = b.response.current_step || [];
    const mines = new Set(b.response.mines_positions);
    const anyHit = steps.some(s => mines.has(s));
    const expectedOutcome = anyHit ? 'loss' : 'win';
    if (b.response.outcome !== expectedOutcome) condErrors++;
  }
  const s9 = step(9, 'Win Condition (all stepped tiles not in mines)',
    condErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets verified: outcome=win iff every current_step[] ∉ mines_positions; ${condErrors} errors`,
  );

  // ── Step 10: Phase C bet-size invariance ─────────────────────────────────────
  let cErrors = 0;
  let cChecked = 0;
  for (const b of phaseC) {
    if (b.response.outcome !== 'win') continue;
    cChecked++;
    const dpc = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    const k = (b.response.current_step || []).length;
    const expMult = theoreticalMultiplier(dpc, k, 0);
    const actMult = parseFloat(b.response.multiplier);
    if (Math.abs(expMult - actMult) > 1e-6) cErrors++;
    const amt = parseFloat(b.response.amount_currency || b.request.amount);
    const nhe = parseFloat(b.response.no_house_edge_multiplier ?? '0');
    const won = parseFloat(b.response.amount_won);
    if (Math.abs(amt * nhe - won) > 1e-8) cErrors++;
  }
  const s10 = step(10, 'Phase C Bet-Size Invariance ($10 bets)',
    cErrors === 0 && cChecked > 0 ? 'PASS' : cChecked === 0 ? 'FLAG' : 'FAIL',
    `${phaseC.length} Phase C bets ($10), ${cChecked} wins: multiplier formula identical, payout math correct; ${cErrors} errors`,
  );

  // ── Step 11: Config completeness ─────────────────────────────────────────────
  // All 4 difficulty levels (1–4) present in dataset
  const difficulties = new Set(bets.map(b => b.response.difficulty_level));
  const expected = [1, 2, 3, 4];
  const missing  = expected.filter(d => !difficulties.has(d as 1|2|3|4));
  const s11 = step(11, 'Config Completeness (4 difficulty levels)',
    missing.length === 0 ? 'PASS' : 'FLAG',
    `${difficulties.size}/4 difficulty levels present${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}`,
  );

  // ── Step 12: House edge audit ────────────────────────────────────────────────
  // effective_edge === 0.8 for all bets (0.8% — verified: 1/0.95 × 0.992 = 1.04421…)
  let edgeErrors = 0;
  for (const b of bets) {
    if (b.response.effective_edge !== 0.8) edgeErrors++;
  }
  const s12 = step(12, 'House Edge Audit (effective_edge = 0.8%)',
    edgeErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets: effective_edge = 0.8 (0.8%) for all; ${edgeErrors} deviations`,
  );

  return [s7, s8, s9, s10, s11, s12];
}
