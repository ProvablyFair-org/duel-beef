/**
 * PLAYER-VERIFIER PARITY (profile BEEF-24) — the ProvablyFair.org docs-site verifier.
 *
 * The docs site ships a player-facing verifier for Duel Beef: the VerifyBets component, whose Beef
 * derivation is `src/components/VerifyBets/games/beef/derive.js` and whose only import is
 * `src/components/VerifyBets/lib/hmac-sha256.js` (the pure-JS HMAC). A player who pastes a round into
 * that page is trusting THAT code, not this package's src/rng.ts. Until 2026-09-26 the two were related
 * only by a comment in derive.js ("Source of truth (audit repo): … src/rng.ts") — a hand sync that no
 * check could see break.
 *
 * WHAT THIS FILE DOES (ported 2026-09-26 from Duel Dice / Mines src/site-verifier.ts).
 *   1. PINS the SHA-256 of both site files (SITE_VERIFIER_PINS).
 *   2. Holds a VENDORED copy of those exact bytes under verifier-parity/, laid out as on the site so
 *      derive.js's relative import names the same file. The vendored bytes must hash to the pins or
 *      Step 5 FAILs before anything runs.
 *   3. EXECUTES the vendored derive.js — not a re-typing of it — on every captured round of both
 *      datasets. Step 5 requires its death points to equal the ones src/rng.ts computes (which Steps 5
 *      and 21 bind to the served mines_positions) and, on every win, its paid multiplier
 *      cashoutMultiplier(m, k) to equal the served no_house_edge_multiplier within MULT_REL_TOL.
 *
 * HOW THE VENDORED ES MODULE IS RUN. The suite is synchronous CommonJS and derive.js is an ES module
 * with an extensionless relative import. So the bytes are evaluated with node:vm, each file wrapped in
 * its own function scope, after exactly two textual rewrites applied to the in-memory copy only, never
 * to the hashed file: the ONE import line (which must equal IMPORT_LINE byte for byte — any other
 * import set FAILs, because it would be code this check does not vendor) is replaced by bindings to
 * the vendored library, and `export ` is dropped from each top-level declaration. No other character
 * is touched.
 *
 * PROVENANCE OF THE PINNED BYTES (read 2026-09-26, read-only, via `git cat-file -p origin/main:<path>` —
 * the local checkout was not switched or modified):
 *   repository  qa-workspace/duel/docusaurus (mikepforg/pf-audit-duel), origin/main
 *               @ bd4d59cd9a3e75146f2575c5218a3fb9a8b2692d (2026-09-19). The beef derive.js on main was
 *               last changed in 4aaa1b2 (2026-06-07). The local checkout's HEAD copy differs from main's
 *               only in the source-URL comment (github.com/ProvablyFair/… → github.com/ProvablyFair-org/…);
 *               hmac-sha256.js is byte-identical to the copy Duel Dice pins (bc30bfe9…).
 *   The LIVE page (www.provablyfair.org/verify-bets) is a separate build and is NOT checked here.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

export const SITE_VERIFIER_DIR = path.join(__dirname, '../verifier-parity');

/** Site-relative path → SHA-256 of the exact bytes. The vendored copies live at the same relative paths. */
export const SITE_VERIFIER_PINS: Readonly<Record<string, string>> = Object.freeze({
  'games/beef/derive.js': '0003d6347506334f27b2159d73d6552cd19c39d52348dd97e6270b6293e592d3',
  'lib/hmac-sha256.js':   'bc30bfe9ef202905ece93de33440d41851abf16e910f90c2a567774a2b79d889',
});

export const SITE_VERIFIER_PROVENANCE = Object.freeze({
  siteRoot: 'qa-workspace/duel/docusaurus/src/components/VerifyBets',
  repository: 'mikepforg/pf-audit-duel',
  ref: 'origin/main',
  head: 'bd4d59cd9a3e75146f2575c5218a3fb9a8b2692d',
  headDate: '2026-09-19',
  deriveLastChanged: '4aaa1b267a6b86199c46f57db41058c7885067bb (2026-06-07)',
  readVia: 'git cat-file -p origin/main:<path>',
  readOn: '2026-09-26',
});

/** The only import derive.js may carry. Anything else is code this check does not vendor. */
export const IMPORT_LINE = "import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';";

export interface SiteBeefResult {
  deathPositions: number[];
  safePositions: number[];
  deathCount: number;
  firstHmac: string;
  maxSteps: number;
  multiplier?: number;
  busted?: boolean;
}
export type SiteDeriveBeef = (p: { clientSeed: string; serverSeed: string; nonce: number; difficulty: string; targetSteps?: number }) => SiteBeefResult;
export type SiteCashoutMultiplier = (deathCount: number, steps: number) => number;
/** derive.js DIFFICULTIES as the site defines them: id → death-point count. Read from the module, not re-typed. */
export type SiteDifficulties = Array<{ id: string; label: string; code: number; deaths: number }>;

export interface SiteVerifierLoad {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  /** Present only when every hash matches and the module evaluated. */
  deriveBeef: SiteDeriveBeef | null;
  cashoutMultiplier: SiteCashoutMultiplier | null;
  difficulties: SiteDifficulties | null;
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/** Drop `export ` from top-level declarations; nothing else. */
const stripExports = (src: string): string => src.replace(/^export (function|const|let|class) /gm, '$1 ');

/**
 * Hash the vendored files against the pins and, only if every one matches, evaluate them.
 * Never throws: a failure is returned as `error` so Step 5 reports it as a FAIL.
 */
export function loadSiteVerifier(dir = SITE_VERIFIER_DIR): SiteVerifierLoad {
  const files = Object.entries(SITE_VERIFIER_PINS).map(([file, pinned]) => {
    const p = path.join(dir, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  if (!hashesMatch) return { files, hashesMatch, deriveBeef: null, cashoutMultiplier: null, difficulties: null, error: 'vendored site verifier does not match its pinned SHA-256' };
  try {
    // runInThisContext, not a new context: the pure-JS SHA-256 runs ~30x slower in a fresh context
    // (measured on Duel Mines, 2026-09-24), which would force a sample instead of every bet.
    const libSrc = fs.readFileSync(path.join(dir, 'lib/hmac-sha256.js'), 'utf8');
    const lib = (vm.runInThisContext(
      `(function () {\n${stripExports(libSrc)}\n;return { hmacSha256Hex, hexToBytes };\n})`,
      { filename: 'verifier-parity/lib/hmac-sha256.js' },
    ) as () => { hmacSha256Hex: unknown; hexToBytes: unknown })();

    const deriveSrc = fs.readFileSync(path.join(dir, 'games/beef/derive.js'), 'utf8');
    const importLines = deriveSrc.split('\n').filter(l => /^\s*import\b/.test(l));
    if (importLines.length !== 1 || importLines[0] !== IMPORT_LINE) {
      return { files, hashesMatch, deriveBeef: null, cashoutMultiplier: null, difficulties: null,
        error: `derive.js imports ${JSON.stringify(importLines)}; the only vendored import is ${JSON.stringify(IMPORT_LINE)}` };
    }
    const body = `(function (hmacSha256Hex, hexToBytes) {\n${stripExports(deriveSrc.replace(IMPORT_LINE, ''))}\n;return { deriveBeef, cashoutMultiplier, DIFFICULTIES };\n})`;
    const mod = (vm.runInThisContext(body, { filename: 'verifier-parity/games/beef/derive.js' }) as
      (h: unknown, x: unknown) => { deriveBeef: SiteDeriveBeef; cashoutMultiplier: SiteCashoutMultiplier; DIFFICULTIES: SiteDifficulties })(lib.hmacSha256Hex, lib.hexToBytes);
    if (typeof mod.deriveBeef !== 'function' || typeof mod.cashoutMultiplier !== 'function' || !Array.isArray(mod.DIFFICULTIES))
      return { files, hashesMatch, deriveBeef: null, cashoutMultiplier: null, difficulties: null, error: 'derive.js does not define deriveBeef / cashoutMultiplier / DIFFICULTIES' };
    return { files, hashesMatch, deriveBeef: mod.deriveBeef, cashoutMultiplier: mod.cashoutMultiplier, difficulties: mod.DIFFICULTIES, error: null };
  } catch (e) {
    return { files, hashesMatch, deriveBeef: null, cashoutMultiplier: null, difficulties: null, error: `vendored site verifier failed to evaluate: ${(e as Error).message}` };
  }
}
