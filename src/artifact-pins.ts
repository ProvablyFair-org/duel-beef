/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence. Step 23 (tests/steps/artifacts.ts)
 * recomputes each SHA-256 on every run and HARD-FAILS on a missing or altered file.
 *
 * outputs/verification-results.json is deliberately NOT pinned — it is this verifier's own
 * output, rewritten by `PF_EMIT=1 npm run verify` by construction, and it is the file that
 * carries this step's verdict. The reproduction gate (outputs/run/diff.json) binds it to a fresh
 * recomputation instead.
 *
 * The two verifier-written artifacts that ARE pinned — determinism-log.json and
 * chi-squared-results.json — carry no run timestamp. A `generatedAt` inside a pinned file makes
 * the pin unreproducible even when every figure is identical, which defeats the point of pinning
 * it; both carried one until this release. Without it, `PF_EMIT=1 npm run verify` rewrites them
 * with byte-identical content whenever the result is the same, and a different result is exactly
 * what the pin is there to catch.
 *
 * simulation-results.json and rtp-convergence.html are products of `npm run simulate`, which
 * writes into outputs/ only under PF_EMIT=1 (otherwise outputs/run/). RE-PINNED 2026-09-26: the
 * committed simulation-results.json carried the `generatedAt` of the run that produced it and two
 * `executionTimeMs` fields (run metadata; profile BEEF-27, conformance C-04). Those three lines were
 * deleted with Node's own JSON.parse / JSON.stringify(…, null, 2) — the serializer src/simulate.ts
 * writes with, which round-trips the original file byte for byte — and no other byte moved
 * (git diff: 3 deletions). src/simulate.ts emits neither field any more. Previous pin 3f3ffd19….
 *
 * The pin is the identity of the COMMITTED bytes and is never rewritten to make a regeneration
 * agree with it. Regenerating an artifact legitimately means re-pinning it here, in the same
 * commit, with the run that produced it.
 *
 * rtp-convergence.html RE-PINNED 2026-09-28 (previous pin b26044a8…): Chart.js 4.4.7 is inlined verbatim
 * (Mike's review F16) instead of loaded from cdn.jsdelivr.net. Regenerated with `PF_EMIT=1 npm run simulate`;
 * simulation-results.json came back byte-identical (dcd5537e…) and the html diff is the one <script> tag.
 *
 * simulation-results.json RE-PINNED 2026-10-06 (previous pin dcd5537e…): Pass 2 now scores one step on
 * tile 0, Beef's first tile, instead of the rotating tile nonce % 20 (Mike's review, 6 Oct 2026; src/loader.ts
 * SIM_FIRST_STEP_TILE). Regenerated with `PF_EMIT=1 npm run simulate`; the pass1_fresh_seeds block came back
 * identical and rtp-convergence.html byte-identical (2633e8f8…), so only the Pass 2 rows and counts moved.
 *
 * simulation-results.json RE-PINNED 2026-10-06 (previous pin 41ae9b9d…): src/stats.ts runsTest is now the
 * Wald-Wolfowitz runs test on the win/loss outcome (n1 = wins, n2 = losses). The median split it used was
 * degenerate when losses outnumbered wins (difficulty 4: z 0, p 1). Regenerated with `PF_EMIT=1 npm run
 * simulate`; only difficulty 4's runsZ and runsPValue moved (git diff: 2 lines), rtp-convergence.html came
 * back byte-identical (2633e8f8…).
 *
 * simulation-results.json RE-PINNED 2026-10-19 (previous pin 2ddcc202…): the Pass 1 description said it
 * "Validates independent implementation"; src/rng.ts is checked against Duel's Verify-tab code, not an
 * independent implementation (Mike's QA, 19 Oct 2026, decision 1). Regenerated with `PF_EMIT=1 npm run
 * simulate`; only that description line moved (git diff: 1 line), rtp-convergence.html came back
 * byte-identical (2633e8f8…).
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'chi-squared-results.json':
    '65857a46ab1d0d4acfe0c46ceaa264f22a112358895643160bc5605310451ca0',
  'determinism-log.json':
    '88bc153e2d6e867f375c0cf8138491185761cdb3150e4c921a0746ecf5a7b3c2',
  'rtp-convergence.html':
    '2633e8f87d9ed124b1c32c604c25291108ee5af775f8e2405e0ef3538e97d066',
  'simulation-results.json':
    'd49f95a23cbd3d6839761fdefc19c3ffa4103a42bd2b892eb7511a54ea5af358',
});
