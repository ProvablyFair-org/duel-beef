/**
 * Steps 18–19: Simulation Results
 */

import * as fs   from 'fs';
import * as path from 'path';

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { EXPECTED_EPOCHS, SIM_FIRST_STEP_TILE } from '../../src/loader';
import { computeDeathPointsFromBuffer, survivalProbability, DEATH_POINTS_BY_DIFFICULTY } from '../../src/rng';
import { chiSquaredTest, binomSurvival } from '../../src/stats';

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir } = ctx;
  const simPath = path.join(outputsDir, 'simulation-results.json');

  if (!fs.existsSync(simPath)) {
    // The artifact of record is pinned (Step 23); its absence is a FAIL, not a FLAG.
    const s18 = step(18, 'Simulation Results — Pass 1 Integrity', 'FAIL',
      'simulation-results.json not found — the pinned artifact of record is missing',
    );
    const s19 = step(19, 'Simulation Results — Pass 2 Cherry-Pick Test', 'FAIL',
      'simulation-results.json not found — the pinned artifact of record is missing',
    );
    return [s18, s19];
  }

  const sim = JSON.parse(fs.readFileSync(simPath, 'utf-8'));

  // ── Step 18: Pass 1 ────────────────────────────────────────────────────────
  const pass1    = sim.pass1_fresh_seeds;
  const configs  = pass1.configs ?? pass1.targets ?? 4;
  const bonAlpha = 0.01 / configs;
  const chi2BonFails = pass1.results.filter((r: any) => r.positionPValue < bonAlpha).length;
  const serialBonFails = pass1.results.filter((r: any) =>
    Math.abs(r.r1Z ?? 0) > 3.5 || (r.runsPValue !== undefined && r.runsPValue < bonAlpha)
  ).length;
  const pass1Ok  = chi2BonFails === 0 && serialBonFails === 0;
  // The simulated RTP is a measured float; it goes in `data`, where the reproduction gate
  // can compare it against the committed figure within tolerance. A float spelled into the
  // sentence can only be compared as a string, and then a last-bit difference on another
  // machine is scored as a disagreement forever. The sentence carries the bound.
  const s18 = step(18, 'Simulation Results — Pass 1 Integrity',
    pass1Ok ? 'PASS' : 'FAIL',
    `${(pass1.totalRounds ?? 0).toLocaleString()} rounds × ${configs} configs; chi2: ${pass1.chi2FailsAtAlpha01 ?? 0}/${configs} uncorrected, ${chi2BonFails}/${configs} at Bonferroni α/${configs}=${bonAlpha.toFixed(6)}; serial: ${pass1.serialIndependenceFails ?? 0}/${configs} uncorrected, ${serialBonFails}/${configs} at Bonferroni; mean simulated RTP reported in this step's data block`,
    {
      totalRounds: pass1.totalRounds ?? 0,
      configs,
      avgSimulatedRTP: pass1.avgSimulatedRTP ?? 0,
      bonferroniAlpha: bonAlpha,
      chi2FailsUncorrected: pass1.chi2FailsAtAlpha01 ?? 0,
      chi2FailsBonferroni: chi2BonFails,
      serialFailsUncorrected: pass1.serialIndependenceFails ?? 0,
      serialFailsBonferroni: serialBonFails,
    },
  );

  // ── Step 19: Pass 2 ────────────────────────────────────────────────────────
  // RECOMPUTED, NOT READ. The step used to take test_b_cherry_pick_flags from the artifact, cap
  // it at 2×ceil(0.05N) (14 of 121) and stop at FLAG — so no Pass-2 result could fail the audit,
  // and its "broad" count could not be non-zero: simulate.ts only raises cherry_pick_flag when
  // lateP >= 0.05, so a flagged seed is never broad by definition. Now, from the per-seed rows:
  //   • the rows are bound to the population — exactly one row per bet-bearing epoch of the
  //     dataset, on that epoch's serverSeedHashed and clientSeed, at difficulty 2 (m = 3);
  //   • every EARLY window (nonces 0–49, the window the cherry-pick test is about) is REPLAYED
  //     from the revealed seed and its win count must equal the row's exactly. A round is one step on
  //     SIM_FIRST_STEP_TILE (tile 0), and that tile must be the first stepped tile of every captured
  //     round. Until 2026-10-06 the replay and Pass 2 in src/simulate.ts both checked tile nonce % 20, agreed
  //     with each other, and so could not notice that neither is the tile a Beef round steps on first
  //     (QA review, 6 Oct 2026);
  //   • earlyP, lateP and the Test A p are recomputed from the win counts; the flags, the counts
  //     and both binomial p-values are recomputed and must agree with what the artifact states;
  //   • the verdict uses the RECOMPUTED figures, and every rule that can move it is a COUNT tested
  //     against the number of seeds: FAIL if Test B's binomial p < 0.01 (simulate.ts's own rule), if
  //     Test A's binomial p < 0.01, if the count of seeds off in BOTH windows at p < 0.05 has
  //     P(K >= k | Binomial(N, 0.05 × 0.05)) < 0.01, or if any seed is off in both windows at
  //     p < 0.001; FLAG at Test B binomial p < 0.05 or that both-window count P < 0.05. The early
  //     window is tested on its own because seed selection need not bias the whole nonce range: a
  //     seed could be chosen on the nonces a player reaches first. A FLAG is a statistical
  //     deviation; on its own it does not establish manipulation.
  //   • FALSE-ALARM RATES ARE PART OF THE RULE (QA review, 6 Oct 2026): a statistical rule may
  //     move the verdict only if its false-alarm rate on a fair game is stated, at most 5% for a
  //     FLAG and 1% for a FAIL. Each rule's rate is computed below twice, under the rule's own model
  //     (each window's test exactly 5% on a fair seed) and with the exact sizes of the discrete
  //     tests (the binomial mass of every win count the chi-squared test rejects), and printed.
  // WHY THE BOTH-WINDOW RESULT IS A COUNT, NOT A SEED. Scoring each seed on its own (any one seed off
  // in both windows at p < 0.05 makes a FLAG) would ignore how many seeds are tested: on a fair game
  // each seed is off in both by luck with probability 0.05 × 0.05 = 1/400, so across 121 seeds at
  // least one is about 26% of the time (P(K >= 1 | Binomial(121, 0.0025)) = 0.2613), far over the 5%
  // cap. A seed off in both windows is listed in the detail and the data block as a disclosed
  // observation. The p < 0.001 both-window rule stays per seed: its false-alarm rate is far under 1%.
  // Late windows (9,950 nonces × 121 seeds) are NOT replayed here — about 100 s of HMAC per run;
  // their counts come from simulation-results.json, whose bytes Step 23 pins.
  const pass2 = sim.pass2_casino_seeds;
  const rows: any[] = Array.isArray(pass2.results) ? pass2.results : [];
  const N = rows.length;
  const theoWin = survivalProbability(DEATH_POINTS_BY_DIFFICULTY[2], 1);
  const EARLY = 50, TOTAL = 10_000, LATE = TOTAL - EARLY;
  const P_TOL = 1e-12;   // recomputed p vs artifact p: same code, allows a last-bit libm difference only
  const s19Issues: string[] = [];

  if (N !== EXPECTED_EPOCHS)        s19Issues.push(`rows ${N} != ${EXPECTED_EPOCHS} bet-bearing epochs`);
  if (pass2.seeds_tested !== N)     s19Issues.push(`seeds_tested ${pass2.seeds_tested} != rows ${N}`);
  if (pass2.nonces_per_seed !== TOTAL || pass2.epoch_length !== EARLY) {
    s19Issues.push(`nonces_per_seed/epoch_length ${pass2.nonces_per_seed}/${pass2.epoch_length} != ${TOTAL}/${EARLY}`);
  }
  // The win condition is bound to the game, not only to the artifact: every captured round (both files)
  // must have stepped on SIM_FIRST_STEP_TILE first, or the tile Pass 2 scores is not Beef's first step.
  const firstStepOther = [...ctx.bets, ...ctx.phaseE].filter(b =>
    !Array.isArray(b.response.current_step) || b.response.current_step[0] !== SIM_FIRST_STEP_TILE).length;
  if (firstStepOther > 0) {
    s19Issues.push(`${firstStepOther} captured rounds whose first stepped tile is not tile ${SIM_FIRST_STEP_TILE}, the tile Pass 2 scores`);
  }
  const seenHashes = new Set<string>();
  const broadSeeds: Array<{ serverSeedHashed: string; clientSeed: string; earlyWins: number; earlyP: number; lateWins: number; lateP: number }> = [];
  let rowShape = 0, earlyReplayMismatch = 0, pMismatch = 0, flagMismatch = 0;
  let flags = 0, testA = 0, broad = 0, broadSevere = 0;
  for (const r of rows) {
    const epoch = ctx.byHash.get(r.serverSeedHashed);
    const ss    = ctx.seedMap.get(r.serverSeedHashed);
    if (!epoch || !ss || seenHashes.has(r.serverSeedHashed) || epoch[0].seed.clientSeed !== r.clientSeed
        || r.difficulty !== 2 || r.deathPointsCount !== 3 || r.earlyTotal !== EARLY || r.lateTotal !== LATE
        || !Number.isInteger(r.earlyWins) || !Number.isInteger(r.lateWins)) { rowShape++; continue; }
    seenHashes.add(r.serverSeedHashed);

    const key = Buffer.from(ss, 'hex');
    let early = 0;
    for (let n = 0; n < EARLY; n++) {
      if (!computeDeathPointsFromBuffer(key, r.clientSeed, n, 3).includes(SIM_FIRST_STEP_TILE)) early++;
    }
    if (early !== r.earlyWins) earlyReplayMismatch++;

    const pEarly = chiSquaredTest([r.earlyWins, EARLY - r.earlyWins], [theoWin * EARLY, (1 - theoWin) * EARLY]).pValue;
    const pLate  = chiSquaredTest([r.lateWins, LATE - r.lateWins], [theoWin * LATE, (1 - theoWin) * LATE]).pValue;
    const tot    = r.earlyWins + r.lateWins;
    const pA     = chiSquaredTest([tot, TOTAL - tot], [theoWin * TOTAL, (1 - theoWin) * TOTAL]).pValue;
    if (!(Math.abs(pEarly - r.earlyP) <= P_TOL) || !(Math.abs(pLate - r.lateP) <= P_TOL)) pMismatch++;

    const flag  = pEarly < 0.05 && pLate >= 0.05;
    const aFail = pA < 0.01;
    if (flag !== r.cherry_pick_flag || aFail !== r.testA_chi2_fail) flagMismatch++;
    if (flag)  flags++;
    if (aFail) testA++;
    if (pEarly < 0.05 && pLate < 0.05) {
      broad++;
      broadSeeds.push({ serverSeedHashed: r.serverSeedHashed, clientSeed: r.clientSeed,
        earlyWins: r.earlyWins, earlyP: pEarly, lateWins: r.lateWins, lateP: pLate });
    }
    if (pEarly < 0.001 && pLate < 0.001) broadSevere++;
  }
  if (rowShape > 0)            s19Issues.push(`${rowShape} rows not bound to a distinct dataset epoch/clientSeed at difficulty 2 with ${EARLY}/${LATE} windows`);
  if (earlyReplayMismatch > 0) s19Issues.push(`${earlyReplayMismatch} early windows disagree with a replay from the revealed seed`);
  if (pMismatch > 0)           s19Issues.push(`${pMismatch} rows whose earlyP/lateP do not recompute from their win counts`);
  if (flagMismatch > 0)        s19Issues.push(`${flagMismatch} rows whose cherry_pick_flag/testA_chi2_fail do not follow from the recomputed p-values`);
  if (pass2.test_b_cherry_pick_flags !== flags)     s19Issues.push(`artifact states ${pass2.test_b_cherry_pick_flags} Test B flags, rows give ${flags}`);
  if (pass2.test_a_chi2_fails_at_alpha01 !== testA) s19Issues.push(`artifact states ${pass2.test_a_chi2_fails_at_alpha01} Test A fails, rows give ${testA}`);
  const pB   = binomSurvival(flags, N, 0.05);
  const pAbn = binomSurvival(testA, N, 0.01);
  if (!(Math.abs(pB - pass2.test_b_binomial_pValue) <= P_TOL))   s19Issues.push(`artifact Test B binomial p ${pass2.test_b_binomial_pValue} != recomputed`);
  if (!(Math.abs(pAbn - pass2.test_a_binomial_pValue) <= P_TOL)) s19Issues.push(`artifact Test A binomial p ${pass2.test_a_binomial_pValue} != recomputed`);

  // ── The count rule and the false-alarm rate of every verdict-moving rule ──────────────────
  const CAP_FLAG = 0.05, CAP_FAIL = 0.01;     // the standard: false-alarm rate on a fair game, at most 5% FLAG, 1% FAIL
  const FLAG_AT = 0.05, FAIL_AT = 0.01;       // the rules' own levels; checked against the caps below, not assumed
  const P_WIN = 0.05, P_SEVERE = 0.001;       // per-window thresholds, unchanged
  const P_TEST_A = 0.01;                      // Test A per-seed threshold, unchanged
  const P_BOTH = P_WIN * P_WIN;               // a fair seed off in both windows by luck: 1/400
  const P_BOTH_SEVERE = P_SEVERE * P_SEVERE;
  /** The smallest count k whose tail P(K >= k | Binomial(N, p)) is below `alpha`: the count that moves the verdict. */
  const kAt = (p: number, alpha: number): number => {
    for (let k = 0; k <= N; k++) if (binomSurvival(k, N, p) < alpha) return k;
    return N + 1;
  };
  const testAFailK = kAt(P_TEST_A, FAIL_AT);
  const testBFlagK = kAt(P_WIN, FLAG_AT), testBFailK = kAt(P_WIN, FAIL_AT);
  const bothFlagK  = kAt(P_BOTH, FLAG_AT), bothFailK  = kAt(P_BOTH, FAIL_AT);
  const severeFailK = 1;                      // any one seed: kept, its false-alarm rate is printed below
  const pBoth = binomSurvival(broad, N, P_BOTH);
  // Exact size of a window's test on a fair seed: the binomial mass of every win count it rejects.
  // log-pmf by recurrence, so 9,950 trials neither underflow nor cost a factorial per count.
  const windowSize = (n: number, alpha: number): number => {
    const lq = Math.log(theoWin / (1 - theoWin));
    let lpmf = n * Math.log(1 - theoWin), size = 0;
    for (let w = 0; w <= n; w++) {
      if (w > 0) lpmf += Math.log(n - w + 1) - Math.log(w) + lq;
      if (chiSquaredTest([w, n - w], [theoWin * n, (1 - theoWin) * n]).pValue < alpha) size += Math.exp(lpmf);
    }
    return size;
  };
  const exact = {
    early05: windowSize(EARLY, P_WIN), late05: windowSize(LATE, P_WIN), total01: windowSize(TOTAL, P_TEST_A),
    early001: windowSize(EARLY, P_SEVERE), late001: windowSize(LATE, P_SEVERE),
  };
  const rate = (k: number, model: number, ex: number) => ({ k, model: binomSurvival(k, N, model), exact: binomSurvival(k, N, ex) });
  const falseAlarm = {
    testAFail:      rate(testAFailK,  P_TEST_A,      exact.total01),
    testBFlag:      rate(testBFlagK,  P_WIN,         exact.early05 * (1 - exact.late05)),
    testBFail:      rate(testBFailK,  P_WIN,         exact.early05 * (1 - exact.late05)),
    bothWindowFlag: rate(bothFlagK,   P_BOTH,        exact.early05 * exact.late05),
    bothWindowFail: rate(bothFailK,   P_BOTH,        exact.early05 * exact.late05),
    severeFail:     rate(severeFailK, P_BOTH_SEVERE, exact.early001 * exact.late001),
  };
  const capped = (r: { model: number; exact: number }, cap: number) => r.model < cap && r.exact < cap;
  const overCap = [
    ...(['testBFlag', 'bothWindowFlag'] as const).filter(n => !capped(falseAlarm[n], CAP_FLAG)),
    ...(['testAFail', 'testBFail', 'bothWindowFail', 'severeFail'] as const).filter(n => !capped(falseAlarm[n], CAP_FAIL)),
  ];
  // A rule over its cap may not move the verdict, and a step whose rules cannot be scored is not a PASS.
  const ruleIssues = overCap.length > 0
    ? [`rules whose false-alarm rate on a fair game exceeds the cap (5% FLAG, 1% FAIL): ${overCap.join(', ')}`] : [];

  const integrityOk = s19Issues.length === 0 && ruleIssues.length === 0;
  // Counts against the thresholds printed in the detail: a count at or above its k has a binomial tail
  // below the rule's level (pB < 0.05 ⟺ flags >= testBFlagK, and so on), so the printed k IS the rule.
  const verdict: 'PASS' | 'FLAG' | 'FAIL' =
    !integrityOk || testA >= testAFailK || flags >= testBFailK || broad >= bothFailK || broadSevere >= severeFailK ? 'FAIL'
    : flags >= testBFlagK || broad >= bothFlagK ? 'FLAG'
    : 'PASS';
  const broadList = broadSeeds.map(b =>
    `${b.serverSeedHashed.slice(0, 8)}… client seed ${b.clientSeed} (early ${b.earlyWins}/${EARLY} p=${b.earlyP.toFixed(6)}, `
    + `late ${b.lateWins.toLocaleString('en-US')}/${LATE.toLocaleString('en-US')} p=${b.lateP.toFixed(6)})`).join('; ');
  const pct = (x: number) => `${(x * 100).toPrecision(2)}%`;
  const fa = (r: { model: number; exact: number }) => `${pct(r.model)} / ${pct(r.exact)}`;
  const s19 = step(19, 'Simulation Results — Pass 2 Cherry-Pick Test', verdict,
    integrityOk
      ? `${N} seeds × difficulty=2 (dpc=3), one step on tile ${SIM_FIRST_STEP_TILE} (the first stepped tile of all ${(ctx.bets.length + ctx.phaseE.length).toLocaleString('en-US')} captured rounds), every row bound to a dataset epoch, ${N} early windows replayed from the revealed seeds; `
        + `Test A: ${testA}/${N} fails, binomial p=${pAbn.toFixed(3)} (FAIL at p<0.01: ${testAFailK} or more of ${N}); `
        + `Test B: ${flags}/${N} isolated-early flags, binomial p=${pB.toFixed(3)} (FLAG at p<0.05: ${testBFlagK} or more; FAIL at p<0.01: ${testBFailK} or more); `
        + `both windows at p<0.05: ${broad}/${N} seed${broad === 1 ? '' : 's'}${broad > 0 ? ` [${broadList}]` : ''}, count p=P(K>=${broad} | Binomial(${N}, 0.05×0.05))=${pBoth.toFixed(4)} (FLAG at p<0.05: ${bothFlagK} or more of ${N}; FAIL at p<0.01: ${bothFailK} or more); `
        + `both windows at p<0.001: ${broadSevere}/${N} (FAIL at ${severeFailK} or more); `
        + `false-alarm rate on a fair game, rule's model / exact discrete window sizes (caps 5% FLAG, 1% FAIL): Test A FAIL ${fa(falseAlarm.testAFail)}; Test B FLAG ${fa(falseAlarm.testBFlag)}, FAIL ${fa(falseAlarm.testBFail)}; `
        + `both-window count FLAG ${fa(falseAlarm.bothWindowFlag)}, FAIL ${fa(falseAlarm.bothWindowFail)}; both windows at p<0.001 FAIL ${fa(falseAlarm.severeFail)}; `
        + `${verdict === 'PASS'
          ? `no cherry-picking detected${broad > 0 ? `; the seed${broad === 1 ? '' : 's'} off in both windows ${broad === 1 ? 'is' : 'are'} a disclosed observation, within the count a fair game produces` : ''}`
          : verdict === 'FLAG' ? 'INVESTIGATE: a statistical deviation, which on its own does not establish manipulation' : 'BIASED SEED SELECTION'}`
      : s19Issues.length > 0
        ? `PASS-2 ARTIFACT DOES NOT RECOMPUTE: ${[...s19Issues, ...ruleIssues].join('; ')}`
        : `PASS-2 RULES NOT SCORABLE: ${ruleIssues.join('; ')}`,
    { seedsTested: N, firstStepTile: SIM_FIRST_STEP_TILE, capturedRoundsFirstStepNotThatTile: firstStepOther,
      testAFails: testA, testABinomialP: pAbn, cherryPickFlags: flags, testBBinomialP: pB,
      broadBoth05: broad, broadBoth05CountP: pBoth, broadBoth001: broadSevere,
      thresholds: { testAFailAt: testAFailK, testBFlagAt: testBFlagK, testBFailAt: testBFailK,
        bothWindowFlagAt: bothFlagK, bothWindowFailAt: bothFailK, bothWindowSevereFailAt: severeFailK },
      exactWindowSizes: exact, falseAlarm,
      // Not a rule: scoring any one seed off in both windows as a FLAG, at the same two rates. Over the
      // 5% cap, which is why the count is scored.
      perSeedBothWindowFlagNotUsed: rate(1, P_BOTH, exact.early05 * exact.late05),
      broadSeeds, broadSeedsNote: 'disclosed observation: each seed off in both windows at p<0.05; the count, not the seed, is scored',
      earlyWindowsReplayed: N - rowShape, issues: [...s19Issues, ...ruleIssues] },
  );

  return [s18, s19];
}
