#!/usr/bin/env node
'use strict';
/**
 * Runs DUEL'S OWN Beef verification code — the JavaScript shown in the code panel of
 * duel.com → Provably Fair → Verify (Beef) — once per captured round, the way a player uses it:
 * fill in the "User input values" at the top of the file and run it.
 *
 *   node run-operator-verifier.cjs <operator-file.js>        jobs as JSON on stdin → JSON on stdout
 *
 * jobs: { rounds: [{ id, inputs: { <name>: <value>, … } }] }   (names = the file's own input constants)
 *
 * WHAT RUNS. evidence/verify-tab/duel-verify-tab-beef-2026-09-26.js, pasted by Paulo from the Verify
 * tab on 2026-09-26. The file on disk is never edited (its SHA-256 is pinned in src/operator-verifier.ts
 * and checked by the caller before this runner starts).
 *
 * WHAT IS NOT DUEL'S CODE (the whole harness surface, listed so it can be reviewed):
 *   1. THE INPUT SUBSTITUTION — the one in-memory change, and the same one a player makes in the Verify
 *      tab. The file's "// User input values" block is a run of `const <name> = <literal>;` lines. For
 *      each round, ONLY the literal on those lines is replaced (a string by its JSON literal, a number by
 *      its decimal literal; a trailing comment on the line is kept byte for byte). The names on those
 *      lines must be exactly INPUTS below, in order, or the runner exits 1 (the file's shape changed).
 *      After substitution the runner asserts that every other line of the file is byte-identical and
 *      the line count unchanged; otherwise it exits 1.
 *   2. THE WRAPPER `(function (crypto, TextEncoder, TextDecoder, console) { <file> ; return { … }; })`,
 *      evaluated with node:vm. `crypto` is Node's WebCrypto (globalThis.crypto — the W3C API the browser
 *      gives the page), TextEncoder/TextDecoder are Node's, and `console` is a per-round recorder. The
 *      wrapper returns the file's own top-level functions and its (substituted) input constants.
 *   3. THE CALL. The file's own top level runs and prints, exactly as shipped. In addition CALL below
 *      invokes the file's own function with the file's own (substituted) constants — the same arguments
 *      its top level passes — so the returned value (not only the printed one) can be compared. The
 *      runner then waits until the file's printed output is complete (SETTLED below), at most
 *      ROUND_TIMEOUT_MS per round.
 *   4. ONE SHIPPED RUN: the file is also run once with no substitution at all, and what it prints is
 *      returned (`shippedLogs`), so the caller can see the file ran as shipped.
 * Exit 0 with JSON; exit 1 if the file will not evaluate, its input block has changed shape, or the
 * substitution would touch any other line.
 */
const vm = require('vm');
const fs = require('fs');

// ── the game-specific part ───────────────────────────────────────────────────────────────────────
const INPUTS = ['clientSeed', 'serverSeed', 'nonce', 'deathPointsCount', 'gridSize'];
const EXPORTS = ['generateDeathPoints'];
// the file's own top-level call is generateDeathPoints(serverSeed, clientSeed, nonce, gridSize, deathPointsCount) (L89)
const CALL = (m) => m.generateDeathPoints(m.serverSeed, m.clientSeed, m.nonce, m.gridSize, m.deathPointsCount);
// the file prints "Death Point: …" (L93/L95) or "Error: …" (L98); run with empty inputs it prints only its
// "Please provide …" line (L100)
const SETTLED = (logs) => logs.some(l => l.startsWith('Please provide') || l.startsWith('Death Point:') || l.startsWith('Error:'));
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const ROUND_TIMEOUT_MS = 30_000;
function fail(msg) { process.stderr.write(`operator verifier: ${msg}\n`); process.exit(1); }

const file = process.argv[2];
if (!file) fail('usage: run-operator-verifier.cjs <operator-file.js>');
const src = fs.readFileSync(file, 'utf8');
const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!jobs || !Array.isArray(jobs.rounds)) fail('jobs must be { rounds: [...] }');

const lines = src.split('\n');
const head = lines.findIndex(l => l.trim() === '// User input values');
if (head < 0) fail('no "// User input values" block');
const DECL = /^const (\w+) = ('(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?)(;.*)$/;
const slots = [];
for (let i = head + 1; i < lines.length && lines[i].trim() !== ''; i++) {
  const m = DECL.exec(lines[i]);
  if (!m) fail(`input block line ${i + 1} is not a const <name> = <literal>; line: ${JSON.stringify(lines[i])}`);
  slots.push({ index: i, name: m[1], rest: m[3] });
}
if (slots.map(s => s.name).join(',') !== INPUTS.join(',')) fail(`input block names ${slots.map(s => s.name).join(',')} != ${INPUTS.join(',')}`);

function literal(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  fail(`input value ${JSON.stringify(v)} is neither a string nor a finite number`);
}
function substitute(inputs) {
  const out = lines.slice();
  for (const s of slots) {
    if (!(s.name in inputs)) fail(`round is missing input ${s.name}`);
    out[s.index] = `const ${s.name} = ${literal(inputs[s.name])}${s.rest}`;
  }
  const touched = new Set(slots.map(s => s.index));
  if (out.length !== lines.length || out.some((l, i) => !touched.has(i) && l !== lines[i])) fail('substitution touched a line outside the input block');
  return out.join('\n');
}

function evaluate(code, recorder) {
  const wrapped = `(function (crypto, TextEncoder, TextDecoder, console) {\n${code}\n;return { ${[...EXPORTS, ...INPUTS].join(', ')} };\n})`;
  return vm.runInThisContext(wrapped, { filename: file })(globalThis.crypto, TextEncoder, TextDecoder, recorder);
}
function recorderFor(logs) {
  const rec = (...a) => logs.push(a.map(String).join(' '));
  return { log: rec, error: rec, warn: rec, info: rec };
}
async function settle(logs) {
  const t0 = Date.now();
  while (!SETTLED(logs)) {
    if (Date.now() - t0 > ROUND_TIMEOUT_MS) throw new Error(`printed output incomplete after ${ROUND_TIMEOUT_MS} ms: ${JSON.stringify(logs)}`);
    await new Promise(r => setTimeout(r, 1));
  }
}

async function runOne(r) {
  const logs = [];
  try {
    const m = evaluate(substitute(r.inputs), recorderFor(logs));
    for (const e of EXPORTS) if (typeof m[e] !== 'function') throw new Error(`file does not define ${e}`);
    const value = CALL ? await CALL(m) : null;
    await settle(logs);
    return { id: r.id, value, logs };
  } catch (e) { return { id: r.id, value: null, logs, error: e.message }; }
}

(async () => {
  const shippedLogs = [];
  try { evaluate(src, recorderFor(shippedLogs)); } catch (e) { fail(`file did not evaluate: ${e.message}`); }
  await settle(shippedLogs).catch(e => fail(`shipped run: ${e.message}`));
  const results = [];
  const BATCH = 100;
  for (let i = 0; i < jobs.rounds.length; i += BATCH) {
    results.push(...await Promise.all(jobs.rounds.slice(i, i + BATCH).map(runOne)));
  }
  process.stdout.write(JSON.stringify({ shippedLogs, inputs: INPUTS, results }));
})().catch(e => fail(e.message));
