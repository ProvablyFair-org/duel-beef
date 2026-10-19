/**
 * Steps 13–17: Dataset Integrity & Anti-Circularity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import {
  checkDatasetHash,
  EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_PHASE_BETS, EXPECTED_SEED_PHASES,
  EXPECTED_EPOCHS, EXPECTED_EPOCH_SIZE, EXPECTED_SHORT_EPOCH_SIZES,
} from '../../src/loader';
import {
  theoreticalMultiplier,
  survivalProbability,
  computeDeathPoints,
  DEATH_POINTS_BY_DIFFICULTY,
  HOUSE_EDGE,
  GRID_SIZE,
} from '../../src/rng';
import { enumerateSurvivalCounts, exactMultiplier, binomialBig } from '../../src/exact';
import { computeRtpClaim } from '../../src/rtp-settings';

/** Float identity bound for Step 16; the exact legs carry no tolerance. */
const S16_BOUND = 1e-10;
/** Relative agreement of counted survival with the float survivalProbability (double rounding only). */
const S16_ANCHOR_REL = 1e-12;

export function run(
  ctx: VerifyContext,
  phaseEHash: { expected: string; actual: string; match: boolean } | null,
): StepResult[] {
  const { bets, seeds, phaseD } = ctx;

  // ── Step 13: Population & phase labels ────────────────────────────────────────
  // Labels are not a population. "A, B, C and D are all present, and the last bet is a
  // D" is satisfied by four bets. Every figure a label check can reach is read from
  // inside the file being scored, so a uniform shrink keeps every label valid and every
  // ratio intact; a shrunken capture with a matching header re-pins cleanly. The counts
  // are therefore compared against src/loader.ts, which the dataset does not control,
  // and a disagreement is a hard failure rather than a flag.
  const phases    = new Set(bets.map(b => b.phase));
  const hasAll    = (['A', 'B', 'C', 'D'] as const).every(p => phases.has(p));
  const lastPhase = bets[bets.length - 1].phase;

  const betPhaseCounts: Record<string, number> = {};
  for (const b of bets) betPhaseCounts[b.phase] = (betPhaseCounts[b.phase] ?? 0) + 1;
  const seedPhaseCounts: Record<string, number> = {};
  for (const s of seeds) seedPhaseCounts[s.phase] = (seedPhaseCounts[s.phase] ?? 0) + 1;

  const popIssues: string[] = [];
  if (bets.length !== EXPECTED_BETS)   popIssues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (seeds.length !== EXPECTED_SEEDS) popIssues.push(`seed records ${seeds.length} != ${EXPECTED_SEEDS}`);
  for (const [p, n] of Object.entries(EXPECTED_PHASE_BETS)) {
    const got = betPhaseCounts[p] ?? 0;
    if (got !== n) popIssues.push(`phase ${p} bets ${got} != ${n}`);
  }
  for (const [p, n] of Object.entries(EXPECTED_SEED_PHASES)) {
    const got = seedPhaseCounts[p] ?? 0;
    if (got !== n) popIssues.push(`phase ${p} seeds ${got} != ${n}`);
  }
  if (!hasAll)             popIssues.push(`phases present: ${[...phases].sort().join(', ')}`);
  if (lastPhase !== 'D')   popIssues.push(`last bet phase '${lastPhase}' != 'D'`);

  const s13 = step(13, 'Population & Phase Labels',
    popIssues.length === 0 ? 'PASS' : 'FAIL',
    popIssues.length === 0
      ? `${bets.length} bets and ${seeds.length} seed records match the capture plan in src/loader.ts `
        + `(code constants, not the dataset header); phases A, B, C, D all present, last bet phase D`
      : `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${popIssues.join('; ')}`,
    { betPhases: betPhaseCounts, seedPhases: seedPhaseCounts, lastPhase, populationIssues: popIssues },
  );

  // ── Step 14: Dataset hash ─────────────────────────────────────────────────────
  // Both captures are pinned (src/loader.ts). This step used to cover the primary file only, and
  // its only non-PASS branch was FLAG — which could never be reached anyway, because
  // tests/verify.ts exited before any step ran. The pre-flight now prints and continues, so a
  // mismatch on EITHER file, or an absent Phase E file, lands here as a FAIL.
  const h = checkDatasetHash();
  const s14Issues: string[] = [];
  if (!h.match) s14Issues.push(`primary dataset sha256 ${h.actual} != pinned ${h.expected || '(not set)'}`);
  if (!phaseEHash) s14Issues.push('Phase E dataset absent');
  else if (!phaseEHash.match) s14Issues.push(`Phase E dataset sha256 ${phaseEHash.actual} != pinned ${phaseEHash.expected}`);
  const s14 = step(14, 'Dataset Hash',
    s14Issues.length === 0 ? 'PASS' : 'FAIL',
    s14Issues.length === 0
      ? `Primary: ${h.actual} matches its pin | Phase E: ${phaseEHash!.actual} matches its pin`
      : `DATASET NOT THE ONE AUDITED: ${s14Issues.join('; ')}`,
  );

  // ── Step 15: Epoch size ────────────────────────────────────────────────────────
  // `max <= 50` only fails on an OVERSIZED epoch, and nothing in this audit was ever at
  // risk of producing one. Every uniform truncation — 121 epochs of 5 bets — passed it,
  // as did dropping epochs entirely. The declared size is asserted instead, together with
  // the epoch count and the exact multiset of the two documented short epochs, so that
  // shrinking the data and the header together cannot leave the step satisfied.
  const epochSizes = new Map<string, number>();
  for (const b of bets) {
    epochSizes.set(b.seed.serverSeedHashed, (epochSizes.get(b.seed.serverSeedHashed) ?? 0) + 1);
  }
  const sizes    = [...epochSizes.values()];
  const minSize  = sizes.length > 0 ? Math.min(...sizes) : 0;
  const maxSize  = sizes.length > 0 ? Math.max(...sizes) : 0;
  const fullSize = sizes.filter(s => s === EXPECTED_EPOCH_SIZE).length;
  const shortObserved = sizes.filter(s => s !== EXPECTED_EPOCH_SIZE).sort((a, b) => a - b);
  const shortExpected = [...EXPECTED_SHORT_EPOCH_SIZES].sort((a, b) => a - b);

  const epochIssues: string[] = [];
  if (epochSizes.size !== EXPECTED_EPOCHS) {
    epochIssues.push(`epochs ${epochSizes.size} != ${EXPECTED_EPOCHS}`);
  }
  if (shortObserved.length !== shortExpected.length
      || shortObserved.some((s, i) => s !== shortExpected[i])) {
    epochIssues.push(
      `epochs not of ${EXPECTED_EPOCH_SIZE} bets are [${shortObserved.join(', ')}], `
      + `expected exactly [${shortExpected.join(', ')}]`,
    );
  }

  const s15 = step(15, 'Epoch Size',
    epochIssues.length === 0 ? 'PASS' : 'FAIL',
    epochIssues.length === 0
      ? `${EXPECTED_EPOCHS} epochs as declared in src/loader.ts: ${fullSize} of exactly ${EXPECTED_EPOCH_SIZE} bets, `
        + `plus the two documented capture-retry epochs of ${shortExpected.join(' and ')} bets`
      : `EPOCH STRUCTURE MISMATCH vs src/loader.ts: ${epochIssues.join('; ')}`,
    { epochs: epochSizes.size, fullEpochs: fullSize, shortEpochSizes: shortObserved, minSize, maxSize, epochIssues },
  );

  // ── Step 16: Anti-circularity — theoretical RTP ───────────────────────────────
  // For each difficulty d (1–4) and each valid step count k (1..GRID_SIZE - m),
  // single-stop RTP at step k is:
  //   RTP(d, k) = survivalProbability(m, k) × theoreticalMultiplier(m, k, edge)
  //             = [C(20-m, k)/C(20, k)] × [(1-edge) × C(20, k)/C(20-m, k)]
  //             = (1 - edge) = 0.992
  // Independent derivation: no casino-supplied data used.
  //
  // HARDENED 2026-09-26 (profile BEEF-18, ported from Duel Mines Step 16): two exact legs join the
  // float identity. (1) COUNTING ANCHOR — all 2^20 death-point sets are enumerated (src/exact.ts
  // enumerateSurvivalCounts) and, at every (m, k) cell, the counted survivors/total must equal
  // src/rng.ts survivalProbability AND, in exact integer arithmetic, counted-survival × the exact
  // paid multiplier C(20,k)·992/(C(20−m,k)·1000) must equal that cell's exact row in the RTP table
  // (src/rtp-settings.ts; 992/1000 at every honest cell) — no binomial in the survival path, so a
  // wrong comb() cannot cancel out. Since 14 Oct 2026 (C3) the row, not the claimed 992/1000: a cell
  // that pays less is an RTP miss, which RTP-CLAIM scores on this step as RTP FIGURE OVERSTATED. (2) NEGATIVE CONTROL — the same exact
  // identity is re-run with the edge corrupted to 991/1000 and must be REJECTED at every cell; a
  // check that accepted it would be accepting anything.
  let maxDeviation = 0;
  let worstConfig  = '';
  let combosTested = 0;
  const anchor = enumerateSurvivalCounts();
  // The RTP table's exact row per cell (src/rtp-settings.ts, the table RTP-CLAIM scores on this step).
  const tableRtp = new Map(computeRtpClaim().rows.map(r => {
    const [n, d] = r.rtpExact.split('/');
    return [r.setting, { n: BigInt(n as string), d: BigInt((d ?? '1') as string) }] as const;
  }));
  let anchorMismatches = 0, exactIdentityFailures = 0, negativeControlAccepted = 0;
  for (const d of [1, 2, 3, 4] as const) {
    const m = DEATH_POINTS_BY_DIFFICULTY[d];
    for (let k = 1; k <= GRID_SIZE - m; k++) {
      const surv = survivalProbability(m, k);
      const mult = theoreticalMultiplier(m, k, HOUSE_EDGE);
      const rtp  = surv * mult;
      const dev  = Math.abs(rtp - (1 - HOUSE_EDGE));
      combosTested++;
      if (dev > maxDeviation) { maxDeviation = dev; worstConfig = `d=${d} (m=${m}), k=${k}`; }
      const cS = BigInt(anchor.survive[m][k]), cT = BigInt(anchor.total[m]);
      if (Math.abs(anchor.survive[m][k] / anchor.total[m] - surv) > S16_ANCHOR_REL * surv) anchorMismatches++;
      const paid = exactMultiplier(m, k, true);
      // counted survival × paid multiplier == the RTP table's exact row for this cell (C3, 14 Oct 2026:
      // the row, not the claimed 992/1000 — a cell paying less is an RTP miss, scored by RTP-CLAIM on
      // this step as RTP FIGURE OVERSTATED, never a FAIL here). cS·paid.num·row.d == cT·paid.den·row.n
      const row = tableRtp.get(`difficulty=${d} (m=${m}) k=${k}`);
      if (!row || cS * paid.num * row.d !== cT * paid.den * row.n) exactIdentityFailures++;
      // negative control: a multiplier built on 991/1000 must NOT reproduce the row
      const badNum = binomialBig(GRID_SIZE, k) * 991n, badDen = binomialBig(GRID_SIZE - m, k) * 1000n;
      if (row && cS * badNum * row.d === cT * badDen * row.n) negativeControlAccepted++;
    }
  }
  // The measured deviation is a float and belongs in `data`, not in the sentence: the
  // reproduction gate compares a string leaf for equality, so a figure printed into prose
  // disagrees forever on a machine whose last bit differs. The sentence carries the BOUND.
  const s16Ok = maxDeviation < S16_BOUND && anchorMismatches === 0 && exactIdentityFailures === 0 && negativeControlAccepted === 0;
  const s16 = step(16, 'Probability Independence (Anti-Circularity)',
    s16Ok ? 'PASS' : 'FAIL',
    s16Ok
      ? `4 difficulties × valid step counts = ${combosTested} combos; RTP = survival × payoutMult = ${(1 - HOUSE_EDGE).toFixed(4)} by construction, within the ${S16_BOUND.toExponential(0)} bound at every combo; `
        + `counting anchor (all 2^${GRID_SIZE} death-point sets enumerated, no binomial in the path): counted survival equals survivalProbability and, `
        + `in exact integer arithmetic, counted survival × the exact paid multiplier = the RTP table's exact row at all ${combosTested} cells `
        + `(each row is held to the claim by RTP-CLAIM on this step, not here); negative control (edge 991/1000) rejected at all ${combosTested}`
      : `RTP identity broken: float deviation ${maxDeviation < S16_BOUND ? 'within' : 'beyond'} the ${S16_BOUND.toExponential(0)} bound (worst: ${worstConfig}); `
        + `${anchorMismatches} counting-anchor mismatch(es), ${exactIdentityFailures} exact-identity failure(s), negative control accepted at ${negativeControlAccepted} cell(s)`,
    { combosTested, maxDeviation, bound: S16_BOUND, worstConfig, anchorMismatches, exactIdentityFailures, negativeControlAccepted },
  );

  // ── Step 17: Phase D — client seed variation ──────────────────────────────────
  // Phase D exists to show outcomes still recompute when the CLIENT seed changes every epoch. A
  // recomputation mismatch here is the same defect Step 5 hard-fails on, so it hard-fails here
  // too (it used to FLAG). The population is bound: every Phase D bet recomputed (an unrevealed
  // seed is counted, not skipped), the phase at its planned size, and every Phase D epoch on its
  // own client seed — "at least 2 distinct" was satisfied by a single rotation.
  const dClientSeeds  = new Set(phaseD.map(b => b.seed.clientSeed));
  const dEpochs       = new Map<string, Set<string>>();
  for (const b of phaseD) {
    const cs = dEpochs.get(b.seed.serverSeedHashed) ?? new Set<string>();
    cs.add(b.seed.clientSeed);
    dEpochs.set(b.seed.serverSeedHashed, cs);
  }
  const dDifficulties = new Set(phaseD.map(b => b.request.difficulty_level));
  let dMatched = 0, dTested = 0, dSkipped = 0;
  for (const b of phaseD) {
    const ss = ctx.seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { dSkipped++; continue; }
    dTested++;
    const dpc      = DEATH_POINTS_BY_DIFFICULTY[b.request.difficulty_level];
    const computed = computeDeathPoints(ss, b.seed.clientSeed, b.seed.nonce, dpc);
    const actual   = [...b.response.mines_positions].sort((a, c) => a - c);
    if (computed.length === actual.length && computed.every((v, i) => v === actual[i])) dMatched++;
  }
  const s17Issues: string[] = [];
  if (phaseD.length !== EXPECTED_PHASE_BETS.D) s17Issues.push(`Phase D bets ${phaseD.length} != ${EXPECTED_PHASE_BETS.D}`);
  if (dSkipped > 0)          s17Issues.push(`${dSkipped} Phase D bets on an unrevealed seed`);
  if (dMatched !== dTested)  s17Issues.push(`${dTested - dMatched} recomputation mismatches`);
  const multiCsEpochs = [...dEpochs.values()].filter(cs => cs.size !== 1).length;
  if (multiCsEpochs > 0)     s17Issues.push(`${multiCsEpochs} Phase D epochs carry more than one client seed`);
  if (dClientSeeds.size !== dEpochs.size) {
    s17Issues.push(`${dClientSeeds.size} distinct client seeds across ${dEpochs.size} Phase D epochs — a client seed was reused`);
  }
  const s17 = step(17, 'Phase D — Client Seed Variation',
    s17Issues.length === 0 ? 'PASS' : 'FAIL',
    s17Issues.length === 0
      ? `${phaseD.length} bets, ${dClientSeeds.size} distinct client seeds, one per Phase D epoch (${dEpochs.size}), difficulties: ${[...dDifficulties].sort((a, b) => a - b).join(', ')}; recomputation: ${dMatched}/${phaseD.length} match`
      : `PHASE D FAILED: ${s17Issues.join('; ')}`,
    { bets: phaseD.length, epochs: dEpochs.size, distinctClientSeeds: dClientSeeds.size, tested: dTested, matched: dMatched, skipped: dSkipped },
  );

  return [s13, s14, s15, s16, s17];
}
