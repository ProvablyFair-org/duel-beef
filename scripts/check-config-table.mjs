#!/usr/bin/env node
/**
 * check-config-table — Duel's Beef payout table (E07) against the audit's formula, all 61 cells.
 *
 * E07 is the GET /api/v2/cross-road/config response: the duel.com config as fetched 2026-10-05
 * 12:16:36 UTC in a logged-in session (read-only GET), saved byte for byte
 * (evidence/E07-cross-road-config-2026-10-05.json, response metadata beside it in .meta.json).
 *
 * What this checks, in exact integer arithmetic (BigInt; no floating point in any comparison):
 *   1. the file is the pinned bytes (SHA-256 below);
 *   2. `data` carries exactly `payout_tables`, `probabilities` and `difficulty_levels`, and no key
 *      named `scaling_edge` appears anywhere in the response;
 *   3. difficulty ids 1..4 list steps = 20 − m for the death-point counts m = 1 / 3 / 5 / 10
 *      (premise P3; the same constants as DEATH_POINTS_BY_DIFFICULTY in src/rng.ts);
 *   4. every payout_tables cell (difficulty, k) equals C(20,k)/C(20−m,k) × 992/1000 within
 *      relative 1e-12, and the table holds exactly `steps` cells per difficulty (61 in all).
 *
 * Standalone on purpose: it is not part of mocha or of the 25 scored steps, and it moves no step,
 * no verdict and no pinned output. It reads nothing outside this package and makes no network call.
 *
 * Usage: node scripts/check-config-table.mjs     exit 0 = every check holds, exit 1 = any does not
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'evidence/E07-cross-road-config-2026-10-05.json';
const FILE_SHA256 = 'a7836863db88f699083e14a695fd916799fcbc349006b8bad81d4477a919feca';

const GRID = 20n;
const DEATH_POINTS = { 1: 1n, 2: 3n, 3: 5n, 4: 10n };          // premise P3, src/rng.ts DEATH_POINTS_BY_DIFFICULTY
const EDGE_NUM = 992n, EDGE_DEN = 1000n;                       // payout = raw × 0.992
const REL_TOL_DEN = 10n ** 12n;                                // relative 1e-12

const problems = [];
const fail = (m) => problems.push(m);

function comb(n, k) {
  if (k < 0n || k > n) return 0n;
  let r = 1n;
  for (let i = 1n; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** A plain decimal string as an exact fraction [numerator, 10^decimals]. */
function decimal(s) {
  if (typeof s !== 'string' || !/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  return [BigInt(int + frac), 10n ** BigInt(frac.length)];
}

function keyNames(o, out = new Set()) {
  if (Array.isArray(o)) for (const v of o) keyNames(v, out);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); keyNames(v, out); }
  return out;
}

const bytes = readFileSync(path.join(ROOT, FILE));
const sha = createHash('sha256').update(bytes).digest('hex');
if (sha !== FILE_SHA256) {
  console.log(`[check-config-table] FAIL: ${FILE} SHA-256 ${sha} is not the pinned ${FILE_SHA256}`);
  process.exit(1);
}
const body = JSON.parse(bytes.toString('utf8'));
const data = body?.data ?? {};

// 2. structure
const dataKeys = Object.keys(data).sort();
const expectKeys = ['difficulty_levels', 'payout_tables', 'probabilities'];
if (dataKeys.join(',') !== expectKeys.join(',')) fail(`data keys are [${dataKeys}], expected [${expectKeys}]`);
const names = keyNames(body);
if (names.has('scaling_edge')) fail('a key named scaling_edge is present');

// 3. difficulty levels
const levels = new Map((data.difficulty_levels ?? []).map((l) => [l.id, l]));
for (const [id, m] of Object.entries(DEATH_POINTS)) {
  const l = levels.get(Number(id));
  if (!l) { fail(`difficulty ${id} missing from difficulty_levels`); continue; }
  if (BigInt(l.steps) !== GRID - m) fail(`difficulty ${id} (${l.name}) lists ${l.steps} steps, expected ${GRID - m}`);
}
if (levels.size !== 4) fail(`difficulty_levels has ${levels.size} entries, expected 4`);

// 4. payout cells
let cells = 0;
let worst = { rel: 0, at: null };
const tableIds = Object.keys(data.payout_tables ?? {}).sort();
if (tableIds.join(',') !== '1,2,3,4') fail(`payout_tables ids are [${tableIds}], expected [1,2,3,4]`);
for (const id of tableIds) {
  const m = DEATH_POINTS[id];
  const row = data.payout_tables[id];
  if (m === undefined) { fail(`payout_tables has an unknown difficulty ${id}`); continue; }
  if (!Array.isArray(row) || BigInt(row.length) !== GRID - m) {
    fail(`difficulty ${id}: ${Array.isArray(row) ? row.length : 'no'} cells, expected ${GRID - m}`);
    continue;
  }
  row.forEach((s, i) => {
    const k = BigInt(i + 1);
    const dec = decimal(s);
    if (!dec) { fail(`difficulty ${id} k=${k}: ${JSON.stringify(s)} is not a plain decimal string`); return; }
    const [sNum, sDen] = dec;
    // exact = C(20,k)·992 / (C(20−m,k)·1000);  |s − exact| / exact = |sNum·eDen − eNum·sDen| / (eNum·sDen)
    const eNum = comb(GRID, k) * EDGE_NUM;
    const eDen = comb(GRID - m, k) * EDGE_DEN;
    let diff = sNum * eDen - eNum * sDen;
    if (diff < 0n) diff = -diff;
    const denom = eNum * sDen;
    const rel = Number((diff * 10n ** 30n) / denom) / 1e30;
    if (rel > worst.rel) worst = { rel, at: `difficulty ${id} k=${k} (${s})` };
    if (diff * REL_TOL_DEN >= denom) fail(`difficulty ${id} k=${k}: config lists ${s}, exact ${eNum}/${eDen}, relative deviation ${rel.toExponential(3)} >= 1e-12`);
    cells++;
  });
}

console.log(`[check-config-table] ${FILE} SHA-256 ${sha} (pinned)`);
console.log(`[check-config-table] data keys: ${dataKeys.join(', ')}; key named scaling_edge: ${names.has('scaling_edge') ? 'present' : 'none'}`);
console.log(`[check-config-table] difficulty steps: ${[...levels.values()].map((l) => `${l.id} ${l.name} ${l.steps}`).join(', ')}`);
console.log(`[check-config-table] payout cells compared with C(20,k)/C(20−m,k) × 0.992: ${cells}; worst relative deviation ${worst.rel.toExponential(3)}${worst.at ? ` at ${worst.at}` : ''}; tolerance 1e-12`);
if (problems.length) {
  for (const p of problems) console.log(`[check-config-table] FAIL: ${p}`);
  process.exit(1);
}
console.log(`[check-config-table] OK: all ${cells} cells match`);
