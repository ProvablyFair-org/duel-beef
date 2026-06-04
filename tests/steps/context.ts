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
  outputsDir: string;
  // Mutable accumulators
  step5Mismatches: number;
  step5Skipped:    number;
  chiResultsLog:   Record<string, unknown>[];
}

export function step(
  num:    number,
  name:   string,
  status: 'PASS' | 'FLAG' | 'FAIL',
  detail: string,
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'FLAG' ? '[FLAG]' : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  return { step: num, name, status, detail };
}
