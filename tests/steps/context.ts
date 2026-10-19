import type { BeefGame, SeedEntry, StepResult, InfoItem } from '../../src/types';

export type { StepResult, InfoItem };

export interface VerifyContext {
  bets:       BeefGame[];
  seeds:      SeedEntry[];
  seedMap:    Map<string, string>;
  byHash:     Map<string, BeefGame[]>;
  phaseA:     BeefGame[];
  phaseB:     BeefGame[];
  phaseC:     BeefGame[];
  phaseD:     BeefGame[];
  /** Phase E multi-step bets. The only phase that exercises k > 1, so payout-table
   *  coverage cannot be measured without it. */
  phaseE:     BeefGame[];
  /** Phase E seed records (separate file) — Step 2 checks their forward chain. */
  phaseESeeds: SeedEntry[];
  outputsDir: string;
  // Mutable accumulators
  step5Mismatches: number;
  step5Skipped:    number;
  chiResultsLog:   Record<string, unknown>[];
}

/**
 * MONEY TOLERANCE, SIZED TO THE ARITHMETIC. Credited money is a full-precision product of a
 * stake and a multiplier — there is no grid to snap it to, so the bound is the only thing between
 * a served figure and its recomputation. The absolute `1e-8` this suite used to carry was five
 * orders looser than double arithmetic needs, and an off-grid forgery that nudges a served payout
 * by 1e-9 passed it (measured across the Duel fleet on 2026-09-15). The tolerance is RELATIVE so
 * it scales with the figure — a $10 payout and a $0.01 payout are held to the same precision —
 * and it is still orders of magnitude above the worst real deviation in any capture it guards.
 * Every payout comparison in this package uses `moneyTol`; none carries its own bound.
 */
export const MONEY_REL_TOL = 1e-12;
export const moneyTol = (x: number): number => MONEY_REL_TOL * Math.max(Math.abs(x), 1);

export function step(
  num:    number,
  name:   string,
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO',
  detail: string,
  data?:  Record<string, unknown>,
  origin?: 'capture',
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'INFO' ? '[INFO]' : status === 'FLAG' ? (origin === 'capture' ? '[FLAG:capture]' : '[FLAG]') : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  const r: StepResult = data === undefined
    ? { step: num, name, status, detail }
    : { step: num, name, status, detail, data };
  if (status === 'FLAG' && origin === 'capture') r.origin = 'capture';
  return r;
}
