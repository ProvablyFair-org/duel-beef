/**
 * Two-pass Monte Carlo simulation for Duel.com Beef (cross-road) audit.
 *
 * Pass 1 — Fresh random seeds (4 configs × 1,000,000 rounds = 4M rounds).
 *   Grid: 20 tiles. Difficulty levels: 1,2,3,4 with deathPointsCount 1,3,5,10.
 *   Strategy: reveal tile (nonce % 20). Win if tile is NOT a death point.
 *   Payout: theoreticalMultiplier(dpc, 1, 0.008) on win, 0 on loss.
 *   Theoretical RTP per config: survivalProb(m, 1) × payoutMult(m, 1) = 0.992 for all m.
 *   Chi-squared on 20-bin death position frequencies, serial independence per config.
 *
 * Pass 2 — Casino seeds (10,000 nonces per revealed seed, difficulty=2 / MEDIUM).
 *   Test A: chi-squared on full nonce range vs binomial win/loss at ~85% win rate.
 *   Test B: early epoch (0–49) vs late (50–9999) — cherry-pick detection.
 *
 * Output: outputs/simulation-results.json, outputs/rtp-convergence.html
 */

import * as fs   from 'fs';
import * as path from 'path';

import { computeDeathPointsFromBuffer, theoreticalMultiplier, survivalProbability,
         GRID_SIZE, HOUSE_EDGE, DEATH_POINTS_BY_DIFFICULTY } from './rng';
import { chiSquaredTest, lag1Autocorrelation, runsTest }     from './stats';
import { loadDataset, buildSeedMap }                          from './loader';

// ── Constants ────────────────────────────────────────────────────────────────

const DIFFICULTIES: Array<1|2|3|4> = [1, 2, 3, 4];
const ROUNDS_PER_CONFIG   = 1_000_000;
const NONCES_PER_SEED     = 10_000;
const EPOCH_LENGTH        = 50;
const THEORETICAL_RTP     = 1 - HOUSE_EDGE; // 0.992
const CONVERGENCE_SAMPLES = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

// Representative difficulty for Pass 2 — MEDIUM (deathPointsCount=3) gives
// 85% first-step win chance, a good balance of sample size and variance.
const PASS2_DIFFICULTY = 2 as const;
const PASS2_DPC        = DEATH_POINTS_BY_DIFFICULTY[PASS2_DIFFICULTY];

// ── Pinned simulation seeds — one unique pair per config (4 total) ──────────
// Generated via crypto.randomBytes(32) / crypto.randomBytes(16). Pinned so the
// simulation output is reproducible across runs.
const SIM_SEEDS: Array<{ server: string; client: string }> = [
  { server: 'e33ac56577654adb77e9ed4cad54142bb99f12a85b93ac4b473ec687631d584a', client: '857902ce8e141aff4bd073ede94cc708' },
  { server: 'e2a6b8999929cb7a99313e7e8030c77913f656bdcd8b13e4138a7d83732f1018', client: '788fd3d35a196357da74e1f89a82bbaf' },
  { server: 'e7fd02dd9662ad142310ab99a02ba70692d2a38b1024ccbbe9001d6633f01f45', client: '29cbc576e54475c5b5f835103da9bda4' },
  { server: '3dda4af8d5357e02c72cd519b926edda4dfc778d6bdca163da3041b0b3889bf9', client: '0c013271e4ef52b6b1a2b438b92a1bb2' },
];

// ── Progress bar ────────────────────────────────────────────────────────────

const SPINNER = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
let spinIdx = 0;
let lastProgressLine = '';
let spinnerTimer: ReturnType<typeof setInterval> | null = null;

function startSpinner(): void {
  if (spinnerTimer) return;
  spinnerTimer = setInterval(() => {
    if (!lastProgressLine) return;
    spinIdx++;
    const spin = SPINNER[spinIdx % SPINNER.length];
    const updated = lastProgressLine.replace(/^(\r  )./, `$1${spin}`);
    process.stdout.write(updated);
  }, 120);
}
function stopSpinner(): void { if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; } }

function progressBar(current: number, total: number, label: string, startMs: number, width = 30): void {
  const ratio   = Math.min(total > 0 ? current / total : 0, 1);
  const filled  = Math.round(ratio * width);
  const bar     = '\u2501'.repeat(filled) + '\u254C'.repeat(width - filled);
  const pct     = (ratio * 100).toFixed(0).padStart(3);
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const eta     = current > 0 ? (((Date.now() - startMs) / current) * (total - current) / 1000).toFixed(0) : '?';
  const spin    = SPINNER[spinIdx % SPINNER.length];
  lastProgressLine = `\r  ${spin} ${bar} ${pct}% | ${current}/${total} | ${label} | ${elapsed}s elapsed ~ ${eta}s left`;
  process.stdout.write(lastProgressLine);
}
function clearLine(): void { process.stdout.write('\r\x1b[K'); }

// ── Binomial helpers for Pass 2 verdicts ────────────────────────────────────

function binomSurvival(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let cdf = 0;
  for (let i = 0; i < k; i++) cdf += binomPMF(i, n, p);
  return Math.max(0, 1 - cdf);
}
function binomPMF(k: number, n: number, p: number): number {
  let logP = 0;
  for (let i = 0; i < k; i++) logP += Math.log(n - i) - Math.log(i + 1);
  logP += k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logP);
}

// ══════════════════════════════════════════════════════════════════════════════
//  PASS 1 — Fresh Seeds
// ══════════════════════════════════════════════════════════════════════════════

console.log('\u2550'.repeat(60));
console.log('  PASS 1 \u2014 Fresh random seeds');
console.log(`  ${DIFFICULTIES.length} configs (difficulties 1\u20134) \u00d7 ${ROUNDS_PER_CONFIG.toLocaleString()} rounds`);
console.log('\u2550'.repeat(60) + '\n');

interface Pass1Result {
  difficulty:       number;
  deathPointsCount: number;
  theoreticalRTP:   number;
  simulatedRTP:     number;
  winRate:          number;
  theoreticalWin:   number;
  positionChi2:     number;
  positionDf:       number;
  positionPValue:   number;
  r1:               number;
  r1Z:              number;
  runsZ:            number;
  runsPValue:       number;
  rtpSnapshots:     Map<number, number>;
}

const pass1Results: Pass1Result[] = [];
const pass1Start = Date.now();
progressBar(0, DIFFICULTIES.length, 'starting...', pass1Start);
startSpinner();

for (let ci = 0; ci < DIFFICULTIES.length; ci++) {
  const difficulty = DIFFICULTIES[ci];
  const dpc        = DEATH_POINTS_BY_DIFFICULTY[difficulty];
  const theoWin    = survivalProbability(dpc, 1);       // P(safe step 1) = (20 - m) / 20
  const mult       = theoreticalMultiplier(dpc, 1, HOUSE_EDGE);
  const theoRTP    = theoWin * mult;                     // should be 0.992

  const seedPair  = SIM_SEEDS[ci];
  const keyBuffer = Buffer.from(seedPair.server, 'hex');

  // 20-bin death position frequency counter
  const positionFreq = new Array(GRID_SIZE).fill(0);
  const winSequence: number[] = new Array(ROUNDS_PER_CONFIG);
  let totalPayout = 0;
  let totalWins   = 0;

  const sampleSet    = new Set(CONVERGENCE_SAMPLES.filter(s => s <= ROUNDS_PER_CONFIG));
  const rtpSnapshots = new Map<number, number>();

  for (let nonce = 0; nonce < ROUNDS_PER_CONFIG; nonce++) {
    const deaths = computeDeathPointsFromBuffer(keyBuffer, seedPair.client, nonce, dpc);
    for (const pos of deaths) positionFreq[pos]++;

    const revealTile = nonce % GRID_SIZE;
    const deathSet   = new Set(deaths);
    const won        = !deathSet.has(revealTile);

    if (won) { totalWins++; totalPayout += mult; }
    winSequence[nonce] = won ? 1 : 0;

    const roundNum = nonce + 1;
    if (sampleSet.has(roundNum)) rtpSnapshots.set(roundNum, totalPayout / roundNum);
  }

  const simRTP   = totalPayout / ROUNDS_PER_CONFIG;
  const winRate  = totalWins / ROUNDS_PER_CONFIG;

  const expectedPerBin = (dpc / GRID_SIZE) * ROUNDS_PER_CONFIG;
  const expectedCounts = new Array(GRID_SIZE).fill(expectedPerBin);
  const { chi2: posChi2, df: posDf, pValue: posPValue } = chiSquaredTest([...positionFreq], expectedCounts);

  const r1 = lag1Autocorrelation(winSequence);
  const r1Z = r1 * Math.sqrt(ROUNDS_PER_CONFIG);
  const { z: runsZ, pValue: runsP } = runsTest(winSequence);

  pass1Results.push({
    difficulty, deathPointsCount: dpc,
    theoreticalRTP: theoRTP, simulatedRTP: simRTP, winRate, theoreticalWin: theoWin,
    positionChi2: posChi2, positionDf: posDf, positionPValue: posPValue,
    r1, r1Z, runsZ, runsPValue: runsP, rtpSnapshots,
  });

  progressBar(ci + 1, DIFFICULTIES.length, `diff=${difficulty}`, pass1Start);
}

stopSpinner();
clearLine();
progressBar(DIFFICULTIES.length, DIFFICULTIES.length, 'done', pass1Start);
process.stdout.write('\n');

// ── Convergence data ────────────────────────────────────────────────────────

interface ConvergencePoint { roundsPerConfig: number; label: string; meanRTP: number; stdDev: number; }
const convergenceData: ConvergencePoint[] = [];

for (const sampleN of CONVERGENCE_SAMPLES) {
  const rtpValues: number[] = [];
  for (const r of pass1Results) {
    const rtp = r.rtpSnapshots.get(sampleN);
    if (rtp !== undefined) rtpValues.push(rtp);
  }
  if (rtpValues.length === 0) continue;

  const mean = rtpValues.reduce((a, b) => a + b, 0) / rtpValues.length;
  const variance = rtpValues.length > 1
    ? rtpValues.reduce((a, b) => a + (b - mean) ** 2, 0) / (rtpValues.length - 1)
    : 0;

  const label = sampleN >= 1_000_000 ? `${(sampleN / 1e6).toFixed(0)}M`
              : sampleN >= 1_000     ? `${(sampleN / 1e3).toFixed(0)}K`
                                     : `${sampleN}`;

  const stdErr = rtpValues.length > 1 ? Math.sqrt(variance) / Math.sqrt(rtpValues.length) : 0;
  convergenceData.push({ roundsPerConfig: sampleN, label, meanRTP: mean, stdDev: stdErr });
}

// ── Pass 1 summary ──────────────────────────────────────────────────────────

const pass1ElapsedMs      = Date.now() - pass1Start;
const pass1Chi2Fails      = pass1Results.filter(r => r.positionPValue < 0.01).length;
const bonAlpha            = 0.01 / DIFFICULTIES.length;
const pass1Chi2FailsBon   = pass1Results.filter(r => r.positionPValue < bonAlpha).length;
const pass1SerialFails    = pass1Results.filter(r => Math.abs(r.r1Z) > 3 || r.runsPValue < 0.01).length;
const pass1AvgRTP         = pass1Results.reduce((a, r) => a + r.simulatedRTP, 0) / pass1Results.length;
const pass1AvgTheoRTP     = pass1Results.reduce((a, r) => a + r.theoreticalRTP, 0) / pass1Results.length;

console.log(`\n  Avg simulated RTP:   ${(pass1AvgRTP * 100).toFixed(4)}%`);
console.log(`  Avg theoretical RTP: ${(pass1AvgTheoRTP * 100).toFixed(4)}%`);
console.log(`  FWER: Bonferroni \u03b1/N = ${bonAlpha.toFixed(6)} (N=${DIFFICULTIES.length})`);
console.log(`  Position chi-squared fails: ${pass1Chi2Fails}/${DIFFICULTIES.length} at \u03b1=0.01 \u00b7 ${pass1Chi2FailsBon}/${DIFFICULTIES.length} at Bonferroni`);
console.log(`  Serial independence fails: ${pass1SerialFails}/${DIFFICULTIES.length} (|r\u2081z|>3 or runs p<0.01)`);
console.log(`  Time: ${(pass1ElapsedMs / 1000).toFixed(1)}s\n`);

// ══════════════════════════════════════════════════════════════════════════════
//  PASS 2 — Casino Seeds
// ══════════════════════════════════════════════════════════════════════════════

console.log('\u2550'.repeat(60));
console.log('  PASS 2 \u2014 Casino seeds');

const dataset  = loadDataset();
const seedMap  = buildSeedMap(dataset.seeds);

const clientSeedForHash = new Map<string, string>();
for (const [hash] of seedMap) {
  const counts = new Map<string, number>();
  for (const bet of dataset.bets) {
    if (bet.seed.serverSeedHashed === hash) {
      const cs = bet.seed.clientSeed;
      counts.set(cs, (counts.get(cs) || 0) + 1);
    }
  }
  if (counts.size > 0) {
    let bestCS = '', bestCount = 0;
    for (const [cs, count] of counts) {
      if (count > bestCount) { bestCS = cs; bestCount = count; }
    }
    clientSeedForHash.set(hash, bestCS);
  }
}

const theoWinPass2 = survivalProbability(PASS2_DPC, 1);
const multPass2    = theoreticalMultiplier(PASS2_DPC, 1, HOUSE_EDGE);
const seedEntries  = Array.from(seedMap.entries());

console.log(`  ${seedEntries.length} revealed seeds \u00d7 difficulty=${PASS2_DIFFICULTY} (dpc=${PASS2_DPC}, ${(theoWinPass2 * 100).toFixed(1)}% win rate)`);
console.log(`  ${NONCES_PER_SEED.toLocaleString()} nonces per seed (early: 0\u2013${EPOCH_LENGTH - 1}, late: ${EPOCH_LENGTH}\u2013${NONCES_PER_SEED - 1})`);
console.log('\u2550'.repeat(60) + '\n');

interface Pass2Result {
  serverSeedHashed: string;
  clientSeed:       string;
  difficulty:       number;
  deathPointsCount: number;
  earlyWins:        number;
  earlyTotal:       number;
  earlyP:           number;
  lateWins:         number;
  lateTotal:        number;
  lateP:            number;
  testA_chi2_fail:  boolean;
  cherry_pick_flag: boolean;
}

const pass2Results: Pass2Result[] = [];
let testAFails      = 0;
let cherryPickFlags = 0;

const pass2Start = Date.now();
progressBar(0, seedEntries.length, 'starting...', pass2Start);
startSpinner();

for (let si = 0; si < seedEntries.length; si++) {
  const [hash, serverSeed] = seedEntries[si];
  const clientSeed = clientSeedForHash.get(hash) || 'auditSeed';
  const keyBuf     = Buffer.from(serverSeed, 'hex');

  let earlyWins = 0;
  let lateWins  = 0;

  for (let nonce = 0; nonce < NONCES_PER_SEED; nonce++) {
    const deaths    = computeDeathPointsFromBuffer(keyBuf, clientSeed, nonce, PASS2_DPC);
    const deathSet  = new Set(deaths);
    const revealTile = nonce % GRID_SIZE;
    const won       = !deathSet.has(revealTile);

    if (won) {
      if (nonce < EPOCH_LENGTH) earlyWins++;
      else lateWins++;
    }
  }

  const totalWins = earlyWins + lateWins;
  const { pValue: pA } = chiSquaredTest(
    [totalWins, NONCES_PER_SEED - totalWins],
    [theoWinPass2 * NONCES_PER_SEED, (1 - theoWinPass2) * NONCES_PER_SEED],
  );
  const testA_fail = pA < 0.01;
  if (testA_fail) testAFails++;

  const lateCount = NONCES_PER_SEED - EPOCH_LENGTH;
  const { pValue: pEarly } = chiSquaredTest(
    [earlyWins, EPOCH_LENGTH - earlyWins],
    [theoWinPass2 * EPOCH_LENGTH, (1 - theoWinPass2) * EPOCH_LENGTH],
  );
  const { pValue: pLate } = chiSquaredTest(
    [lateWins, lateCount - lateWins],
    [theoWinPass2 * lateCount, (1 - theoWinPass2) * lateCount],
  );
  const cherry_pick_flag = pEarly < 0.05 && pLate >= 0.05;
  if (cherry_pick_flag) cherryPickFlags++;

  pass2Results.push({
    serverSeedHashed: hash, clientSeed,
    difficulty: PASS2_DIFFICULTY, deathPointsCount: PASS2_DPC,
    earlyWins, earlyTotal: EPOCH_LENGTH, earlyP: pEarly,
    lateWins,  lateTotal:  lateCount,    lateP:  pLate,
    testA_chi2_fail: testA_fail, cherry_pick_flag,
  });

  progressBar(si + 1, seedEntries.length, `seed ${si + 1}/${seedEntries.length}`, pass2Start);
}

stopSpinner();
clearLine();
progressBar(seedEntries.length, seedEntries.length, 'done', pass2Start);
process.stdout.write('\n');

const pass2ElapsedMs = Date.now() - pass2Start;
const N = pass2Results.length;

const testAPValue    = binomSurvival(testAFails, N, 0.01);
const testAVerdict   = testAPValue >= 0.01 ? 'PASS' : 'FAIL';
const cherryPValue   = binomSurvival(cherryPickFlags, N, 0.05);
const cherryVerdict  = cherryPValue >= 0.01 ? 'PASS' : 'FAIL';

console.log(`\n  Seeds tested: ${seedEntries.length}`);
console.log(`  Test A fails (p<0.01): ${testAFails} / ${N} \u2014 binomial p=${testAPValue.toFixed(4)} [${testAVerdict}]`);
console.log(`  Cherry-pick flags: ${cherryPickFlags} / ${N} \u2014 binomial p=${cherryPValue.toFixed(4)} [${cherryVerdict}]`);
console.log(`  Time: ${(pass2ElapsedMs / 1000).toFixed(1)}s\n`);

// ══════════════════════════════════════════════════════════════════════════════
//  Write output
// ══════════════════════════════════════════════════════════════════════════════

const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

const pass1Serializable = pass1Results.map(r => ({
  difficulty:       r.difficulty,
  deathPointsCount: r.deathPointsCount,
  theoreticalRTP:   r.theoreticalRTP,
  simulatedRTP:     r.simulatedRTP,
  winRate:          r.winRate,
  theoreticalWin:   r.theoreticalWin,
  positionChi2:     r.positionChi2,
  positionDf:       r.positionDf,
  positionPValue:   r.positionPValue,
  r1:               r.r1,
  r1Z:              r.r1Z,
  runsZ:            r.runsZ,
  runsPValue:       r.runsPValue,
}));

const output = {
  generatedAt: new Date().toISOString(),
  pass1_fresh_seeds: {
    description: 'Auditor-generated random seeds. Validates independent implementation, death-point position uniformity, and serial independence.',
    configs:                 DIFFICULTIES.length,
    roundsPerConfig:         ROUNDS_PER_CONFIG,
    totalRounds:             DIFFICULTIES.length * ROUNDS_PER_CONFIG,
    executionTimeMs:         pass1ElapsedMs,
    avgTheoreticalRTP:       pass1AvgTheoRTP,
    avgSimulatedRTP:         pass1AvgRTP,
    chi2FailsAtAlpha01:      pass1Chi2Fails,
    chi2FailsBonferroni:     pass1Chi2FailsBon,
    bonferroniAlpha:         bonAlpha,
    serialIndependenceFails: pass1SerialFails,
    convergence:             convergenceData,
    results:                 pass1Serializable,
  },
  pass2_casino_seeds: {
    description: 'Revealed casino server seeds from capture dataset. Tests whether seed selection produces biased distributions over the first epoch vs later nonces (cherry-picking detection).',
    seeds_tested:                 seedEntries.length,
    difficulty:                   PASS2_DIFFICULTY,
    death_points_count:           PASS2_DPC,
    theoretical_win_chance:       theoWinPass2,
    nonces_per_seed:              NONCES_PER_SEED,
    epoch_length:                 EPOCH_LENGTH,
    test_a_chi2_fails_at_alpha01: testAFails,
    test_a_binomial_pValue:       testAPValue,
    test_a_verdict:               testAVerdict,
    test_b_cherry_pick_flags:     cherryPickFlags,
    test_b_binomial_pValue:       cherryPValue,
    test_b_verdict:               cherryVerdict,
    executionTimeMs:              pass2ElapsedMs,
    results:                      pass2Results,
  },
};

fs.writeFileSync(path.join(OUTPUTS_DIR, 'simulation-results.json'), JSON.stringify(output, null, 2));

// ── RTP convergence chart ───────────────────────────────────────────────────

const finalPoint = convergenceData[convergenceData.length - 1];
const finalRTP   = finalPoint.meanRTP;

const chartHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DUEL.COM BEEF RTP CONVERGENCE \u2014 ${DIFFICULTIES.length} CONFIGS x 1M ROUNDS EACH</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; padding: 24px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  h1 { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 24px; }
  .chart-wrap { position: relative; height: 420px; }
  .final-box { display: inline-block; border: 2px solid #4caf50; border-radius: 8px; padding: 10px 20px; margin-top: 20px; }
  .final-box .label { font-size: 13px; color: #666; }
  .final-box .value { font-size: 22px; font-weight: 700; color: #2e7d32; }
  .final-box .check { color: #4caf50; font-size: 18px; }
  .legend { text-align: center; margin-top: 12px; font-size: 13px; color: #666; }
  .legend span { margin: 0 12px; }
  .legend .dot { display: inline-block; width: 12px; height: 3px; vertical-align: middle; margin-right: 4px; }
</style>
</head>
<body>
<div class="container">
  <h1>DUEL.COM BEEF RTP CONVERGENCE \u2014 ${DIFFICULTIES.length} CONFIGS x 1M ROUNDS EACH</h1>
  <div class="chart-wrap"><canvas id="chart"></canvas></div>
  <div class="legend">
    <span><span class="dot" style="background:#1565c0;height:3px"></span> Mean RTP (${DIFFICULTIES.length} configs)</span>
    <span><span class="dot" style="background:rgba(229,115,115,0.5);height:3px"></span> \u00b12 SE</span>
    <span><span class="dot" style="background:#e57373;border-top:2px dashed #e57373;height:0"></span> Theoretical (${(THEORETICAL_RTP * 100).toFixed(1)}%)</span>
  </div>
  <div style="text-align:right; margin-top:8px;">
    <div class="final-box">
      <span class="label">Final Mean RTP:</span>
      <span class="value">${(finalRTP * 100).toFixed(3)}%</span>
      <span class="check">&#10003;</span>
    </div>
  </div>
</div>
<script>
const data = ${JSON.stringify(convergenceData.map(d => ({
  x: d.roundsPerConfig, y: d.meanRTP * 100, sd: d.stdDev * 100, label: d.label,
})))};
const theoretical = ${(THEORETICAL_RTP * 100).toFixed(6)};
const labels = data.map(d => d.label);
const ctx = document.getElementById('chart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: {
    labels,
    datasets: [
      { label: 'Upper band', data: data.map(d => d.y + d.sd * 2), borderColor: 'transparent', backgroundColor: 'rgba(229,115,115,0.08)', fill: '+1', pointRadius: 0, tension: 0.3 },
      { label: 'Lower band', data: data.map(d => d.y - d.sd * 2), borderColor: 'transparent', backgroundColor: 'rgba(229,115,115,0.08)', fill: false, pointRadius: 0, tension: 0.3 },
      { label: '\u00b12 SE (upper)', data: data.map(d => d.y + d.sd), borderColor: 'rgba(229,115,115,0.4)', borderWidth: 1, fill: false, pointRadius: 0, tension: 0.3 },
      { label: '\u00b12 SE (lower)', data: data.map(d => d.y - d.sd), borderColor: 'rgba(229,115,115,0.4)', borderWidth: 1, fill: false, pointRadius: 0, tension: 0.3 },
      { label: 'Theoretical', data: data.map(() => theoretical), borderColor: '#e57373', borderWidth: 2, borderDash: [8, 4], fill: false, pointRadius: 0 },
      { label: 'Mean RTP', data: data.map(d => d.y), borderColor: '#1565c0', borderWidth: 2.5, fill: false, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: '#1565c0', tension: 0.3 },
      { label: 'Final', data: data.map((d, i) => i === data.length - 1 ? d.y : null), borderColor: '#1565c0', backgroundColor: '#1565c0', pointRadius: 6, pointHoverRadius: 8, showLine: false },
    ],
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => data[items[0].dataIndex].label + ' rounds/config',
          label: (item) => {
            if (item.datasetIndex === 5) return 'Mean RTP: ' + item.parsed.y.toFixed(4) + '%';
            if (item.datasetIndex === 4) return 'Theoretical: ' + theoretical.toFixed(4) + '%';
            return null;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: 'Rounds per Config', font: { size: 12 } }, ticks: { maxTicksLimit: 10 } },
      y: { title: { display: false }, ticks: { callback: v => v.toFixed(1) + '%' } },
    },
  },
});
<\/script>
</body>
</html>`;

fs.writeFileSync(path.join(OUTPUTS_DIR, 'rtp-convergence.html'), chartHTML);

console.log('\u2550'.repeat(60));
console.log('  Written: outputs/simulation-results.json');
console.log('  Written: outputs/rtp-convergence.html');
console.log('\u2550'.repeat(60) + '\n');
