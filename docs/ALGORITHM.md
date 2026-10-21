# Duel.com Beef: clean-room algorithm specification

> Package copy of the ProvablyFair.org audit framework's `games/beef/ALGORITHM.md`.
> It differs from that file only where the file named locations or tracking items
> in the spec author's workspace: those now read as paths inside this package or as
> neutral wording. No rule, number, vector or source note was changed.

Written 20 Oct 2026 for the ProvablyFair.org audit of Duel.com Beef (Duel's API
calls the game `cross-road`).

This document is the only input an implementer needs to rebuild Beef's outcome
derivation and settlement. It was written without opening any Duel source code,
any port of it, or any copy of Duel's in-site verifier code (see §8 for every
file and URL opened). Every step names where it came from:

- **PAGE**: Duel's public pages, quoted with location and date.
- **STANDARD**: the standard provably-fair construction used across the
  industry (SHA-256 commitment to a server seed; HMAC-SHA256 keyed by the server
  seed over the client seed, nonce and a counter; bytes to integer; rejection
  sampling; Fisher-Yates shuffle).
- **DATA**: fixed by testing the standard candidates against all **6,450** live
  rounds: `data/beef-master-6000bets.json` (6,000
  single-step rounds, phases A–D, captured 16 Apr 2026) and
  `beef-phaseE-450bets.json` (450 multi-step rounds, phase E, captured
  21 Apr 2026). The data chose; Duel's code did not.
- **CONFIG**: Duel's public Beef config, `GET /api/v2/cross-road/config`,
  captured 5 Oct 2026 as
  `evidence/E07-cross-road-config-2026-10-05.json`.
  Fetched again (GET, logged out) on 20 Oct 2026: identical after JSON parsing.

The public pages say what goes in. They do not say how it is combined, so most
of §2 was settled by DATA.

---

## 0. The game in one paragraph

A road of **20 tiles**, numbered 0 … 19 in the order the player steps on them.
At the start of a round, `m` of the 20 tiles are made death points, where `m`
depends on the difficulty. The player steps on tile 0, then 1, then 2 …, and may
cash out after any safe step. Stepping on a death point loses the stake. Cashing
out after `k` safe steps pays `stake × multiplier(difficulty, k)`. The death-point
set is fixed by the seeds before the first step; the player's choices only
decide how far along the fixed road they walk.

| Difficulty id | Name (CONFIG) | `steps` (CONFIG) | Death points `m` |
|---|---|---|---|
| 1 | EASY | 19 | 1 |
| 2 | MEDIUM | 17 | 3 |
| 3 | HARD | 15 | 5 |
| 4 | EXPERT | 10 | 10 |

- SOURCE for `m`: CONFIG + DATA. CONFIG gives `steps` = 19 / 17 / 15 / 10, which
  is `20 − m`, and its `probabilities` row starts at 0.95 / 0.85 / 0.75 / 0.5 =
  `(20 − m) / 20`. Every captured round records exactly `m` death points for its
  difficulty, and every recorded `path_length` is 20 (6,450 / 6,450).
- The 20-tile road and difficulty names are also visible in the game UI (E01:
  "Difficulty: Easy", a row of tiles labelled 1.04x, 1.10x, 1.17x, 1.24x, 1.32x,
  1.42x, which are the first six EASY multipliers of CONFIG rounded to 2 dp).

---

## 1. Inputs and commitment

### 1.1 Inputs

| Input | Form | Source |
|---|---|---|
| `serverSeed` | 64 lowercase hex characters (32 bytes); secret until the seed pair is rotated | PAGE: "Server seed - a random string provided by us" (E03; live page 20 Oct 2026). Form: DATA (all 139 revealed seeds are 64 hex) |
| `clientSeed` | text string chosen or accepted by the player | PAGE: "Client seed - a random string provided by you" (E03). E02 shows the "Active client seed" and an editable "New client seed" field |
| `nonce` | non-negative integer; 0 on the first round after a rotation, +1 per round | PAGE: "Nonce - a number that increases with each bet" (E03); E02 shows "Nonce 0" on a fresh pair. DATA: every epoch starts at 0 |
| `difficulty` | 1–4 | DATA (`difficulty_level`); CONFIG `difficulty_levels` |
| `amount` | stake, decimal | DATA |
| cash-out depth `k` | 1 … 20 − m, chosen by the player during the round | DATA (phase E `target_k` / `reached_k`; single-step phases always `k = 1`) |

One round consumes one nonce, however many steps the player takes (DATA: every
phase-E round, 1–5 steps, carries a single nonce).

### 1.2 Commitment

PAGE (duel.com/provably-fair, Overview tab; E03, and rendered 20 Oct 2026):

> "We then send you the hex-encoded SHA-256 hash of our server seed before you
> place your bets, to prove we won't change our minds."
>
> "After the game, we reveal the unhashed Server Seed. You can verify that: The
> server seed matches the original hash. The combined seeds generated the exact
> result you played."

The page does not say which bytes are hashed. Spec:

```
commitment = lowercase_hex( SHA-256( hex_decode(serverSeed) ) )
```

i.e. hash the **32 raw bytes** the 64 hex characters encode, not the 64 ASCII
characters.

- SOURCE: STANDARD (SHA-256 commitment) + DATA for the encoding.
- Candidates tried: SHA-256 of the 32 hex-decoded bytes → **131 / 131** bet
  commitments resolve (121 master + 10 phase E), covering **6,450 / 6,450**
  rounds; SHA-256 of the ASCII hex string → **0 / 131**.
- Pairing: revealed seeds are paired to rounds **by this hash**, never by record
  position (a rotation record can carry a revealed seed next to a different,
  new hash).
- Forward chain: each rotation record also carries the next-seed hash shown
  before the rotation (`nextServerSeedHash`), which must become the active hash
  after it (E02 shows "Active server seed (Hashed)" and "Next server seed
  (Hashed)").

---

## 2. Outcome derivation (the death-point set)

PAGE gives only the inputs, not the combination:

> "Then we combine all of these values to generate a random result for each
> round: Fair result = Server seed + Client seed + Nonce" (E03; same text on the
> live page 20 Oct 2026)

### Step 1: one HMAC per shuffle draw

The shuffle in Step 3 makes 19 draws, indexed `t = 0, 1, …, 18`. Draw `t` uses
its own HMAC:

```
key       = hex_decode(serverSeed)                                      # 32 bytes
message_t = UTF-8( clientSeed + ":" + decimal(nonce) + ":" + decimal(t) )
digest_t  = HMAC-SHA256(key, message_t)                                 # 32 bytes
```

e.g. `8AgNlaGR1fxeiy93:0:0`, `8AgNlaGR1fxeiy93:0:1`, …, `8AgNlaGR1fxeiy93:0:18`.
`decimal(x)` is plain base 10: no padding, sign or separators.

- SOURCE: STANDARD (HMAC-SHA256, server seed as key, `clientSeed:nonce:counter`
  as message) + DATA for the key form, the message format and the counter.
- The counter is the **draw index** `t`, starting at 0, one fresh HMAC per draw.
  It is not a 32-byte block cursor over a continuous byte stream.

### Step 2: digest to an index in [0, r)

```
LIMIT(r) = floor(2^32 / r) * r
for c in 0, 4, 8, …, 28:
    v = digest_t[c .. c+3] read as an unsigned 32-bit BIG-ENDIAN integer
    if v < LIMIT(r):
        return v mod r
# all 8 chunks rejected: Open point O1
```

- SOURCE for "first 4 bytes, big-endian, mod r": DATA.
- SOURCE for the rejection loop: STANDARD (rejection sampling removes modulo
  bias). The data **cannot** tell it apart from plain `v mod r`: for r ≤ 20 a
  chunk is rejected with probability `(2^32 mod r) / 2^32` ≤ 3.7 × 10⁻⁹, and
  **0** of the 122,550 draws in the dataset (6,450 rounds × 19) hit it. Both
  forms give 6,450 / 6,450. See O1.

### Step 3: backward Fisher-Yates over the 20 tiles

```
a = [0, 1, 2, …, 19]
for t in 0 … 18:
    i = 19 − t                         # i runs 19, 18, …, 1
    j = draw(t, r = i + 1)             # Steps 1–2, j in [0, i]
    swap a[i], a[j]
deathPoints = set( a[0], a[1], …, a[m − 1] )     # the FIRST m entries
```

`a` holds tile numbers. The death points are the tile **values** found in the
first `m` slots of the shuffled array (not the slots whose value is below `m`).
Draw `t` uses range `20 − t`, so the 19 ranges are 20, 19, …, 2.

- SOURCE: STANDARD (Fisher-Yates) + DATA for direction, counter alignment and
  which slots are read. (The framework profile, `rules.drawBias`, already
  describes Beef as "a backward Fisher–Yates on 20 tiles … the 19 ranges 2 …
  20". That text did not choose the variant; the data below did.)
- The same 20-tile shuffle is computed for every difficulty; only `m` differs.
- Candidates tried, each scored on all **6,450** rounds (death-point set compared
  as a set; the capture records it sorted):

  | Variant | Match |
  |---|---|
  | **SPEC**: hex key, `c:n:t` with t = 0…18, u32 BE + rejection, backward FY, first m | **6,450 / 6,450** |
  | same, plain `mod r` (no rejection) | **6,450 / 6,450** (indistinguishable, see Step 2) |
  | key = the 64-character ASCII hex string | 62 / 6,450 |
  | counter `t + 1` (1…19) | 53 / 6,450 |
  | counter = the range `i + 1` (20…2) | 77 / 6,450 |
  | death points = the last m slots | 0 / 6,450 |
  | forward Fisher-Yates (i = 0…18, j in [i, 19]), first m | 0 / 6,450 |
  | pick m tiles one by one from a shrinking list | 0 / 6,450 |
  | tiles p with a[p] < m (inverse reading) | 146 / 6,450 |
  | float from 4 bytes (Σ bᵢ / 256^(i+1)) × r, floored | 72 / 6,450 |
  | whole 32-byte digest as a big integer mod r | 53 / 6,450 |
  | continuous byte stream, HMAC `c:n:cursor` per 32 bytes, u32 BE + rejection | 66 / 6,450 |
  | continuous byte stream, float from 4 bytes (Stake-style) | 72 / 6,450 |

  The non-matching counts are chance level (an EASY round matches a wrong
  variant 1 time in 20). Two wider sweeps were run first: 128 stream/shuffle
  combinations on 300 rounds (best 14 / 300, chance level) and 380
  combinations of key form × 11 message/stream schemes × 4 byte mappings ×
  5 shuffle readings on 60 EXPERT rounds (where a chance match is ~1 in
  184,756): only the SPEC row and its plain-mod twin scored 60 / 60; every
  other combination scored 0 / 60.

### Step 4: what the player walks

The player stands on tiles `0, 1, …, k−1` in that order. A round with intended
cash-out depth `K`:

```
f = min(deathPoints)                       # first death point on the road
win   ⇔  f ≥ K                             # no death point among tiles 0 … K−1
reached = K       if win
        = f + 1   if loss                  # the round ends on tile f
current_step = [0, 1, …, reached − 1]
```

- SOURCE: game description (E01 road) + DATA. Recomputed from the derived death
  points (never from the operator's `outcome`): win/loss matches
  **6,450 / 6,450**; `current_step = [0 … reached−1]` and phase E `reached_k`
  match **6,450 / 6,450**.

---

## 3. Win probability, multiplier and payout

### 3.1 Exact reference (what the audit tests against)

```
P(survive k steps | m) = C(20 − m, k) / C(20, k)
fair(m, k)             = C(20, k) / C(20 − m, k)
edge e                 = 0.008                          (0.8 %)
multiplier(m, k)       = (1 − e) · fair(m, k) = 0.992 · C(20, k) / C(20 − m, k)
```

- SOURCE: STANDARD (multiplier = (1 − edge) / probability; the hypergeometric
  survival probability follows from Step 3, which makes the death-point set a
  uniform m-subset of 20) + CONFIG + DATA.
- CONFIG `payout_tables[d][k−1]` equals `0.992 · C(20,k)/C(20−m,k)` rounded to
  18 dp, half-up or half-even, on **61 / 61** cells (truncation 37 / 61, rounding
  up 43 / 61). CONFIG `probabilities[d][k−1]` equals `C(20−m,k)/C(20,k)` within
  10⁻¹⁵ on **61 / 61** cells (they are float64).
- Edge: every captured round serves `effective_edge` = 0.8 (**6,450 / 6,450**),
  and 0.992 is the CONFIG table's factor on every cell. No stake tiers were
  observed (phase C at amount 10 served the same 0.8 %).

### 3.2 What Duel actually serves (DATA)

The served figures are not the exact rational rounded once. They follow this
fixed-precision chain (all rounding half-up at the stated decimals; half-even
gives the same result on every captured value, see O6):

```
p_k  = (20 − m − (k − 1)) / (20 − (k − 1))   # chance step k is safe, given k−1 were
q14  = round to 14 decimals
q18  = round to 18 decimals

M_1  = q18( 20 / (20 − m) )
M_k  = q18( M_(k−1) / q14(p_k) )            for k ≥ 2
served "multiplier"               (no edge) = M_k
served "no_house_edge_multiplier" (edge)    = q18( M_k × 0.992 )
amount_won (cash-out at depth k)            = q18( amount × M_k × 0.992 )   # one rounding
```

Note the field names are the reverse of their meaning: the field called
`multiplier` carries the no-edge figure, the field called
`no_house_edge_multiplier` carries the figure with the 0.8 % edge, and the payout
uses the latter's unrounded form.

- DATA, all 6,450 rounds:
  - field `multiplier` = `M_k`: **4,539 / 4,539** wins; every phase-E rung
    `multiplier` = `M_k`: **1,085 / 1,085**.
  - field `no_house_edge_multiplier` = `q18(M_k × 0.992)`: **4,539 / 4,539**.
  - `amount_won` = `q18(amount × M_k × 0.992)`: **4,539 / 4,539**.
    Alternatives: `q18(amount × q18(M_k × 0.992))` 4,374 / 4,539 (fails all 165
    phase-C wins at amount 10); `q18(amount × exact multiplier)` 4,172 / 4,539.
  - rung `win_chance` = `q14(p_(k+1))` (the chance of the NEXT step):
    **1,085 / 1,085**; rung `next_multiplier` = `q18(M_k / q14(p_(k+1)) × 0.992)`,
    one rounding: **1,085 / 1,085** (two-rounding forms: 879 and 961).
  - rounding modes (q18 × q14): half-up/half-up, half-up/half-even,
    half-even/half-up and half-even/half-even all give 1,085 / 1,085 rungs and
    4,539 / 4,539 wins; every combination that truncates or rounds up at either
    precision fails (at most 4,512 / 4,539 wins and 670 / 1,085 rungs).
- For k = 1 the chain equals the exact multiplier rounded (except for
  difficulty 3, where `q18(M_1 × 0.992)` = 1.322666666666666666 and the CONFIG
  cell is 1.322666666666666667; 903 captured wins show the former).
- For k ≥ 2 the 14-decimal `p_k` makes the served multiplier differ from the
  exact one. Across all 61 (difficulty, k) cells the chain's `M_k` differs from
  `fair(m, k)` by at most **4.05 × 10⁻¹⁴ relative** (difficulty 3, k = 15).
  On the 202 captured phase-E cash-outs the served edge multiplier differs from
  the exact one by at most 9.63 × 10⁻¹⁵ relative.

### 3.3 Loss

```
loss: amount_won = 0
      served "multiplier" = M_(reached−1), or "1.000000000000000000" when the
      first step was the death point; "no_house_edge_multiplier" = null
```

DATA: losses paying 0 **1,911 / 1,911**. In phase E the death rung (248 of
them) carries the previous rung's multiplier, or 1 when it is step 1, with
`next_multiplier = null`.

### 3.4 Fields an implementation must not read

`mines_positions`, `outcome`, `current_step`, `reached_k`, `multiplier`,
`no_house_edge_multiplier`, `win_chance`, `next_multiplier`, `effective_edge`
and `amount_won` are the operator's claims, to be checked. The derivation reads
only `serverSeed`, `clientSeed`, `nonce`, `difficulty`, `amount`, the player's
cash-out depth and the CONFIG table.

---

## 4. Source per step (summary)

| Step | Source | Evidence |
|---|---|---|
| Inputs: server seed, client seed, nonce | PAGE | E03 / live overview page, 20 Oct 2026 |
| Commitment = SHA-256, hex output | PAGE + STANDARD | E03 "hex-encoded SHA-256 hash of our server seed" |
| Hash input = hex-decoded 32 bytes | DATA | 131/131 commitments (ASCII form 0/131) |
| 20 tiles; m = 1 / 3 / 5 / 10 | CONFIG + DATA | `steps` = 20 − m; 6,450/6,450 rounds |
| HMAC-SHA256, key = hex-decoded server seed | STANDARD + DATA | 6,450/6,450 (ASCII key 62) |
| Message `clientSeed:nonce:t`, t = draw index from 0 | STANDARD + DATA | 6,450/6,450 (t+1: 53; range: 77; stream: 66) |
| First 4 bytes, big-endian u32, mod r | DATA | 6,450/6,450; float 72, big-int 53 |
| Rejection ≥ floor(2³²/r)·r, next chunk | STANDARD | not exercised (0 of 122,550 draws); O1 |
| Backward Fisher-Yates, ranges 20…2 | STANDARD + DATA | 6,450/6,450; forward 0, pick-list 0 |
| Death points = values in first m slots | DATA | 6,450/6,450; last m 0; inverse 146 |
| Walk tiles 0…k−1; win ⇔ first death ≥ k | E01 + DATA | 6,450/6,450 outcome and path |
| Multiplier = 0.992 · C(20,k)/C(20−m,k) (reference) | STANDARD + CONFIG | CONFIG 61/61 cells at 18 dp |
| Served chain M_k, q14 chances, q18 | DATA | 1,085/1,085 rungs; 4,539/4,539 wins |
| Payout = q18(amount × M_k × 0.992) | DATA | 4,539/4,539 wins; losses 1,911/1,911 = 0 |

---

## 5. Test vectors (from the dataset)

Each vector is copied from the dataset, with the server seed taken from the
revealed seed record whose SHA-256 (§1.2) equals the round's commitment.
`j` lists the 19 draws (t = 0 … 18; draw t has range 20 − t). `a` is the array
after the shuffle.

**V1: round 7722772** (phase A, EASY, win)
```
serverSeed  fcf0584ae26b61deecc138adfc788ef039d69814c172a7d71667b5c9cdc661fb
commitment  b86763e0dc0f362d83e9bf1e6466f9be05434a502b7ea5fd1f96c2873b2bbcfe
clientSeed  8AgNlaGR1fxeiy93   nonce 0   difficulty 1 (m=1)   k 1   amount 0.01
HMAC(t=0)   1b34db470ca62d03e3cfc2726cfa0dca1040b8e76cfffa9b49f66ffdb3d2ff97
            u32 456448839 mod 20 = 19
j           [19, 18, 12, 14, 4, 14, 7, 3, 2, 3, 8, 0, 3, 4, 2, 1, 1, 0, 1]
a           [5, 13, 9, 6, 1, 11, 15, 10, 0, 8, 17, 2, 3, 7, 16, 4, 14, 12, 18, 19]
deathPoints {5}  → tile 0 safe → win
M_1 1.052631578947368421   edge mult 1.044210526315789474   amount_won 0.010442105263157895
```

**V2: round 7722782** (phase A, EXPERT, loss on tile 0)
```
serverSeed  fcf0584ae26b61deecc138adfc788ef039d69814c172a7d71667b5c9cdc661fb
clientSeed  8AgNlaGR1fxeiy93   nonce 7   difficulty 4 (m=10)   k 1   amount 0.01
HMAC(t=0)   0e513ba4d88506d04746536d0840040e611599f2032768a04f2cde86848d7ea4
            u32 240204708 mod 20 = 8
j           [8, 4, 7, 8, 14, 12, 7, 10, 4, 8, 2, 7, 2, 3, 5, 1, 2, 2, 1]
a           [0, 11, 6, 15, 1, 5, 3, 9, 13, 2, 16, 18, 10, 17, 12, 14, 19, 7, 4, 8]
deathPoints {0, 1, 2, 3, 5, 6, 9, 11, 13, 15}  → tile 0 is a death point → loss
served multiplier 1.000000000000000000   amount_won 0
```

**V3: round 7730566** (phase C, MEDIUM, amount 10, win: separates the payout rule)
```
serverSeed  fa0d2372508ea04cb2ca8c321085432e47f57e1a8d7e52ffbf5277844627fae0
commitment  d648f7438936f09d1ec3737ed9bd8b3ef79369f09f139724140da41af0f11b2f
clientSeed  QW1UGwpr3IxbGxgO   nonce 0   difficulty 2 (m=3)   k 1   amount 10
HMAC(t=0)   fbe83cf4622e429da057f95b14524b4e3f4528a3609b0f07b45e614ca924b873
            u32 4226301172 mod 20 = 12
j           [12, 7, 1, 8, 9, 6, 6, 5, 7, 0, 0, 6, 1, 2, 4, 4, 3, 0, 0]
a           [11, 16, 15, 3, 19, 4, 2, 17, 13, 10, 0, 18, 5, 14, 6, 9, 8, 1, 7, 12]
deathPoints {11, 15, 16}  → win
M_1 1.176470588235294118   edge mult 1.167058823529411765
amount_won 11.670588235294117651   (= q18(10 × M_1 × 0.992); 10 × edge mult would give …650)
```

**V4: round 7730795** (phase D, player-set client seed, HARD, win)
```
serverSeed  0347bfcda37123edea059f239f019628c6283209bdcf559d00338dc894d2b059
commitment  36df4d00a5d056b9423e79e337b9c2f249d2c4dcefebf3e3062d9845eb37db6c
clientSeed  pfauditmo2180iw   nonce 2   difficulty 3 (m=5)   k 1   amount 0.01
HMAC(t=0)   1f47d5bfb3c869fc308b1936d937272cd6c69bc9736e89e341fc6af3ad4c56b1
            u32 524801471 mod 20 = 11
j           [11, 15, 16, 14, 13, 8, 7, 1, 8, 9, 4, 0, 1, 2, 2, 1, 2, 1, 1]
a           [19, 3, 10, 5, 18, 6, 2, 12, 0, 4, 9, 17, 1, 7, 8, 13, 14, 16, 15, 11]
deathPoints {3, 5, 10, 18, 19}  → win
M_1 1.333333333333333333   edge mult 1.322666666666666666 (CONFIG cell: …667)   amount_won 0.013226666666666667
```

**V5: round 7844427** (phase E3, HARD, 5-step cash-out)
```
serverSeed  b8191951aae4437f5be0355f55968e224e779c1ae9d816f37134c0d8a3846342
commitment  5f480bfbb6e5efe5daec1d240036e5bd063679c51346944ef7dfeda5f5e8b76a
clientSeed  zsZvRuV71KhtyR7w   nonce 0   difficulty 3 (m=5)   k 5   amount 0.01
HMAC(t=0)   5e47398e0c927b3f1b6212d681fe45ce13cd3df051bd40a0a5d3bec34f6d614d
            u32 1581726094 mod 20 = 14
j           [14, 2, 3, 12, 15, 1, 12, 1, 1, 5, 1, 4, 7, 0, 2, 1, 3, 2, 0]
a           [8, 6, 10, 17, 9, 18, 0, 7, 4, 11, 5, 13, 19, 16, 1, 15, 12, 3, 2, 14]
deathPoints {6, 8, 9, 10, 17}  → tiles 0–4 safe → win, cash out at k = 5
rungs (M_k / q14(p_(k+1))):
  k=1 1.333333333333333333  0.73684210526316
  k=2 1.809523809523804353  0.72222222222222
  k=3 2.505494505494506044  0.70588235294118
  k=4 3.549450549450532482  0.6875
  k=5 5.162837162837138156  0.66666666666667
edge mult 5.121534465534441051 (exact 0.992·15504/3003 = 5.121534465534465534…)
amount_won 0.051215344655344411
```

**V6: round 7844441** (phase E3, HARD, target 5, dies on the 4th step)
```
serverSeed  b8191951aae4437f5be0355f55968e224e779c1ae9d816f37134c0d8a3846342
clientSeed  zsZvRuV71KhtyR7w   nonce 12   difficulty 3 (m=5)   K 5   amount 0.01
HMAC(t=0)   bdbd3938c6beddf4a8ed2d5f4c11f2524498faaf1b2156ca51965a1a3426b335
            u32 3183294776 mod 20 = 16
j           [16, 1, 4, 0, 8, 7, 11, 1, 0, 1, 5, 0, 4, 2, 1, 1, 1, 0, 1]
a           [6, 3, 15, 14, 9, 10, 2, 17, 13, 5, 12, 19, 18, 11, 7, 8, 0, 4, 1, 16]
deathPoints {3, 6, 9, 14, 15}  → first death 3 < 5 → loss, reached 4, current_step [0,1,2,3]
served multiplier 2.505494505494506044 (= M_3)   amount_won 0
```

---

## 6. Open points the public sources do not settle

- **O1: rejection continuation.** When a draw's first 4-byte chunk is ≥
  `LIMIT(r)`, this spec moves to the next chunk of the same digest. Whether Duel
  rejects at all, and what happens if all 8 chunks are rejected (≤ 4 × 10⁻⁶⁸), is
  not settled: 0 of 122,550 captured draws exercised it, so "rejection" and
  "plain mod r" both match 6,450 / 6,450. It affects about 1 draw in 7.2 × 10⁸
  at r = 19 and none at r = 2, 4, 8, 16. To settle: a written Duel rule, or a
  nonce on a revealed seed whose draw hits a rejected chunk, checked on Duel's
  Verify page.
- **O2: no written algorithm.** "Fair result = Server seed + Client seed +
  Nonce" names no HMAC, key form, separator, counter, mapping or shuffle.
  Everything in §2 beyond the inputs rests on STANDARD + DATA. Unlike Dice, no
  Beef result from Duel's own Verify page was captured in the allowed evidence,
  so there is no independent cross-check against Duel's page.
- **O3: served multiplier precision.** §3.2 is a description of what was served,
  fitted to the data, not a published rule. It sits at most 4.05 × 10⁻¹⁴
  (relative) from the exact table: above it in 28 of the 61 cells, below in
  32, equal in 1; whether the cells beyond k = 5 behave the same is not
  witnessed (captured depths: k = 1 at all difficulties, up to k = 5 in phase E).
- **O4: the CONFIG table is not what is paid.** CONFIG serves the exact
  multiplier rounded once; the bet response pays the chained figure (e.g.
  difficulty 3, k = 1: CONFIG …667, paid …666). Which one the UI shows on the
  tiles before a step is not captured beyond E01's 2-dp labels.
- **O5: maximum payout / cap.** No cap appears in CONFIG or on the pages read.
  The largest cell is EXPERT k = 10 at 183,277.952×; none of it was captured
  above k = 2 at EXPERT.
- **O6: rounding tie mode.** Half-up and half-even agree on every captured value
  (q18 and q14), so the tie mode is unsettled.
- **O7: drand and other fields.** No `drand_*` fields appear on Beef records; the
  spec covers only the server/client/nonce construction. Non-ASCII client seeds
  are unwitnessed (all 6,450 are ASCII, 15–16 characters); UTF-8 is assumed.
- **O8: config timing.** The CONFIG was captured 5 Oct and re-fetched 20 Oct
  2026 (identical); the rounds are from 16 and 21 Apr 2026. Its 0.992 factor
  matches the 0.8 % served on every round, but the April config itself was not
  captured. The "Zero Edge" branding on Duel's site was not checked for Beef.
- **O9: game page.** `duel.com/originals/beef` and `duel.com/originals/cross-road`
  both return Duel's 404 page logged out (20 Oct 2026); no public Beef rules
  page was found.

---

## 7. Reproduction of this spec

The spec was implemented, independently of any audit package, in throwaway
scripts outside the repo (`spec_check.py`, `alts.py`, `modes.py`, `nextmult.py`)
and run on every round:

```
beef-master-6000bets.json: bet commitments 121, resolved by SHA256(hexdecode(revealed seed)) 121; ascii form 0
beef-phaseE-450bets.json: bet commitments 10, resolved by SHA256(hexdecode(revealed seed)) 10; ascii form 0
config steps per difficulty == 20 - m: 4/4
config payout_tables == 0.992*C(20,k)/C(20-m,k) at 18dp, by mode: {'down': 37, 'half_up': 61, 'half_even': 61, 'ceil': 43} of 61
config probabilities == C(20-m,k)/C(20,k) within 1e-15: 61/61
death-point set (first m of backward FY, HMAC c:n:t, u32BE) == recorded: 6450/6450  mismatches=[]
alternative reading (tiles p with perm[p] < m): 146/6450
rejected 4-byte chunks across 122550 draws: 0
outcome win/loss from recomputed death points (win iff first death >= target_k): 6450/6450
current_step == [0..reached-1] and reached_k consistent: 6450/6450
losses paying 0: 1911/1911
rung multiplier == model Mk: 1085
rung win_chance == q14(p_(k+1)): 1085
win: field multiplier == model Mk: 4539
win: field no_house_edge_multiplier == q18(Mk*0.992): 4539
win: amount_won == q18(amount*Mk*0.992): 4539
win: amount_won == q18(amount*q18(Mk*0.992)): 4374
win: amount_won == q18(amount*exact): 4172
wins: 4539
effective_edge == 0.8: 6450
model ladder vs exact C(20,k)/C(20-m,k), all 61 cells: max rel dev 4.046e-14 at m=5 k=15
next_multiplier C q18(M(k-1)/p*0.992) one rounding: 1085/1085
```

---

## 8. Files and URLs opened while writing this spec

Read: `evidence/` E01, E02, E03, E04 (PNG),
`client-seed-origin.png`, `E07-cross-road-config-2026-10-05.json` and its
`.meta.json`; `data/beef-master-6000bets.json` and
`beef-phaseE-450bets.json`; the audit framework's `games/beef/profile.json`;
the audit framework's `games/dice/ALGORITHM.md` (shape model).
Rendered logged out with GET on 20 Oct 2026: `duel.com/provably-fair` (Overview
text only), `duel.com/originals/beef` (404), `duel.com/originals` (redirected to
`/originals/groomers-van`; only links and chat text read),
`duel.com/originals/cross-road` (404), `duel.com/api/v2/cross-road/config`.

`client-seed-origin.png` is our own annotated screenshot of Duel's live JS bundle
showing the browser's **client-seed generator** (a 63-character alphabet drawn
with `crypto.getRandomValues`). It is Duel code, though not the Beef
derivation. It was viewed because the brief lists all evidence PNGs as allowed;
nothing in §2 or §3 was taken from it.

Not opened: any `verify-tab`, `verifier-parity`, `src/`, `tests/`,
`scripts/`, `capture/`, `verify.js`, `test.js`, `MANIFEST.md` or `README.md` of
any Duel package, any saved Duel JS bundle, or Duel's Verify tab code. E04 shows
the top of the Verify tab's code panel (input-value lines only, for Blackjack);
no code was read from it.
