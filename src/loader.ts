import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { BeefDataset, BeefGame, SeedEntry } from './types';

const DATASET_PATH   = path.join(__dirname, '../data/beef-master-6000bets.json');
const PHASE_E_PATH   = path.join(__dirname, '../data/beef-phaseE-450bets.json');
const EXPECTED_HASH  = 'd654ef7c6195584501e9033202d5acad13a16d89d296baab8befc0240fb36d36';
const PHASE_E_HASH   = 'ef39d7f584cdb6d8057e846cdcb9b4ffcc60495bfcce8443d15bb910a9c51001';

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
  const match = EXPECTED_HASH.length === 0 || actual === EXPECTED_HASH;
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

// ── POPULATION OF RECORD ─────────────────────────────────────────────────────────
// The capture plan, stated as CODE so a shrunken dataset cannot pass by agreeing with
// itself. Deleting rounds and doctoring the header to match leaves a file that is
// internally consistent and re-pins cleanly — and re-pinning is exactly what a forger
// does, so EXPECTED_HASH cannot see it. The counts have to be asserted from somewhere
// the dataset does not control, and a step that finds them wrong must HARD FAIL.
export const EXPECTED_BETS  = 6000;
export const EXPECTED_SEEDS = 125;
export const EXPECTED_PHASE_BETS: Readonly<Record<string, number>> =
  Object.freeze({ A: 4000, B: 1000, C: 200, D: 800 });
