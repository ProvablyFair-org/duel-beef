/**
 * Steps 5–6: RNG Determinism
 *
 * Step 5 owns the shuffle, so it also carries the draw-bias bound (profile BEEF-08) and the
 * player-verifier parity leg (BEEF-24) — both ported 2026-09-26 from Duel Mines Step 5, which runs
 * the same shuffle on 25 tiles.
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import {
  computeDeathPointsFromBuffer, computePermutationFromBuffer, computeDeathPoints, drawBiasBound, newDrawCensus,
  DEATH_POINTS_BY_DIFFICULTY, GRID_SIZE,
} from '../../src/rng';
import { EXPECTED_BETS, EXPECTED_PHASE_E_BETS } from '../../src/loader';
import { exactMultiplier, relativeDeviation, MULT_REL_TOL } from '../../src/exact';
import { loadSiteVerifier, SITE_VERIFIER_PROVENANCE } from '../../src/site-verifier';
import {
  runOperatorVerifier, checkOperatorCites, operatorPrintedLine, OPERATOR_EXPECTED_LOGS, OPERATOR_VERIFIER_PROVENANCE,
} from '../../src/operator-verifier';

/** The profile's ceiling on draw bias (BEEF-08, methodology S2): one part in 2^32. */
const BIAS_CEILING = Math.pow(2, -32);
/** How many unchanged bets Step 6 names in its detail (a display cap, not a population). */
const MAX_LISTED = 10;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap } = ctx;

  // ── Step 5: Death-point recomputation ───────────────────────────────────────
  let mismatches = 0;
  let skipped    = 0;
  const census   = newDrawCensus();
  for (const b of bets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { skipped++; continue; }
    const dpc      = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    const key      = Buffer.from(ss, 'hex');
    const computed = computeDeathPointsFromBuffer(key, b.seed.clientSeed, b.seed.nonce, dpc, GRID_SIZE, census);
    const actual   = [...b.response.mines_positions].sort((a, c) => a - c);
    if (computed.length !== actual.length || !computed.every((v, i) => v === actual[i])) mismatches++;
  }
  ctx.step5Mismatches = mismatches;
  ctx.step5Skipped    = skipped;
  const verifiedCount = bets.length - skipped;
  // An unrevealed seed is not a pass: a bet that cannot be recomputed is unverified, and "0
  // mismatches" over fewer than every bet is a smaller claim than the step's name makes.
  const s5Issues: string[] = [];
  if (bets.length !== EXPECTED_BETS) s5Issues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (skipped !== 0) s5Issues.push(`${skipped} bet(s) not recomputable — their epoch seed was never revealed`);
  if (mismatches !== 0) s5Issues.push(`${mismatches} death-point mismatch(es)`);

  // ── Step 5, second leg: draw bias bound (BEEF-08) ───────────────────────────
  // Measured from src/rng.ts drawFromChunk — the function the shuffle calls — for every range the
  // shuffle draws on (2..20). HARD FAIL unless (1) every range's accepted window is a whole number
  // of ranges (exact uniformity — the binding assertion: for one 32-bit chunk even the UNCORRECTED
  // v mod range deviates by only ~1e-10 absolute, inside the 2^-32 ceiling, so the ceiling alone
  // cannot tell a corrected draw from an uncorrected one) and (2) the worst per-index deviation is
  // inside 2^-32. The census counts how often the rejection branch was taken over the rounds
  // recomputed above; its draw count is bound to recomputed × 19.
  const bb = drawBiasBound(GRID_SIZE);
  const drawsPerRound  = GRID_SIZE - 1;
  const expectedDraws  = verifiedCount * drawsPerRound;
  const expectedRejectedChunks = verifiedCount * bb.expectedRejectedChunksPerRound;
  if (bb.ranges.length !== drawsPerRound) s5Issues.push(`bias bound covers ${bb.ranges.length} ranges, the shuffle draws on ${drawsPerRound}`);
  if (bb.predicateProbeFailures > 0) {
    s5Issues.push(`drawFromChunk disagrees with "v < window ? v mod range : null" on ${bb.predicateProbeFailures} probe(s)`);
  }
  if (bb.inexactRanges.length > 0) {
    const rows = bb.ranges.filter(r => !r.exact)
      .map(r => `range ${r.range}: window ${r.acceptedWindow} = ${r.range} × ${r.minIndexCount} + ${r.remainder}`);
    s5Issues.push(`accepted window is NOT a whole number of ranges on ${bb.inexactRanges.length} of ${bb.ranges.length} ranges `
      + `(${rows.slice(0, 4).join('; ')}${rows.length > 4 ? '; …' : ''}) — the low indices are over-represented`);
  }
  if (!(bb.worstBias <= BIAS_CEILING)) {
    s5Issues.push(`worst per-index bias ${bb.worstBias.toExponential(3)} exceeds the 2^-32 ceiling ${BIAS_CEILING.toExponential(3)}`);
  }
  if (census.draws !== expectedDraws) {
    s5Issues.push(`rejection census covers ${census.draws} draws, expected ${expectedDraws} (${verifiedCount} recomputed × ${drawsPerRound})`);
  }
  const w20 = bb.ranges.find(r => r.range === GRID_SIZE);

  // ── Step 5, third leg: player-verifier parity (BEEF-24) ─────────────────────
  // The ProvablyFair.org docs-site Beef verifier (VerifyBets derive.js + its one library import) is
  // vendored byte for byte under verifier-parity/ and pinned in src/site-verifier.ts. Its deriveBeef —
  // the site's code, executed, not re-typed — runs on EVERY round of both datasets and must return
  // exactly the death points src/rng.ts computes (bound to the served set by this step and Step 21);
  // on every win its cashoutMultiplier(m, k) must equal the served paid multiplier
  // (no_house_edge_multiplier) within MULT_REL_TOL of the exact rational. The site's DIFFICULTIES
  // table must map each served difficulty_level to the death-point count src/rng.ts uses.
  const sv = loadSiteVerifier();
  const siteIssues: string[] = [];
  let siteCompared = 0, siteMismatches = 0, siteUnrecomputable = 0, siteMultChecked = 0, siteMultMismatches = 0;
  let siteMultWorst = 0;
  const siteExpected = EXPECTED_BETS + EXPECTED_PHASE_E_BETS;
  if (sv.error) siteIssues.push(sv.error);
  for (const f of sv.files) if (!f.match) siteIssues.push(`${f.file}: vendored ${f.actual ?? '(absent)'} != pinned ${f.pinned}`);
  if (sv.deriveBeef && sv.cashoutMultiplier && sv.difficulties) {
    const byCode = new Map(sv.difficulties.map(d => [d.code, d]));
    for (const [code, m] of Object.entries(DEATH_POINTS_BY_DIFFICULTY)) {
      const d = byCode.get(Number(code));
      if (!d || d.deaths !== m) siteIssues.push(`site DIFFICULTIES code ${code}: deaths ${d ? d.deaths : '(absent)'} != ${m}`);
    }
    for (const b of [...bets, ...ctx.phaseE]) {
      const ss = seedMap.get(b.seed.serverSeedHashed);
      if (!ss) { siteUnrecomputable++; continue; }
      const level = b.response.difficulty_level;
      const d = byCode.get(level);
      const m = DEATH_POINTS_BY_DIFFICULTY[level];
      if (!d) { siteMismatches++; continue; }
      const site = Array.from(sv.deriveBeef({ clientSeed: b.seed.clientSeed, serverSeed: ss, nonce: b.seed.nonce, difficulty: d.id }).deathPositions);
      const pkg = computeDeathPoints(ss, b.seed.clientSeed, b.seed.nonce, m);
      siteCompared++;
      if (site.length !== pkg.length || !site.every((v, i) => v === pkg[i])) siteMismatches++;
      if (b.response.outcome === 'win') {
        const k = b.response.reached_k ?? (b.response.current_step || []).length;
        const siteMult = sv.cashoutMultiplier(m, k);
        const siteStr = String(siteMult);
        const devExact = /e/i.test(siteStr) ? Infinity : relativeDeviation(siteStr, exactMultiplier(m, k, true));
        const devServed = relativeDeviation(b.response.no_house_edge_multiplier, exactMultiplier(m, k, true));
        siteMultWorst = Math.max(siteMultWorst, devExact);
        siteMultChecked++;
        if (!(devExact <= MULT_REL_TOL) || !(devServed <= MULT_REL_TOL)) siteMultMismatches++;
      }
    }
  }
  if (siteCompared !== siteExpected) siteIssues.push(`site verifier compared ${siteCompared} rounds, expected ${siteExpected} (${siteUnrecomputable} unrecomputable)`);
  if (siteMismatches > 0) siteIssues.push(`site deriveBeef disagrees with src/rng.ts on ${siteMismatches} round(s)`);
  if (siteMultMismatches > 0) siteIssues.push(`site cashoutMultiplier off the exact paid multiplier (or the served one) on ${siteMultMismatches} win(s)`);
  s5Issues.push(...siteIssues);

  // ── Step 5, fourth leg: THE OPERATOR'S OWN Verify-tab code (BEEF-09) ────────
  // Duel's Beef code panel, pasted by Paulo from the Verify tab on 2026-09-26, vendored verbatim under
  // evidence/verify-tab/ and pinned in src/operator-verifier.ts. The pinned runner fills in the file's
  // five "User input values" (clientSeed, serverSeed, nonce, deathPointsCount from the served
  // difficulty_level via DEATH_POINTS_BY_DIFFICULTY, gridSize = GRID_SIZE) and runs it, on EVERY round of
  // both datasets. Its generateDeathPoints must return exactly the served death points (mines_positions,
  // sorted) AND src/rng.ts's; the line it prints must be the one its own code prints for that list; as
  // shipped it must print only its empty-input line; every operator line src/rng.ts cites must carry its
  // text. HARD FAIL otherwise, or on a count other than EXPECTED_BETS + EXPECTED_PHASE_E_BETS.
  const opIssues: string[] = [];
  const opAll = [...bets, ...ctx.phaseE];
  const opRounds: Array<{ id: string; inputs: { clientSeed: string; serverSeed: string; nonce: number; deathPointsCount: number; gridSize: number } }> = [];
  opAll.forEach((b, i) => {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) return;
    opRounds.push({ id: String(i), inputs: { clientSeed: b.seed.clientSeed, serverSeed: ss, nonce: b.seed.nonce,
      deathPointsCount: DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level], gridSize: GRID_SIZE } });
  });
  const op = runOperatorVerifier(opRounds);
  const opCites = checkOperatorCites();
  let opChecked = 0, opVsServed = 0, opVsRng = 0, opPrinted = 0, opErrors = 0;
  const opFirst: string[] = [];
  if (!op.results) {
    opIssues.push(`operator Verify-tab code: ${op.error}`);
  } else {
    const logsOk = op.shippedLogs.length === OPERATOR_EXPECTED_LOGS.length && op.shippedLogs.every((l, i) => l === OPERATOR_EXPECTED_LOGS[i]);
    if (!logsOk) opIssues.push(`operator Verify-tab code printed ${JSON.stringify(op.shippedLogs).slice(0, 200)} as shipped — not only its empty-input message`);
    for (const r of opRounds) {
      const o = op.results.get(r.id);
      if (o === undefined) continue;
      opChecked++;
      const b = opAll[Number(r.id)];
      if (!o.value || o.error) { opErrors++; if (opFirst.length < 3) opFirst.push(`round ${b.response.round_id}: ${o.error ?? 'no value'}`); continue; }
      const got = o.value.join(',');
      const served = [...b.response.mines_positions].sort((x, y) => x - y).join(',');
      const mine = computeDeathPoints(r.inputs.serverSeed, r.inputs.clientSeed, r.inputs.nonce, r.inputs.deathPointsCount).join(',');
      if (got !== served) { opVsServed++; if (opFirst.length < 3) opFirst.push(`round ${b.response.round_id}: operator [${got}] vs served [${served}]`); }
      if (got !== mine) { opVsRng++; if (opFirst.length < 3) opFirst.push(`round ${b.response.round_id}: operator [${got}] vs src/rng.ts [${mine}]`); }
      if (o.logs.length === 1 && o.logs[0] === operatorPrintedLine(o.value, r.inputs.gridSize, r.inputs.deathPointsCount)) opPrinted++;
      else if (opFirst.length < 3) opFirst.push(`round ${b.response.round_id}: printed ${JSON.stringify(o.logs).slice(0, 100)}`);
    }
    if (opChecked !== siteExpected) opIssues.push(`operator Verify-tab code ran on ${opChecked} rounds, ${siteExpected} declared`);
    if (opVsServed + opVsRng + opErrors > 0 || opPrinted !== opChecked) {
      opIssues.unshift(`operator Verify-tab code disagrees: death points vs the served ones on ${opVsServed}, vs src/rng.ts on ${opVsRng}, `
        + `${opErrors} run error(s), printed ≠ returned on ${opChecked - opErrors - opPrinted} (${opFirst.join('; ')})`);
    }
  }
  if (opCites.bad.length > 0 || opCites.checked === 0) opIssues.push(`src/rng.ts operator citations: ${opCites.bad.slice(0, 2).join('; ')}`);
  if (opIssues.length > 0) s5Issues.push(`OPERATOR VERIFY-TAB CODE PARITY (BEEF-09): ${opIssues.join('; ')}`);

  const s5 = step(5, 'Outcome Recomputation (Death Points)',
    s5Issues.length === 0 && bets.length > 0 ? 'PASS' : 'FAIL',
    s5Issues.length === 0
      ? `${verifiedCount}/${EXPECTED_BETS} verified, ${mismatches} mismatches, ${skipped} skipped (unrevealed seeds). `
        + `Draw bias bound (BEEF-08), measured from src/rng.ts drawFromChunk on all ${bb.ranges.length} ranges 2..${GRID_SIZE}: `
        + `every accepted window is an exact whole number of ranges`
        + (w20 ? ` (range ${GRID_SIZE}: ${w20.acceptedWindow} = ${GRID_SIZE} × ${w20.minIndexCount})` : '')
        + `, so every swap index is exactly equiprobable — worst bias 0, inside the 2^-32 ceiling (uncorrected v mod range `
        + `would lean by up to ${bb.worstUncorrectedRelativeBias.toExponential(2)} relative, ${bb.worstUncorrectedBias.toExponential(2)} absolute). `
        + `Rejection census over the ${verifiedCount.toLocaleString()} rounds: ${census.draws.toLocaleString()} draws, `
        + `${census.chunksRead.toLocaleString()} chunks read, ${census.rejectedChunks} rejected, ${census.cursorAdvances} cursor advances `
        + `(expected rejections ${expectedRejectedChunks.toExponential(2)}). Player-verifier parity (BEEF-24): the ProvablyFair.org `
        + `docs-site derive.js (pinned, ${SITE_VERIFIER_PROVENANCE.ref} @ ${SITE_VERIFIER_PROVENANCE.head.slice(0, 7)}) executed on `
        + `${siteCompared}/${siteExpected} rounds of both datasets — 0 death-point disagreements with src/rng.ts; its paid multiplier on `
        + `${siteMultChecked} wins within relative ${MULT_REL_TOL.toExponential(0)} of the exact rational and the served figure. `
        + `Operator-code parity (BEEF-09): Duel's own Beef Verify-tab code (${OPERATOR_VERIFIER_PROVENANCE.savedAs}, `
        + `${OPERATOR_VERIFIER_PROVENANCE.from}, SHA-256 ${OPERATOR_VERIFIER_PROVENANCE.sha256.slice(0, 16)}…, pinned) executed with only its `
        + `five "User input values" filled in (gridSize ${GRID_SIZE}, deathPointsCount from the served difficulty) on ${opChecked}/${siteExpected} `
        + `rounds of both datasets — its death points equal the served ones and src/rng.ts on every round (${opVsServed} / ${opVsRng} differ), `
        + `the line it prints equals what its code prints for the returned list on ${opPrinted}/${opChecked}, operator lines cited by src/rng.ts `
        + `${opCites.checked - opCites.bad.length}/${opCites.checked} verbatim`
      : `STEP 5 FAILED: ${s5Issues.join('; ')}`,
    {
      population: bets.length, verified: verifiedCount, mismatches, skipped,
      drawBias: {
        ceiling: BIAS_CEILING, worstBias: bb.worstBias, worstUncorrectedBias: bb.worstUncorrectedBias,
        worstUncorrectedRelativeBias: bb.worstUncorrectedRelativeBias, inexactRanges: bb.inexactRanges,
        predicateProbeFailures: bb.predicateProbeFailures,
        ranges: bb.ranges.map(r => ({ range: r.range, acceptedWindow: r.acceptedWindow, perIndex: r.minIndexCount, remainder: r.remainder, rejectedValues: r.rejectedValues })),
        census: { ...census, expectedDraws, expectedRejectedChunks },
      },
      siteVerifier: {
        provenance: SITE_VERIFIER_PROVENANCE, files: sv.files, compared: siteCompared, expected: siteExpected,
        mismatches: siteMismatches, unrecomputable: siteUnrecomputable,
        multipliersChecked: siteMultChecked, multiplierMismatches: siteMultMismatches, worstMultiplierDeviation: siteMultWorst,
      },
      operatorVerifier: {
        files: op.files.map(f => ({ file: f.file, pinnedSha256: f.pinned, actualSha256: f.actual, match: f.match })),
        provenance: OPERATOR_VERIFIER_PROVENANCE, roundsExecuted: opChecked, expected: siteExpected,
        differsFromServed: opVsServed, differsFromRng: opVsRng, printedEqualsReturned: opPrinted, errors: opErrors,
        citesChecked: opCites.checked, citesBad: opCites.bad.length, issues: opIssues,
      },
    },
  );

  // ── Step 6: Client seed influence ────────────────────────────────────────────
  // THE PROPERTY IS 100%, SO THE BAR IS 100%. This step used to compare the sorted death-point
  // SET and pass at "> 95% changed", with 597 of 601 riding on the slack. The four that did not
  // change were all EASY bets, and that is arithmetic, not a defect: EASY keeps 1 tile of 20,
  // so two independent shuffles land the same single death point 1 time in 20 (142 EASY bets
  // were in that sample; ~7.1 coincidences expected, 4 seen). The projection simply cannot see
  // the client seed on those bets — and a 95% bar that forgives it also forgives 30 bets on
  // which the client seed genuinely had no effect. The step now compares the FULL 20-tile
  // permutation the RNG produces (src/rng.ts computePermutationFromBuffer), where a chance
  // repeat has probability 1/20! (~4e-19), and requires every bet to change. The projection
  // count is still reported, in the data block, so the old figure stays explainable.
  // EMPTY-SEED CONTROL (2026-09-26, ported from Duel Mines/Dice Step 6): the same comparison with
  // clientSeed = "" on every bet. An implementation that ignored a non-empty client seed but not
  // the empty string, or keyed on its length, would show here; the bar is again every bet.
  const WRONG_CLIENT = 'wrong-client-seed-test';
  let tested = 0, changed = 0, s6Skipped = 0, projectionUnchanged = 0, emptyChanged = 0;
  const projectionUnchangedByDifficulty: Record<string, number> = {};
  const unchanged: string[] = [];
  for (const b of bets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { s6Skipped++; continue; }
    tested++;
    const key     = Buffer.from(ss, 'hex');
    const correct = computePermutationFromBuffer(key, b.seed.clientSeed, b.seed.nonce);
    const wrong   = computePermutationFromBuffer(key, WRONG_CLIENT, b.seed.nonce);
    if (correct.join(',') !== wrong.join(',')) changed++;
    else if (unchanged.length < MAX_LISTED) unchanged.push(`${b.seed.serverSeedHashed.substring(0, 16)}…#${b.seed.nonce}`);
    if (computePermutationFromBuffer(key, '', b.seed.nonce).join(',') !== correct.join(',')) emptyChanged++;
    const dpc = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    const proj = (p: number[]) => p.slice(0, dpc).sort((x, y) => x - y).join(',');
    if (proj(correct) === proj(wrong)) {
      projectionUnchanged++;
      const d = String(b.response.difficulty_level);
      projectionUnchangedByDifficulty[d] = (projectionUnchangedByDifficulty[d] ?? 0) + 1;
    }
  }
  let projectionExpected = 0;
  for (const b of bets) {
    const m = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
    let c = 1; for (let i = 0; i < m; i++) c = (c * (20 - i)) / (i + 1);
    projectionExpected += 1 / c;
  }
  const s6Issues: string[] = [];
  if (tested !== bets.length) s6Issues.push(`tested ${tested} of ${bets.length} bets (${s6Skipped} on an unrevealed seed)`);
  if (tested === 0)           s6Issues.push('zero bets tested');
  if (changed !== tested)     s6Issues.push(`${tested - changed} bet(s) produced the IDENTICAL permutation under a different client seed: ${unchanged.join(', ')}`);
  if (emptyChanged !== tested) s6Issues.push(`empty-seed control: ${tested - emptyChanged} bet(s) produced the IDENTICAL permutation with clientSeed ""`);
  const s6 = step(6, 'Client Seed Influence',
    s6Issues.length === 0 ? 'PASS' : 'FAIL',
    s6Issues.length === 0
      ? `${changed}/${bets.length} bets: wrong clientSeed → different 20-tile permutation (the full RNG output, not the death-point projection); `
        + `${projectionUnchanged} bet(s) keep the same death-point SET by chance (${projectionExpected.toFixed(1)} expected at 1/C(20,m) per bet); `
        + `empty-seed control (clientSeed ""): ${emptyChanged}/${bets.length} permutations differ`
      : `STEP 6 FAILED: ${s6Issues.join('; ')}`,
    { population: bets.length, tested, changed, emptySeedChanged: emptyChanged, skipped: s6Skipped, projectionUnchanged, projectionExpected, projectionUnchangedByDifficulty },
  );

  return [s5, s6];
}
