# Duel Beef — Consolidated Audit Overview

**Audit ID:** PF-2026-DL06 · **Auditor:** ProvablyFair.org · **Release:** `v1.2.2` · **Framework:** 1.1

Game: Beef (Cross-Road) on [Duel.com](https://duel.com). Audit date: April 2026. Capture window across both data files: `2026-04-16T18:49:34.137Z` to `2026-04-21T15:54:58.815Z`. Original publication: 4 June 2026. Runtime: Node 22.x (`package.json` `engines`, `.nvmrc`). Audit report: https://audit.provablyfair.org/casino/duel/games/beef/overview. This overview consolidates the package documentation. The machine-readable release identity remains in [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json).

## Conclusion and scope

**PROVABLY FAIR — Full Pass.** Of 25 scored verification steps, 24 PASS and 1 is a capture-origin FLAG (Step 4: the two capture-retry nonce gaps, one per data file; disclosed, verdict-neutral). There are 0 verdict-affecting flags and 0 hard fails. Step 19, the seed-selection (cherry-pick) test, passes. With each round scored on tile 0, Beef's actual first tile, one of the 121 casino seeds is off in both of its windows at p < 0.05 (commitment `c9ddfba9…7121b568`, client seed `Ty1rZcxKscWFXxqt`: early 36/50 wins, p = 0.010042; late 8,387/9,950, p = 0.047777). It is disclosed as an observation. A fair game gives at least one such seed among 121 about one time in four (P = 0.261), so Step 19 scores the count of such seeds against the number tested: 1 of 121 is not a flag, 2 would be a FLAG and 3 a FAIL. Each rule that can move the verdict states its false-alarm rate on a fair game ([Step 19 rules](#step-19-rules-and-false-alarm-rates)). Every death-point layout in the 6,450-bet dataset (6,000 primary + 450 Phase E multi-step) was reproduced from (serverSeed, clientSeed, nonce) by `src/rng.ts`, the backward Fisher-Yates shuffle with HMAC-SHA256 rejection sampling. `src/rng.ts` was rebuilt from a written specification ([`docs/ALGORITHM.md`](docs/ALGORITHM.md)) by an implementer who never opened Duel's code. Duel's published Verify-tab code (E06), run unmodified, is a second check, not the source, and agrees on every round ([Operator and player verifier code](#operator-and-player-verifier-code)). All payout formulas were confirmed to machine precision, with zero deviations from the published algorithm.

**Theoretical RTP is 99.2000% on all four difficulty levels, a flat 0.8% house edge.** For every one of the 61 (difficulty, step) cells, multiplier × survival probability = 0.992, derived from the combinatorial death-point distribution without casino-supplied probabilities or payout tables (Step 16). `effective_edge = 0.8` was served on all 6,000 primary bets (Step 12). The edge is the same at every stake in the duel.com Beef config as fetched 2026-10-05 in a logged-in session (read-only GET): the config has no `scaling_edge` (E07). After the capture, Duel added a 0.8% rakeback on Beef under its Zero Edge allowance. It is not part of the game's paytable and is not audited here; the certified RTP is the game's 99.2%. Empirical RTP over the 6,000 primary bets is 96.3737%. Beef is high-variance; that figure is informational and not scored.

Two limitations remain from the original conclusion:

1. **No external randomness beacon.** The server generates seeds unilaterally. Cherry-pick risk is structurally present but statistically undetected (Step 19 PASS; the one seed off in both windows, above, is within what a fair game produces).
2. **Single-account audit.** Multi-account seed sharing was not tested.

The declared limitations DL-1 … DL-11 and the load-bearing premises P1–P6 are in [Limitations and trust](#limitations-and-trust).

None of the hard-fail conditions was triggered:

| Criterion | Status |
|-----------|--------|
| Death-point mismatch | 0 / 6,000 primary; 0 / 450 Phase E |
| Payout math error | 0 / 6,000 |
| Win condition error | 0 / 6,450 (Step 9, both files) |
| Seed hash verification failure | 0 / 121 |
| Anti-circularity deviation > 0.01% | No (max: 2.22e-16) |
| Simulation chi-squared failure (Bonferroni) | 0 / 4 |
| Cherry-pick: seeds off in both windows (FAIL at 3 or more of 121 at p < 0.05, or 1 at p < 0.001) | 1 / 121 at p < 0.05 (P = 0.261; a FLAG needs 2); 0 / 121 at p < 0.001 |

## Contents

- [Dataset and capture](#dataset-and-capture)
- [Game and algorithm](#game-and-algorithm)
- [Payouts and RTP](#payouts-and-rtp)
- [Verification results](#verification-results)
- [Reproduce the audit](#reproduce-the-audit)
- [Verify a bet](#verify-a-bet)
- [Evidence](#evidence)
- [Limitations and trust](#limitations-and-trust)
- [Terms](#terms)
- [Release history](#release-history)

## Dataset and capture

Live bet data was collected via browser session interception during active play on Duel.com Beef, using a test account funded by ProvablyFair.org. API responses were recorded in five structured phases:

| Phase | Bets | Stake | Difficulty | Purpose |
|-------|------|-------|------------|---------|
| A | 4,000 | $0.01 | All 4 (1–4) | Baseline — full difficulty coverage (1,000 each) |
| B | 1,000 | $0.01 | 4 (EXPERT) | High-death-point statistical validation |
| C | 200 | $10.00 | 2 (MEDIUM) | High-stake payout verification |
| D | 800 | $0.01 | Random (1–4) | Custom client seed variation test |
| E1 | 100 | $0.01 | 1 (EASY) | Multi-step k=5 — multiplier chain + death-point invariance |
| E2 | 100 | $0.01 | 2 (MEDIUM) | Multi-step k=3 — multiplier chain + death-point invariance |
| E3 | 150 | $0.01 | 3 (HARD) | Multi-step k=5 — multiplier chain + death-point invariance |
| E4 | 100 | $0.01 | 4 (EXPERT) | Multi-step k=2 — multiplier chain + death-point invariance |

Phases A–D use single-step bets (start → step → cashout). Phase E uses multi-step bets (start → step × target k → cashout) to verify the multiplier chain and death-point invariance at k > 1.

Each bet record stores the request payload (`amount`, `difficulty_level`) and response (`round_id`, `outcome`, `difficulty_level`, `path_length`, `current_step`, `mines_positions`, `multiplier`, `no_house_edge_multiplier`, `amount_won`, `amount_currency`, `transaction_id`, `effective_edge`), along with the associated seed commitment (`serverSeedHashed`, `clientSeed`, `nonce`). Phase E bets also store `step_results` (per-step multiplier, status and `current_step` array), `cashed_out` and `reached_k`.

| Metric | Value |
|--------|-------|
| Primary seed entries | 125 |
| Phase E seed entries | 14 |
| Bet-bearing epochs (primary) | 121 |
| Phase-boundary / end-of-capture entries (primary) | 4 |
| Revealed seeds | 121 (primary) + 10 (Phase E) distinct seeds; `serverSeed` is present on all 125 + 14 seed rows, counting `seeds[0]` of each file, filled after capture (see below) |
| Bets per epoch | 1–50 (most are 50) |

Every phase begins with a seed rotation that establishes the new epoch's commitment, Phase A included: `seeds[0]` is Phase A's opening rotation (context `rotate-phase-A`), timestamped 2.3 s before Phase A's first bet, which is served under its `serverSeedHashed`. Every seed row in both data files records the same fields, except that `seeds[0]` has no `revealedFrom` (see below).

| Input | SHA-256 | Contents |
|-------|---------|----------|
| [data/beef-master-6000bets.json](data/beef-master-6000bets.json) | `d654ef7c6195584501e9033202d5acad13a16d89d296baab8befc0240fb36d36` | 6,000 bets, 125 seed entries; phases A (4,000), B (1,000), C (200), D (800) |
| [data/beef-phaseE-450bets.json](data/beef-phaseE-450bets.json) | `ef39d7f584cdb6d8057e846cdcb9b4ffcc60495bfcce8443d15bb910a9c51001` | 450 bets, 14 seed entries; E1 (100), E2 (100), E3 (150), E4 (100); multi-step verification that resolves the k=1-only limitation of the baseline phases |

The population is bound to code constants in `src/loader.ts` (bet, seed, phase and epoch counts), not to the dataset's own header. The verification suite checks both hashes at startup and scores them in Step 14. A mismatch on either file, or an absent Phase E file, is a hard FAIL (verdict NOT PROVABLY FAIR, exit 1). `PF_EMIT=1` refuses to run on a mismatched dataset, so it can never overwrite the committed evidence.

The capture was made with two browser-console scripts: one for all five phases A–E, controlled with `beef.go()`, `pause()`, `save()`, `status()` and `clear()`, and one for Phase E alone (`beefE.*`). The runnable scripts place bets on duel.com, so they are kept in the private audit workshop and are not published. This package ships their two reference records under `capture/`:

| File | What it is |
|------|------------|
| [capture/beef-capture.reference.js](capture/beef-capture.reference.js) | Reference record of the all-phases capture script, with the banner, the console controls and the call removed, so it does not run |
| [capture/beef-capture-phaseE.reference.js](capture/beef-capture-phaseE.reference.js) | Reference record of the Phase E capture script, made the same way |

The line numbers this overview cites are the reference records' lines. The code that writes the saved file's `meta` (each script's `save()`) is among what was removed, so which revision of a script wrote each data file cannot be checked from this package. What can be checked: the Phase E file's `meta.schema` is `duel-beef-capture-phaseE-v1`, and the primary file's `meta` carries `schema` `duel-beef-capture` with only `createdAt` and `completedAt` beside it. In the workshop's runnable scripts, `save()` writes `duel-beef-capture-phaseE-v1` for Phase E and `duel-beef-capture-v2` with `phaseBetCounts` for all phases, so the primary file came from an earlier revision of the all-phases script. That revision is not in the workshop's git history: the script first appears there already writing `duel-beef-capture-v2`, in `be5779b`, the commit that first holds the data files. The capture rig set the client seeds itself: `Math.random()` in Phases A–C and E (DL-2) and predictable `'pfaudit' + Date.now().toString(36)` strings in Phase D (DL-3).

In each data file `seeds[0].seed.serverSeed` was `null` as captured: the first rotation has no earlier bet to read the reveal from (`capture/beef-capture.reference.js:308`; for the Phase E file `capture/beef-capture-phaseE.reference.js:414`), and `seeds[0]` is the only row in each file without a `revealedFrom` transaction. It was filled in after capture with the plaintext from `seeds[1]`, which reveals the same seed and hashes to `seeds[0].serverSeedHashed`. No commit records the edit: both files already carry it, at their pinned SHA-256, in the first commit that holds them (`be5779b`, 20 May 2026) and in the original publication (`05530ee`, 4 June 2026), so it was made after the capture and by 20 May 2026. No bet and no recomputation depends on it; Step 1's count of 125 revealed primary seed rows includes it.

## Game and algorithm

Duel.com Beef is a mine-avoidance game on a 20-tile grid [E01]. The player steps through tiles without hitting a hidden death point. Each successful step increases the payout multiplier; the player can cash out at any point or continue for a higher multiplier.

| Parameter | Options |
|-----------|---------|
| Bet amount | $0.01 – varies by account |
| Difficulty | EASY (1 death point), MEDIUM (3), HARD (5), EXPERT (10) |
| Grid size | 20 tiles (constant across all difficulties; `path_length` is `20` in every API response) |

| Difficulty | Level ID | Death Points | Max Steps | First-Step Win Chance |
|------------|----------|-------------|-----------|----------------------|
| EASY | 1 | 1 | 19 | 95.00% |
| MEDIUM | 2 | 3 | 17 | 85.00% |
| HARD | 3 | 5 | 15 | 75.00% |
| EXPERT | 4 | 10 | 10 | 50.00% |

Outcome determination:

1. The server generates a random permutation of `[0, 1, ..., 19]` using a backward Fisher-Yates shuffle seeded by HMAC-SHA256(serverSeed, clientSeed:nonce).
2. The first `deathPointsCount` positions in the permutation, sorted ascending, are the death points.
3. The player steps one tile at a time along the fixed path 0, 1, 2 …. If the tile is a death point, the outcome is "loss". If not, the player can cash out (win) or continue.
4. **Win:** outcome = "win" when all stepped tiles are safe; `amount_won = amount × payout_multiplier`.
5. **Loss:** outcome = "loss" when any stepped tile is a death point; `amount_won = 0`.

Unlike Mines, which typically reveals a single tile, Beef lets the player step multiple tiles before cashing out. The `current_step[]` array contains all tiles stepped on; the win condition checks all entries against `mines_positions`, and the multiplier corresponds to k = `current_step.length`. In Phases A–D most bets are single-step (k=1), since the capture script used an auto-cashout-after-one-step strategy.

The round uses these endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v2/cross-road/config` | GET | Returns difficulty configs, payout tables, probabilities |
| `/api/v2/cross-road/active` | GET | Returns active round state (if any) |
| `/api/v2/cross-road/start` | POST | Start a new round (`{amount, difficulty}`); the server looks up the active (serverSeedHashed, clientSeed, nonce), computes the death points and returns `round_id`, `path_length=20` |
| `/api/v2/cross-road/step` | POST | Step on a tile (`{round_id, tile_index}`); a death point ends the round as a loss, a safe tile returns the updated state |
| `/api/v2/cross-road/cashout` | POST | Cash out (`{round_id}`); the server computes the multiplier for the steps taken and credits amount × payout_multiplier |
| `/api/v2/client-seed` | GET | Current seed state |
| `/api/v2/client-seed/rotate` | POST | Rotate to new seed epoch |
| `/api/v2/user/security/token` | POST | Refresh security token (expires ~10 min) |

### Shuffle and rejection sampling

The algorithm below is specified in [`docs/ALGORITHM.md`](docs/ALGORITHM.md), written from Duel's public pages, the standard provably-fair construction, Duel's public Beef config and the 6,450 live rounds, without Duel's code; each step there names its source. `src/rng.ts` implements that specification. It is the HMAC-SHA256 backward Fisher-Yates shuffle of 20 positions with per-draw rejection sampling, the same structure as Duel.com Mines (25-tile grid) and Keno. Its first N positions (N = 1 / 3 / 5 / 10 by difficulty), sorted ascending, are the round's death points.

```
key = hexDecode(serverSeed)
a   = [0, 1, ..., 19]
for t from 0 to 18:                          # draw index
  i      = 19 - t
  r      = i + 1                             # ranges 20, 19, ..., 2
  LIMIT  = floor(2^32 / r) * r
  digest = HMAC-SHA256(key, clientSeed + ":" + nonce + ":" + t)
  j      = (first 4-byte big-endian chunk v of digest with v < LIMIT) mod r
  swap a[i] <-> a[j]
deathPoints = a[0 .. N-1], sorted ascending
```

The server seed is a 64-character hex string representing 32 bytes. The HMAC key is `Buffer.from(serverSeed, 'hex')`: hex-decoded bytes, not the UTF-8 string. Using the wrong encoding produces entirely different outputs. The audit confirmed the 64-character length for all revealed seeds.

Each draw accepts only chunk values below `LIMIT`, a whole number of ranges, which eliminates modulo bias. Step 5 measures this from `src/rng.ts` on all 19 ranges 2–20: every accepted window is a whole number of ranges (range 20: 4294967280 = 20 × 214748364; at ranges 2, 4, 8 and 16 the whole 2^32 domain already is, so nothing is rejected), so every swap index is exactly equiprobable, worst bias 0, inside the 2^-32 ceiling. What happens if all 8 chunks of one digest are rejected is not settled by any public source (`docs/ALGORITHM.md` open point O1), so `src/rng.ts` stops with an error rather than guess; for ranges ≤ 20 that has probability at most (16/2^32)^8 ≈ 4 × 10⁻⁶⁸ per draw. The Step 5 census over the 6,000 primary rounds found 0 rejected chunks in 114,000 draws.

Duel's Verify-tab code (E06) differs from this specification in two places no captured round reaches. At ranges 2, 4, 8 and 16 its bound is `0xFFFFFFFF − (0xFFFFFFFF % r)` = 2^32 − r, so it rejects the top r chunk values, which the specification accepts, and moves to the next chunk. When all 8 chunks are rejected it increments the HMAC counter and draws again. Both bounds are whole numbers of ranges, so both draws are unbiased.

Beef does **not** use an external randomness beacon (drand). The RNG depends only on the server seed (committed pre-epoch by SHA-256 hash), the client seed (player-controlled) and the nonce (sequential counter, 0-based per epoch). The server therefore generates seeds without external constraint; the cherry-pick assessment is in [Limitations and trust](#limitations-and-trust).

Worked example from the first revealed epoch in the dataset: serverSeed `fcf0584ae26b61deecc138adfc788ef039d69814c172a7d71667b5c9cdc661fb`, clientSeed `8AgNlaGR1fxeiy93`, nonce 1, difficulty_level 2 (MEDIUM, deathPointsCount = 3). Computed death points `[1, 9, 15]`; API `mines_positions` `[1, 9, 15]`; match. This is the nonce 1 known-answer vector in `tests/beef/BeefTests.ts`. The TypeScript implementation in [src/rng.ts](src/rng.ts), rebuilt from [`docs/ALGORITHM.md`](docs/ALGORITHM.md), reproduced the death points of all 6,450 bets (6,000 primary + 450 Phase E) with zero mismatches.

### Seed lifecycle and commitment chain

1. The server commits to a server seed hash before the epoch begins.
2. The player sets a client seed (browser-generated or custom).
3. Each bet increments a nonce (0, 1, 2, ...).
4. The player rotates seeds when they choose. Only then does the server reveal the previous server seed and commit to a new one. This capture's scripts rotated after 50 bets (`BETS_PER_EPOCH = 50`, `capture/beef-capture.reference.js:36` and `capture/beef-capture-phaseE.reference.js:27`); that schedule is the capture's, not Duel's.
5. The revealed server seed can be verified: `SHA-256(hex_decode(serverSeed)) === serverSeedHashed`.

Duel.com's fairness modal and the `/api/v2/client-seed` API both display a "Next server seed (Hashed)": a pre-commitment to the server seed used after the player rotates. Step 2 checks that each rotation's new active hash equals the "next" hash recorded before it (promotion), walks the forward chain (`seeds[i].nextServerSeedHash` must equal `seeds[i+1].serverSeedHashed` at every one of the 124 transitions) and checks the pre-capture link (the first epoch's active hash equals the "next" hash read before the capture's first rotation). In this capture these are one comparison, not three independent properties: the capture scripts copied each rotation's `next_server_seed_hash` into both that row's `nextServerSeedHash` and the next row's `previousNextHash` (`capture/beef-capture.reference.js:294`, `:299`, `:304`; `capture/beef-capture-phaseE.reference.js:400`, `:405`, `:410`), so a promotion is the same check as the forward link before it, and the pre-capture link is the promotion at row 0. Hash equality shows the records are consistent with each rotation activating the seed already published as "next". That the "next" hash was shown before the rotation that activated it rests on the capture's write order, not on the hashes ([Limitations and trust](#limitations-and-trust), premise P1).

| Metric | Value |
|--------|-------|
| Total seed entries (primary) | 125 |
| Next-seed promotions recomputed from raw hex | 125 / 125 |
| Promotion mismatches | 0 |
| Forward chain links verified | 124 / 124 |
| Pre-capture link into the first epoch | Present |
| Phase E file | 14/14 promotions, 13/13 forward links, pre-capture link present |

### Client seed origin

The client seed shown in the Provably Fair panel is generated by the player's browser before any bet is placed. On rotation the browser submits the new client seed via `POST /api/v2/client-seed/rotate`. The server's response contains only the new `server_seed_hashed` commitment, the `next_server_seed_hash`, the echoed `client_seed` (the value the client submitted) and the reset `nonce`. The server does not generate or assign the client seed; it echoes back what the player sent.

How the browser produces the default value is visible in Duel.com's live JS bundle (E05, an annotated DevTools capture of `assets/index-DlvddfIT.js` dated 2026-06-03). A random-string generator draws each character from a 63-character alphabet (`A–Z a–z 0–9 _`) using an index obtained by rejection sampling over `crypto.getRandomValues`. Values at or above `4294967295 − (4294967295 % alphabetLength)` are discarded, so the index is unbiased. The seed-rotation component `FairnessNextSeed.vue` calls that generator with length 16 to pre-fill the "New client seed" field. The server receives the value only when the player submits the rotation.

| Property | Result |
|----------|--------|
| Client seed generated by | Browser (client-side) |
| Player can change client seed | Yes — via seed rotation UI |
| Server commits before client seed is known | Yes — `server_seed_hashed` is published at rotation |
| **Verdict** | **Full Pass** |

The capture itself did not use this generator; its client seeds came from the capture script (DL-2, DL-3).

### Operator and player verifier code

Duel's own Beef verification code (E06) was pasted by ProvablyFair.org from the duel.com Verify tab on 2026-09-26 and saved verbatim. Step 5 and the unit tests execute it with only its five "User input values" filled in on all 6,450 rounds of both datasets: its death points equal the served ones and `src/rng.ts` on 6,450/6,450. It is a second check, not the source of `src/rng.ts` (BEEF-09). This does not establish that the Verify button, or Duel's server, runs exactly this code.

Since v1.2.0 (20 October 2026) `src/rng.ts` is rebuilt from the written specification [`docs/ALGORITHM.md`](docs/ALGORITHM.md) by an implementer who never opened Duel's code; Duel's published Verify-tab code is run as a second check, not used as the source. Through v1.1.0 `src/rng.ts` followed Duel's Verify-tab code step for step (its shuffle was written that way in the package's first commit, `be5779b`, 20 May 2026) and, from 26 September 2026, cited 17 of its lines; that code and the citation table were removed. The specification was fixed by Duel's public pages, the standard construction and the live rounds (its §2 lists each variant tried and its score on the 6,450 rounds), so a mistake in Duel's code is not copied into the check of it. Step 5 measures the agreement of the rebuild, Duel's code and the 6,450 served rounds on every run. The two codes can differ only where no captured round reaches ([Shuffle and rejection sampling](#shuffle-and-rejection-sampling)). The theoretical RTP (Step 16) is derived from the death-point combinatorics, not from the shuffle code.

The ProvablyFair.org docs-site Beef verifier (`VerifyBets/games/beef/derive.js` + `lib/hmac-sha256.js`, mikepforg/pf-audit-duel `origin/main` @ `bd4d59c`) is vendored under [verifier-parity/](verifier-parity/) and pinned in `src/site-verifier.ts` (derive.js `0003d6347506334f27b2159d73d6552cd19c39d52348dd97e6270b6293e592d3`, hmac-sha256.js `bc30bfe9ef202905ece93de33440d41851abf16e910f90c2a567774a2b79d889`). Step 5 executes it on all 6,450 rounds of both datasets with 0 death-point disagreements (BEEF-24). The live page (www.provablyfair.org/verify-bets) is a separate build and is not checked.

## Payouts and RTP

### Multiplier formula

For a player who has completed k steps with m death points on the 20-tile grid:

```
raw_multiplier    = C(20, k) / C(20 - m, k)
payout_multiplier = raw_multiplier × (1 - 0.008) = raw_multiplier × 0.992
```

The API field `multiplier` is the raw (pre-edge) value. The field `no_house_edge_multiplier` is a misnomer: it is the paid multiplier and includes the 0.8% house edge deduction.

| Difficulty | m | Win Chance (k=1) | Raw (API `multiplier`) | Payout (API `no_house_edge_multiplier`) | RTP |
|------------|---|-----------|----------|-------------|-----|
| EASY | 1 | 95.00% | 1.05263158 | 1.04421053 | 99.2000% |
| MEDIUM | 3 | 85.00% | 1.17647059 | 1.16705882 | 99.2000% |
| HARD | 5 | 75.00% | 1.33333333 | 1.32266667 | 99.2000% |
| EXPERT | 10 | 50.00% | 2.00000000 | 1.98400000 | 99.2000% |

The captured k=1 values match the expected raw and payout multipliers in all four rows. With 10 death points (EXPERT) exactly half the tiles are lethal and at most 10 safe steps are possible: the full-traversal cell is `C(20,10)/C(10,10) × 0.992 = 184,756 × 0.992`, the largest formula multiplier, 183,277.952 (Step 24 data block). With 1 death point (EASY) 19 of 20 tiles are safe and the multiplier grows slowly (k=1: 1.044×; k=19: 19.84×). No max-odds cap is declared for Beef. The largest served paid multiplier is 1.984 in the primary file (all k = 1; the figure Step 24 prints, from the primary wins) and `5.121534465534441051` in the Phase E file (E3, HARD, k = 5).

### House edge

The house edge is 0.8% flat across all difficulty levels and step counts (edge factor 0.992, applied to the payout multiplier). The `effective_edge` field in every API response is `0.8` (representing 0.8%). No rakeback applied to the captured bets: every bet was served `effective_edge` 0.8 and paid stake × raw multiplier × 0.992. The edge does not scale with the stake in the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET): `GET /api/v2/cross-road/config` (E07) returns `payout_tables`, `probabilities` and `difficulty_levels` and no `scaling_edge`. The capture paid the same formula at $0.01 and $10 (Step 10), and no bet above $10 was placed; the config lists one payout table per difficulty with no stake dimension.

### Settlement checks

- **Step 7, payout math.** Wins: `amount_won ≈ amount × no_house_edge_multiplier` at a relative tolerance of 1e-12 (`MONEY_REL_TOL` in `tests/steps/context.ts`, shared by every payout comparison in the suite). Losses: `amount_won === '0'`. 6,000 bets checked, 0 errors.
- **Step 8, multiplier formula.** For the 4,337 winning bets, `m` is the death-point count of the bet's difficulty and `k = current_step.length`. Both served 18-decimal strings are parsed exactly and compared with the exact rational (`src/exact.ts`) at relative 1e-12; until 26 Sep 2026 the comparison was an absolute 1e-6 on parsed doubles. 0 mismatches. The worst deviation is 5.0e-19 on these k = 1 wins and 9.63e-15 on the Phase E k > 1 values, which carry the operator's double-precision rounding (DL-7).
- **Step 10, Phase C bet-size invariance.** 200 Phase C bets at $10.00 (MEDIUM), 165 wins: multiplier formula identical to Steps 7–8, payout math 0 errors. This confirms the same payout formula at $10 as at $0.01, the two stakes captured.
- **Step 12, house edge.** `effective_edge === 0.8` on 6,000 bets, 0 deviations, consistent across all difficulty levels, phases and both captured bet sizes ($0.01 and $10).
- **Steps 20 and 22, multi-step.** 1,085 rung multipliers across 450 Phase E bets and 15 (difficulty, k) combinations, 0 mismatches; 202/202 winning Phase E bets verified at their planned target k>1 (k=2:27, k=3:67, k=5:108), 0 errors; 248/248 Phase E losses credit exactly 0.

Live play observes 15 of the 61 (difficulty, k) payout cells (Step 11, including all 15 the capture plan in `src/loader.ts` requires). The 46 unexercised cells are named in the step's data block and carry the same theoretical RTP, proven for every cell in Step 16 (DL-5).

### Theoretical RTP

The theoretical RTP is derived independently of any casino-supplied data. For a 20-tile grid with m death points and k steps completed:

```
survival(m, k)   = C(20-m, k) / C(20, k)            // hypergeometric
multiplier(m, k) = C(20, k) / C(20-m, k) × 0.992    // payout with 0.8% edge

RTP(m, k) = survival(m, k) × multiplier(m, k)
          = [C(20-m,k)/C(20,k)] × [C(20,k)/C(20-m,k) × 0.992]
          = 0.992
```

`survival(m, k)` is the probability that the shuffle's first k positions avoid all m death points: a combinatorial consequence of the shuffle, not a per-step threshold draw. The survival probability and multiplier cancel exactly, leaving a flat RTP of 99.2% for every difficulty level and every step count. Step 16 checks all 61 valid (difficulty, step) combinations: maximum deviation from 0.992 is 2.22e-16 (floating-point epsilon), within the 1e-10 bound. Its counting anchor enumerates all 2^20 death-point sets and gives exactly 992/1000 in integer arithmetic at every cell; a negative control (edge 991/1000) is rejected at all 61. No casino-supplied probabilities or payout tables were used.

`outputs/rtp-claim-table.json` scores all 61 difficulty and cash-out cells against a flat 99.2% claim from the game settings, one of the RTP-CLAIM rule's six places (game page, fairness page, help page, bet panel, rules, game settings): the `effective_edge` 0.8 Duel's site is served with every Beef bet, on the payout tables of the Beef config (E07) built on 0.992. The rule (RTP-CLAIM 1.2.0, Methodology v1.1) is switched on (decision D3, 14 October 2026): the outcome is scored on Step 16, the step carrying BEEF-19, and a house-side miss would make the verdict RTP FIGURE OVERSTATED (exit 5), never NOT PROVABLY FAIR, because the draws themselves pass. Outcome: pass (true minimum 99.200000%, true maximum 99.200000%; 0 of 61 cells beyond the 0.1 pp band).

### Empirical RTP and simulation

| Metric | Value |
|--------|-------|
| Empirical RTP (6,000 bets) | 96.3737% |
| Theoretical RTP | 99.2000% |
| Deficit | -2.8263 percentage points |

The empirical RTP is below the theoretical 99.2% because of the 200 Phase C bets at $10, which carry 97% of the stake and returned 96.28% (165 wins against 170 expected, about one standard deviation). The 5,800 bets at $0.01 returned 99.52%. This is ordinary variance, not systematic bias.

The two-pass Monte Carlo simulation provides the authoritative RTP validation. Pass 1 runs 4,000,000 rounds across the 4 difficulty levels (1,000,000 each): mean simulated RTP 99.1468% against the theoretical 99.2000%, consistent within Monte Carlo variance, with 0/4 chi-squared failures (Bonferroni) and 0/4 serial independence failures. Pass 1 scores each round on the rotating tile nonce % 20, and its tile-0 result is disclosed as DL-11. Pass 2 runs the 121 revealed casino seeds × 10,000 nonces at difficulty 2, each round one step on tile 0.

## Verification results

The suite scores 25 steps on the 6,450 captured rounds: **24 PASS, 1 capture-origin FLAG (Step 4), 0 hard fails**, verdict PROVABLY FAIR — Full Pass.

| # | Check | Result | Finding |
|---|-------|--------|---------|
| **Commit-Reveal Integrity** | | | |
| 1 | Seed hash integrity | PASS | 121 of the 124 rotation transitions required by `src/loader.ts` verified by SHA-256; 3 phase-boundary transitions excluded; 0 seed rows without plaintext (seeds[0] of each file filled from seeds[1] after capture, see [Dataset and capture](#dataset-and-capture)) |
| 2 | Next-seed promotion + forward commitment chain | PASS | 125/125 rotations recomputed from raw hex; 124/124 forward links verified (`seeds[i].nextServerSeedHash === seeds[i+1].serverSeedHashed`); pre-capture link present — consistency checks: in this capture a promotion and the forward link before it are one comparison, and that each "next" hash was shown before the rotation that activated it rests on the capture's write order, not on the hashes; Phase E file: 14/14 promotions, 13/13 forward links, pre-capture link present |
| 3 | Hash consistency within epoch | PASS | Epochs taken from the seed-rotation timeline, not from the bets: 6,000 bets in 121 bet-bearing windows (4 rotation records with no bets, 0 orphans); every bet carries the serverSeedHashed and clientSeed of the rotation active at its timestamp; Phase E file: 450 bets in 10 windows, same result |
| 4 | Nonce audit | FLAG (capture-origin, verdict-neutral) | 121 primary + 10 Phase E epochs (Phase E audited since 26 Sep 2026; its one gap, nonce 31 of epoch 1dfe6dcf…, declared by identity); primary: nonces from 0, no duplicates, all within 0..49, one client seed per epoch; 1 nonce gap, exactly the capture-retry gap declared in `src/loader.ts` (nonce 25 of epoch b2dfe98473b69f19…; a gap more or fewer, or a gap under an unrevealed seed, is a hard FAIL); the missed round is reconstructed from the revealed seed, not verified — the capture holds no served outcome for it |
| **RNG Determinism** | | | |
| 5 | Death-point recomputation | PASS | 6,000/6,000 verified by `src/rng.ts` (rebuilt from `docs/ALGORITHM.md`), 0 mismatches, 0 skipped; draw bias measured from `src/rng.ts` on all 19 ranges 2–20 — every accepted window a whole number of ranges, worst bias 0 (ceiling 2^-32), 0 rejected chunks in 114,000 draws; the ProvablyFair.org site verifier (`derive.js`, pinned) executed on all 6,450 rounds of both files — 0 disagreements; Duel's Verify-tab code (E06; a second check, not the source) executed on 6,450/6,450 — death points equal the served ones and `src/rng.ts` |
| 6 | Client seed influence | PASS | 6,000/6,000 bets: wrong clientSeed produces a different 20-tile permutation (the full RNG output); 59 bets keep the same death-point set by chance, 61.3 expected at 1/C(20,m) per bet; empty-seed control (clientSeed "") 6,000/6,000 differ |
| **Payout Verification** | | | |
| 7 | Payout math | PASS | 6,000 bets checked, 0 errors (relative tolerance 1e-12) |
| 8 | Multiplier formula | PASS | 4,337 winning bets: multiplier = C(20,k)/C(20−m,k), payout_mult = raw × 0.992 (0.8% edge), both served strings compared exactly with the rational at relative 1e-12; 0 mismatches |
| 9 | Win condition (all stepped tiles not in mines) | PASS | 6,450/6,450 rounds (both files) against the recomputed death points: stepped tiles are the path prefix 0…k−1, outcome=win iff no stepped tile is a death point, every loss ends on its first death point; 0 errors |
| 10 | Phase C bet-size invariance ($10 bets) | PASS | 200 Phase C bets, every one staked at $10, 165 wins: multiplier formula identical, payout math correct; 0 errors |
| 11 | Config completeness & payout-table coverage | PASS | All 4 difficulty levels above the 1,000-bet floor in `src/loader.ts`; 15 of 61 (difficulty, k) payout cells observed in live play, including all 15 the capture plan in `src/loader.ts` requires; the 46 unexercised cells named in the step's data block |
| 12 | House edge audit (effective_edge = 0.8%) | PASS | 6,000 bets: effective_edge = 0.8 (0.8%) for all; 0 deviations |
| **Dataset Integrity** | | | |
| 13 | Population & phase labels | PASS | 6,000 bets and 125 seed records match the capture plan in `src/loader.ts` (code constants, not the dataset header); phases A, B, C, D all present, last bet phase D |
| 14 | Dataset hash | PASS | Primary SHA-256 d654ef7c6195584501e9033202d5acad13a16d89d296baab8befc0240fb36d36 and Phase E SHA-256 ef39d7f584cdb6d8057e846cdcb9b4ffcc60495bfcce8443d15bb910a9c51001 both match their pins |
| 15 | Epoch size | PASS | 121 epochs as declared in `src/loader.ts`: 119 of exactly 50 bets, plus the two documented capture-retry epochs of 1 and 49 bets |
| 16 | Probability independence (anti-circularity) | PASS | 4 difficulties × valid step counts = 61 combos; RTP = survival × payoutMult = 0.9920 by construction, within the 1e-10 bound at every combo (measured deviation 2.22e-16, in the step's data block); counting anchor over all 2^20 death-point sets agrees at every cell, and counted survival × the exact paid multiplier equals the RTP table's exact row (992/1000 at every cell) in integer arithmetic; negative control (edge 991/1000) rejected at all 61. Since 14 October 2026 (C3) the identity is held to the table's row, not to the claimed 992/1000: a cell that paid less would be an RTP-CLAIM miss on this step (RTP FIGURE OVERSTATED, exit 5), not a fail of this check |
| 17 | Phase D client seed variation | PASS | 800 bets, 16 distinct client seeds, one per Phase D epoch (16), all 4 difficulties; recomputation: 800/800 match |
| **Simulation Integrity** | | | |
| 18 | Simulation Pass 1 integrity | PASS | 4,000,000 rounds × 4 configs; chi2: 0/4 uncorrected, 0/4 at Bonferroni α/4=0.002500; serial: 0/4 uncorrected, 0/4 at Bonferroni; mean simulated RTP 99.1468% in the step's data block |
| 19 | Simulation Pass 2 cherry-pick test | PASS | 121 seeds × difficulty=2 (dpc=3), one step on tile 0 per round (the first stepped tile of all 6,450 captured rounds), every row bound to a dataset epoch and all 121 early windows replayed from the revealed seeds; Test A: 0/121 fails, binomial p=1.000 (FAIL at 5 or more); Test B: 2/121 isolated-early flags, binomial p=0.985 (FLAG at 11 or more, FAIL at 13 or more); seeds off in both windows at p<0.05: 1/121 (`c9ddfba9…7121b568`, client seed `Ty1rZcxKscWFXxqt`: early 36/50 p=0.010042, late 8,387/9,950 p=0.047777), count p = P(K ≥ 1 \| Binomial(121, 0.05 × 0.05)) = 0.2613 (FLAG at 2 or more, FAIL at 3 or more); 0 at p<0.001 (FAIL at 1); false-alarm rate of each rule in [Step 19 rules](#step-19-rules-and-false-alarm-rates); no cherry-picking detected, the one seed disclosed as an observation |
| **Phase E Multi-Step** | | | |
| 20 | Multi-step multiplier chain | PASS | 1,085 rung multipliers (step-by-step) across 450 bets; 15 distinct (difficulty, k) combos; exact rational at relative 1e-12; 0 mismatches |
| 21 | Death-point recomputation (Phase E) | PASS | 450/450 Phase E bets verified (0 skipped); 0 mismatches |
| 22 | Cash-out payout correctness (k>1) | PASS | 202/202 winning Phase E bets verified at their planned target k>1; distribution: k=2:27, k=3:67, k=5:108; 0 errors; 248/248 Phase E losses credit exactly 0 |
| **Artifact Integrity** | | | |
| 23 | Artifact integrity (pinned artifacts of record) | PASS | 4 artifacts checked against `src/artifact-pins.ts`: `chi-squared-results.json`, `determinism-log.json`, `rtp-convergence.html`, `simulation-results.json` each match their SHA-256 pin; every one of the 1,083 numeric leaves of the three JSON artifacts lies in its declared value domain (`src/domains.ts`) and none is undeclared |
| **Model Bounds and Live Fit (added 26 Sep 2026)** | | | |
| 24 | Multiplier monotonicity & bounds (flag-only) | PASS | All 61 (difficulty, k) cells of C(20,k)/C(20−m,k) × 0.992 compared as exact fractions: strictly increasing in depth (57/57 pairs) and in difficulty (42/42); 5,422 raw + 4,337 paid served multipliers in 15 observed cells strictly increasing across every adjacent observed pair; no max-odds cap is declared for Beef, so none is asserted |
| 25 | Live-sample fit (informational, flag-only) | PASS | Death-point positions of all 6,450 rounds per difficulty fit the uniform 20-tile lattice (χ² with the without-replacement correction) and the win rates of the 4 primary difficulties and the 4 Phase E sub-phases fit the binomial; 12 tests, all above the Bonferroni bound 0.01/12 — the smallest, difficulty-2 positions, p = 0.0062 |

**The nonce flag.** One round of the primary file (epoch `b2dfe98473b69f19…`, nonce 25) and one round of the Phase E file (epoch `1dfe6dcf…`, E4, nonce 31) were missed by the capture on retried requests. Each revealed server seed hashes to the commitment its epoch's bets were served under, so the missed rounds' death points are reconstructed in Step 4's data block, but the rounds themselves were not captured and are not verified. Both gaps are declared by identity in `src/loader.ts`; any other gap, or one of these missing, fails Step 4 (DL-1, DL-4).

**Nonce boundaries.** Nonce 0 is the first bet of each epoch in all 121 primary epochs. Most epochs contain exactly 50 bets (nonces 0–49). Death points can land on any position in [0, 19]; the shuffle treats all positions equivalently, and the Pass 1 chi-squared test confirms a uniform distribution across all 20 positions for each difficulty.

**Informational context (not scored).** These live-bet tests lack power at the sample sizes in this dataset; the authoritative results come from the simulation.

| Item | Detail |
|------|--------|
| RTP analysis | Empirical RTP 96.3737% — Beef is high-variance; theoretical RTP 99.2000% proven analytically in Step 16 |
| Win rate chi-squared | 4 difficulty groups (all with ≥10 bets), aggregated by step count; 0/4 fail at α=0.01; min p=0.2893; Bonferroni α/4=0.002500 |

The per-difficulty win counts behind the chi-squared test, from [outputs/chi-squared-results.json](outputs/chi-squared-results.json) (theoretical k=1 win chance 95% / 85% / 75% / 50%):

| Difficulty | Death points | Bets | Wins | Expected wins |
|------------|--------------|------|------|---------------|
| EASY (1) | 1 | 1,200 | 1,132 | 1,140 |
| MEDIUM (2) | 3 | 1,400 | 1,198 | 1,190 |
| HARD (3) | 5 | 1,200 | 903 | 900 |
| EXPERT (4) | 10 | 2,200 | 1,104 | 1,100 |

At live sample sizes this test lacks power to detect subtle bias.

### Step 19 rules and false-alarm rates

A statistical rule moves the verdict only if its false-alarm rate on a fair game is stated: at most 5% for a rule that can make the step a FLAG and 1% for one that can make it a FAIL. Step 19 computes every rate on each run (`outputs/verification-results.json`, Step 19 `data.falseAlarm`) and fails the step if any is over its cap, since such a rule may not move the verdict. Every rule is a count over the 121 seeds, compared with the binomial distribution of that count on a fair game.

| Rule | Moves the step to | Count that triggers it (121 seeds) | False-alarm rate on a fair game: rule's model | exact discrete window sizes | This dataset |
|------|-------------------|------------------------------------|----------------------------------|-----------------------------|--------------|
| Test A: seeds failing the full-window chi-squared at p < 0.01; P(K ≥ k \| Binomial(121, 0.01)) < 0.01 | FAIL | 5 or more | 0.76% | 0.89% | 0 |
| Test B: isolated-early seeds (early p < 0.05, late p ≥ 0.05); P(K ≥ k \| Binomial(121, 0.05)) < 0.05 | FLAG | 11 or more | 4.0% | 1.3% | 2 |
| Test B, same count; P < 0.01 | FAIL | 13 or more | 0.77% | 0.18% | 2 |
| Both windows: seeds off in both at p < 0.05; P(K ≥ k \| Binomial(121, 0.05 × 0.05)) < 0.05 | FLAG | 2 or more | 3.7% | 2.9% | 1 (P = 0.261) |
| Both windows, same count; P < 0.01 | FAIL | 3 or more | 0.36% | 0.25% | 1 |
| Both windows at p < 0.001 (kept from before 6 October 2026) | FAIL | 1 or more | 0.012% | 0.024% | 0 |

The rule's model treats each window's test as exactly 5% (0.1%, 1%) on a fair seed. Win counts are discrete, so the exact size of each test is the binomial probability of every count it rejects: 4.42% for the early window at p < 0.05 and 4.94% for the late window; 0.195% and 0.102% at p < 0.001; 1.039% for Test A's full window at p < 0.01. Where the exact size is above the model's (Test A, the p < 0.001 rule), the exact rate is the one to read, and it is still under its cap. The early and late windows cover disjoint nonces, so on a fair game their results are independent. Seeds off in both windows are counted rather than scored one by one because a per-seed rule (any one seed off in both windows at p < 0.05 makes a FLAG) ignores the number of seeds: at 121 seeds its false-alarm rate is 26.1% under the model and 23.2% exact, over the 5% cap. Both figures are recorded in the same data block as `perSeedBothWindowFlagNotUsed`.

### Adversarial matrix

S5: fairness-integrity matrix; game-integrity testing not commissioned.

The standardized ProvablyFair.org fairness-integrity matrix (framework layer **S5**) applied to the Beef surface. Each row is tied to the scored step that decides it, on the delivered 6,000 + 450-bet capture. The matrix was restated on 26 September 2026 from the package's earlier ten-row table, kept below as supplementary rows; no result changed.

<!-- S5-MATRIX:START -->
| Test | Category | Attack | Expected fair behaviour | Result | Decided by |
|------|----------|--------|-------------------------|--------|------------|
| S5-1 | Seed substitution | Serve rounds under a server seed other than the one committed | Every revealed seed hashes to the commitment its bets were served under; each rotation activates the hash recorded as "next" before it (consistency; when each hash was shown rests on the capture's write order) | Pass | Steps 1, 2, 14 — 121 transitions hashed (+3 phase-boundary), 125/125 + 14/14 promotions, 124/124 + 13/13 forward links, both datasets hash-pinned |
| S5-2 | Client-seed manipulation | Ignore or neutralise the player's client seed | A different client seed changes the round | Pass | Steps 6, 17 — 6,000/6,000 full 20-tile permutations change under a wrong seed and under an empty seed; 800 Phase D bets on 16 player-set seeds recompute |
| S5-3 | Stake-conditional outcome | Make the outcome depend on the wager | $10 rounds recompute and pay by the same formula as $0.01 rounds | Pass | Step 10 — 200 Phase C bets at $10, 165 wins, 0 errors; the RNG takes no stake input; no `scaling_edge` in the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), E07 |
| S5-4 | Server-seed cherry-picking | Pre-select seeds whose first 50 nonces run cold | No early-window bias across revealed seeds | Pass (limited power) | Step 19 — 121 seeds × 10,000 nonces, one step on tile 0, early windows replayed; Test A 0/121, Test B 2/121 (binomial p = 0.985); 1 seed off in both windows at p < 0.05 (`c9ddfba9…`, count p = 0.261; a FLAG needs 2), 0 at p < 0.001 |
| S5-5 | Seed-rotation race (TOCTOU) | Rotate the seed while a multi-step round is open | The open round settles under the seed it started with | Not tested — disclosed | No capture rotates mid-round; Phase E rounds each open and settle inside one epoch |
| S5-6 | Multiplier tampering | Credit a multiplier other than the published formula's | Every served multiplier equals C(20,k)/C(20−m,k) × 0.992 and every credit equals stake × multiplier | Pass | Steps 7, 8, 20, 22 — exact rational at relative 1e-12 on 4,337 + 202 wins and 1,085 rungs; every loss credits 0 |
| S5-7 | Nonce manipulation | Skip, repeat or reorder nonces | Nonces count from 0 in each epoch, no repeat (0…49 in this capture, whose scripts rotated after 50 bets) | Pass (2 capture-retry gaps, one per file, disclosed as a capture-origin FLAG) | Step 4 — both files, gaps bound by identity |
| S5-8 | Range-mapping bias | Map HMAC output to tiles with a biased reduction | Every swap index exactly equiprobable | Pass (rejection sampling — bias exactly 0) | Step 5 — accepted window a whole number of ranges on all 19 ranges; Step 18 — position chi-squared on 4 × 1,000,000 simulated rounds |
<!-- S5-MATRIX:END -->

Supplementary rows (the package's original table, its two-digit ids renamed S5-S1 … S5-S10 so they are not read as framework rows; content unchanged except S5-S10, restated with the Step 19 result on 6 October 2026):

| Test ID | Category | What was tested | Result | Finding |
|---------|----------|-----------------|--------|---------|
| S5-S1 | RNG Integrity | Death-point recomputation for all 6,000 bets | Pass | 6,000/6,000 match; 0 mismatches |
| S5-S2 | Commitment Integrity | SHA-256(hex_decode(serverSeed)) === serverSeedHashed for all revealed seeds | Pass | 121/121 verified; 3 phase-boundary skips (expected) |
| S5-S3 | Player Influence | Wrong client seed produces different death points | Pass | 6,000/6,000 bets produced a different 20-tile permutation with a wrong client seed |
| S5-S4 | Nonce Integrity | Nonces sequential 0..N per epoch; no gaps or duplicates | Pass (Step 4 itself is a capture-origin FLAG, verdict-neutral) | 121 epochs; the 1 nonce gap is the capture-retry gap declared in `src/loader.ts` — reconstructed from the revealed seed, not verified; 0 duplicates |
| S5-S5 | Shuffle Bias | Chi-squared on death-point position frequency (20 bins × 4 configs, 1M rounds each) | Pass | 0/4 configs fail at Bonferroni α/4 = 0.0025 |
| S5-S6 | Win Condition | outcome=win iff every stepped tile not in death points | Pass | 6,000/6,000 correct |
| S5-S7 | Bet-Size Independence | $10 bets produce identical multipliers and payouts as $0.01 bets | Pass | 200 Phase C bets ($10), 165 wins; 0 formula deviations |
| S5-S8 | Algorithm Substitution | Serial independence on 1M-round simulation (lag-1 autocorrelation + runs test) | Pass | 0/4 configs fail at Bonferroni threshold |
| S5-S9 | Hash Commitment | Next-seed promotion: each rotation's next-hash matches the subsequent epoch's active hash | Pass | 125/125 transitions verified |
| S5-S10 | Seed Cherry-Picking | Pass 2: early-epoch vs late-epoch win distribution for 121 casino seeds | Pass | 2/121 isolated-early flags, binomial p=0.985; 1/121 seed off in both windows at p<0.05 (count p=0.261; FLAG at 2), 0 at p<0.001 |

## Reproduce the audit

Use **Node.js 22.x**, pinned in `package.json` `engines` and `.nvmrc`. The committed artifacts in `outputs/` were produced on that line, and the last bits of a derived floating-point statistic are runtime-dependent (see the tolerance below). TypeScript comes from the devDependencies. Run from the package directory:

```sh
npm ci
npm test
```

`npm test` runs the Mocha unit tests and then the verification suite against the committed simulation artifact. Expected: **25 passing**, then **24/25 PASS + 1 capture-origin FLAG (Step 4)**, `PROVABLY FAIR — Full Pass`, `REPRODUCED`, exit 0. The release record measures `npm test` at 37.39 s wall time on an Apple M2 Max (12 cores) with Node 22.23.1, on 28 September 2026.

| Command | Purpose |
|---------|---------|
| `npx mocha` | Unit tests only (`tests/beef/BeefTests.ts`, `tests/beef/RngSpecTests.ts`): cryptographic core, payout formulas, full dataset verification, Duel's Verify-tab code (E06) run as a second check on the 7 known-answer bets and all 6,450 rounds, and the specification's own vectors and properties (105 checks) against `src/rng.ts` |
| `npm run verify` | The 25 scored steps plus informational items, scored against the committed `outputs/simulation-results.json`; writes this run's products and `diff.json` to `outputs/run/`, never into `outputs/` |
| `npm run simulate` | Two-pass simulation (4M rounds Pass 1 + 121 casino seeds Pass 2) into `outputs/run/` |
| `npm run test:full` | Unit tests → simulation → verification; the committed simulation artifact and its pin are untouched and the verifier still scores the committed copy |
| `npm run mutate` | The mutation battery, in a disposable copy |
| `npm run rtp-claim:write` | Rewrite `outputs/rtp-claim-table.json` and print its SHA-256 to pin |
| `npm run release-manifest` | Write `RELEASE-MANIFEST.json` |
| `node scripts/check-config-table.mjs` | Standalone, outside mocha and the 25 scored steps: checks E07's pinned bytes, its keys (no `scaling_edge`) and its 61 payout cells against C(20,k)/C(20−m,k) × 0.992 at relative 1e-12 |

### The gate

`npm run verify` writes **nothing** into `outputs/`. This run's results, its determinism log, its chi-squared table and `diff.json` go to `outputs/run/` (gitignored, a run record rather than audit evidence), so a re-run cannot replace the evidence it scores, and a disagreement between two runs is recorded rather than resolved in favour of whichever ran last.

Four artifacts of record are pinned by SHA-256 in `src/artifact-pins.ts`, and Step 23 recomputes every pin on every run. Two of them are written by the verifier itself (`determinism-log.json` and `chi-squared-results.json`, by `PF_EMIT=1 npm run verify`) and two by the simulation (`simulation-results.json` and `rtp-convergence.html`, by `PF_EMIT=1 npm run simulate`). The verifier's results file, `verification-results.json`, is the one not pinned (below). A missing or altered artifact is a hard fail.

| File | SHA-256 |
|------|---------|
| `outputs/chi-squared-results.json` | `65857a46ab1d0d4acfe0c46ceaa264f22a112358895643160bc5605310451ca0` |
| `outputs/determinism-log.json` | `88bc153e2d6e867f375c0cf8138491185761cdb3150e4c921a0746ecf5a7b3c2` |
| `outputs/rtp-convergence.html` | `2633e8f87d9ed124b1c32c604c25291108ee5af775f8e2405e0ef3538e97d066` |
| `outputs/simulation-results.json` | `7119a3e3743fbd288bf81477ce52ec289b67ea80b4be4fc70663b1a78dd5f613` |

None of the pinned files carries run metadata, so a regeneration that computes the same result reproduces the pinned bytes; a regeneration that does not is what the pin is there to catch, and re-pinning is a deliberate act in the same commit. `outputs/verification-results.json` is the verifier's own output and is not pinned: `outputs/run/diff.json` compares this run against the committed artifacts field by field and records the runtime it ran on. The comparison tolerance is **1e-14 absolute + 1e-12 relative**, and two distinct integers never agree, so a derived statistic that moved by a unit in the last place is recorded as `withinTolerance` and not scored, while anything outside that bound is a different result. The SHA-256 dataset guard remains the identity of the captured bytes and is never rewritten to make a run agree with it.

Exit codes are the verdict, so nothing automated can read a Conditional Pass as clean:

| Code | Meaning |
|------|---------|
| `0` | `PROVABLY FAIR — Full Pass`, and this run reproduces the committed artifacts |
| `1` | at least one hard fail, **or** a reproduction difference beyond tolerance |
| `2` | at least one operator-origin FLAG — `PROVABLY FAIR — Conditional Pass`. A capture-origin FLAG (Step 4's capture-retry gaps) is printed and recorded but is verdict-neutral and exits `0` |
| `5` | `RTP FIGURE OVERSTATED`: no draw check failed, but the RTP-CLAIM rule (1.2.0, switched on) found settings beyond the 0.1 pp band on the house side of the published figure. It outranks a Conditional Pass; a hard fail (exit 1) outranks it |

### Deliberate artifact refresh

The committed copies in `outputs/` are rewritten only by `PF_EMIT=1`:

```sh
PF_EMIT=1 npm run simulate   # simulation-results.json, rtp-convergence.html; re-pin src/artifact-pins.ts in the same commit
PF_EMIT=1 npm run verify     # verification-results.json, determinism-log.json, chi-squared-results.json
```

To refresh the RTP claim table after a reviewed change:

```sh
npm run rtp-claim:write
# update RTP_CLAIM_TABLE_SHA256 in src/rtp-settings.ts with the printed digest
npm run verify
npm run release-manifest
node scripts/release-manifest.mjs --check
```

The release generator requires both README.md and MANIFEST.md and checks that each carries the audit ID.

### Package layout

| Path | Contents |
|------|----------|
| `docs/ALGORITHM.md` | The written specification `src/rng.ts` is rebuilt from: Duel's public pages, the standard construction, Duel's public Beef config and the live rounds, without Duel's code (copy of the ProvablyFair.org framework's `games/beef/ALGORITHM.md`) |
| `src/rng.ts` | RNG (HMAC-SHA256 backward Fisher-Yates), rebuilt from `docs/ALGORITHM.md` by an implementer who never opened Duel's code |
| `src/bias.ts` | The draw-bias bound (Step 5, BEEF-08), measured from `src/rng.ts` `drawFromChunk`; audit code, not part of the RNG |
| `src/operator-verifier.ts` | Duel's own Verify-tab code (E06): pinned, executed by Step 5 and the unit tests as a second check, not the source of `src/rng.ts` |
| `capture/` | The non-runnable reference records of the two browser-console capture scripts; the runnable scripts place bets and are not published ([Dataset and capture](#dataset-and-capture)) |
| `src/loader.ts` | Dataset loader, SHA-256 check and the population constants |
| `src/stats.ts` | Chi-squared, lag-1 autocorrelation, runs test |
| `src/simulate.ts` | Two-pass Monte Carlo simulation (writes to `outputs/run/` unless `PF_EMIT=1`) |
| `src/diff.ts` | Field-level reproduction diff at tolerance |
| `src/artifact-pins.ts`, `src/domains.ts` | SHA-256 pins of the four artifacts of record and the value domain of every numeric leaf (Step 23) |
| `tests/beef/BeefTests.ts`, `tests/beef/RngSpecTests.ts` | Mocha unit tests with known-answer vectors; `RngSpecTests.ts` is the specification's self-test, written with `src/rng.ts` |
| `tests/steps/` | `commitment.ts` (Steps 1–4), `determinism.ts` (5–6), `payouts.ts` (7–12), `dataset.ts` (13–17), `simulation.ts` (18–19), `multireveal.ts` (20–22), `artifacts.ts` (23), `monotonicity.ts` (24), `live-fit.ts` (25), `statistical.ts` (informational items) |
| `tests/verify.ts` | Orchestrator: runs all 25 scored steps and the reproduction gate |

### Mutation battery and profile

`npm run mutate` runs 45 step-named mutations from `tests/mutations.json` in a disposable copy (46 until 20 October 2026, 42 until 14 October 2026, 38 until 6 October 2026). Measured on 26 Sep 2026 after Duel's Verify-tab code was wired into Step 5: 38/38 killed, 25/25 scored steps covered. The five entries added then (M05e–M05i) forge the operator file and re-pin it, edit it without re-pin, edit the runner without re-pin, forge the runner and re-pin it, and move a citation (M05i, retired on 20 October 2026 with the citation table). The release record repeats the result on 28 September 2026: 38/38 killed, 25/25 scored steps covered, 0 declared survivors. This consolidation did not rerun the battery.

On 20 October 2026, after `src/rng.ts` was rebuilt from `docs/ALGORITHM.md`, the battery was rerun on the 45 remaining entries (M05i retired; M05d and M06 retargeted to the rebuilt module): 45/45 killed, 25/25 scored steps covered, 0 declared survivors (Apple M2 Max, Node v22.23.1).

On 6 October 2026, after the Step 19 change and the capture-schedule and commitment-chain wording changes, the battery was rerun on 42 mutations: 42/42 killed, 25/25 scored steps covered. Rerun on 14 October 2026 on the tree carrying RTP-CLAIM 1.2.0 switched on (Apple M2 Max, Node v22.23.1): 42/42 killed, 25/25 scored steps covered. M19b (the replay scoring the rotating tile nonce % 20), M19c (a captured round whose first stepped tile is not tile 0), M19d (seeds off in both windows scored one by one) and M19e (the both-window FLAG level loosened past its 5% false-alarm cap) were added. The runner's honest baseline is the Full Pass (verify exit 0, no operator-origin FLAG), and a mutation counts as killed when its run exits with any other status and prints the entry's marker. The runner also copies `outputs/rtp-claim-table.json` into its disposable workspace: without it the RTP-claim gate exits 1 and the baseline could not run, which was the case on `main` at `c3eec20`. Second pass, 14–15 October 2026 (FIXPASS2 class C3, the exit-5 entries): see the release-history entry "14 October 2026 (second pass)"; the release manifest records that run.

Each scored step carries the ProvablyFair.org Beef profile check(s) it implements (`src/profile-map.ts`, emitted as `profileIds` in `outputs/verification-results.json`). The Beef profile is **1.0.2** (approved as cited, Methodology v1.1 decision D6, 14 October 2026).

### Fresh-clone reproduction (measured 26 Sep 2026)

These runs predate Steps 24–25 (BEEF-28).

| Run | Tree | Node | Result |
|-----|------|------|--------|
| `git clone` of `ProvablyFair-org/pf-duel-workspace` → `npm ci` → `npm test` | origin/main @ `79aa65b` (this game last changed in `8f13658`) | v22.23.1 | npm ci exit 0; npm test exit 0 — 21 passing, 22/23 + 1 capture-origin FLAG, Full Pass, REPRODUCED; `outputs/run/verification-results.json` byte-identical to the committed file |
| same clone → `npm run test:full` | as above | v22.23.1 | exit 0 in 136 s; regenerated `simulation-results.json` and `rtp-convergence.html` byte-identical to the pinned files |
| copy of exactly the files the next commit carries (`git ls-files` + untracked-not-ignored) → `npm ci` → `npm test` | working tree on `8f13658` + that round's changes | v22.23.1 | npm ci exit 0; npm test exit 0 — 21 passing, 22/23 + 1 capture-origin FLAG, Full Pass, REPRODUCED; verification-results byte-identical |

## Verify a bet

An ordered path a player can follow to check a single Beef round end to end. Field names are the ones Duel serves and the ones `declarations/duel.beef.json` (Framework 1.1) records: the seed fields under `seed.*`, the round under `response.*`, the stake under `request.*`. Nothing below reads an operator odds or win-chance field.

1. **Reveal the server seed.** In the Beef **Provably Fair** panel (E02, illustrative: active client seed, server seed (hashed), nonce, next server seed (hashed), rotate button), **rotate your seed pair**. Rotation ends the epoch and reveals the plaintext `serverSeed` of the seed you were playing on; until then only its commitment `seed.serverSeedHashed` is public. Rotation also promotes the previously published next-seed hash to the new active `serverSeedHashed`, so the chain can be followed forward.

2. **Collect the fields to paste.** From the round and the panel:
   - `serverSeed` — the revealed plaintext, 64 hex characters (32 bytes), from step 1
   - `seed.serverSeedHashed` — the commitment shown before the round
   - `seed.clientSeed` — your client seed for that epoch
   - `seed.nonce` — the round's index within the epoch, counted from **0** (0 … 49 in this capture)
   - `request.difficulty_level` — 1 EASY, 2 MEDIUM, 3 HARD, 4 EXPERT (the UI calls it "Extreme")
   - the served outcome you are checking: `response.mines_positions`, `response.current_step`, `response.outcome`, `response.multiplier`, `response.no_house_edge_multiplier`, `response.amount_won`, and your stake `response.amount_currency`

3. **Check the commitment encoding.** The seed is hashed as **bytes**, not as its hex string:

   ```
   SHA-256( hex_decode(serverSeed) )  ==  seed.serverSeedHashed
   ```

4. **Recompute the shuffle** with `computeDeathPoints(serverSeed, clientSeed, nonce, deathPointsCount)` below (the construction of [`docs/ALGORITHM.md`](docs/ALGORITHM.md) §2). It keys HMAC-SHA256 with `hex_decode(serverSeed)` and runs a **backward Fisher–Yates** over the 20 tiles `[0, 1, …, 19]`: for draw t = 0 … 18 (i = 19 − t, range r = i + 1) it messages `` `${clientSeed}:${nonce}:${t}` ``, reads the digest as eight big-endian 32-bit chunks and takes the first chunk below `floor(2^32 / r) × r` (rejection sampling: the tail is discarded, so every position is equally likely), then swaps `positions[i]` with `positions[chunk % r]`. No public source says what happens if all eight chunks are rejected (open point O1); the code below stops with an error, and no captured draw rejects even one chunk (0 in the 114,000 draws of the 6,000 primary rounds, Step 5 census).

5. **Take the death-point count for your difficulty.** The death points are the **first m tiles** of the shuffled board, sorted ascending, with m fixed by `request.difficulty_level`:

   | difficulty_level | label | death points m | safe tiles 20 − m |
   |---|---|---|---|
   | 1 | EASY | 1 | 19 |
   | 2 | MEDIUM | 3 | 17 |
   | 3 | HARD | 5 | 15 |
   | 4 | EXPERT | 10 | 10 |

   The result must equal `response.mines_positions` as a set (Duel serves it sorted).

6. **Apply the tile numbering and the win rule.** Tiles are numbered **from 0** along a fixed path: a round that walks k steps stands on tiles `0, 1, …, k − 1`, which is exactly `response.current_step`. The round is a **win** if none of those tiles is a death point; a loss ends on the first stepped tile that is one. Check `response.outcome` against this.

7. **Check the settlement.** The settlement equations apply **only to a winning cash-out** (`response.outcome` = `win`). For m death points and k steps:

   ```
   response.multiplier               =  C(20, k) / C(20 − m, k)            // raw
   response.no_house_edge_multiplier =  C(20, k) / C(20 − m, k) × 0.992    // paid (Duel's field name is a misnomer: it includes the 0.8% edge)
   response.amount_won               =  amount_currency × no_house_edge_multiplier
   ```

   On winning cash-outs at k = 1 the served values match the exact fractions within 5.0e-19 relative (the 18th printed decimal, Step 8); at k > 1 they carry the operator's double-precision rounding (worst 9.63e-15 relative in this capture, DL-7).

   A **loss** is not settled by these equations. For a loss, check two things: the round ended on its **first** death point (tiles `0 … k − 2` safe, tile `k − 1` a death point, nothing stepped after it; Step 9 on both datasets), and the credit is zero (`response.amount_won` = `"0"`; Step 7 on the primary file, Step 22 on Phase E). The two multiplier fields of a loss are not a payout:
   - `response.multiplier` is retained at the raw value of the last safe position, `C(20, k − 1) / C(20 − m, k − 1)`. When the first step is fatal (k = 1) that is `1`.
   - `response.no_house_edge_multiplier` is `null`, because nothing is paid.

   Example: round 7722782, EXPERT (m = 10), died on its first step (`current_step` `[0]`, tile 0 a death point) and records `multiplier` `1.000000000000000000`, `no_house_edge_multiplier` `null`, `amount_won` `"0"`. The winning-cash-out equations at k = 1 would ask for 2 and 1.984, which do not apply to it. In this capture all 1,911 recorded losses (1,663 primary, 248 Phase E) have a null paid multiplier and `amount_won` `"0"`, and each retained raw multiplier equals `C(20, k − 1) / C(20 − m, k − 1)` within relative 1e-12 (1,763 of them at k = 1, so `1`). The null field and the retained raw value were measured on the datasets for this release; no scored step reads them.

If all seven checks hold, the round is provably fair: the death points follow from the seed whose commitment you saw before the round, your client seed and nonce are inputs to them, and the credit follows the published formula on a win and is zero on a loss. The audit runs this path on all 6,450 captured rounds (Steps 1, 5, 7–9, 20–22).

```javascript
const crypto = require('crypto');

function computeDeathPoints(serverSeed, clientSeed, nonce, deathPointsCount) {
    const key = Buffer.from(serverSeed, 'hex');
    const positions = Array.from({ length: 20 }, (_, i) => i);

    for (let t = 0; t <= 18; t++) {
        const i = 19 - t;
        const range = i + 1;
        const limit = Math.floor(2 ** 32 / range) * range;
        const digest = crypto.createHmac('sha256', key).update(`${clientSeed}:${nonce}:${t}`).digest();
        let j = null;

        for (let c = 0; c < 8 && j === null; c++) {
            const value = digest.readUInt32BE(c * 4);
            if (value < limit) j = value % range;
        }
        if (j === null) throw new Error('all 8 chunks rejected (ALGORITHM.md open point O1)');
        [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    return positions.slice(0, deathPointsCount).sort((a, b) => a - b);
}
```

**Or paste it into a verifier page.** This audit runs a SHA-256-pinned byte copy of the ProvablyFair.org docs-site Beef verifier (VerifyBets `games/beef/derive.js`) on all 6,450 rounds: its death points equal `src/rng.ts` on every round, and on all 4,539 wins its paid multiplier is within relative 1e-12 of the exact rational and the served figure (Step 5, BEEF-24). The live [ProvablyFair.org verifier](https://www.provablyfair.org/verify-bets) page is a separate build and is not checked. Duel's own Verify page (E04) has a game selector and seed / nonce inputs; its Beef code is preserved as E06 and executed by Step 5.

## Evidence

The primary evidence is the two captured datasets and their revealed seeds. Screenshots illustrate interface states; they do not replace the recorded responses.

| ID | File | Description |
|----|------|-------------|
| E01 | [evidence/E01-beef-game-ui.png](evidence/E01-beef-game-ui.png) | Beef game interface — 20-tile grid, difficulty selector, multiplier ladder |
| E02 | [evidence/E02-provably-fair-panel.png](evidence/E02-provably-fair-panel.png) | Provably Fair panel — active client seed, server seed (hashed), nonce, next server seed (hashed), rotate seed button. Illustrative only: it shows the final Phase E rotation's seed (active hash `090390e8…`, client seed `Ic5RYWpnRDXUQebq`, nonce 0), under which no bet was recorded, so it is not pre-bet evidence for any recorded round |
| E03 | [evidence/E03-fairness-page-overview.png](evidence/E03-fairness-page-overview.png) | Duel.com fairness page — overview of the provably fair system, seed generation, hash commitment |
| E04 | [evidence/E04-fairness-verify-page.png](evidence/E04-fairness-verify-page.png) | Fairness verification page — game selector, client seed / server seed / nonce input fields, published verification code |
| E05 | [evidence/client-seed-origin.png](evidence/client-seed-origin.png) | Annotated DevTools capture of duel.com's live JS bundle (`assets/index-DlvddfIT.js`, captured 2026-06-03): the default client seed is drawn per character from a 63-character alphabet via rejection-sampled `crypto.getRandomValues`, and `FairnessNextSeed.vue` calls that generator with length 16 to pre-fill the "New client seed" field client-side (see [Client seed origin](#client-seed-origin)) |
| E06 | [evidence/verify-tab/duel-verify-tab-beef-2026-09-26.js](evidence/verify-tab/duel-verify-tab-beef-2026-09-26.js) | Duel's own Beef verification code, pasted by ProvablyFair.org from duel.com Verify tab 2026-09-26 (duel.com → Provably Fair → Verify, game Beef, code panel), saved verbatim and never edited. SHA-256 `43ba4dfbd068cbf5dde917a5432ef664df2ef68f4fabc91f516ed220ed5564f6`, 3,353 bytes, 101 lines. Pinned with its runner ([verifier-parity/operator/run-operator-verifier.cjs](verifier-parity/operator/run-operator-verifier.cjs)) in `src/operator-verifier.ts`. A second check, not the source of `src/rng.ts`, which is rebuilt from `docs/ALGORITHM.md`; through v1.1.0 `src/rng.ts` followed this file and cited 17 of its lines. Step 5 and the unit tests execute it — only its five "User input values" filled in — on all 6,450 rounds of both datasets: death points = served and `src/rng.ts` on 6,450/6,450 (BEEF-09) |
| E07 | [evidence/E07-cross-road-config-2026-10-05.json](evidence/E07-cross-road-config-2026-10-05.json) | Duel's `GET /api/v2/cross-road/config` response: the duel.com config as fetched 2026-10-05 12:16:36 UTC in a logged-in session (read-only GET), saved byte for byte: `payout_tables`, `probabilities`, `difficulty_levels`, no `scaling_edge`. Request path, HTTP status, response headers and fetch time are in [evidence/E07-cross-road-config-2026-10-05.json.meta.json](evidence/E07-cross-road-config-2026-10-05.json.meta.json). SHA-256 `a7836863db88f699083e14a695fd916799fcbc349006b8bad81d4477a919feca`, 2,325 bytes |

Test account: Duel.com, game Beef (Cross-Road), funded by ProvablyFair.org. Capture method: browser session interception during live play, for both datasets.

### Files supporting the recorded result

| File | Role |
|------|------|
| [data/beef-master-6000bets.json](data/beef-master-6000bets.json) | Primary dataset: 6,000 bets, 125 seed entries; SHA-256 `d654ef7c6195584501e9033202d5acad13a16d89d296baab8befc0240fb36d36` |
| [data/beef-phaseE-450bets.json](data/beef-phaseE-450bets.json) | Phase E dataset: 450 multi-step bets, 14 seed entries; SHA-256 `ef39d7f584cdb6d8057e846cdcb9b4ffcc60495bfcce8443d15bb910a9c51001` |
| [outputs/verification-results.json](outputs/verification-results.json) | Full results of the 25 scored steps (the verifier's own output; not pinned, bound to a fresh run by the reproduction gate) |
| [outputs/simulation-results.json](outputs/simulation-results.json) | Pass 1 (4M rounds) and Pass 2 (121 casino seeds) simulation output — pinned |
| [outputs/rtp-convergence.html](outputs/rtp-convergence.html) | RTP convergence chart (4 configs × 1M rounds) — pinned |
| [outputs/determinism-log.json](outputs/determinism-log.json) | Death-point recomputation log (6,000 verified, 0 mismatches) — pinned |
| [outputs/chi-squared-results.json](outputs/chi-squared-results.json) | Per-difficulty chi-squared test results (informational) — pinned |
| [outputs/rtp-claim-table.json](outputs/rtp-claim-table.json) | Exact RTP of all 61 cells against the flat 99.2% claim; RTP-CLAIM 1.2.0, scored on Step 16, pinned in `src/rtp-settings.ts` |
| [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json) | Release identity, artifact hashes, recorded score and mutation-run record, written by `scripts/release-manifest.mjs` |
| `outputs/run/diff.json` | Run record (gitignored): field-level diff of this run against the committed artifacts, with the runtime it ran on |

## Limitations and trust

The commit-reveal records support three findings. The first rests on consistency checks together with the capture's own pre-bet observations; the other two rest on recomputation:

1. **The server seed was fixed before the bets it covers.** Two kinds of evidence bear on this, and they establish different things:
   - *Consistency.* For all 121 bet-bearing revealed seeds, `SHA-256(hex_decode(serverSeed))` equals the commitment the bets were served under (Step 1), every rotation promoted the next-seed hash already published, and the forward links hold (Step 2). Hash matching and forward links are consistency checks: they show the seed records fit together, not when a commitment was shown.
   - *Timing.* That each commitment was shown before its epoch's bets rests on the capture's recorded pre-bet observations: the capture recorded each epoch's active commitment at the rotation that opened it, before that epoch's first bet (the seed entry's capture timestamp precedes the epoch's first bet for 121/121 primary and 10/10 Phase E bet-bearing seeds; measured for this release, not scored), and the pre-capture link shows the first epoch's hash already outstanding as "next" before the first observation. This timing holds only to the extent the capture is a faithful record of what Duel served (premise P1).
   - E02 is illustrative only. It shows the panel at the final Phase E rotation (active server seed hash `090390e8…`, nonce 0), a seed under which no bet was recorded, so it is not pre-bet evidence for any recorded round.
2. **The death-point positions are deterministic given the inputs.** 6,000 / 6,000 death-point sets reproduced exactly.
3. **The win condition and payouts are applied correctly.** Zero errors across all formula checks.

| Property | Value |
|----------|-------|
| Model | Client Seed + Server Seed (commit-reveal) |
| External beacon | None |
| Cherry-pick risk tier | Medium — server generates seed unilaterally |
| Pass 2 result | Test B 2 / 121 isolated-early flags (binomial p = 0.985); 1 / 121 seed off in both windows at p < 0.05 (count p = 0.261, not a flag) |

Two structural limitations remain in any commit-reveal system without an external randomness beacon such as drand.

**Seed selection (cherry-picking).** The operator generates server seeds before the player places bets. The commitment prevents changing the seed mid-epoch, but the operator could theoretically generate many server seeds, evaluate their death-point outcomes, and select seeds that produce unfavorable distributions. Selection need not bias the whole nonce range: a player meets a seed's early nonces first (this capture rotated after at most 50 bets, nonces 0–49), so a seed could be chosen on those nonces alone and look ordinary after them. That is why Pass 2 tests the early window (nonces 0–49) separately from the late window (50–9,999). Pass 2 (Step 19) tested all 121 casino seeds at `difficulty = 2` (MEDIUM, 85% first-step win rate) with 10,000 nonces per seed, each round one step on tile 0, Beef's first tile:

- **Test A (full-window chi-squared):** 0 / 121 fails — binomial p = P(X >= 0 | n = 121, p = 0.01) = 1.000 (PASS threshold >= 0.01)
- **Test B (early window against late window):** 2 / 121 isolated-early flags (early p < 0.05, late p ≥ 0.05) — binomial p = P(X >= 2 | n = 121, p = 0.05) = 0.985 (PASS)
- **Seeds off in both windows (count test):** 1 / 121 at p < 0.05 — count p = P(K ≥ 1 | Binomial(121, 0.05 × 0.05)) = 0.2613 (PASS; FLAG at 2 or more, P = 0.0373; FAIL at 3 or more, P = 0.0036); 0 / 121 at p < 0.001 (FAIL at 1).
- **Disclosed observation:** the one seed off in both windows is commitment `c9ddfba9fa8b23651529c4a5b56b037007c2223c4113e58a978598fe7121b568`, client seed `Ty1rZcxKscWFXxqt`: 36 wins in its first 50 nonces (p = 0.010042) and 8,387 in the next 9,950 (p = 0.047777), against 42.5 and 8,457.5 expected at 85%. Pooled over all 121 seeds, the first 50 nonces win 5,151 of 6,050 rounds (85.14%) against 85% expected.

The 2 isolated-early flags are within what the 5% per-seed threshold produces across 121 seeds (binomial p = 0.985). An isolated-early flag is the pattern early-nonce selection would leave, which is why their count is tested rather than set aside. The seed off in both windows is likewise scored as a count: at least one such seed among 121 is what a fair game produces about one time in four. The cherry-pick risk remains structurally present, since no external randomness beacon binds the server seed.

**Multi-account seed sharing.** The operator could supply identical server seeds to multiple accounts, allowing observation of player bet patterns before committing. This is a structural property of all HMAC-based commit-reveal schemes without drand. Not tested (single account).

| Property | HMAC-only (Duel Beef) | HMAC + drand |
|----------|----------------------|--------------|
| RNG deterministic from seeds | Yes | Yes |
| Seed commitment pre-bet | Yes | Yes |
| Seed selection exploitable | Theoretically possible | Prevented |
| External dependency | None | drand availability |

| Property | Verifiable? | How |
|----------|-------------|-----|
| Death-point positions match algorithm | Yes | Recompute from (serverSeed, clientSeed, nonce, deathPointsCount) |
| Revealed seed is consistent with its commitment | Yes | SHA-256(hex_decode(serverSeed)) === serverSeedHashed, plus next-hash promotion and forward links; consistency checks, not timing |
| Commitment was shown before the bets | Conditionally | The capture's recorded pre-bet observations of each epoch's commitment; holds only as far as the capture is faithful (P1) |
| Nonces are sequential | Yes | Check 0, 1, 2, ... per epoch |
| Win condition applied correctly | Yes | Check all current_step[] entries against mines_positions |
| Payout math correct | Yes | amount × payout_multiplier = amount_won |
| Multiplier formula correct | Yes | C(20,k)/C(20-m,k) × 0.992 |
| Server seed not cherry-picked | Partially | Statistical testing (Pass 2), but no cryptographic guarantee without drand |
| No multi-account seed sharing | No | Requires multi-account audit |

### Declared limitations register

| ID | Limitation | Magnitude (measured) | Where it is enforced or disclosed |
|----|------------|----------------------|-----------------------------------|
| DL-1 | One capture-retry nonce gap in the primary file | 1 round of 6,000 (epoch `b2dfe98473b69f19…`, nonce 25) not captured; its death points are reconstructed from the revealed seed, not verified | Step 4 — capture-origin FLAG, bound to `EXPECTED_CAPTURE_RETRY_GAPS = 1`; verdict-neutral |
| DL-2 | Phases A–C and E client seeds came from `Math.random()` in the capture script, not a CSPRNG | 5,200 primary bets + 450 Phase E bets (`capture/beef-capture.reference.js:170-172`, `capture/beef-capture-phaseE.reference.js:268-270`) | Disclosed here; the CSPRNG requirement is newer than the April 2026 capture. The client seed is the auditor's own input and the server seed was committed before it was set |
| DL-3 | Phase D client seeds are predictable | 800 bets, 16 epochs: each seed is `'pfaudit' + Date.now().toString(36)` (`capture/beef-capture.reference.js:339`, `:362`) | Disclosed here; no step enumerates the exposed epochs |
| DL-4 | One capture-retry nonce gap in the Phase E file | 1 round of 450 (epoch `1dfe6dcf…`, E4, nonce 31) not captured, followed by a 1-bet epoch — the retry shape of DL-1; its death points are reconstructed from the revealed seed, not verified | Step 4 — declared by identity in `EXPECTED_PHASE_E_NONCE_GAPS` and audited since 26 Sep 2026 (before that no step read the Phase E nonces); capture-origin FLAG, verdict-neutral |
| DL-5 | Live play observes 15 of the 61 (difficulty, k) payout cells | 46 cells never observed live | Step 11 names them; every cell's RTP is 0.992 by the exact identity of Step 16, so no unverified RTP mass |
| DL-6 | Simulation statistics are read from the committed artifact, not re-derived | Pass 1: 4 × 1,000,000 rounds, p-values read; Pass 2: fixed difficulty-2 board, one step on tile 0, late windows (9,950 nonces × 121 seeds) read, no detection power stated | Steps 18–19; the artifact is pinned (Step 23) and a `test:full` regeneration is field-diffed against it |
| DL-7 | Served k > 1 multipliers carry the operator's double-precision rounding | worst relative deviation from the exact rational 9.63e-15 (Phase E), 5.0e-19 at k = 1 | Steps 8, 10, 20 compare at relative 1e-12 and print the worst deviation |
| DL-8 | Seed rotation during an open multi-step round is not tested (S5-5) | 0 captured rounds span a rotation | [Adversarial matrix](#adversarial-matrix) S5-5 — Not tested, disclosed |
| DL-9 | Duel's own Verify-page code was not vendored until 2026-09-26 — **that half is CLOSED**: ProvablyFair.org pasted it from the duel.com Verify tab on 2026-09-26 (`evidence/verify-tab/duel-verify-tab-beef-2026-09-26.js`, E06, SHA-256 `43ba4dfbd068cbf5dde917a5432ef664df2ef68f4fabc91f516ed220ed5564f6`); Step 5 executes it with only its inputs filled in on all 6,450 rounds — death points equal the served ones on 6,450/6,450 — as a second check; `src/rng.ts` is rebuilt from `docs/ALGORITHM.md`, not from this file (BEEF-09). Still open: no max-odds cap is declared for Beef | no cap to assert: the largest served paid multiplier is 1.984 in the primary file and `5.121534465534441051` in the Phase E file (E3, HARD, k = 5), the largest formula cell 183,277.952 | `evidence/E04` shows the Verify page; the player verifier checked is a pinned copy of the ProvablyFair.org docs-site verifier ([Operator and player verifier code](#operator-and-player-verifier-code)). Multiplier monotonicity is scored since 26 Sep 2026 (Step 24, flag-only): 61 formula cells and 15 observed served cells, 0 violations |
| DL-10 | A server-side payout cap on Beef was not tested | No cap appears in the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), E07, and none was reached in the capture (largest paid 5.12× at stakes up to $10); the EXPERT full-traversal cell pays 183,277.952× | Disclosed here; the 99.2% holds for every cell below any such cap |
| DL-11 | Pass 1 scores each round on the rotating tile nonce % 20, not on tile 0, the tile every Beef round steps first | Pass 1 tests the shuffle on auditor seeds: under a fair shuffle every tile, fixed or rotating, gives an independent win/loss series with the same probability, and the rotating tile was the committed design before tile 0 was examined. Measured on tile 0 for this disclosure (6 Oct 2026, not scored): on the pinned 1,000,000 rounds per difficulty the lag-1 z is −0.30 / 0.58 / −1.32 / 3.44 (d1–d4), and difficulty 4's runs p is 5.7×10⁻⁴, below Step 18's α/4 = 0.0025, so Step 18 as written would FAIL on tile 0. It does not replicate: on the same difficulty-4 seed, nonces 1,000,000–9,999,999 give z 1.67 (runs p 0.094); 200 fresh random seeds at difficulty 4, tile 0, 1,000,000 rounds each, give mean z 0.076 (standard error 0.068), and an independent re-run on 100 fresh seeds gave mean z 0.0009 with none below 0.0025. On truly random series, Step 18's serial rule fails about 1% of four-difficulty runs | Disclosed here; Step 18 scores the rotating tile |

### Load-bearing premises

| ID | Premise | Could the captured data contradict it? | Status |
|----|---------|----------------------------------------|--------|
| P1 | The capture records what Duel served | Only in part: a forged record would still have to recompute from a seed that hashes to the commitment it was served under (Steps 1, 2, 5, 21) | ASSUMED (browser-session capture) |
| P2 | Duel's server derives every round with the algorithm in `src/rng.ts` | Yes — 6,450/6,450 captured rounds recompute (Steps 5, 21) | Witnessed for captured rounds; ASSUMED for rounds not captured |
| P3 | Death-point counts per difficulty are 1 / 3 / 5 / 10 | Yes — every recomputation uses them and matches | Witnessed |
| P4 | The player walks tiles 0, 1, 2 … in order | Yes — Step 9 requires every stepped path to be the prefix 0…k−1 | Witnessed (6,450/6,450) |
| P5 | Nonces start at 0 in every epoch | Yes — Step 4 (both files) | Witnessed |
| P6 | The paid multiplier is C(20,k)/C(20−m,k) × 0.992 for every cell, including the 46 never observed live | Only for observed cells | Witnessed on 15 cells; matches Duel's payout table in the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), E07, on all 61 (`node scripts/check-config-table.mjs`); payment on the 46 unobserved cells ASSUMED |

### Recommendations

| ID | Recommendation | Priority | Detail |
|----|----------------|----------|--------|
| R-1 | External randomness beacon (drand integration) | Medium | Eliminates seed cherry-picking risk: the current scheme does not bind the server seed to an external randomness source, and a drand beacon would cryptographically prevent pre-selecting favorable seeds. Current mitigation is statistical only: Pass 2 found no statistical evidence of exploitation (Step 19 PASS: 2/121 isolated-early flags, binomial p = 0.985; 1/121 seed off in both windows, count p = 0.261) |
| R-2 | Multi-account audit | Low | Would verify that different accounts receive different server seeds for the same epoch; a structural limitation of all single-account audits |
| R-3 | Bracket boundary testing | Low | A dedicated capture with multi-step progression through various step counts, especially near max-step boundaries, would add coverage of the multiplier ladder beyond the single-step baseline phases |

What does not need changing: the RNG algorithm (backward Fisher-Yates with HMAC-SHA256 rejection sampling) is cryptographically sound; the commit-reveal mechanism works correctly; payout formulas are mathematically correct and paid the same at the two stakes captured ($0.01 and $10); the nonce system provides sequential, non-repeating bet identifiers within each epoch.

## Terms

**Anti-circularity:** deriving theoretical RTP from independent mathematical principles, not casino-supplied probabilities or payout tables; for Beef, `survival(m,k) × multiplier(m,k) = 0.992` by algebraic cancellation. **Backward Fisher-Yates shuffle:** iterates from the last index down to 1, swapping each position with a uniformly random position in `[0, i]`; the first m positions become death points. **Client seed:** player-controlled string combined with the server seed and nonce via HMAC-SHA256; changeable via seed rotation. **Commit-reveal:** the server commits to a seed hash (SHA-256) and reveals the seed after the epoch ends. **Draw index (cursor):** the counter t in the HMAC message, one per shuffle draw (t = 0 … 18, so t = 19 − i); `docs/ALGORITHM.md` leaves the case of all 8 chunks rejected open (O1), and Duel's Verify-tab code then increments the counter and draws again. **Death points:** lethal tile positions; their count is set by the difficulty level. **Difficulty level:** EASY=1, MEDIUM=2, HARD=3, EXPERT=4, giving 1, 3, 5 or 10 death points. **drand:** a decentralized randomness beacon; Beef does not use one. **Epoch:** bets sharing one server seed, from one player rotation to the next (at most 50 in this capture, whose scripts rotated after 50 bets). **HMAC-SHA256:** `HMAC-SHA256(key=hex_decode(serverSeed), message=clientSeed:nonce:cursor)`, the pseudorandom function of the shuffle. **House edge:** 0.8% flat for Beef (payout = raw multiplier × 0.992). **Hypergeometric:** the model for drawing k safe tiles without replacement, `P(survive k steps) = C(n-m, k) / C(n, k)`. **Multiplier:** `raw = C(20,k)/C(20-m,k)`, `payout = raw × 0.992`. **Nonce:** per-epoch bet counter from 0; resets on rotation. **Rejection sampling:** discarding values >= `maxFair` to remove modulo bias. **RTP:** expected (theoretical) or observed fraction of stake returned; 99.2% theoretical for Beef. **Server seed:** 32-byte hex string, committed pre-bet by SHA-256 and revealed post-epoch. **Survival probability:** `C(20-m, k) / C(20, k)`.

## Release history

| Release | What changed | Verdict |
|---------|--------------|---------|
| `v1.0.0` | The original audit, published 4 June 2026, tagged at `b9ac903`. | PROVABLY FAIR — Full Pass |
| `v1.1.0` | Re-certification under Framework 1.1, October 2026, below. The dataset of record is unchanged. | PROVABLY FAIR — Full Pass |
| `v1.2.0` | The RNG rebuilt from a written specification instead of following Duel's code; Duel's code kept as a second check. Below, "21 October 2026" and "20 October 2026". | unchanged |
| `v1.2.1` | Errata: adds `.gitattributes` (`* -text`) so a Windows git clone keeps every file byte-identical; no audit content changed. | unchanged |
| `v1.2.2` | Wording errata: internal references removed; no change to data, code paths or results. | unchanged |

### 21 October 2026 — final QA corrections (v1.2.0)

No draw check, scored step status, figure or verdict changed.

- **Version labels.** This document's header and `package.json` / `package-lock.json` still named `v1.1.0` / `1.1.0`; they now name `v1.2.0`, and no place calls v1.2.0 "unreleased". The v1.1.0 section no longer points at this package's `RELEASE-MANIFEST.json` for v1.1.0's signature.
- **Pinned-file table.** The SHA-256 of `outputs/simulation-results.json` in [The gate](#the-gate) was still v1.1.0's (`d49f95a2…`); it now reads `7119a3e3…`, the file shipped and the pin in `src/artifact-pins.ts`.
- **Capture scripts.** [Dataset and capture](#dataset-and-capture) linked the two runnable capture scripts, which are not in the published package: they place bets on duel.com and are not published. It now lists only the two reference records that ship, and says which part of the capture-revision statement cannot be checked from this package.
- **RTP claim source.** The claim's pointer for "payout tables built on 0.992" was `src/rng.ts:41`, this package's own reference constant, which does not show Duel's config. It now points at `docs/ALGORITHM.md` §3.1 and `scripts/check-config-table.mjs`, which compare the 61 E07 payout cells with C(20,k)/C(20−m,k) × 0.992. `outputs/rtp-claim-table.json` was rewritten with `npm run rtp-claim:write` and re-pinned (`1528d0c9…`, previously `4522bd56…`); only the claim source moved.
- **Release wording.** At tagging, the README, this overview and the release manifest stopped describing `v1.2.0` as a draft until tagged. The release manifest records `v1.2.0`, superseding `v1.1.0`, and the fingerprint of the ProvablyFair.org signing key (`signature`, `SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`), as tagged `v1.2.0`; it was refreshed with `npm run release-manifest`. No check, figure or verdict changed.

### 20 October 2026 — RNG rebuilt from a written specification (v1.2.0)

The verdict, the scored-step statuses (24 PASS, 1 capture-origin FLAG, 0 hard fails) and the dataset are unchanged. Through v1.1.0, `src/rng.ts` followed Duel's published Verify-tab code (E06) step for step. A copy of the casino's code can carry the casino's own mistake into the check of it, so the RNG is now rebuilt from a written specification instead.

- **Specification.** [`docs/ALGORITHM.md`](docs/ALGORITHM.md), a copy of the ProvablyFair.org framework's `games/beef/ALGORITHM.md` (SHA-256 `57daebfd…f7b6`) with the spec author's workspace paths replaced by package paths or neutral wording (its header says so). It was written from Duel's public pages, the standard provably-fair construction, Duel's public Beef config and the 6,450 live rounds, without opening Duel's code; its §4 gives the source of every step and its §8 lists every file read.
- **Rebuild.** `src/rng.ts` was written by an implementer who read only that specification and an interface file and never opened Duel's code or the earlier `src/rng.ts`. Its body is that implementer's file byte for byte; only a provenance header was added. Its self-test is now a unit test, `tests/beef/RngSpecTests.ts` (105/105). The draw-bias bound, which is audit code and not part of the RNG, moved unchanged to `src/bias.ts` and still probes `src/rng.ts` `drawFromChunk`.
- **Duel's code is a second check, not the source.** Step 5 and the unit tests still run Duel's Verify-tab file byte for byte on all 6,450 rounds: 6,450/6,450 death points agree with the served ones and with `src/rng.ts`. The 17-line citation table (`OPERATOR_SOURCE_CITES`), its check, its unit test and mutation M05i are removed, so the registry holds 45 entries; M05d and M06 now edit the rebuilt module.
- **Three-way agreement, measured on integration over both files.** `src/rng.ts` against the served rounds: 131/131 commitments, 6,450/6,450 death points, and the win/loss, path and Phase E `reached_k` derived from them 6,450/6,450 and 450/450; against Duel's Verify-tab code 6,450/6,450; against the docs-site `derive.js` 6,450/6,450. The live www.provablyfair.org verifier is not run for Beef: this package has no runner for it. Step 5 repeats the served, Duel-code and docs-site legs on every `npm test`.
- **Where the rebuild and Duel's code differ.** Neither difference is reached by any captured draw (0 rejected chunks in 122,550 draws). At ranges 2, 4, 8 and 16 the specification accepts every 32-bit chunk, while Duel's bound rejects the top r values and moves to the next chunk; Step 5's draw-bias table now shows those four windows as the whole 2^32 domain. When all 8 chunks of one draw are rejected (at most about 4 × 10⁻⁶⁸ per draw), `src/rng.ts` stops with an error (specification open point O1), while Duel's code draws again on the next counter. The unit test that expected a throw at 20 death points (Duel's guard) now expects one at 21: the specification sets no such guard.
- **Artifacts.** `outputs/simulation-results.json` was regenerated with `PF_EMIT=1 npm run simulate` on the rebuilt module and re-pinned (`7119a3e3…`, previously `d49f95a2…`): only the Pass 1 description moved; every simulated figure and `rtp-convergence.html` came back byte-identical. `outputs/rtp-claim-table.json` was rewritten with `npm run rtp-claim:write` and re-pinned (`4522bd56…`, previously `0ad7bc6d…`): only the line reference in the claim source moved, to `src/rng.ts:41`. `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify`; `determinism-log.json` and `chi-squared-results.json` came back byte-identical. In Step 16 the largest float deviation of survival × multiplier from 0.992 is unchanged at 2.22e-16 (one unit in the last place), but the first cell reaching it moved from d=2, k=4 to d=1, k=17 (`worstConfig`), because the rebuilt `survivalProbability` and `theoreticalMultiplier` compute the binomials exactly and round once. The release manifest was written by `npm run release-manifest` for `v1.2.0`, unsigned.
- **Mutation battery.** `npm run mutate` on 20 October 2026 (Apple M2 Max, Node v22.23.1, the whole registry of 45 entries in one run, baseline verify exit 0, mocha exit 0, PROVABLY FAIR — Full Pass): 45/45 mutations killed, 25/25 scored steps have a mutation that kills them, 0 declared survivors.

### v1.1.0 — what changed

v1.1.0's release identity, artifact hashes and signature are in the `RELEASE-MANIFEST.json` at the `v1.1.0` tag. The [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json) in this package is v1.2.0's.

- **Scored steps: 22 in the original 4 June 2026 publication (public commit `05530ee`), 23 at the `v1.0.0` tag (public commit `b9ac903`), 25 now.** The verdict is unchanged, PROVABLY FAIR — Full Pass. The dataset of record is byte-identical to both. New since the original publication: Artifact Integrity (Step 23, added on 14 Sep 2026 and already in the tagged v1.0.0 tree), Multiplier Monotonicity & Bounds and Live-Sample Fit (informational).
- **Step 4 (Nonce Audit) is now a capture-origin FLAG.** v1.0.0 checked the 121 primary epochs and reported 1 capture-retry gap; this release also checks the 10 Phase E epochs and reports 2 gaps, both declared in `src/loader.ts` as capture retries. A capture-origin FLAG is disclosed and does not move the verdict; the step passed in v1.0.0.
- **RTP claim table, scored.** `outputs/rtp-claim-table.json` scores all 61 difficulty and cash-out cells against a flat 99.2% claim (the effective_edge 0.8 in Duel's game settings, served on every bet); under RTP-CLAIM 1.2.0, switched on, the outcome is scored on Step 16. Outcome: pass (true minimum 99.200000%, true maximum 99.200000%).
- **Run metadata removed (26 Sep 2026).** `simulation-results.json` carried a `generatedAt` and two `executionTimeMs` fields until 26 Sep 2026, when those three lines were deleted with the generator's own serializer and the file re-pinned; no figure moved.
- **Errata (2026-09-29):** the RTP convergence chart (`outputs/rtp-convergence.html`) loaded Chart.js 4.4.7 from cdn.jsdelivr.net, so a pinned artifact depended on a third-party host. The same version is now inlined, byte for byte from the npm package pinned in package-lock.json. Every figure and data point in the chart is unchanged.
- **Added:** 18 Markdown report files (consolidated with the others into README.md and this MANIFEST.md on 4 October 2026, below), `LICENSE` (MIT), `.nvmrc` (Node 22), `RELEASE-MANIFEST.json` (written by `scripts/release-manifest.mjs`) and the mutation battery (`npm run mutate`, `tests/mutations.json`).
- **Added (October 2026):** the Beef config as evidence (E07, no scaling edge: the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET)) and `scripts/check-config-table.mjs` (its 61 payout cells match C(20,k)/C(20−m,k) × 0.992), the note that Duel's Zero Edge rakeback on Beef postdates the capture and is not audited, limitation DL-10 (payout cap not tested), and the disclosure that `seeds[0]` of each data file was filled from `seeds[1]` after capture. Removed: the comparison of the 0.8% edge with Duel.com's 0.1% standard (the overview sentence, former limitation 3 and R-4), and, from this document's informational table, the two serial-independence rows on the capture's difficulty sequence with the sentence that named the simulation the definitive serial test (the verifier kept printing and emitting both rows until 6 October 2026, below). `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify` only to carry DL-10 in the BEEF-30 profile note; no result changed.

### 19 October 2026 — RNG provenance, capture scripts and pinned-file wording

No draw check, scored step status, figure or verdict changed.

- **RNG provenance.** This document called `src/rng.ts` an "independent" implementation (the conclusion, the worked example and the package layout), and the Pass 1 description in `outputs/simulation-results.json` said it "Validates independent implementation". `src/rng.ts` then followed Duel's published Verify-tab code step for step and was checked against it (E06), so each place said that until the 20 October 2026 rebuild (above); [Operator and player verifier code](#operator-and-player-verifier-code) states what that comparison cannot catch. `outputs/simulation-results.json` was regenerated with `PF_EMIT=1 npm run simulate` (only that description line changed; `outputs/rtp-convergence.html` came back byte-identical) and re-pinned in `src/artifact-pins.ts`; the two mutations that re-pin it (M18, M19) carry the new pin and were rerun: 2/2 killed. `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify` (only Step 23's pin row changed) and the release manifest was regenerated.
- **Capture scripts.** [Dataset and capture](#dataset-and-capture) and the package layout listed all four files under `capture/`: the two browser-console scripts as well as their reference records, and which data file each script's output schema matches. The two runnable scripts are withheld from the published package, so v1.2.0 lists only the reference records (21 October 2026, above).
- **Pinned files.** [The gate](#the-gate) said the four pinned artifacts are not the verifier's own output; two of them, `determinism-log.json` and `chi-squared-results.json`, are written by `PF_EMIT=1 npm run verify`. It now says which command writes each.
- The README and this section no longer describe the release as a draft or not yet released.

### 6 October 2026 — capture schedule, commitment chain and stake wording

Wording only. No step status, figure or verdict changed.

- The 50-bet epoch was described as part of Beef's seed lifecycle (lifecycle step 4, the Terms entry for Epoch, S5-7's expected behaviour and a `src/loader.ts` comment). It was the capture scripts' rotation schedule (`BETS_PER_EPOCH = 50`); Duel reveals a server seed only when the player rotates.
- The commitment-chain paragraph, the Step 2 row and detail, and S5-1 said the promotion, forward-link and pre-capture checks established that the epoch order was pre-committed. In this capture they are one comparison, because the capture scripts copied each rotation's next hash into both fields (124/124 primary and 13/13 Phase E rows), and when a hash was shown rests on the capture's write order, as [Limitations and trust](#limitations-and-trust) already said. "Hashes to its pre-bet commitment" now reads "hashes to the commitment its bets were served under" in the nonce-flag paragraph, the Step 4 detail, S5-1 and premise P1.
- "Stake-independent" (the Step 10 note and "What does not need changing") and "all bet sizes" (the Step 12 note) now name the two stakes captured, $0.01 and $10. The daily allowance figure, which had no source in this package, was removed from the Zero Edge rakeback sentence, and a `src/types.ts` comment that said Beef has no rakeback now says none applied to the captured bets.
- The phase-start note in [Dataset and capture](#dataset-and-capture) now says every phase, Phase A included, opens with a rotation and every seed row records the same fields; it said Phases B, C and D carried separate pre-bet snapshots. The Step 1 detail and a `src/loader.ts` comment now attribute the 3 excluded phase-boundary transitions to the next phase's opening rotation, not to the end-of-phase rotation.
- `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify` (Step 1, Step 2 and Step 4 details) and the release manifest was regenerated.

### 6 October 2026 — Pass 1 tile disclosed

Pass 1 keeps the rotating tile nonce % 20 it was designed and pinned with. Its result on tile 0, the tile Pass 2 and Step 19 now score, was measured and is disclosed as DL-11, with the replication on 9,000,000 further nonces and on fresh seeds. No step status, figure or verdict changed.

### 6 October 2026 — Pass 1 runs test on the win/loss outcome

The runs test on Pass 1's binary outcome series was degenerate when losses outnumbered wins: it split the series at its median, which is 0 at difficulty 4 (win rate 0.499415), so it returned z 0, p 1 whatever the sequence. `src/stats.ts` now uses the binary Wald-Wolfowitz test on the outcome itself (n1 = wins, n2 = losses). `outputs/simulation-results.json` was regenerated with `PF_EMIT=1 npm run simulate` and re-pinned: difficulty 4 now reads runs z 0.62, p 0.54, and difficulties 1–3 and `outputs/rtp-convergence.html` came back identical. `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify` (only Step 23's pin row changed) and the release manifest was regenerated. No step status or verdict changed.

### 6 October 2026 — serial-independence rows removed from the verifier

The two serial-independence rows on the capture's difficulty sequence (lag-1 autocorrelation and Wald-Wolfowitz runs test) left this document on 5 October 2026, but `tests/steps/statistical.ts` still computed them, so `npm test` printed them and `outputs/verification-results.json` carried them in its `info` block, including `z=-14.398, p=0.0000`. They measured the order in which the capture chose difficulties, not the game's randomness. Both are now deleted from `tests/steps/statistical.ts`, and `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify`: its `info` block carries the RTP analysis and the win-rate chi-squared only. No scored step changed status and no figure moved. The release manifest was regenerated.

### 6 October 2026 — Step 19 scored on Beef's first tile, by counts

Pass 2 of the simulation and Step 19's replay scored each round on the rotating tile nonce % 20, but every Beef round steps tile 0 first; both now score tile 0, and Step 19 checks that tile against the first stepped tile of all 6,450 captured rounds. `outputs/simulation-results.json` was regenerated with `PF_EMIT=1 npm run simulate` and re-pinned (Pass 1 and `outputs/rtp-convergence.html` came back identical).

In v1.0.0 Step 19 read the flag counts from the artifact, compared Test B's count with 14 (2 × ceil(0.05 × 121)) and could reach FLAG but never FAIL; it counted seeds off in both windows only among Test B's flags, which require a late p ≥ 0.05, so that count could not be non-zero. Step 19 now recomputes every p-value, flag and count from the per-seed rows, replays all 121 early windows from the revealed seeds, and scores every verdict-moving rule as a count over the 121 seeds, with its false-alarm rate on a fair game stated and capped at 5% for a FLAG and 1% for a FAIL ([Step 19 rules](#step-19-rules-and-false-alarm-rates)): Test A FAILs at 5 or more seeds; Test B FLAGs at 11 or more and FAILs at 13 or more; seeds off in both windows at p < 0.05 FLAG at 2 or more and FAIL at 3 or more, P(K ≥ k | Binomial(121, 0.05 × 0.05)); any seed off in both windows at p < 0.001 is a FAIL.

Result on tile 0: Test A 0/121; Test B 2/121 (binomial p = 0.985); 1/121 seed off in both windows at p < 0.05 (count p = 0.2613), commitment `c9ddfba9…7121b568`, client seed `Ty1rZcxKscWFXxqt`, early 36/50 p = 0.010042, late 8,387/9,950 p = 0.047777, disclosed as an observation; 0 at p < 0.001. Step 19 is a PASS, as in v1.0.0 (Test B 4/121 on nonce % 20), and the verdict is unchanged. `outputs/verification-results.json` was regenerated with `PF_EMIT=1 npm run verify` and the release manifest was regenerated. A cherry-picked seed need not bias the full nonce range: selection could target the early nonces alone, which is why the early window is tested separately.

The mutation battery (added in this release) now runs 42 mutations; M19b–M19e cover Step 19 (the replay on nonce % 20, a captured round whose first stepped tile is not tile 0, seeds off in both windows scored one by one, the both-window FLAG level loosened past its cap). Its runner copies `outputs/rtp-claim-table.json` into the disposable workspace, without which the RTP-claim gate exits 1 and the battery cannot establish its baseline. Rerun on this change together with the capture-schedule and commitment-chain wording above: 42/42 killed, 25/25 scored steps covered.

### 4 October 2026 — consolidated documentation

The 20 Markdown documents were reduced to **README.md and this MANIFEST.md**. Repeated explanations and superseded figures were removed; evidence files, the captured datasets, the draw and settlement logic and every scored result were retained. Documentation references in the profile-coverage map (`src/profile-map.ts`) and the RTP claim source (`src/rtp-settings.ts`) now point to the retained sections; `outputs/verification-results.json` and `outputs/rtp-claim-table.json` were regenerated with the package's own commands, the claim-table pin and the release manifest were refreshed, and every numerical result is unchanged. No new casino capture, simulation regeneration or mutation run is asserted for this update.

Where the former chapters disagreed with the verifier's output, the output was kept: the unit-test count is 25 (three former documents said 21); the win-condition check covers 6,450 rounds of both files (two chapters said 6,000); the EXPERT full-traversal multiplier is the one in Step 24's data block (one chapter gave a different figure); the per-difficulty win counts are those in `outputs/chi-squared-results.json` (one chapter gave approximate counts); Duel's Verify-tab code is preserved as E06 (one chapter still said it was not copied); the adversarial matrix rests on 24 PASS + 1 capture-origin FLAG (its chapter still quoted 22 PASS + 1 FLAG from before Steps 24–25).

### 14 October 2026 (second pass) — an RTP miss ends RTP FIGURE OVERSTATED (FIXPASS2 class C3)

No verdict, scored step status or figure changed. `outputs/verification-results.json` was re-emitted (`PF_EMIT=1 npm run verify`); the only field that changed is the Step 16 detail line.

- **Step 16 no longer pre-empts the rule.** Its exact identity held counted survival × the paid multiplier to the claimed 992/1000 at every cell, so a cell paying less ended the run NOT PROVABLY FAIR (measured with MC3a on the 14 October tree: exit 1, `[FAIL] Step 16`). It now holds the identity to that cell's exact row in the RTP table (992/1000 at every honest cell); whether a row meets the claim is RTP-CLAIM's, on the same step. M16 was re-aimed from `EDGE_NUM` 992 → 991 (which now moves the RTP table instead) to a `binomialBig` off by one, which cancels out of the table but not against the counted survivals.
- **Exit-5 mutations.** `scripts/mutate.mjs` gained `regen` (in the disposable copy: the RTP table rewritten by `src/rtp-settings.ts` and re-pinned, then the committed record re-emitted with `PF_EMIT=1`), `expectExit` (an entry counts as killed only when the run also ends with that exit code) and runner `test` (mocha, then the verifier, as `npm test` runs them). New entries: MC3a (the paid multiplier of difficulty 4, k = 10 lowered 1 % in `src/exact.ts`: 98.208 %, 0.992 pp under the 99.2 % claim) and MC3b (the claim raised to 99.4 %), each with the table and record regenerated and expected to end RTP FIGURE OVERSTATED, exit 5. MC3as and MC3bs make the same changes without regenerating the table and are expected to end exit 1: a committed RTP table that differs from the run, or from its pin, is a reproduction failure, miss or no miss.
- **Battery (Apple M2 Max, 12 cores, Node v22.23.1).** The whole registry (46 entries) in one `npm run mutate` on this tree, 14 October 2026 evening (baseline green): 46/46 killed, 25/25 scored steps covered. On 15 October `--only` (now taking several comma-separated substrings) reran the four C3 entries and every entry naming Step 16, the RTP-claim step (M16, MC3): 5/5 killed; MC3a and MC3b ended `VERDICT: RTP FIGURE OVERSTATED`, exit 5; MC3as and MC3bs exit 1 with the committed table reported as differing from the run.

### 14 October 2026 — Methodology v1.1

No draw check, scored step status, figure or verdict changed. The dataset and the artifacts pinned in `src/artifact-pins.ts` are unchanged; the RTP-claim table, pinned in `src/rtp-settings.ts`, was rewritten and re-pinned (below).

- **Framework 1.1.** The audit is re-certified under ProvablyFair.org Framework 1.1 (decision D1); the release manifest's `framework` field and the release row above say 1.1.
- **RTP-CLAIM 1.2.0, switched on.** `src/rtp-claim.ts` is the framework's rule 1.2.0, byte-identical to `core/rtp-claim.ts` (SHA-256 `c9a9c1c4…5f131c`), and `src/rtp-claim-switch.ts` is set to true (decision D3). The outcome is scored on Step 16 (BEEF-19): a house-side miss would be an operator-origin FLAG on that step and the verdict RTP FIGURE OVERSTATED, exit 5, never NOT PROVABLY FAIR. The claim source now names its place, the game settings (decision D2: "The edge in Duel's game settings counts"): the `effective_edge` 0.8 served with every bet and the E07 payout tables built on 0.992. Outcome: pass, as before. In `outputs/rtp-claim-table.json` only `ruleVersion` and the source wording changed.
- **Profile.** The Beef profile version this suite cites is 1.0.2 (decision D6, approved as cited; the `-proposed` suffix is dropped, no check changed). In `outputs/verification-results.json` only `profileCoverage.profileVersion` changed.
- **S5 level.** The adversarial matrix states the S5 level received: the fairness-integrity matrix; game-integrity testing was not commissioned (decision D5).
- **Exit 5** (RTP FIGURE OVERSTATED) is added to the exit codes.
- `outputs/rtp-claim-table.json` was rewritten with `npm run rtp-claim:write` and re-pinned, `outputs/verification-results.json` regenerated with `PF_EMIT=1 npm run verify`, and the release manifest refreshed with `npm run release-manifest`. The mutation battery was rerun: 42/42 killed, 25/25 scored steps covered.

### Where the former chapters went

| Former documentation | Consolidated location |
|---|---|
| `executive-summary.md`, `conclusion.md` | Conclusion and scope; README |
| `game-rules.md`, `system-architecture.md`, `rng-algorithm-analysis.md` | Game and algorithm |
| `payout-verification.md`, `rtp-analysis.md` | Payouts and RTP |
| `findings.md`, `live-parity-testing.md`, `exploit-testing.md`, `edge-case-analysis.md` | Verification results (adversarial matrix under its own heading); Dataset and capture |
| `reproducibility.md` | Reproduce the audit |
| `game-logic-verifiability.md` | Verify a bet; Limitations and trust (trust vs verifiable table) |
| `evidence.md` | Evidence |
| `operator-trust-analysis.md` | Limitations and trust; Game and algorithm (commitment chain, client seed origin) |
| `recommendations.md` | Limitations and trust (Recommendations) |
| `glossary.md` | Terms |
| `SUMMARY.md` | Contents; README |
