# Duel Beef — Verifier

Independent verifier for the ProvablyFair.org audit of **Duel.com Beef**.

- **Audit report:** https://audit.provablyfair.org/casino/duel/games/beef/overview
- **Audit ID:** PF-2026-DL06
- **Audited:** April 2026
- **Algorithm:** HMAC-SHA256 backward Fisher-Yates shuffle of 20 positions with per-step rejection sampling; death points are the first N positions of the shuffle (N = 1 / 3 / 5 / 10 by difficulty), sorted ascending.

## What's in this repo

This is the verification codebase. It re-derives every audited Beef game from the captured dataset and the published algorithm. The full audit report — methodology, evidence, findings, recommendations — lives on the docusaurus page linked above.

**Note on house edge:** Beef is the highest-edge game in the audited Duel lineup. Theoretical RTP = **99.2%** (house edge **0.8%** flat across all 4 difficulty levels). This is documented and intentional — players should understand the 8× higher edge vs other Duel originals (which are flat 0.1%).

## Reproduce

```sh
git clone git@github.com:ProvablyFair-org/duel-beef.git
cd duel-beef
npm install
npm test
```

`npm test` runs the full pipeline: unit tests + 4M-round simulation + 6,450-bet dataset verification. Expected: 22/22 PASS, **PROVABLY FAIR — Full Pass**.

Individual scripts:

```sh
npm run simulate   # 4M-round simulation across 4 difficulty levels
npm run verify     # 22-step verification of the captured dataset
```

## Dataset

- **Master file:** `data/beef-master-6000bets.json`
- **SHA-256:** `d654ef7c6195584501e9033202d5acad13a16d89d296baab8befc0240fb36d36`
- **Phase E file:** `data/beef-phaseE-450bets.json` (multi-step verification)
- **Total bets:** 6,450 across 5 phases (A: 4,000 · B: 1,000 · C: 200 · D: 800 · E: 450)
- **Configurations:** 4 difficulty levels

The verifier confirms the master dataset hash before running any checks.

## License

MIT
