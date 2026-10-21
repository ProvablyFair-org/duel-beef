# Duel Beef — Provably Fair Audit

**Auditor:** [ProvablyFair.org](https://www.provablyfair.org) · **Audit ID:** PF-2026-DL06 · **Release:** `v1.2.0` · **Capture:** 16–21 April 2026

**Result: PROVABLY FAIR — Full Pass.** Every death-point layout in the 6,450-bet dataset (6,000 primary + 450 Phase E multi-step) reproduces from (serverSeed, clientSeed, nonce). The verifier reports 24 passing steps of 25, one disclosed capture-origin flag and no hard failures. The flag is Step 4: two nonces the capture missed on retried requests, one per data file; their death points are reconstructed from the revealed seeds, but the rounds were not captured. It is verdict-neutral. Step 19, the seed-selection test, passes and discloses one observation: one of the 121 casino seeds (commitment `c9ddfba9…7121b568`, client seed `Ty1rZcxKscWFXxqt`) is off in both of its windows, 36 wins in its first 50 nonces (p = 0.010042) and 8,387 in the next 9,950 (p = 0.047777), against the 85% first-step win chance on tile 0, Beef's first tile. A fair game gives at least one such seed among 121 about one time in four, so the step tests the count of such seeds: 2 would be a FLAG, 3 a FAIL.

**Scope:** Theoretical RTP is **99.2000% on all four difficulty levels**, a flat 0.8% house edge (multiplier × survival probability = 0.992 for all 61 difficulty and step cells), derived without casino-supplied probabilities. `effective_edge = 0.8` was served on all 6,000 primary bets. Duel added a 0.8% rakeback on Beef under its Zero Edge allowance after the capture; it is not part of the game's paytable and is not audited here. The certified RTP is the game's 99.2%. Empirical RTP over those bets is 96.3737%, driven by 200 $10 bets that carry 97% of the stake (the $0.01 bets returned 99.52%); it is informational. The audit covers one account: multi-account seed sharing was not tested, and seed cherry-picking is tested statistically (Pass 2) with no cryptographic guarantee without an external randomness beacon.

## What was verified

| Check | Captured evidence |
|---|---|
| Death points | 6,000 / 6,000 primary and 450 / 450 Phase E layouts recomputed by `src/rng.ts`, 0 mismatches. `src/rng.ts` was rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened Duel's code; Duel's published Verify-tab code is run as a second check, not used as the source ([details](MANIFEST.md#operator-and-player-verifier-code)) |
| Payouts | 6,000 payouts checked at relative tolerance 1e-12, 0 errors; 4,337 winning multipliers equal C(20,k)/C(20−m,k) × 0.992 |
| Multi-step (Phase E) | 1,085 rung multipliers in 15 (difficulty, k) cells; 202 cash-outs at k>1 and 248 losses settle correctly |
| Seed records | 121 bet-bearing seeds hash to their commitments; 124/124 primary and 13/13 Phase E forward links |
| Stake and client seed | 200 $10 bets pay by the same formula; 800 Phase D bets on 16 client seeds recompute |
| Theoretical RTP | 99.2000% on all 61 cells, exact identity checked by Step 16 |
| Simulation evidence | 4,000,000 Pass 1 rounds (mean RTP 99.1468%); Pass 2 on 121 revealed casino seeds, one step on tile 0 per round: Test A 0/121, Test B 2/121 (binomial p = 0.985), 1 seed off in both windows at p < 0.05 (count p = 0.261; a flag needs 2), 0 at p < 0.001; each rule's false-alarm rate on a fair game is stated in the [overview](MANIFEST.md#step-19-rules-and-false-alarm-rates) |
| Player verification | Duel's own Verify-tab code (the second check) and a pinned copy of the ProvablyFair.org docs-site verifier both reproduce all 6,450 rounds |

Hash matching and the forward commitment chain establish consistency of the supplied records. Coverage gaps, capture seeds and residual operator trust are retained in the [overview's limitations](MANIFEST.md#limitations-and-trust).

## Run the audit

Open a terminal in the `beef` package directory. Use **Node 22.x**, as declared in [.nvmrc](.nvmrc) and [package.json](package.json).

```sh
npm ci
npm test
```

Expected: **25 unit tests pass; 24/25 PASS + 1 capture-origin FLAG (Step 4); zero hard failures; PROVABLY FAIR — Full Pass; REPRODUCED; exit 0.** This replays every captured bet, checks the pinned evidence and compares fresh verification results with the committed artifacts. It scores the stored simulation; it does not rerun it. The exit code is the verdict: `0` PROVABLY FAIR — Full Pass · `2` PROVABLY FAIR — Conditional Pass · `5` RTP FIGURE OVERSTATED (the RTP-CLAIM rule 1.2.0 found a published RTP figure above the game's real RTP; the draws pass) · `1` NOT PROVABLY FAIR, or a reproduction difference.

**RTP claim (RTP-CLAIM 1.2.0, switched on).** All 61 difficulty and cash-out cells are held to the flat 99.2% (house edge 0.8%) in Duel's game settings: the `effective_edge` 0.8 served with every Beef bet, on payout tables built on 0.992. Scored on Step 16: PASS, 0 of 61 cells beyond the 0.1 pp band ([table](outputs/rtp-claim-table.json)).

```sh
npm run test:full                 # optional: also regenerates the simulation into outputs/run/
node scripts/release-manifest.mjs --check
```

Ordinary runs write to `outputs/run/` and leave the evidence of record intact. See [reproduction details](MANIFEST.md#reproduce-the-audit) for the comparison rules, exit codes, mutation battery and deliberate artifact-refresh procedure.

## Verify a bet

Rotate your seed pair in the Beef Provably Fair panel to reveal the server seed. Check `SHA-256(hex_decode(serverSeed))` against the commitment, recompute the backward Fisher–Yates shuffle, take the first 1 / 3 / 5 / 10 tiles for your difficulty as death points, and, on a winning cash-out, check the paid multiplier `C(20,k)/C(20−m,k) × 0.992`. A loss ends on its first death point and credits 0; its paid multiplier is recorded as null. The [complete seven-step instructions](MANIFEST.md#verify-a-bet) include a runnable function. This audit ran a pinned copy of the ProvablyFair.org docs-site verifier on all 6,450 rounds; the live [ProvablyFair.org verifier](https://www.provablyfair.org/verify-bets) page itself was not checked.

## Files and evidence

There are two documentation files: this README and [MANIFEST.md — consolidated audit overview](MANIFEST.md). The overview contains the game rules, algorithm, RTP derivation, verification results, evidence, limitations and release history.

- [Primary dataset](data/beef-master-6000bets.json) — SHA-256 `d654ef7c6195584501e9033202d5acad13a16d89d296baab8befc0240fb36d36`.
- [Phase E dataset](data/beef-phaseE-450bets.json) — SHA-256 `ef39d7f584cdb6d8057e846cdcb9b4ffcc60495bfcce8443d15bb910a9c51001`.
- [Verification results](outputs/verification-results.json), [RTP claim table](outputs/rtp-claim-table.json) and [release manifest](RELEASE-MANIFEST.json).
- [Audit report](https://audit.provablyfair.org/casino/duel/games/beef/overview) · [Public repository](https://github.com/ProvablyFair-org/duel-beef) · [MIT license](LICENSE).

The consolidation, the 6 October 2026 changes to Step 19 and the 19 October 2026 wording changes are recorded in the [release history](MANIFEST.md#release-history).
