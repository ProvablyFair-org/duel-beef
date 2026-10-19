/**
 * Steps 7–12: Payout Verification
 */

import type { StepResult } from './context';
import { step, moneyTol, MONEY_REL_TOL, VerifyContext } from './context';
import { HOUSE_EDGE, DEATH_POINTS_BY_DIFFICULTY, GRID_SIZE, computeDeathPoints } from '../../src/rng';
import { exactMultiplier, relativeDeviation, MULT_REL_TOL } from '../../src/exact';
import { MIN_BETS_PER_DIFFICULTY, DIFFICULTY_LEVELS, EXPECTED_PHASE_BETS, EXPECTED_PHASE_E_TARGETS, EXPECTED_BETS, EXPECTED_PHASE_E_BETS } from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseC, phaseE } = ctx;

  // ── Step 7: Payout math ──────────────────────────────────────────────────────
  // Wins:   amount_won ≈ amount × no_house_edge_multiplier, within moneyTol (relative 1e-12;
  //         see tests/steps/context.ts for why the old absolute 1e-8 was a hole)
  // Losses: amount_won === '0'
  let payoutErrors = 0;
  for (const b of bets) {
    if (b.response.outcome === 'win') {
      const amt = parseFloat(b.response.amount_currency || b.request.amount);
      const nhe = parseFloat(b.response.no_house_edge_multiplier ?? '0');
      const won = parseFloat(b.response.amount_won);
      if (!Number.isFinite(won) || Math.abs(amt * nhe - won) > moneyTol(amt * nhe)) payoutErrors++;
    } else {
      if (b.response.amount_won !== '0') payoutErrors++;
    }
  }
  const s7 = step(7, 'Payout Math',
    payoutErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets checked, ${payoutErrors} errors (relative tolerance ${MONEY_REL_TOL.toExponential(0)})`,
  );

  // ── Step 8: Multiplier formula ───────────────────────────────────────────────
  // Raw multiplier    = C(20,k)/C(20-m,k)                 (served as `multiplier`)
  // Payout multiplier = C(20,k)·992 / (C(20-m,k)·1000)    (served as `no_house_edge_multiplier` —
  //                     Duel's naming quirk: this is the PAID figure, with the 0.8% edge)
  // Both served 18-dp strings are parsed EXACTLY and compared with the exact rational (src/exact.ts)
  // at MULT_REL_TOL = 1e-12 relative. This replaced |parseFloat(served) − float formula| ≤ 1e-6
  // ABSOLUTE (2026-09-26), which passed a served multiplier moved by 1e-7. The worst measured
  // deviation is emitted every run, beside the bound. All captured primary bets are 1-step (k=1).
  let multErrors = 0;
  let s8Worst = 0;
  for (const b of bets) {
    if (b.response.outcome !== 'win') continue;
    const dpc = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    const k = (b.response.current_step || []).length;   // number of steps completed
    const dRaw  = relativeDeviation(b.response.multiplier, exactMultiplier(dpc, k, false));
    const dPaid = relativeDeviation(b.response.no_house_edge_multiplier, exactMultiplier(dpc, k, true));
    s8Worst = Math.max(s8Worst, dRaw, dPaid);
    if (!(dRaw <= MULT_REL_TOL)) multErrors++;
    if (!(dPaid <= MULT_REL_TOL)) multErrors++;
  }
  const wins = bets.filter(b => b.response.outcome === 'win').length;
  const s8 = step(8, 'Multiplier Formula (C(20,k)/C(20−m,k) × edge)',
    multErrors === 0 && wins > 0 ? 'PASS' : 'FAIL',
    `${wins} winning bets: multiplier = C(20,k)/C(20−m,k), payout_mult = raw × 992/1000 (0.8% edge), both compared EXACTLY `
    + `with the rational at relative ${MULT_REL_TOL.toExponential(0)} (worst deviation in this step's data block); ${multErrors} mismatches`,
    { wins, mismatches: multErrors, relTol: MULT_REL_TOL, worstRelativeDeviation: s8Worst },
  );

  // ── Step 9: Win condition & path consistency ─────────────────────────────────
  // Hardened 2026-09-26 (profile BEEF-10). The step used to read ONLY the served fields — outcome vs
  // current_step ∩ mines_positions — on the 6,000 primary bets. It now, on every round of BOTH
  // datasets (bound to EXPECTED_BETS + EXPECTED_PHASE_E_BETS):
  //   • takes the death points from the RECOMPUTATION (src/rng.ts, revealed seed), not the served set;
  //   • requires the stepped tiles to be exactly the path prefix 0 … k−1 (the player cannot choose
  //     tiles in Beef), with k = reached_k where the capture records it;
  //   • requires win ⇔ no stepped tile is a death point, and on a loss the LAST stepped tile to be the
  //     death point with none earlier — the round ends on the first death point it meets.
  const { seedMap } = ctx;
  let condErrors = 0, condChecked = 0, condUnrecomputable = 0;
  const condIssues: string[] = [];
  for (const b of [...bets, ...phaseE]) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { condUnrecomputable++; continue; }
    condChecked++;
    const steps = b.response.current_step || [];
    const deaths = new Set(computeDeathPoints(ss, b.seed.clientSeed, b.seed.nonce, DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level]));
    const k = steps.length;
    const prefixOk = k >= 1 && steps.every((t, i) => t === i) && (b.response.reached_k === undefined || b.response.reached_k === k);
    const hits = steps.map(t => deaths.has(t));
    const anyHit = hits.some(h => h);
    const expectedOutcome = anyHit ? 'loss' : 'win';
    const lossShapeOk = !anyHit || (hits[k - 1] === true && hits.slice(0, k - 1).every(h => !h));
    if (!prefixOk || b.response.outcome !== expectedOutcome || !lossShapeOk) {
      condErrors++;
      if (condIssues.length < 5) condIssues.push(`${b.seed.serverSeedHashed.substring(0, 12)}…#${b.seed.nonce}: steps [${steps.join(',')}] deaths [${[...deaths].join(',')}] outcome ${b.response.outcome}`);
    }
  }
  const condExpected = EXPECTED_BETS + EXPECTED_PHASE_E_BETS;
  const s9Ok = condErrors === 0 && condUnrecomputable === 0 && condChecked === condExpected;
  const s9 = step(9, 'Win Condition (all stepped tiles not in mines)',
    s9Ok ? 'PASS' : 'FAIL',
    s9Ok
      ? `${condChecked}/${condExpected} rounds (both datasets) verified against the RECOMPUTED death points: stepped tiles are the path prefix 0…k−1, `
        + `outcome=win iff no stepped tile is a death point, and every loss ends on its first death point; 0 errors`
      : `STEP 9 FAILED: ${condErrors} error(s), ${condUnrecomputable} unrecomputable, ${condChecked}/${condExpected} checked; ${condIssues.join('; ')}`,
    { checked: condChecked, expected: condExpected, errors: condErrors, unrecomputable: condUnrecomputable },
  );

  // ── Step 10: Phase C bet-size invariance ─────────────────────────────────────
  let cErrors = 0;
  let cChecked = 0;
  for (const b of phaseC) {
    if (b.response.outcome !== 'win') continue;
    cChecked++;
    const dpc = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    const k = (b.response.current_step || []).length;
    if (!(relativeDeviation(b.response.multiplier, exactMultiplier(dpc, k, false)) <= MULT_REL_TOL)) cErrors++;
    if (!(relativeDeviation(b.response.no_house_edge_multiplier, exactMultiplier(dpc, k, true)) <= MULT_REL_TOL)) cErrors++;
    const amt = parseFloat(b.response.amount_currency || b.request.amount);
    const nhe = parseFloat(b.response.no_house_edge_multiplier ?? '0');
    const won = parseFloat(b.response.amount_won);
    if (!Number.isFinite(won) || Math.abs(amt * nhe - won) > moneyTol(amt * nhe)) cErrors++;
  }
  // Population bound: Phase C at its planned size and every bet actually at $10 — the step's
  // name is a claim about stake, so a stake that is not 10 fails it. Zero wins checked is a
  // FAIL (it used to be a FLAG): an invariance shown on no bets is not shown.
  const cStakeOff = phaseC.filter(b => parseFloat(b.request.amount) !== 10 || parseFloat(b.response.amount_currency ?? b.request.amount) !== 10).length;
  const s10Issues: string[] = [];
  if (phaseC.length !== EXPECTED_PHASE_BETS.C) s10Issues.push(`Phase C bets ${phaseC.length} != ${EXPECTED_PHASE_BETS.C}`);
  if (cStakeOff > 0) s10Issues.push(`${cStakeOff} Phase C bets not at a $10 stake`);
  if (cChecked === 0) s10Issues.push('zero Phase C wins to check');
  if (cErrors > 0)    s10Issues.push(`${cErrors} multiplier/payout errors`);
  const s10 = step(10, 'Phase C Bet-Size Invariance ($10 bets)',
    s10Issues.length === 0 ? 'PASS' : 'FAIL',
    s10Issues.length === 0
      ? `${phaseC.length} Phase C bets ($10), ${cChecked} wins: multiplier formula identical, payout math correct; 0 errors`
      : `PHASE C FAILED: ${s10Issues.join('; ')}`,
  );

  // ── Step 11: Config completeness & payout-table coverage ─────────────────────
  // "All four difficulty levels are present" is satisfied by four bets, one per level,
  // so it measured nothing about how well any level was exercised. The step now carries
  // a bet-count floor from src/loader.ts, and reports coverage of the payout table.
  //
  // A cell of that table is a (difficulty, steps-taken) pair: multiplier(d, k) =
  // C(20,k)/C(20−m_d,k) × (1 − edge), defined for k = 1 … 20 − m_d. Phases A–D are all
  // single-step, so k > 1 is exercised only by Phase E. Cells no captured bet ever landed
  // on are named here rather than left implicit — a reader should not have to infer which
  // part of the table live play did not touch.
  //
  // On the RTP share: every cell of this table has the SAME theoretical RTP, 1 − edge,
  // proven analytically over all cells in Step 16 (survival × payout multiplier collapses
  // to 1 − edge identically). So no RTP mass hides on an unexercised cell — what an
  // unexercised cell lacks is a live observation of its multiplier, not a verified return.
  const perDifficulty: Record<string, number> = {};
  for (const b of bets) {
    const d = String(b.response.difficulty_level);
    perDifficulty[d] = (perDifficulty[d] ?? 0) + 1;
  }

  const cfgFailures: string[] = [];
  for (const d of DIFFICULTY_LEVELS) {
    const n = perDifficulty[String(d)] ?? 0;
    if (n < MIN_BETS_PER_DIFFICULTY) {
      cfgFailures.push(`difficulty ${d}: ${n} bets (floor ${MIN_BETS_PER_DIFFICULTY})`);
    }
  }

  // A cell counts as exercised only where live play OBSERVED its multiplier: a phase A–D win
  // at k (the served multiplier is for k), or a non-death Phase E step result at k. A death step
  // shows the previous step's multiplier, so it observes nothing for its own cell.
  const exercised = new Map<string, number>();
  const countCell = (d: number, k: number) => {
    const key = `d${d}:k${k}`;
    exercised.set(key, (exercised.get(key) ?? 0) + 1);
  };
  for (const b of bets) {
    if (b.response.outcome === 'win') countCell(b.response.difficulty_level, (b.response.current_step || []).length);
  }
  for (const b of phaseE) {
    for (const sr of b.step_results ?? []) {
      if (!(sr.is_death || sr.status === 2)) countCell(b.response.difficulty_level, sr.step);
    }
  }

  const allCells: string[] = [];
  for (const d of DIFFICULTY_LEVELS) {
    const m = DEATH_POINTS_BY_DIFFICULTY[d];
    for (let k = 1; k <= GRID_SIZE - m; k++) allCells.push(`d${d}:k${k}`);
  }
  const neverExercised = allCells.filter(c => !exercised.has(c));
  const coverageShare  = allCells.length > 0 ? (allCells.length - neverExercised.length) / allCells.length : 0;

  // COVERAGE IS SCORED AGAINST THE CAPTURE PLAN. coverageShare used to be computed and printed
  // and never compared with anything, so Phase E could vanish and the step would still PASS.
  // The plan in src/loader.ts says which cells live play must reach: k = 1 at every difficulty
  // (phases A–D) and k = 1..target_k at each Phase E sub-phase's difficulty. Every planned cell
  // must be exercised, or the step fails. 15 of 61 is not a defect — the other cells are proven
  // analytically in Step 16 — but losing a PLANNED cell is.
  const plannedCells = new Set<string>();
  for (const d of DIFFICULTY_LEVELS) plannedCells.add(`d${d}:k1`);
  for (const t of Object.values(EXPECTED_PHASE_E_TARGETS)) {
    for (let k = 1; k <= t.targetK; k++) plannedCells.add(`d${t.difficulty}:k${k}`);
  }
  const plannedMissing = [...plannedCells].filter(c => !exercised.has(c));
  if (plannedMissing.length > 0) {
    cfgFailures.push(`planned payout-table cells not exercised by live play: ${plannedMissing.join(', ')}`);
  }

  const s11 = step(11, 'Config Completeness & Payout-Table Coverage',
    cfgFailures.length === 0 ? 'PASS' : 'FAIL',
    cfgFailures.length === 0
      ? `All ${DIFFICULTY_LEVELS.length} difficulty levels carry at least the ${MIN_BETS_PER_DIFFICULTY}-bet floor declared in src/loader.ts. `
        + `Payout-table coverage: ${allCells.length - neverExercised.length} of ${allCells.length} (difficulty, k) cells observed in live play, `
        + `including all ${plannedCells.size} cells the capture plan in src/loader.ts requires; `
        + `the ${neverExercised.length} unexercised cells are named in this step's data block and carry the same theoretical RTP, `
        + `proven analytically for every cell in Step 16.`
      : `${cfgFailures.length} config/coverage failure(s): ${cfgFailures.join('; ')}`,
    {
      betsPerDifficulty: perDifficulty,
      minBetsPerDifficulty: MIN_BETS_PER_DIFFICULTY,
      totalCells: allCells.length,
      exercisedCells: allCells.length - neverExercised.length,
      plannedCells: plannedCells.size,
      plannedMissing,
      coverageShare,
      neverExercisedCells: neverExercised,
      theoreticalRTPPerCell: 1 - HOUSE_EDGE,
      unverifiedRTPShare: 0,
      note: 'Every (difficulty, k) cell has theoretical RTP 1 − edge by the identity proven in Step 16, '
          + 'so an unexercised cell carries no unverified RTP mass — only no live observation of its multiplier.',
      failures: cfgFailures,
    },
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
