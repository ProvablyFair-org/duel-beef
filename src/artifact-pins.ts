/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence.
 *
 * outputs/verification-results.json is deliberately NOT pinned — it is this verifier's own
 * output and is rewritten on every run by construction.
 *
 * Regenerating an artifact legitimately means re-pinning it here, in the same commit, with the
 * run that produced it.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'rtp-convergence.html':
    'b26044a83960c2158a0abe2c31db8072b8e5c3f4e4599a59a72222480f9c7a54',
  'simulation-results.json':
    '22bde95556b2c838ec576414e8d95106d1877ec299874321837c59a01637fe44',
});
