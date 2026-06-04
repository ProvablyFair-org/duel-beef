# Manifest — Duel Beef Audit

- **Audit ID:** PF-2026-DL06
- **Publication date:** 4 June 2026
- **Audit report:** https://audit.provablyfair.org/casino/duel/games/beef/overview
- **Auditor:** ProvablyFair.org
- **Audit date:** April 2026

## Algorithm

HMAC-SHA256 backward Fisher-Yates shuffle of 20 positions with per-step rejection sampling. The shuffle's first N positions (N = 1 / 3 / 5 / 10 by difficulty), sorted ascending, are the round's death points. The player advances step-by-step; if step k coincides with any death point the round ends.

```
key       = hexDecode(serverSeed)
positions = [0, 1, ..., 19]
for i from 19 downto 1:
  cursor  = 19 - i
  range   = i + 1
  maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range)
  loop:
    message = clientSeed + ":" + nonce + ":" + cursor
    hmac    = HMAC-SHA256(key, message)
    scan 4-byte chunks of hmac:
      if chunk < maxFair: j = chunk % range; swap positions[i] ↔ positions[j]; break
    else: cursor++ and retry
deathPoints = positions[0 .. N-1], sorted ascending
```

For each difficulty level the (multiplier × survivalProbability) product equals **0.992** (the flat 0.8% house edge factor), where the survival probabilities are the combinatorial consequence of the shuffle, not per-step threshold draws.

## Dataset

- **Master file:** `data/beef-master-6000bets.json`
- **Master SHA-256:** `d654ef7c6195584501e9033202d5acad13a16d89d296baab8befc0240fb36d36`
- **Phase E file:** `data/beef-phaseE-450bets.json` (multi-step verification)
- **Total bets:** 6,450
- **Configurations:** 4 difficulty levels
- **Phases:**
  - A — 4,000 bets — baseline coverage
  - B — 1,000 bets — high-variance
  - C — 200 bets — bet-size invariance
  - D — 800 bets — client seed variation
  - E — 450 bets — multi-step intermediate-state verification

## Verification

- **Verification steps:** 22 scored steps in `tests/verify.ts`
- **Unit tests:** Mocha (`tests/**/*Tests.ts`)
- **Simulation:** 4,000,000 rounds across 4 difficulty levels
- **Anti-circularity:** theoretical RTP independently derived from the combinatorial death-point distribution — `survivalProbability(m, k) = C(20−m, k) / C(20, k)` (probability that the shuffle's first k positions avoid all m death points) — which yields `multiplier × survivalProbability = 0.992` for every difficulty, flat 0.8% house edge confirmed
- **Theoretical RTP:** 99.2000% (vs 99.9000% for other Duel originals — Beef carries an 8× higher edge by design)
- **Expected `npm test` result:** 22/22 PASS · PROVABLY FAIR — Full Pass

## Reproducibility

Cloning this repo at the publication commit and running `npm install && npm test` reproduces the entire audit pipeline. Both datasets are hash-verified at startup; the verifier recomputes every step from `(serverSeed, clientSeed, nonce, step)`; the simulation re-derives RTP from independent combinatorial death-point probabilities.
