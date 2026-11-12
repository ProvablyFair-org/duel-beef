import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { BeefDataset, BeefGame, SeedEntry } from './types';

const DATASET_PATH   = path.join(__dirname, '../data/beef-master-6000bets.json');
const PHASE_E_PATH   = path.join(__dirname, '../data/beef-phaseE-450bets.json');
const EXPECTED_HASH  = 'd654ef7c6195584501e9033202d5acad13a16d89d296baab8befc0240fb36d36';
const PHASE_E_HASH   = 'ef39d7f584cdb6d8057e846cdcb9b4ffcc60495bfcce8443d15bb910a9c51001';

// ── POPULATION OF RECORD ──────────────────────────────────────────────────────
// The capture plan stated as CODE, next to the dataset pin, so that the scored steps
// have something to check the data against that the data does not control. A dataset
// that agrees with its own header proves nothing: delete bets, delete seeds, shrink
// every epoch uniformly and edit the header to match, and the file is still internally
// consistent — and it re-pins cleanly, because re-pinning is exactly what a forger does.
// Anything scored against these numbers has to HARD_FAIL when they disagree.
export const EXPECTED_BETS  = 6000;
export const EXPECTED_SEEDS = 125;
export const EXPECTED_PHASE_BETS: Readonly<Record<string, number>> =
  Object.freeze({ A: 4000, B: 1000, C: 200, D: 800 });
export const EXPECTED_SEED_PHASES: Readonly<Record<string, number>> =
  Object.freeze({ A: 82, B: 21, C: 5, D: 17 });

// Every seed row in this capture carries its plaintext, so every rotation transition is
// comparable: 125 rows -> 124 adjacent transitions, of which 3 cross a phase boundary
// (the end-of-phase rotation's seed gets no bets, so the next phase's opening rotation reveals the
// previous phase's last bet-bearing seed again: rows 82/103/108 carry the seeds of rows 80/101/106).
export const EXPECTED_REVEALED_SEEDS   = 125;
export const EXPECTED_SEED_TRANSITIONS = 124;
export const EXPECTED_PHASE_BOUNDARY_SKIPS = 3;

// This capture's epochs are 50 bets: the capture scripts rotated after 50 bets (BETS_PER_EPOCH,
// capture/beef-capture.reference.js:36); Duel rotates only when the player does. Two are short
// and both are documented capture artifacts: one 49-bet epoch and one 1-bet epoch, which
// together account for the 50 bets of a single nominal epoch split by a capture retry.
// Declaring the exceptions by size is what makes the step fail on a uniform shrink — 'no
// epoch is larger than 50' does not.
export const EXPECTED_EPOCHS            = 121;
export const EXPECTED_EPOCH_SIZE        = 50;
export const EXPECTED_SHORT_EPOCH_SIZES: readonly number[] = Object.freeze([1, 49]);

// The one documented nonce gap: the 49-bet epoch above is missing nonce 25 — the round a
// capture retry did not record. Declared here by (epoch hash, nonce) so Step 4 can tell THIS gap
// from any other: an undeclared gap anywhere is a hard failure, and so is this one going missing.
export const EXPECTED_NONCE_GAPS: readonly { epochHash: string; nonce: number }[] = Object.freeze([
  { epochHash: 'b2dfe98473b69f19f8ff0a79bb2661403ab9492b0c12bd4e1956a54bc3727a46', nonce: 25 },
]);
// The declared count, stated separately (Duel video-poker / plinko standard): a gap more or a gap
// fewer is a different dataset and FAILs Step 4. The planned gap is reported as a capture-origin
// FLAG — disclosed on every run, verdict-neutral.
export const EXPECTED_CAPTURE_RETRY_GAPS = 1;

// Difficulty is the only configuration dimension. Phase A is balanced at 1000 bets per
// difficulty; the floor is set there so that dropping a difficulty to a token sample fails.
export const MIN_BETS_PER_DIFFICULTY = 1000;
export const DIFFICULTY_LEVELS: readonly (1 | 2 | 3 | 4)[] = Object.freeze([1, 2, 3, 4]);

// Phase E is the supplementary multi-step capture, pinned separately above.
export const EXPECTED_PHASE_E_BETS  = 450;
export const EXPECTED_PHASE_E_SEEDS = 14;
// Phase E epochs and its one capture-retry gap, declared 2026-09-26 (MANIFEST DL-4). Measured on the
// pinned file: 10 bet-bearing epochs — 8 of 50 bets on nonces 0..49, epoch 1dfe6dcf… (E4) of 49 bets
// with nonce 31 absent, then a 1-bet epoch 00fa747a… — the same retry shape as the primary file's
// declared gap. Bound by identity in Step 4; a capture-origin FLAG, never an operator finding.
export const EXPECTED_PHASE_E_EPOCHS = 10;
export const EXPECTED_PHASE_E_NONCE_GAPS: readonly { epochHash: string; nonce: number }[] = Object.freeze([
  { epochHash: '1dfe6dcfa0e64dc57642c1c4cb0dfc24d79d15f2d1f71fc0748c09fedd741107', nonce: 31 },
]);
export const EXPECTED_PHASE_E_BETS_BY_PHASE: Readonly<Record<string, number>> =
  Object.freeze({ E1: 100, E2: 100, E3: 150, E4: 100 });
// Each Phase E sub-phase plays ONE difficulty to ONE cash-out target (request.target_k). This is
// what makes k > 1 cells of the payout table observable at all, so it is the coverage floor
// Step 11 scores against, and the population Step 22 binds its checked winners to.
export const EXPECTED_PHASE_E_TARGETS: Readonly<Record<string, { difficulty: 1 | 2 | 3 | 4; targetK: number }>> =
  Object.freeze({
    E1: { difficulty: 1, targetK: 5 },
    E2: { difficulty: 2, targetK: 3 },
    E3: { difficulty: 3, targetK: 5 },
    E4: { difficulty: 4, targetK: 2 },
  });

// The simulation plan (src/simulate.ts reads these; src/domains.ts bounds the committed
// simulation-results.json by them). Moved here from src/simulate.ts on 2026-09-26 (profile BEEF-27) so
// the value domains take their bounds from src/, never from the artifact; the values are unchanged.
export const SIM_DIFFICULTIES: readonly (1 | 2 | 3 | 4)[] = Object.freeze([1, 2, 3, 4]);
export const SIM_ROUNDS_PER_CONFIG   = 1_000_000;
export const SIM_NONCES_PER_SEED     = 10_000;
export const SIM_EPOCH_LENGTH        = 50;
export const SIM_CONVERGENCE_SAMPLES: readonly number[] = Object.freeze([1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000]);
export const SIM_PASS2_DIFFICULTY    = 2 as const;
// The tile a Pass 2 round stands on. Beef's path is fixed: a round of k steps stands on tiles 0 … k−1
// (Step 9 asserts it on all 6,450 captured rounds), so a one-step round wins iff tile 0 is not a death
// point. Pass 2 and Step 19's replay use it, and Step 19 checks it against the first stepped tile of
// every captured round. Until 2026-10-06 both checked the rotating tile nonce % 20 instead, which is
// not Beef's first-step rule (QA review, 6 Oct 2026).
export const SIM_FIRST_STEP_TILE     = 0;

// Live-sample fit (profile BEEF-22, Step 25): family level for the informational fits.
export const LIVE_FIT_ALPHA = 0.01;

export function getDatasetPath(): string { return DATASET_PATH; }

export function loadDataset(): BeefDataset {
  const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
  return JSON.parse(raw) as BeefDataset;
}

export function loadDatasetBuffer(): Buffer {
  return fs.readFileSync(DATASET_PATH);
}

export function checkDatasetHash(): { expected: string; actual: string; match: boolean } {
  const raw = fs.readFileSync(DATASET_PATH);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  // An unset pin is not a match. `EXPECTED_HASH.length === 0 || …` let a blanked constant
  // wave any dataset through.
  const match = EXPECTED_HASH.length > 0 && actual === EXPECTED_HASH;
  return { expected: EXPECTED_HASH, actual, match };
}

/**
 * Build O(1) map: serverSeedHashed → serverSeed (plaintext).
 *
 * In the Duel dataset, seeds[N].seed.serverSeed is the PREVIOUS epoch's
 * revealed seed. The plaintext for seeds[N].serverSeedHashed is in
 * seeds[N+1].seed.serverSeed. We verify the hash before adding.
 */
export function buildSeedMap(seeds: SeedEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < seeds.length - 1; i++) {
    const next = seeds[i + 1];
    if (next.seed.serverSeed) {
      const h = crypto.createHash('sha256')
        .update(Buffer.from(next.seed.serverSeed, 'hex'))
        .digest('hex');
      if (h === seeds[i].seed.serverSeedHashed) {
        m.set(seeds[i].seed.serverSeedHashed, next.seed.serverSeed);
      }
    }
  }
  return m;
}

/** Load Phase E supplementary dataset (multi-step verification). */
export function loadPhaseE(): BeefDataset | null {
  if (!fs.existsSync(PHASE_E_PATH)) return null;
  const raw = fs.readFileSync(PHASE_E_PATH, 'utf-8');
  return JSON.parse(raw) as BeefDataset;
}

export function checkPhaseEHash(): { expected: string; actual: string; match: boolean } | null {
  if (!fs.existsSync(PHASE_E_PATH)) return null;
  const raw = fs.readFileSync(PHASE_E_PATH);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  return { expected: PHASE_E_HASH, actual, match: actual === PHASE_E_HASH };
}

/** Group bets by serverSeedHashed (epoch). */
export function groupByHash(bets: BeefGame[]): Map<string, BeefGame[]> {
  const m = new Map<string, BeefGame[]>();
  for (const b of bets) {
    const hash = b.seed.serverSeedHashed;
    const arr = m.get(hash) ?? [];
    arr.push(b);
    m.set(hash, arr);
  }
  return m;
}
