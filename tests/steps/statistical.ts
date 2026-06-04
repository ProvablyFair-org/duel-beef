/**
 * Live-bet statistical context (informational, not scored).
 * At n<1000/config these tests lack power — authoritative results come from simulation.
 */

import type { InfoItem } from './context';
import { VerifyContext } from './context';
import { survivalProbability, DEATH_POINTS_BY_DIFFICULTY, HOUSE_EDGE } from '../../src/rng';
import { chiSquaredTest, lag1Autocorrelation, runsTest } from '../../src/stats';

export function run(ctx: VerifyContext): InfoItem[] {
  const { bets, chiResultsLog } = ctx;

  // ── RTP analysis ──────────────────────────────────────────────────────────
  const totalBet = bets.reduce((a, b) => a + parseFloat(b.request.amount), 0);
  const totalWon = bets.reduce((a, b) => a + parseFloat(b.response.amount_won), 0);
  const empiricalRTP = totalWon / totalBet;
  const theoRTPPct = ((1 - HOUSE_EDGE) * 100).toFixed(4);

  const rtpInfo: InfoItem = {
    label: 'RTP Analysis',
    detail: `Empirical RTP: ${(empiricalRTP * 100).toFixed(4)}% — Beef is high-variance; theoretical RTP ${theoRTPPct}% proven analytically in anti-circularity step.`,
  };

  // ── Win rate — per difficulty — chi-squared ──────────────────────────────
  // For each bet, expected P(win) = survivalProbability(m, k) where k = steps taken.
  // Aggregate observed vs expected counts per difficulty, then chi-squared.
  const diffGroups = new Map<number, { wins: number; expWins: number; total: number }>();
  for (const b of bets) {
    const d   = b.response.difficulty_level;
    const m   = DEATH_POINTS_BY_DIFFICULTY[d];
    const k   = (b.response.current_step || []).length;
    const pWin = survivalProbability(m, k);
    const cur = diffGroups.get(d) ?? { wins: 0, expWins: 0, total: 0 };
    cur.total++;
    cur.expWins += pWin;
    if (b.response.outcome === 'win') cur.wins++;
    diffGroups.set(d, cur);
  }

  let fails  = 0;
  let minP   = 1;
  let tested = 0;
  for (const [difficulty, { wins, expWins, total }] of diffGroups) {
    if (total < 10 || expWins < 5 || (total - expWins) < 5) continue;
    tested++;
    const { pValue } = chiSquaredTest([wins, total - wins], [expWins, total - expWins]);
    if (pValue < 0.01) fails++;
    if (pValue < minP) minP = pValue;
    chiResultsLog.push({ difficulty, wins, expWins, total, pValue });
  }
  const bonferroni = tested > 0 ? 0.01 / tested : 0;

  const chi2Info: InfoItem = {
    label: 'Win Rate Chi-Squared (per-difficulty, aggregated by step count)',
    detail: `${tested} difficulty groups tested; fails at α=0.01: ${fails}/${tested}; min p=${minP.toFixed(4)}; Bonferroni α/${tested}=${bonferroni.toFixed(6)}`,
  };

  // ── Serial independence — lag-1 autocorrelation ───────────────────────────
  // Use difficulty_level as continuous series (binary win/loss is degenerate for median-based tests)
  const diffSeries = bets.map(b => b.response.difficulty_level);
  const r1         = lag1Autocorrelation(diffSeries);
  const n          = diffSeries.length;
  const zScore     = r1 / (1 / Math.sqrt(n));

  const absZ = Math.abs(zScore);
  const lag1Verdict = absZ > 3
    ? `(|z|>3 — structured phase ordering; see simulation for definitive test)`
    : `(|z|<3 — no serial correlation detected)`;

  const lag1Info: InfoItem = {
    label: 'Serial Independence (lag-1 autocorrelation on difficulty_level sequence)',
    detail: `r₁=${r1.toFixed(6)}, z=${zScore.toFixed(3)} ${lag1Verdict}. Underpowered at live sample size — see simulation for definitive test.`,
  };

  // ── Wald-Wolfowitz runs test ──────────────────────────────────────────────
  const { runs, expected, z: zRuns, pValue: pRuns } = runsTest(diffSeries);

  const runsInfo: InfoItem = {
    label: 'Serial Independence (Wald-Wolfowitz runs test on difficulty_level sequence)',
    detail: `runs=${runs}, expected=${expected.toFixed(1)}, z=${zRuns.toFixed(3)}, p=${pRuns.toFixed(4)}. Underpowered at live sample size — see simulation for definitive test.`,
  };

  return [rtpInfo, chi2Info, lag1Info, runsInfo];
}
