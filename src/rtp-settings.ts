/**
 * RTP-CLAIM wiring — Duel Beef: the per-setting exact RTP table and the claim it is held to.
 *
 * The rule is src/rtp-claim.ts, a byte-identical copy of the framework's core/rtp-claim.ts (its
 * SHA-256 is compared by conformance C-13), version 1.2.0 (Methodology v1.1, agreed 2026-10-14;
 * 1.0.0 adopted 2026-09-29). The enforcement switch RTP_CLAIM_RULE_ENFORCED is the
 * package's own src/rtp-claim-switch.ts, set to true (decision D3): the outcome is scored on the
 * step carrying BEEF-19, and a house-side miss makes the verdict RTP FIGURE OVERSTATED (exit 5),
 * never NOT PROVABLY FAIR. The claim names one of the rule's six places: the game settings.
 *
 * SETTINGS. Every (difficulty, cash-out step k) cell: difficulty 1–4 with m = 1, 3, 5, 10 death
 * points on the 20-tile road (src/rng.ts:44-49), k = 1 … 20 − m — 61 cells.
 * EXACT RTP. survival C(20−m, k)/C(20, k) × the paid multiplier C(20, k)·992 / (C(20−m, k)·1000)
 * (src/exact.ts exactMultiplier; the served 18-dp multiplier string equals it at relative 1e-12,
 * Step 8). Step 16 anchors the survival closed form on all 2^20 death-point sets.
 * CLAIM. Flat 0.8 % house edge = RTP 992/1000, from the game settings (decision D2: "The edge in
 * Duel's game settings counts"): the effective_edge = 0.8 Duel's site is served with every Beef bet
 * (6,000 of 6,000, Step 12); the Beef config the site loads (E07) carries the payout tables built on
 * 0.992 and no edge field of its own (docs/ALGORITHM.md §3.1; scripts/check-config-table.mjs, 61 of 61
 * cells; MANIFEST.md#payouts-and-rtp).
 *
 *   npm run rtp-claim:write    rewrite outputs/rtp-claim-table.json and print its SHA-256 to pin
 */
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { RtpClaim, RtpClaimAccumulator, RtpClaimResult, rtpClaimTable, rtpClaimGate, RtpClaimGate } from './rtp-claim';
import { DEATH_POINTS_BY_DIFFICULTY, GRID_SIZE } from './rng';
import { binomialBig, exactMultiplier } from './exact';

export const RTP_CLAIM: RtpClaim = {
  kind: 'flat',
  rtp: '0.992',
  source: 'game settings: effective_edge = 0.8 (%), the edge Duel\'s site is served with every Beef bet (6,000 of 6,000, Step 12); the Beef config the site loads (GET /api/v2/cross-road/config, E07, fetched 2026-10-05) carries the payout tables built on 0.992 (docs/ALGORITHM.md §3.1; scripts/check-config-table.mjs, 61 of 61 cells; MANIFEST.md#payouts-and-rtp; declaration gameModel.edge.claimed 0.008)',
};

/** The scored step that carries the derived half of BEEF-19 (src/profile-map.ts). */
export const RTP_CLAIM_STEP = 16;

export const RTP_CLAIM_TABLE = path.join(__dirname, '..', 'outputs', 'rtp-claim-table.json');
/** SHA-256 of the committed table — re-pin with the run that rewrote it (npm run rtp-claim:write). */
export const RTP_CLAIM_TABLE_SHA256 = '1528d0c9b255f9a448ec6cfa171b57779c25074430d5d8e215d51a7cdfb91987';

export function computeRtpClaim(): RtpClaimResult {
  const acc = new RtpClaimAccumulator(RTP_CLAIM);
  for (const d of [1, 2, 3, 4]) {
    const m = DEATH_POINTS_BY_DIFFICULTY[d]!;
    for (let k = 1; k <= GRID_SIZE - m; k++) {
      const pay = exactMultiplier(m, k, true);
      acc.add(`difficulty=${d} (m=${m}) k=${k}`, binomialBig(GRID_SIZE - m, k) * pay.num, binomialBig(GRID_SIZE, k) * pay.den);
    }
  }
  return acc.result();
}

export function rtpClaimTableText(r: RtpClaimResult): string {
  return rtpClaimTable(r, {
    package: 'duel/beef', game: 'beef',
    settingSpace: 'difficulty 1–4 (m = 1, 3, 5, 10) × cash-out step k = 1 … 20 − m (61 cells)',
    rtpMethod: 'exact rational: C(20−m,k)/C(20,k) × C(20,k)·992/(C(20−m,k)·1000), the paid multiplier',
  });
}

export function runRtpClaimGate(): RtpClaimGate {
  const r = computeRtpClaim();
  return rtpClaimGate(r, rtpClaimTableText(r), RTP_CLAIM_TABLE, RTP_CLAIM_TABLE_SHA256);
}

if (require.main === module) {
  const text = rtpClaimTableText(computeRtpClaim());
  fs.writeFileSync(RTP_CLAIM_TABLE, text);
  console.log(`wrote outputs/rtp-claim-table.json sha256 ${createHash('sha256').update(text).digest('hex')}`);
}
