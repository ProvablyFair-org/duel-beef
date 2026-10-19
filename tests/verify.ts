/**
 * Beef audit verification suite — 25 scored steps + informational items.
 * Steps 1–19: primary dataset (6,000 bets, phases A–D)
 * Steps 20–22: Phase E multi-step verification (450 bets)
 * Step 23:     artifact integrity (pinned artifacts of record + value domains)
 * Step 24:     multiplier monotonicity & bounds (FLAG-only, BEEF-14)
 * Step 25:     live-sample fit (informational: a deviation is INFO, never counted, BEEF-22)
 * Run: npm run verify
 * Expected: 24/25 PASS + 1 capture-origin FLAG (step 4, the two capture-retry nonce gaps, one per data file),
 * verdict PROVABLY FAIR — Full Pass, exit 0. A capture-origin FLAG is disclosed, verdict-neutral. Step 19
 * passes with one of 121 casino seeds off in both Pass 2 windows at p < 0.05, disclosed as an observation:
 * the step scores the count of such seeds (FLAG at 2, FAIL at 3), and at least one is what a fair game
 * produces about 26% of the time.
 */

import * as fs   from 'fs';
import * as path from 'path';

import { loadDataset, checkDatasetHash, buildSeedMap, groupByHash, loadPhaseE, checkPhaseEHash } from '../src/loader';
import type { VerifyContext, InfoItem }                 from './steps/context';

import * as commitment  from './steps/commitment';
import * as determinism from './steps/determinism';
import * as payouts     from './steps/payouts';
import * as statistical from './steps/statistical';
import * as dataset     from './steps/dataset';
import * as simulation  from './steps/simulation';
import * as multireveal from './steps/multireveal';
import * as artifacts   from './steps/artifacts';
import * as monotonicity from './steps/monotonicity';
import * as liveFit     from './steps/live-fit';
import { labelFor, profileCoverageBlock } from '../src/profile-map';
import { runRtpClaimGate, RTP_CLAIM_STEP } from '../src/rtp-settings';
import { rtpClaimVerdict, RTP_FIGURE_OVERSTATED, RTP_FIGURE_OVERSTATED_EXIT } from '../src/rtp-claim';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from '../src/diff';

// ── Pre-flight: dataset hashes ─────────────────────────────────────────────────
// Printed here, SCORED in Step 14. The pre-flight used to `process.exit(1)` on a mismatch, which
// made Step 14's own failure branch unreachable: the step could only ever print PASS. A mismatch
// now runs the suite to completion and Step 14 records it as a hard FAIL (verdict NOT PROVABLY
// FAIR, exit 1), so the verdict and the exit code carry it rather than a line that scrolled by.
// The one thing a mismatched dataset must never do is overwrite the committed evidence, so
// PF_EMIT=1 still refuses to run on one.

const hashCheck = checkDatasetHash();
console.log('\n  Dataset hash check:');
console.log(`    Expected: ${hashCheck.expected || '(not set)'}`);
console.log(`    Actual:   ${hashCheck.actual}`);
console.log(`    Status:   ${hashCheck.match ? 'MATCH ✓' : 'MISMATCH ✗ — scored as a FAIL in Step 14'}\n`);

const phaseEHash = checkPhaseEHash();
console.log('  Phase E hash check:');
console.log(`    Expected: ${phaseEHash ? phaseEHash.expected : '(file absent)'}`);
console.log(`    Actual:   ${phaseEHash ? phaseEHash.actual : '(file absent)'}`);
console.log(`    Status:   ${phaseEHash?.match ? 'MATCH ✓' : 'MISMATCH ✗ — scored as a FAIL in Step 14'}\n`);

if (process.env.PF_EMIT === '1' && !(hashCheck.match && phaseEHash?.match)) {
  console.log('  PF_EMIT=1 refused: a dataset that does not match its pin must not rewrite the committed evidence.');
  process.exit(1);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const ds      = loadDataset();
const phaseE  = loadPhaseE();
const allSeeds = phaseE ? [...ds.seeds, ...phaseE.seeds] : ds.seeds;
const seedMap = buildSeedMap(allSeeds);

const bets   = ds.bets;
const seeds  = ds.seeds;
const phaseA = bets.filter(b => b.phase === 'A');
const phaseB = bets.filter(b => b.phase === 'B');
const phaseC = bets.filter(b => b.phase === 'C');
const phaseD = bets.filter(b => b.phase === 'D');
const phaseEBets = phaseE ? phaseE.bets : [];

const outputsDir = path.join(__dirname, '../outputs');

console.log('══════════════════════════════════════════════════════════');
console.log('  BEEF AUDIT — VERIFICATION SUITE');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Dataset: ${bets.length} bets  |  Seeds: ${seeds.length}`);
console.log(`  Phase A: ${phaseA.length}  Phase B: ${phaseB.length}  Phase C: ${phaseC.length}  Phase D: ${phaseD.length}`);
if (phaseEBets.length > 0) {
  console.log(`  Phase E: ${phaseEBets.length} multi-step bets (seeds: ${phaseE!.seeds.length})`);
}
console.log('');

// ── Build context ─────────────────────────────────────────────────────────────

const byHash = groupByHash(bets);

const ctx: VerifyContext = {
  bets, seeds, seedMap, byHash,
  phaseA, phaseB, phaseC, phaseD,
  phaseE: phaseEBets,
  phaseESeeds: phaseE ? phaseE.seeds : [],
  outputsDir,
  step5Mismatches: 0,
  step5Skipped:    0,
  chiResultsLog:   [],
};

// ── Run scored steps ─────────────────────────────────────────────────────────

const results = [
  ...commitment.run(ctx),                    // Steps  1– 4
  ...determinism.run(ctx),                   // Steps  5– 6
  ...payouts.run(ctx),                       // Steps  7–12
  ...dataset.run(ctx, phaseEHash),           // Steps 13–17
  ...simulation.run(ctx),                    // Steps 18–19
  ...multireveal.run(phaseEBets, seedMap),   // Steps 20–22 (Phase E)
  ...artifacts.run(ctx),                     // Step  23 (pinned artifacts of record)
  ...monotonicity.run(bets, phaseEBets),     // Step  24 (multiplier monotonicity & bounds, FLAG-only)
  ...liveFit.run(bets, phaseEBets),          // Step  25 (live-sample fit, informational: INFO on a deviation)
];

// ── Run informational items (live-bet stats — underpowered, not scored) ──────

const infoItems: InfoItem[] = statistical.run(ctx);

// ── RTP-CLAIM rule (1.2.0, Methodology v1.1; 1.0.0 agreed on Slack 2026-09-29) ──
// The per-setting exact RTP table held to the published claim (src/rtp-settings.ts). The package
// switch RTP_CLAIM_RULE_ENFORCED is true (D3, 2026-10-14). Status OVERSTATED (a house-side miss) is
// scored on the step carrying BEEF-19 as an operator-origin FLAG (the profile's policy) and the
// verdict becomes RTP FIGURE OVERSTATED, exit 5 (rtpClaimVerdict) — never NOT PROVABLY FAIR: the
// draws themselves pass. Status FAIL means the committed table no longer equals this run (or its
// pin): a reproduction failure, exit 1, whether or not the rule is enforced; no step moves for it.
const rtpClaim = runRtpClaimGate();
console.log('');
for (const line of rtpClaim.lines) console.log(`  ${line}`);
const rtpOverstated = rtpClaim.status === 'OVERSTATED';
if (rtpOverstated) {
  const s = (results as any[]).find(r => r.step === RTP_CLAIM_STEP);
  if (s && s.status !== 'FAIL') {
    s.status = 'FLAG'; delete s.origin;   // operator-origin: this package marks only capture flags
    s.detail += ` — ${RTP_FIGURE_OVERSTATED} (RTP-CLAIM enforced): ${rtpClaim.result.minimalFix}`;
    // The step printed its own line when it ran, before this rule was scored. Print it again at the
    // status it is now counted at, so the console agrees with the summary and the emitted record.
    console.log(`  [FLAG] Step ${s.step} — ${s.name} (re-scored: RTP-CLAIM enforced, ${RTP_FIGURE_OVERSTATED})`);
    console.log(`         ${s.detail}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

const passed   = results.filter(r => r.status === 'PASS').length;
const flags    = results.filter(r => r.status === 'FLAG').length;
const hardFail = results.filter(r => r.status === 'FAIL').length;
// INFO (profile policy INFORMATIONAL — the live-sample fit, Mike 2026-09-29): reported, never counted
// as a flag, never enters the verdict or the exit code.
const informational = results.filter(r => r.status === 'INFO').length;
// A capture-origin FLAG (an auditor-side capture retry that left a nonce gap) is disclosed but
// verdict-neutral; only an operator-origin FLAG downgrades to Conditional Pass. Same rule as Duel
// plinko (adopted 2026-09-22): not a PASS, but not against the verdict either.
const captureFlags  = results.filter(r => r.status === 'FLAG' && r.origin === 'capture');
const operatorFlags = results.filter(r => r.status === 'FLAG' && r.origin !== 'capture');
// Ranked by the rule's rtpClaimVerdict: a failed draw check (NOT PROVABLY FAIR) > RTP FIGURE
// OVERSTATED > Conditional Pass > Full Pass. This suite has no INCOMPLETE state.
const ruled    = rtpClaimVerdict({ fails: hardFail, complete: true, overstated: rtpOverstated, opFlags: operatorFlags.length });
const verdict  = ruled.verdict;

// Display informational items
if (infoItems.length > 0) {
  console.log('');
  console.log('  ┌── Informational Context (not scored) ──');
  for (const item of infoItems) console.log(`  │ ${item.label}: ${item.detail}`);
  console.log('  └──');
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  RESULTS SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Passed:     ${passed}/${results.length}`);
console.log(`  Hard fails: ${hardFail}`);
console.log(`  Flags:      ${flags} (${operatorFlags.length} verdict-affecting, ${captureFlags.length} capture-origin)`);
if (informational > 0) console.log(`  Informational deviations: ${informational} (reported, not counted, verdict unchanged)`);
if (captureFlags.length > 0) {
  console.log('\n  CAPTURE-ORIGIN LIMITATIONS (disclosed, verdict-neutral):');
  for (const r of captureFlags) console.log(`  ⚑ Step ${r.step}: ${r.name}`);
}
console.log(`\n  VERDICT: ${verdict}`);
console.log('══════════════════════════════════════════════════════════\n');

// ── Write output ──────────────────────────────────────────────────────────────

// ARTIFACTS OF RECORD CARRY NO RUN METADATA (profile BEEF-27, rules.reproduction). This object used
// to carry `generatedAt` and the reproduction gate excluded that field by name; it is now ABSENT
// (2026-09-26), so no field is excluded and a regeneration that changes no figure reproduces the bytes.
// Each scored step also says which ProvablyFair.org Beef profile check it implements
// (src/profile-map.ts) — a label on the emitted record only; it cannot change what a step asserts.
const verificationOutput = {
  totalBets:   bets.length + phaseEBets.length,
  totalSeeds:  allSeeds.length,
  steps:       results.map(r => ({ ...r, ...labelFor(r.step) })),
  profileCoverage: profileCoverageBlock(),
  info:        infoItems,
  summary:     { passed, flags, operatorFlags: operatorFlags.length, captureFlags: captureFlags.length, hardFail, verdict },
};

// NO `generatedAt` in the two artifacts below. They are pinned by SHA-256 in src/artifact-pins.ts
// (Step 23), and a run timestamp inside a pinned file means a regeneration can never reproduce
// the pinned bytes even when every figure is identical — which defeats the pin. Run metadata
// belongs to the run record (outputs/run/diff.json carries the runtime); the evidence carries
// the measurement. verification-results.json carries none either (since 2026-09-26).
const determinismOutput = {
  verified:    bets.length - ctx.step5Skipped,
  mismatches:  ctx.step5Mismatches,
  skipped:     ctx.step5Skipped,
};

const chiSquaredOutput = {
  groups:      ctx.chiResultsLog,
};

// A VERIFICATION RUN MUST NOT REWRITE THE ARTIFACT IT SCORES. A run that disagrees with the
// committed evidence would otherwise destroy the evidence of the disagreement, and the next run
// would compare the repo against what the failing run had just written. This run writes under
// outputs/run/ — gitignored, a run record rather than audit evidence. The committed copies in
// outputs/ are refreshed only by PF_EMIT=1 — and because the two pinned ones carry no timestamp,
// a refresh that computes the same result leaves their bytes, and their pins, unchanged.
const PF_EMIT = process.env.PF_EMIT === '1';
const RUN_DIR = path.join(outputsDir, 'run');
const RESULTS_DIR = PF_EMIT ? outputsDir : RUN_DIR;
fs.mkdirSync(outputsDir, { recursive: true });
fs.mkdirSync(RUN_DIR, { recursive: true });

fs.writeFileSync(path.join(RESULTS_DIR, 'verification-results.json'), JSON.stringify(verificationOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'determinism-log.json'), JSON.stringify(determinismOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'chi-squared-results.json'), JSON.stringify(chiSquaredOutput, null, 2));

const WROTE_TO = PF_EMIT ? 'outputs' : 'outputs/run';
console.log(`  Outputs written to: ${WROTE_TO}/verification-results.json`);
console.log(`  Outputs written to: ${WROTE_TO}/determinism-log.json`);
console.log(`  Outputs written to: ${WROTE_TO}/chi-squared-results.json`);
if (!PF_EMIT) console.log('  Committed artifacts NOT modified.');

// ── Reproduction gate ─────────────────────────────────────────────────────────
// THE GATE IS "BEYOND TOLERANCE", NOT "ANY FIELD". Byte identity is the right bar for exact
// content — the dataset, hash-guarded above. It is the wrong bar for a DERIVED statistic:
// recomputed on other hardware a floating-point figure can move by a unit in the last place.
// Scoring that as a disagreement trains a reader to ignore the diff, which is the one outcome
// that makes it useless. The bound is declared in src/diff.ts, far below the precision of any
// figure this audit publishes; outside it is a DIFFERENT result, and the run exits 1.
let reproductionFailures = 0;
if (!PF_EMIT) {
  const readJsonOrNull = (p: string): unknown => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  };
  const targets: { file: string; fresh: unknown }[] = [
    { file: 'verification-results.json', fresh: verificationOutput },
    { file: 'determinism-log.json',      fresh: determinismOutput },
    { file: 'chi-squared-results.json',  fresh: chiSquaredOutput },
  ];
  // test:full regenerates the simulation into outputs/run/ (`npm run simulate` without PF_EMIT); when
  // that regeneration is present it is field-diffed against the pinned committed artifact, so a
  // regeneration that drifts beyond the reproduction tolerance fails here (added 2026-09-26, profile
  // BEEF-28). Plain `npm test` does not regenerate it, so there is nothing to diff.
  const runSim = readJsonOrNull(path.join(RUN_DIR, 'simulation-results.json'));
  if (runSim !== null) targets.push({ file: 'simulation-results.json', fresh: runSim });
  const perFile = targets.map(t => {
    const committed = readJsonOrNull(path.join(outputsDir, t.file));
    // No field is excluded: run metadata is ABSENT from every artifact, not skipped by the diff,
    // so a timestamp that crept back into one would show up here as a difference.
    const diffs = fieldDiff(committed, t.fresh, []);
    return { file: t.file, readable: committed !== null, diffs, real: beyondTolerance(diffs) };
  });
  const allDiffs  = perFile.flatMap(p => p.diffs);
  const realTotal = perFile.reduce((n, p) => n + p.real.length, 0);
  const gap       = maxima(allDiffs);

  fs.writeFileSync(path.join(RUN_DIR, 'diff.json'), JSON.stringify({
    runtime: process.versions.node,
    verdict,
    tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL, rule: '|a-b| <= atol + rtol*max(|a|,|b|); two distinct integers never agree' },
    reproduced: realTotal === 0,
    beyondToleranceCount: realTotal,
    withinToleranceCount: allDiffs.length - realTotal,
    largestGap: gap,
    note: 'Field-level diff between the COMMITTED artifacts and THIS RUN. No field is excluded: the '
      + 'artifacts of record carry no run metadata. Entries marked `withinTolerance` are the '
      + 'same result computed on different hardware and are recorded, not scored. Any entry NOT '
      + 'so marked means this run disagrees with the committed evidence — investigate it; do not '
      + 're-run until it goes away, and do not regenerate the committed artifact to make it go away.',
    files: perFile.map(p => ({ file: `outputs/${p.file}`, committedReadable: p.readable, differences: p.diffs })),
  }, null, 2));

  console.log(`  Reproduction vs the committed artifacts on Node ${process.versions.node}: `
    + `${realTotal === 0 ? 'REPRODUCED' : `${realTotal} field(s) BEYOND TOLERANCE`}`
    + `${allDiffs.length - realTotal > 0 ? ` (${allDiffs.length - realTotal} within tolerance` + (gap ? `, largest ${gap.absDiff.toExponential(2)} at ${gap.path}` : '') + ')' : ''}`);
  console.log(`  Diff written to: outputs/run/diff.json`);
  if (realTotal > 0) {
    console.log('  ⚠ THIS RUN DISAGREES WITH THE COMMITTED EVIDENCE:');
    for (const p of perFile) {
      if (!p.readable) { console.log(`      outputs/${p.file}: committed copy absent or unreadable`); continue; }
      for (const d of p.real.slice(0, 4)) {
        console.log(`      ${p.file} ${d.path}: committed ${JSON.stringify(d.committed)} vs this run ${JSON.stringify(d.thisRun)}`);
      }
    }
  }
  reproductionFailures = realTotal;
} else {
  console.log('  REPORT GENERATION (PF_EMIT=1): the committed artifacts in outputs/ were rewritten.');
  console.log('  If determinism-log.json or chi-squared-results.json changed, re-pin them in src/artifact-pins.ts in the same commit.');
}

// ── Exit contract ─────────────────────────────────────────────────────────────
// FAIL -> 1, RTP FIGURE OVERSTATED -> 5, operator-origin FLAG -> 2, otherwise 0, so an automated
// caller reads the verdict from the exit status. A reproduction beyond tolerance is a FAIL, not a
// warning: a gate that only prints is not a gate.
if (hardFail > 0 || reproductionFailures > 0 || !rtpClaim.tableMatches) process.exit(1);
if (ruled.exit === RTP_FIGURE_OVERSTATED_EXIT) process.exit(RTP_FIGURE_OVERSTATED_EXIT);
if (operatorFlags.length > 0) process.exit(2);
// A capture-origin FLAG is disclosed but verdict-neutral: exit 0, so npm test stays green.
