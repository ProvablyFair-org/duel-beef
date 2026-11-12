/**
 * Duel.com Beef (cross-road) — type definitions.
 * Matches the actual capture output of the capture script (methodology: capture/beef-capture.reference.js).
 */

export type Phase = 'A' | 'B' | 'C' | 'D' | 'E1' | 'E2' | 'E3' | 'E4';

/** difficulty_level id as used by the cross-road API. */
export type DifficultyLevel = 1 | 2 | 3 | 4;

/** Per-step result from Phase E multi-step capture. */
export interface PhaseEStepResult {
  step: number;
  multiplier: string | null;              // raw multiplier at this step (no house edge)
  no_house_edge_multiplier: string | null;
  current_step: number[];
  status: number;                         // 0 = survived, 2 = death
  is_death: boolean;
  win_chance: string | null;
  next_multiplier: string | null;
}

export interface BeefGame {
  at: string;                         // ISO timestamp (client-side, capture time)
  phase: Phase;
  request: {
    amount: string;                   // bet amount, string for full precision
    difficulty_level: DifficultyLevel;
    target_k?: number;                // Phase E only: target step count
  };
  response: {
    round_id: number;
    outcome: 'win' | 'loss';
    difficulty_level: DifficultyLevel;
    path_length: number;              // constant 20
    current_step: number[];           // indices of tiles the player actually stepped on
    mines_positions: number[];        // revealed death points, sorted ascending
    multiplier: string;               // raw multiplier at the player's stopping step
    no_house_edge_multiplier: string | null;  // payout multiplier (API field is a misnomer — it INCLUDES edge)
    amount_won: string;
    amount_currency: string;
    transaction_id: number;
    effective_edge: number;           // 0.8 on every captured bet (no rakeback applied to the captured bets)
    cashed_out?: boolean;             // Phase E only: true if multi-step game was cashed out
    reached_k?: number;               // Phase E only: how many steps were taken
  };
  step_results?: PhaseEStepResult[];  // Phase E only: per-step tracking
  seed: {
    serverSeedHashed: string;
    clientSeed: string;
    nonce: number;
  };
}

export interface NextSeedPromotion {
  previousNextHash: string;
  newActiveHash: string;
  newNextHash: string;
  match: boolean;
}

export interface SeedEntry {
  at: string;
  context: string;                    // e.g. "rotate-phase-A"
  phase: string;
  seed: {
    clientSeed: string;
    serverSeedHashed: string;
    nextServerSeedHash: string;
    serverSeed: string | null;        // revealed when rotated
  };
  nonce: number;
  nextSeedPromotion?: NextSeedPromotion;
  revealedFrom?: { transactionId: number };
}

export interface BeefDataset {
  meta: {
    schema: string;
    createdAt: string;
    completedAt: string;
  };
  seeds: SeedEntry[];
  bets: BeefGame[];
}

export interface StepResult {
  step: number;
  name: string;
  /** INFO: an informational step's deviation (profile policy INFORMATIONAL — the live-sample fit, adopted
   *  2026-09-29): reported, never counted as a flag, never affects the verdict. */
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO';
  detail: string;
  /**
   * Machine-readable measurements for this step. A measured float belongs here and
   * never inside `detail`: the reproduction gate compares the committed artifact with
   * a fresh run field by field, and a string leaf can only be compared for equality.
   * A float rendered into prose therefore disagrees forever on any machine whose libm
   * differs by a unit in the last place, which is precisely the reader the gate exists
   * for. `detail` states the BOUND; `data` carries the measurement.
   */
  data?: Record<string, unknown>;
  /**
   * 'capture' marks a FLAG raised by the AUDITOR'S capture (a retried request that left a nonce
   * gap), not by anything the operator served. It is disclosed on every run but is
   * verdict-neutral: the verdict stays Full Pass and the exit status 0. Only an operator-origin
   * FLAG downgrades to Conditional Pass. Same rule as Duel plinko (adopted 2026-09-22).
   */
  origin?: 'capture';
}

export interface InfoItem {
  label: string;
  detail: string;
}
