/**
 * Which ProvablyFair.org Beef profile check each scored step implements.
 *
 * The profile (`_workspace/pf-audit-framework/games/beef/profile.json`, BEEF-01 … BEEF-30,
 * 1.0.2 — approved 2026-10-14, Methodology v1.1 D6) declares the checks; this suite scores
 * 25 steps under its own numbering, which every chapter cites and which therefore cannot be
 * renumbered. The mapping is declared here, emitted into `outputs/verification-results.json` beside
 * the step results, and read back by `pf-audit matrix`.
 *
 * THIS FILE LABELS; IT DOES NOT CHECK. Nothing here can make a step pass or fail. A check is claimed
 * only where the step's assertion actually decides the profile's `asserts` text, read from the
 * CURRENT step code (2026-09-26).
 *
 * COVERAGE DESCRIBES THE PACKAGE, NOT THE STEP.
 *   full    — nothing the profile's `asserts` requires is unimplemented; where a check is split
 *             across steps each note says which half it carries.
 *   partial — something the profile requires is implemented nowhere in this package; the note says what.
 */

export type Coverage = 'full' | 'partial';

export interface CheckClaim {
  id: string;
  coverage: Coverage;
  note?: string;
}

export interface StepClaims {
  claims: CheckClaim[];
  /** Required when `claims` is empty: why the step answers no profile check. */
  reason?: string;
}

export const PROFILE_GAME = 'beef';
export const PROFILE_VERSION = '1.0.2';

/** Scored step number → the profile checks it implements. Every step 1..25 has an entry. */
export const STEP_CLAIMS: Record<number, StepClaims> = {
  1: {
    claims: [{
      id: 'BEEF-01', coverage: 'full',
      note: 'SHA-256(hex_decode(serverSeed)) against the previous record\'s serverSeedHashed on every rotation transition; '
        + 'the count is bound to src/loader.ts (EXPECTED_SEEDS 125, EXPECTED_REVEALED_SEEDS 125, EXPECTED_SEED_TRANSITIONS '
        + '124 = 121 compared + 3 phase-boundary transitions), an unrevealed seed row FAILs. Every bet-bearing seed of BOTH '
        + 'files is additionally hash-verified before use (src/loader.ts buildSeedMap) and Steps 5/21 FAIL on any bet whose '
        + 'seed is not in that map, so zero bets are unverifiable',
    }],
  },
  2: {
    claims: [{
      id: 'BEEF-02', coverage: 'full',
      note: 'recomputed from raw hex, never from the capture script\'s `match` boolean: promotion previousNextHash === '
        + 'newActiveHash on all 125 primary rotations, forward links seeds[i].nextServerSeedHash === seeds[i+1].serverSeedHashed '
        + '124/124, and a pre-capture link (an absent link FAILs); since 2026-09-26 the same three on the Phase E file '
        + '(14/14 promotions, 13/13 links, its own pre-capture link), bound to EXPECTED_PHASE_E_SEEDS',
    }],
  },
  3: {
    claims: [{
      id: 'BEEF-03', coverage: 'full',
      note: 'epochs from the rotation TIMELINE, not from the bets: every bet carries the serverSeedHashed and clientSeed of the '
        + 'rotation active at its timestamp (orphans, out-of-order bets and a window/hash-count disagreement all FAIL) — the '
        + '6,000 primary bets in 121 windows and, since 2026-09-26, the 450 Phase E bets in 10 windows, each count bound to '
        + 'src/loader.ts (EXPECTED_EPOCHS, EXPECTED_PHASE_E_EPOCHS). FAIL probed (a Phase E bet given a foreign client seed)',
    }],
  },
  4: {
    claims: [
      {
        id: 'BEEF-04', coverage: 'full',
        note: 'both files (Phase E added 2026-09-26): every epoch starts at the declared base 0, no duplicate, nothing outside '
          + '0..49, one client seed; a gap is a HARD FAIL unless it is declared BY IDENTITY — primary b2dfe984…#25 '
          + '(EXPECTED_NONCE_GAPS) and Phase E 1dfe6dcf…#31 (EXPECTED_PHASE_E_NONCE_GAPS, E4, followed by a 1-bet epoch: the '
          + 'retry shape of the primary gap); a declared gap that is absent, or under an unrevealed / non-matching seed, FAILs. '
          + 'The two declared gaps are a capture-origin FLAG (decision-13: verdict-neutral, never an operator finding) with '
          + 'their death points reconstructed, not verified. FAIL probed (the Phase E gap declared at nonce 30)',
      },
      {
        id: 'BEEF-03', coverage: 'full',
        note: 'client-seed half — exactly one client seed per epoch in both files',
      },
    ],
  },
  5: {
    claims: [
      {
        id: 'BEEF-07', coverage: 'full',
        note: 'primary half: all 6,000 bets recomputed to the served mines_positions (compared as a sorted set — the capture '
          + 'records death points sorted), bound to EXPECTED_BETS; an unrevealed seed is a FAIL of this step. Phase E half: '
          + 'Step 21 (450/450)',
      },
      {
        id: 'BEEF-08', coverage: 'full',
        note: 'added 2026-09-26 (the same bound as Step 5 of the Duel Mines audit package; since 20 Oct 2026 in src/bias.ts, '
          + 'built on the clean-room src/rng.ts): the bound is MEASURED from src/rng.ts drawFromChunk — the '
          + 'function the shuffle calls — on all 19 ranges 2..20 (binary search for the accepted window + ~600 predicate '
          + 'probes per range); FAIL unless every window is an exact whole number of ranges and the worst per-index bias is '
          + 'inside 2^-32. Measured: exact on all 19 (range 20: 4,294,967,280 = 20 × 214,748,364; ranges 2, 4, 8, 16: the '
          + 'whole 2^32 domain, no rejection), worst bias 0. The '
          + 'rejection census over the 6,000 recomputed rounds (114,000 draws) is printed with its expectation. FAIL probed '
          + '(maxFairFor changed to accept every value below 2^32 − 1)',
      },
      {
        id: 'BEEF-24', coverage: 'full',
        note: 'added 2026-09-26 (ported from Duel Dice / Mines): the ProvablyFair.org docs-site VerifyBets games/beef/derive.js '
          + '+ lib/hmac-sha256.js, read with `git cat-file -p origin/main:<path>` from mikepforg/pf-audit-duel origin/main @ '
          + 'bd4d59c (derive.js last changed 4aaa1b2, 2026-06-07), vendored under verifier-parity/ and pinned in '
          + 'src/site-verifier.ts (derive.js 0003d634…, hmac-sha256.js bc30bfe9…). Step 5 FAILs unless the copies hash to the '
          + 'pins, then EXECUTES the site\'s deriveBeef on every round of both datasets (bound to 6,000 + 450) and requires its '
          + 'death points to equal src/rng.ts, its DIFFICULTIES table to map each served difficulty_level to the same '
          + 'death-point count, and on every win its cashoutMultiplier(m, k) to lie within relative 1e-12 of the exact paid '
          + 'multiplier (as the served one must). FAIL probed (derive.js logic changed and re-pinned; a byte changed without '
          + 're-pin). The LIVE page www.provablyfair.org/verify-bets is a separate build and is not checked',
      },
    ],
  },
  6: {
    claims: [{
      id: 'BEEF-06', coverage: 'partial',
      note: 'client-seed-influence half: a wrong client seed must change the FULL 20-tile permutation on every one of the '
        + '6,000 bets (the model rate of a chance repeat is 1/20!, so "every bet" is the model-rate bar with no allowance), '
        + 'and — added 2026-09-26 — an EMPTY-SEED CONTROL (clientSeed "") on all 6,000 with the same bar. Phase D '
        + 'recomputation is Step 17. PARTIAL: (1) the profile requires the A–C client-seed generator to be a CSPRNG; the '
        + 'capture scripts use Math.random() (capture/beef-capture.reference.js:170-172, beef-capture-phaseE.reference.js:268-270) — '
        + 'RULE-NEWER-THAN-CAPTURE (capture April 2026, profile standard 23 Sep 2026), disclosed MANIFEST DL-2; (2) the '
        + 'Phase D seeds are \'pfaudit\' + Date.now().toString(36) (capture/beef-capture.reference.js:339, :362) — predictable; '
        + 'disclosed MANIFEST DL-3, but no step enumerates the exposed epochs against a constant',
    }],
  },
  7: {
    claims: [{
      id: 'BEEF-11', coverage: 'full',
      note: 'primary half: every one of the 6,000 bets — each win credits amount × the served paid multiplier '
        + '(no_house_edge_multiplier) within MONEY_REL_TOL = 1e-12 relative floored at 1 (largest credit in either file '
        + '11.6706 → tolerance 1.2e-11, inside the profile\'s 1e-8; the declaration names no settlement rule, so the '
        + 'tolerance arm applies), each loss credits exactly "0". The paid multiplier itself is bound to the exact formula '
        + 'by Step 8. Phase E: Step 22 (cash-outs and, since 2026-09-26, every Phase E loss = "0")',
    }],
  },
  8: {
    claims: [{
      id: 'BEEF-13', coverage: 'full',
      note: 'k = 1 arm (all primary wins, 4,337): both served strings parsed EXACTLY and compared with the exact rational '
        + '(src/exact.ts) — multiplier with C(20,k)/C(20−m,k), no_house_edge_multiplier with the same × 992/1000 — at '
        + 'MULT_REL_TOL = 1e-12 relative, which replaced 1e-6 ABSOLUTE on 2026-09-26. No exact equality is available: '
        + 'the operator\'s k > 1 values carry double error (worst measured 9.63e-15, Steps 20/22), so 1e-12 leaves ~100× '
        + 'headroom; the worst deviation is emitted every run. The derivation reads (m, k) only; the formula\'s origin is '
        + 'Duel\'s /cross-road/config payout table (docs/ALGORITHM.md §3.1; src/rng.ts:41, :239-254). FAIL probed (one served multiplier moved '
        + '1e-9 relative — the old 1e-6 bound passed it). Rungs k > 1: Step 20; Phase C: Step 10',
    }],
  },
  9: {
    claims: [{
      id: 'BEEF-10', coverage: 'full',
      note: 'hardened 2026-09-26: on all 6,450 rounds of both files, death points from the RECOMPUTATION (not the served '
        + 'set); stepped tiles must be exactly the path prefix 0…k−1 (and k = reached_k where recorded); win ⇔ no stepped '
        + 'tile is a death point; a loss must end on its first death point. Was: served outcome vs served '
        + 'current_step ∩ mines_positions on the 6,000 primary bets only. FAIL probed (a loss\'s path re-ordered)',
    }],
  },
  10: {
    claims: [{
      id: 'BEEF-12', coverage: 'full',
      note: 'Phase C = 200 bets at $10 (1,000× the 0.01 base), bound to EXPECTED_PHASE_BETS.C, every bet asserted at $10, '
        + 'zero wins is a FAIL; 165 wins at difficulty 2 (MEDIUM) — ≥ 100 elevated-stake wins on the payout path. Each '
        + 'win\'s two multipliers against the exact rational (1e-12 relative) and its credit at MONEY_REL_TOL; every Phase C '
        + 'bet recomputes in Step 5. Note for C-08: Phase B is difficulty 4 (EXPERT), so Phase C does not run the Phase B '
        + 'board — the stake-only comparison is Phase C vs the Phase A difficulty-2 bets, same formula',
    }],
  },
  11: {
    claims: [{
      id: 'BEEF-15', coverage: 'full',
      note: 'every difficulty ≥ MIN_BETS_PER_DIFFICULTY = 1,000 (src/loader.ts); (difficulty, k) cells observed in live play '
        + 'counted against all 61, the 46 never-observed named in the data block with the RTP they carry (0.992 each, '
        + 'Step 16 — no unverified RTP mass); the 15 cells the capture plan requires (k = 1 at every difficulty + '
        + 'k = 1..target_k for E1–E4) must all be observed, else FAIL',
    }],
  },
  12: {
    claims: [{
      id: 'BEEF-19', coverage: 'full',
      note: 'operator half: the served effective_edge field = 0.8 on all 6,000 primary bets (compared, never used as the '
        + 'derivation); the derived half is Step 16',
    }],
  },
  13: {
    claims: [{
      id: 'BEEF-05', coverage: 'full',
      note: 'bets 6,000, seed records 125, per-phase bets A 4,000 / B 1,000 / C 200 / D 800 and per-phase seeds against '
        + 'src/loader.ts constants, not the dataset header; epoch sizes are Step 15; the secondary Phase E file is counted '
        + 'against EXPECTED_PHASE_E_BETS / _BY_PHASE (Steps 20–22) and EXPECTED_PHASE_E_SEEDS (Step 2)',
    }],
  },
  14: {
    claims: [{
      id: 'BEEF-26', coverage: 'full',
      note: 'SHA-256 of BOTH dataset files against the pins in src/loader.ts:8-9; a mismatch or an absent Phase E file is a '
        + 'HARD FAIL scored here (the pre-flight prints and continues so this FAIL branch is reachable; PF_EMIT=1 refuses to '
        + 'run on a mismatch)',
    }],
  },
  15: {
    claims: [{
      id: 'BEEF-05', coverage: 'full',
      note: 'epoch half: exactly EXPECTED_EPOCHS = 121 epochs, every one of 50 bets except the declared multiset [1, 49] '
        + '(the capture-retry split)',
    }],
  },
  16: {
    claims: [
      {
        id: 'BEEF-18', coverage: 'full',
        note: 'survival C(20−m,k)/C(20,k) on all 61 cells; since 2026-09-26 a COUNTING ANCHOR — all 2^20 death-point sets '
          + 'enumerated, no binomial in the survival path — must agree with it, and counted survival × the exact paid '
          + 'multiplier must equal 992/1000 in exact integer arithmetic at every cell; a NEGATIVE CONTROL (edge corrupted to '
          + '991/1000) must be rejected at every cell. No operator win-chance field is read (Phase E step_results carry '
          + 'win_chance; nothing reads it). FAIL probed (survivalProbability corrupted)',
      },
      {
        id: 'BEEF-19', coverage: 'full',
        note: 'derived half: RTP per (difficulty, k) cell = 0.992 exactly by the identity above; a deviating cell FAILs '
          + '(stricter than the profile\'s FLAG, since no cell deviates)',
      },
    ],
  },
  17: {
    claims: [{
      id: 'BEEF-06', coverage: 'partial',
      note: 'Phase D half: 800 bets bound to EXPECTED_PHASE_BETS.D, every one recomputed (a mismatch or unrevealed seed '
        + 'FAILs), 16 distinct player-set client seeds, one per Phase D epoch (reuse FAILs), all 4 difficulties. PARTIAL for '
        + 'the reasons on Step 6 (A–C generator not a CSPRNG; predictable Phase D seeds disclosed, exposed epochs not '
        + 'enumerated by a step)',
    }],
  },
  18: {
    claims: [{
      id: 'BEEF-20', coverage: 'partial',
      note: 'what IS asserted: 4 difficulties × 1,000,000 rounds on pinned seed pairs (src/simulate.ts); the per-config '
        + 'position chi-squared and serial statistics are scored at Bonferroni α/4. PARTIAL: the p-values and RTP are READ '
        + 'from the artifact, not re-derived in verify from its rows (the artifact ships no per-position census), and no '
        + 'part of Pass 1 is replayed by verify; a test:full regeneration is field-diffed against the pinned artifact '
        + 'since 2026-09-26 (Step-independent reproduction gate)',
    }],
  },
  19: {
    claims: [{
      id: 'BEEF-21', coverage: 'partial',
      note: 'what IS asserted: 121 revealed seeds × 10,000 nonces, one row per bet-bearing epoch bound to its '
        + 'serverSeedHashed/clientSeed; every round is one step on tile 0 (src/loader.ts SIM_FIRST_STEP_TILE), which must '
        + 'be the first stepped tile of all 6,450 captured rounds; every EARLY window (nonces 0–49 = the captured range) '
        + 'replayed from the revealed seed and its win count must match; early/late/Test-A p-values, flags, counts and both '
        + 'binomial p-values recomputed; FAIL/FLAG rule on the recomputed figures, every verdict-moving rule a count tested '
        + 'against the 121 seeds, with its false-alarm rate on a fair game computed and printed (rule model and exact '
        + 'discrete window sizes) and refused if over 5% for a FLAG or 1% for a FAIL. Until 2026-10-06 '
        + 'Pass 2 and this replay scored the rotating tile nonce % 20, which is not Beef\'s first-step rule (Mike\'s '
        + 'review, 6 Oct 2026). Seeds off in both windows at p < 0.05 are scored as a count, P(K >= k | Binomial(121, '
        + '0.05 × 0.05)): FLAG at k >= 2, FAIL at k >= 3 (a per-seed rule would false-alarm about 26% of fair games at '
        + '121 seeds); the 1 such seed is disclosed as an observation. PARTIAL: the board is a fixed difficulty 2 '
        + 'single step, not the configs each epoch actually served; late windows are read, not replayed; no detection '
        + 'power is printed',
    }],
  },
  20: {
    claims: [
      {
        id: 'BEEF-13', coverage: 'full',
        note: 'rung arm: all 1,085 non-death Phase E step multipliers against the exact rational C(20,k)/C(20−m,k) at '
          + 'MULT_REL_TOL = 1e-12 (was 1e-6 absolute); worst measured 9.63e-15',
      },
      {
        id: 'BEEF-17', coverage: 'full',
        note: 'per-step multipliers are captured (step_results) and every intermediate rung equals the formula at its '
          + 'depth; a bet with no complete step record (length ≠ reached_k) FAILs; population bound to 450 / E1–E4',
      },
    ],
  },
  21: {
    claims: [
      {
        id: 'BEEF-07', coverage: 'full',
        note: 'Phase E half: 450/450 multi-step rounds recomputed to the served death-point set; an unrevealed seed FAILs',
      },
      {
        id: 'BEEF-17', coverage: 'full',
        note: 'the death-point set recomputed from the seed is the served one for every multi-step round',
      },
    ],
  },
  22: {
    claims: [
      {
        id: 'BEEF-11', coverage: 'full',
        note: 'Phase E half: every win must be a cash-out at its planned target k > 1 (off-plan FAILs) and credit '
          + 'amount × raw × 0.992 at MONEY_REL_TOL (202/202); since 2026-09-26 every Phase E loss must credit exactly "0" '
          + '(248/248) — before that no Phase E loss carried a payout assertion',
      },
      {
        id: 'BEEF-17', coverage: 'full',
        note: 'the cash-out pays stake × the rung multiplier at its target depth (k = 5 / 3 / 5 / 2 for E1–E4)',
      },
    ],
  },
  23: {
    claims: [{
      id: 'BEEF-27', coverage: 'full',
      note: 'every pinned artifact (chi-squared-results.json, determinism-log.json, rtp-convergence.html, '
        + 'simulation-results.json) is hash-checked against src/artifact-pins.ts, an absent or altered one FAILs; each is '
        + 'un-ignored by name in .gitignore; verify writes only to outputs/run/ unless PF_EMIT=1; no artifact of record '
        + 'carries run metadata (simulation-results.json lost generatedAt + 2 executionTimeMs and was re-pinned; '
        + 'verification-results.json lost generatedAt, so the reproduction gate excludes no field); and — added 2026-09-26, '
        + 'ported from Duel Crash/Dice — every numeric leaf of the three committed JSON artifacts (1,083 leaves) is validated '
        + 'against a value domain in src/domains.ts (bounds from src/loader.ts — the simulation plan moved there from '
        + 'src/simulate.ts, values unchanged — and src/rng.ts, never from the artifact) in both directions: inside its '
        + 'domain, and covered by a rule. verification-results.json is the verifier\'s own output and is bound by the '
        + 'reproduction gate, not a pin (as Duel Crash). FAIL probed (M23b: an impossible recomputation count written and '
        + 're-pinned)',
    }],
  },
  24: {
    claims: [{
      id: 'BEEF-14', coverage: 'full',
      note: 'added 2026-09-26, FLAG-only (R2): all 61 (difficulty, k) cells of C(20,k)/C(20−m,k) × 992/1000 compared as '
        + 'exact rationals — strictly increasing in depth (57/57 pairs) and in difficulty (42/42 pairs), counts derived '
        + 'from DEATH_POINTS_BY_DIFFICULTY and bound; the served multipliers Steps 8/20 bind to the formula (5,422 raw + '
        + '4,337 paid, 15 observed cells) strictly increasing across every adjacent observed pair (11 depth, 11 difficulty). '
        + 'Cap half: declarations/duel.beef.json gameModel.limits.maxOdds = null — Duel declares no max-odds cap for Beef, '
        + 'so there is no cap to hold a served value against and no formula cell above one; the largest served paid '
        + '(1.984) and formula (183,277.952) multipliers are printed. Measured 0 violations. FLAG probed (M24: a served '
        + 'difficulty-2 k=1 multiplier set below the difficulty-1 cell)',
    }],
  },
  25: {
    claims: [{
      id: 'BEEF-22', coverage: 'full',
      note: 'added 2026-09-26, informational (a deviation is INFO — reported, never counted, verdict unchanged; profile '
        + 'policy INFORMATIONAL, Mike 2026-09-29): death-point positions of all 6,450 rounds per difficulty against '
        + 'the uniform 20-tile lattice (Pearson × 19/(20 − m), the without-replacement correction, vs χ²(19)) and win rates '
        + 'of the 4 primary difficulties (P = (20 − m)/20) and the 4 Phase E sub-phases (P = C(20−m,k)/C(20,k) at target_k) '
        + 'against the binomial (two-sided exact); 12 tests at Bonferroni 0.01/12. Measured: all 12 above the bound; the '
        + 'smallest is difficulty-2 positions p = 0.0062 (above 0.01/12 = 0.00083, below an unadjusted 0.01). INFO probed '
        + '(M25: every death point counted on tile t mod 10)',
    }],
  },
};

/**
 * Checks this casino's design makes inapplicable — the result of evaluating the profile's `applies`
 * predicate against declarations/duel.beef.json, with the declaration's truth confirmed on the data.
 */
export const NOT_APPLICABLE: Array<{ id: string; reason: string }> = [
  {
    id: 'BEEF-16',
    reason: 'applies = { path: money.balanceField, notNull: true } is false — the declaration sets money.balanceField = '
      + 'null. declarationTruth measured 2026-09-26: a key walk over every record of data/beef-master-6000bets.json and '
      + 'data/beef-phaseE-450bets.json (meta, 139 seed records, 6,450 bets, every Phase E step record) finds NO key '
      + 'matching /balance|wallet/i, so there is no consecutive-bet wallet delta to reconcile. The settle-response credit '
      + 'is verified instead (Steps 7, 10, 22)',
  },
];

/** Checks a package artifact answers rather than a scored step. */
export const PACKAGE_CHECKS: Array<{ id: string; artifact: string; coverage: Coverage | 'none'; note: string }> = [
  {
    id: 'BEEF-09',
    artifact: 'docs/ALGORITHM.md + tests/beef/RngSpecTests.ts + tests/beef/BeefTests.ts (Second check block) + src/operator-verifier.ts + Step 5',
    coverage: 'full',
    note: 'REWRITTEN 2026-10-20 (v1.2.0). src/rng.ts is rebuilt from a written specification, docs/ALGORITHM.md (framework '
      + 'games/beef/ALGORITHM.md), by an implementer who never opened Duel\'s code; Duel\'s published Verify-tab code is run as a '
      + 'second check, not used as the source. Through v1.1.0 src/rng.ts followed that code step for step and cited 17 of its lines '
      + '(OPERATOR_SOURCE_CITES); that code and the citation table are gone. CLOSED 2026-09-26 (was partial: Duel\'s Beef Verify-tab code was not in the workspace). Duel\'s own Beef Verify-tab code, '
      + 'pasted by Paulo from duel.com Verify tab 2026-09-26, is vendored verbatim at evidence/verify-tab/duel-verify-tab-beef-2026-09-26.js '
      + '(E06, SHA-256 43ba4dfb…, never edited) and pinned with its runner in src/operator-verifier.ts. The asserts, each met: (1) "unit '
      + 'tests reproduce at least one captured bet … against the operator\'s published algorithm" — the Second check block in '
      + 'tests/beef/BeefTests.ts EXECUTES the pinned file with only its five "User input values" filled in (gridSize 20, deathPointsCount '
      + 'from the served difficulty) on all 6,450 captured rounds of both datasets: its death points equal the served ones and src/rng.ts '
      + 'on 6,450/6,450; (2) "fixed vectors" — the 7 known-answer bets through the same file, returned set and printed line both exact; '
      + 'and tests/beef/RngSpecTests.ts runs the spec\'s own §5 vectors and properties against src/rng.ts (105/105); (3) "the adapter '
      + 'cites the operator source line it ports" — superseded for this package by the 20 Oct 2026 rule that RNG code is rebuilt from a '
      + 'written spec: nothing is ported, so no operator line is cited; docs/ALGORITHM.md §4 names the source of every step instead '
      + '(Duel\'s public pages, the standard construction, Duel\'s public config, or the 6,450 live rounds). Step 5 runs the same '
      + 'execution in the verifier. The earlier unit tests stay (7 vectors × 4 difficulties, hex-key control, tampered-seed control, '
      + 'full recompute). Where the two can differ, no captured round reaches: at ranges 2, 4, 8 and 16 src/rng.ts accepts every 32-bit '
      + 'chunk while Duel\'s code rejects the top `range` values, and when all 8 chunks of a draw are rejected src/rng.ts throws '
      + '(spec open point O1) while Duel\'s code draws again on the next counter. FAIL probed: M05e (a line of the file changed AND '
      + 're-pinned), M05f (file byte, no re-pin), M05g (runner byte, no re-pin), M05h (runner forged AND re-pinned); M05i (a citation '
      + 'moved) was retired on 20 Oct 2026 with the citation table. Not established: that the Verify button, or Duel\'s server, runs exactly this code',
  },
  {
    id: 'BEEF-23', artifact: 'MANIFEST.md#adversarial-matrix', coverage: 'full',
    note: 'rewritten 2026-09-26 to the framework rows S5-1 … S5-8, each a Pass / Flag / Not tested — disclosed verdict tied to a '
      + 'scored step: S5-1 seed substitution [Steps 1, 2, 14], S5-2 client seed [Steps 6, 17], S5-3 stake-conditional '
      + '[Step 10], S5-4 server-seed cherry-picking [Step 19], S5-5 seed-rotation race (Not tested — disclosed), S5-6 '
      + 'multiplier tampering [Steps 7, 8, 20, 22], S5-7 nonce manipulation [Step 4], S5-8 range-mapping bias [Steps 5, 18]; '
      + 'the former S5-01…S5-10 rows are kept below as supplementary rows',
  },
  {
    id: 'BEEF-25', artifact: 'MANIFEST.md#verify-a-bet', coverage: 'full',
    note: 'since 2026-09-26 the package carries an ordered seven-step "Verify one of your own rounds" (MANIFEST "Verify a bet") '
      + 'paste-path in the declaration\'s field names (the Duel Dice DICE-25 pattern): (1) where the seed is revealed — '
      + 'rotate in the Beef Provably Fair panel (E02); (2) which fields to paste — serverSeed, seed.serverSeedHashed, '
      + 'seed.clientSeed, seed.nonce (0-based), request.difficulty_level and the served response.* fields; (3) the '
      + 'commitment encoding SHA-256(hex_decode(serverSeed)) == seed.serverSeedHashed; (4) the backward Fisher–Yates with '
      + 'the message ${clientSeed}:${nonce}:${cursor} and uint32 rejection; (5) the death-point count per difficulty '
      + '(1/3/5/10); (6) the 0-based fixed-prefix path numbering and the win rule; (7) the multiplier and payout formula',
  },
  {
    id: 'BEEF-28', artifact: 'package.json + tests/verify.ts + MANIFEST.md#reproduce-the-audit', coverage: 'full',
    note: 'measured 2026-09-26 on a fresh `git clone` of ProvablyFair-org/pf-duel-workspace origin/main @ 79aa65b (games/beef at '
      + '8f13658), Node v22.23.1: npm ci exit 0; npm test exit 0 — 21 passing, 22/23 + 1 capture-origin FLAG, Full Pass, REPRODUCED, '
      + 'outputs/run/verification-results.json byte-identical to the committed file; npm run test:full exit 0 in 136 s — the '
      + 'regenerated simulation-results.json and rtp-convergence.html byte-identical to the pinned files. The same npm ci + npm '
      + 'test was re-run on a copy of exactly the files this round will commit (git ls-files incl. untracked-not-ignored) — see '
      + 'MANIFEST. npm test never runs simulate; verify writes only to outputs/run/; engines node 22.x; audit ID PF-2026-DL06; '
      + 'step counts in README/MANIFEST = 25 (23 until Steps 24–25 were added later on 2026-09-26; the fresh-clone runs above '
      + 'predate them)',
  },
  {
    id: 'BEEF-29', artifact: 'tests/mutations.json + scripts/mutate.mjs', coverage: 'full',
    note: 'added 2026-09-26 (runner ported from Duel Video Poker): a step-named registry of mutations (38 on 2026-09-26; 42 '
      + 'since 2026-10-06, when M19b–M19e were added for Step 19) run in a disposable '
      + 'copy by `npm run mutate` (300 s hard timeout per run); each names the step that must die and a marker that must '
      + 'appear, so the INTENDED guard fires; includes forgeries that edit a pinned artifact AND re-pin it (M18, M19) and a '
      + 'site-verifier forgery re-pinned (M05c). Measured 2026-09-26 (re-run after Steps 24–25 and M23b/M24/M25 were added): 33/33 killed; re-run the same day after '
      + 'Duel\'s Verify-tab code was wired into Step 5 (M05e–M05i added: operator file forged AND re-pinned, file and runner edited '
      + 'without re-pin, runner forged AND re-pinned, a citation moved): 38/38 killed, 25/25 scored steps have a killing '
      + 'mutation (the runner reads the scored steps from the baseline run). On 20 Oct 2026 M05i (a citation moved) was retired with '
      + 'the citation table, and M05d and M06 were retargeted to the clean-room src/rng.ts. No declared survivors. The result of the '
      + 'latest run is declared in RELEASE-MANIFEST.json (falsifiability)',
  },
  {
    id: 'BEEF-30', artifact: 'MANIFEST.md#limitations-and-trust + MANIFEST.md#evidence', coverage: 'full',
    note: 'MANIFEST.md carries (since 2026-09-26; DL-10 added 2026-10-05, DL-11 2026-10-06) the declared-limitations register DL-1 … DL-11, each with its measured '
      + 'magnitude and where it is enforced or disclosed, and the Load-Bearing Premises table with ASSUMED markers; '
      + 'MANIFEST Evidence numbers every exhibit E01–E07 with its role and both dataset SHA-256; no internal QA folder ships',
  },
];

/** The block emitted alongside the step results. */
export function profileCoverageBlock(): Record<string, unknown> {
  return {
    game: PROFILE_GAME,
    profileVersion: PROFILE_VERSION,
    notApplicable: NOT_APPLICABLE,
    packageChecks: PACKAGE_CHECKS,
  };
}

/** The label fields for one scored step, to be merged into its emitted record. */
export function labelFor(step: number): Record<string, unknown> {
  const entry = STEP_CLAIMS[step];
  if (!entry) return { profileIds: [], profileChecks: [], profileNote: 'no mapping declared for this step' };
  return entry.claims.length
    ? { profileIds: entry.claims.map(c => c.id), profileChecks: entry.claims }
    : { profileIds: [], profileChecks: [], profileNote: entry.reason ?? 'no reason given' };
}
