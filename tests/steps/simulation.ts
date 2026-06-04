/**
 * Steps 18–19: Simulation Results
 */

import * as fs   from 'fs';
import * as path from 'path';

import type { StepResult } from './context';
import { step, VerifyContext } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir } = ctx;
  const simPath = path.join(outputsDir, 'simulation-results.json');

  if (!fs.existsSync(simPath)) {
    const s18 = step(18, 'Simulation Results — Pass 1 Integrity', 'FLAG',
      'simulation-results.json not found — run npm run simulate first',
    );
    const s19 = step(19, 'Simulation Results — Pass 2 Cherry-Pick Test', 'FLAG',
      'simulation-results.json not found',
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
  const s18 = step(18, 'Simulation Results — Pass 1 Integrity',
    pass1Ok ? 'PASS' : 'FAIL',
    `${(pass1.totalRounds ?? 0).toLocaleString()} rounds × ${configs} configs; mean RTP=${((pass1.avgSimulatedRTP ?? 0) * 100).toFixed(4)}%; chi2: ${pass1.chi2FailsAtAlpha01 ?? 0}/${configs} uncorrected, ${chi2BonFails}/${configs} at Bonferroni α/${configs}=${bonAlpha.toFixed(6)}; serial: ${pass1.serialIndependenceFails ?? 0}/${configs} uncorrected, ${serialBonFails}/${configs} at Bonferroni`,
  );

  // ── Step 19: Pass 2 ────────────────────────────────────────────────────────
  const pass2      = sim.pass2_casino_seeds;
  const N          = pass2.seeds_tested;
  const flags      = pass2.test_b_cherry_pick_flags;
  const testA      = pass2.test_a_chi2_fails_at_alpha01;
  const expCP      = Math.ceil(N * 0.05);
  const threshold  = expCP * 2;

  let broadFlags = 0;
  let earlyOnly  = 0;
  for (const r of pass2.results) {
    if (r.cherry_pick_flag) {
      if (r.earlyP < 0.05 && r.lateP < 0.05) broadFlags++;
      else earlyOnly++;
    }
  }

  const verdict = flags <= threshold && broadFlags === 0 ? 'PASS' : 'FLAG';
  const diffLabel = pass2.difficulty !== undefined
    ? `difficulty=${pass2.difficulty} (dpc=${pass2.death_points_count ?? '?'})`
    : `mines=${pass2.mine_count ?? 'varied'}`;
  const s19 = step(19, 'Simulation Results — Pass 2 Cherry-Pick Test', verdict,
    `${N} seeds × ${diffLabel}; Test A: ${testA}/${N} fails (expected ≤${Math.ceil(N * 0.01)}); Test B: ${flags}/${N} flags (≤${threshold} = 2×${expCP} threshold); ${earlyOnly} isolated-early, ${broadFlags} broad — ${broadFlags === 0 ? 'no cherry-picking detected' : 'INVESTIGATE broad flags'}`,
  );

  return [s18, s19];
}
