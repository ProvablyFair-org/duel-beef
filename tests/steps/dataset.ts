/**
 * Steps 13–17: Dataset Integrity & Anti-Circularity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import {
  checkDatasetHash,
  EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_PHASE_BETS,
} from '../../src/loader';
import {
  theoreticalMultiplier,
  survivalProbability,
  computeDeathPoints,
  DEATH_POINTS_BY_DIFFICULTY,
  HOUSE_EDGE,
  GRID_SIZE,
} from '../../src/rng';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseD } = ctx;

  // ── Step 13: Phase labels ─────────────────────────────────────────────────────
  const phases    = new Set(bets.map(b => b.phase));
  const hasAll    = (['A', 'B', 'C', 'D'] as const).every(p => phases.has(p));
  const lastPhase = bets[bets.length - 1].phase;
  // Bound to CODE constants in src/loader.ts, never to the dataset's own header. A dataset
  // that disagrees with the capture plan fails here even when its hash pin has been updated
  // to match it. FLAG was the wrong verdict: it exits 0, so a shrunken capture still passed.
  const phaseCounts: Record<string, number> = {};
  for (const b of bets) phaseCounts[b.phase] = (phaseCounts[b.phase] ?? 0) + 1;
  const phaseBad = Object.entries(EXPECTED_PHASE_BETS)
    .filter(([p, n]) => (phaseCounts[p] ?? 0) !== n)
    .map(([p, n]) => `${p}: ${phaseCounts[p] ?? 0} != ${n}`);
  const extraPhases = Object.keys(phaseCounts).filter(p => !(p in EXPECTED_PHASE_BETS));
  const betsOk  = bets.length === EXPECTED_BETS;
  const seedsOk = ctx.seeds.length === EXPECTED_SEEDS;
  const popOk   = betsOk && seedsOk && phaseBad.length === 0 && extraPhases.length === 0;

  const s13 = step(13, 'Population & Phase Labels',
    popOk && hasAll && lastPhase === 'D' ? 'PASS' : 'FAIL',
    `${bets.length}/${EXPECTED_BETS} bets and ${ctx.seeds.length}/${EXPECTED_SEEDS} seed records ` +
    `against the capture plan in src/loader.ts (code constants, not the dataset header); ` +
    `per phase ${Object.entries(EXPECTED_PHASE_BETS).map(([p, n]) => `${p}=${phaseCounts[p] ?? 0}/${n}`).join(' ')}; ` +
    `last bet phase: ${lastPhase}` +
    (betsOk ? '' : '; BET COUNT MISMATCH') +
    (seedsOk ? '' : '; SEED COUNT MISMATCH') +
    (phaseBad.length ? `; PHASE MISMATCH ${phaseBad.join(', ')}` : '') +
    (extraPhases.length ? `; UNDECLARED PHASE ${extraPhases.join(', ')}` : ''),
  );

  // ── Step 14: Dataset hash ─────────────────────────────────────────────────────
  const h  = checkDatasetHash();
  const s14 = step(14, 'Dataset Hash',
    h.match ? 'PASS' : 'FLAG',
    `Expected: ${h.expected || '(not set)'} | Actual: ${h.actual}`,
  );

  // ── Step 15: Epoch size ────────────────────────────────────────────────────────
  const epochSizes = new Map<string, number>();
  for (const b of bets) {
    epochSizes.set(b.seed.serverSeedHashed, (epochSizes.get(b.seed.serverSeedHashed) ?? 0) + 1);
  }
  const sizes   = [...epochSizes.values()];
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);
  const s15 = step(15, 'Epoch Size',
    maxSize <= 50 ? 'PASS' : 'FLAG',
    `${epochSizes.size} epochs; min=${minSize}, max=${maxSize} bets per epoch`,
  );

  // ── Step 16: Anti-circularity — theoretical RTP ───────────────────────────────
  // For each difficulty d (1–4) and each valid step count k (1..GRID_SIZE - m),
  // single-stop RTP at step k is:
  //   RTP(d, k) = survivalProbability(m, k) × theoreticalMultiplier(m, k, edge)
  //             = [C(20-m, k)/C(20, k)] × [(1-edge) × C(20, k)/C(20-m, k)]
  //             = (1 - edge) = 0.992
  // Independent derivation: no casino-supplied data used.
  let maxDeviation = 0;
  let worstConfig  = '';
  let combosTested = 0;
  for (const d of [1, 2, 3, 4] as const) {
    const m = DEATH_POINTS_BY_DIFFICULTY[d];
    for (let k = 1; k <= GRID_SIZE - m; k++) {
      const surv = survivalProbability(m, k);
      const mult = theoreticalMultiplier(m, k, HOUSE_EDGE);
      const rtp  = surv * mult;
      const dev  = Math.abs(rtp - (1 - HOUSE_EDGE));
      combosTested++;
      if (dev > maxDeviation) { maxDeviation = dev; worstConfig = `d=${d} (m=${m}), k=${k}`; }
    }
  }
  const s16 = step(16, 'Probability Independence (Anti-Circularity)',
    maxDeviation < 1e-10 ? 'PASS' : 'FAIL',
    `4 difficulties × valid step counts = ${combosTested} combos; RTP = survival × payoutMult = ${(1 - HOUSE_EDGE).toFixed(4)} by construction. Max deviation: ${maxDeviation.toExponential(2)} (worst: ${worstConfig})`,
  );

  // ── Step 17: Phase D — client seed variation ──────────────────────────────────
  const dClientSeeds  = new Set(phaseD.map(b => b.seed.clientSeed));
  const dDifficulties = new Set(phaseD.map(b => b.request.difficulty_level));
  let dMatched = 0;
  let dTested  = 0;
  for (const b of phaseD) {
    const ss = ctx.seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;
    dTested++;
    const dpc      = DEATH_POINTS_BY_DIFFICULTY[b.request.difficulty_level];
    const computed = computeDeathPoints(ss, b.seed.clientSeed, b.seed.nonce, dpc);
    const actual   = [...b.response.mines_positions].sort((a, c) => a - c);
    if (computed.length === actual.length && computed.every((v, i) => v === actual[i])) dMatched++;
  }
  const s17 = step(17, 'Phase D — Client Seed Variation',
    dClientSeeds.size >= 2 && dMatched === dTested ? 'PASS' : 'FLAG',
    `${phaseD.length} bets, ${dClientSeeds.size} distinct client seeds, difficulties: ${[...dDifficulties].sort((a, b) => a - b).join(', ')}; recomputation: ${dMatched}/${dTested} match`,
  );

  return [s13, s14, s15, s16, s17];
}
