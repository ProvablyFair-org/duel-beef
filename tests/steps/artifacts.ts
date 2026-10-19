/**
 * Step 23 — Artifact Integrity.
 *
 * Recompute the SHA-256 of every artifact of record and compare it with the pin in
 * src/artifact-pins.ts. A missing or altered artifact is a HARD FAIL, not a flag: the figures in
 * these files are published, and a flag exits 0.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { ARTIFACT_PINS } from '../../src/artifact-pins';
import { domainRules, validateDomains, describeDomainFailures } from '../../src/domains';

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir } = ctx;

  const notes: string[] = [];
  const files: { file: string; pin: string; actual: string | null; match: boolean }[] = [];
  let bad = 0;

  for (const [file, expected] of Object.entries(ARTIFACT_PINS)) {
    const fp = path.join(outputsDir, file);
    if (!fs.existsSync(fp)) {
      bad++;
      files.push({ file, pin: expected, actual: null, match: false });
      notes.push(`${file} ABSENT — a pinned artifact of record is missing`);
      continue;
    }
    const actual = createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    const match = actual === expected;
    files.push({ file, pin: expected, actual, match });
    if (!match) {
      bad++;
      notes.push(`${file} sha256 ${actual.slice(0, 16)}… != pin ${expected.slice(0, 16)}… — the scored artifact is not the committed one`);
    } else {
      notes.push(`${file} matches its pin`);
    }
  }

  // VALUE DOMAINS (profile BEEF-27, added 2026-09-26, ported from Duel Crash/Dice). The pin proves the
  // bytes are the pinned ones; it cannot tell a genuine figure from an impossible one written and
  // re-pinned. Every numeric leaf of the committed JSON artifacts is checked against src/domains.ts in
  // both directions: within its domain, and covered by a rule.
  const domainProblems: string[] = [];
  let leavesChecked = 0;
  for (const [file, rules] of Object.entries(domainRules())) {
    let doc: unknown = null;
    try { doc = JSON.parse(fs.readFileSync(path.join(outputsDir, file), 'utf8')); }
    catch { domainProblems.push(`${file}: committed artifact absent or unreadable`); continue; }
    const r = validateDomains(doc, rules);
    leavesChecked += r.checked;
    if (r.violations.length || r.uncovered.length) domainProblems.push(...describeDomainFailures(file, r));
  }

  const total = Object.keys(ARTIFACT_PINS).length;
  return [step(23, 'Artifact Integrity (pinned artifacts of record)',
    bad === 0 && total > 0 && domainProblems.length === 0 ? 'PASS' : 'FAIL',
    `${total} artifact(s) checked against src/artifact-pins.ts; ` +
    notes.join('; ') + '; ' +
    (domainProblems.length === 0
      ? `every one of the ${leavesChecked} numeric leaves of the committed JSON artifacts lies in its declared value domain (src/domains.ts) and none is undeclared`
      : `VALUE DOMAINS (BEEF-27): ${domainProblems.slice(0, 5).join('; ')}`),
    { checked: files.length, mismatches: bad, files, domainLeavesChecked: leavesChecked, domainProblems },
  )];
}
