# Module interface the audit package expects (written by the auditor, not from the casino)

Write `rng.ts` (TypeScript, strict, Node `crypto` only, no dependencies) exporting exactly these names.
Semantics come from ALGORITHM.md; this file only fixes names, types and the package's own conventions.
Tiles are 0-based indices 0..GRID_SIZE-1.

```ts
export const GRID_SIZE: number;                              // 20
export const HOUSE_EDGE: number;                             // reference edge from the spec (e.g. 0.008)
// difficulty id -> number of death points: 1 = Easy, 2 = Medium, 3 = Hard, 4 = Expert/Extreme
export const DEATH_POINTS_BY_DIFFICULTY: Record<number, number>;
// Largest number of steps a player can take with this many death points (GRID_SIZE - count).
export function maxSteps(deathPointsCount: number): number;

// Exclusive upper end of the accepted 32-bit window for one draw over `range` outcomes.
export function maxFairFor(range: number): number;
// THE single-chunk draw the shuffle uses: index in [0, range) for a 32-bit chunk value, or null if
// the chunk is rejected. The shuffle must call this function for every draw.
export function drawFromChunk(value: number, range: number): number | null;

// Optional counter; passing one changes nothing computed.
export interface DrawCensus {
  draws: number;          // accepted draws (one per shuffle step)
  chunksRead: number;     // 4-byte chunks consumed
  rejectedChunks: number; // chunks drawFromChunk rejected
  cursorAdvances: number; // times a draw needed a further digest/chunk source beyond its first (define per the spec; 0 if the spec never does this)
}
export function newDrawCensus(): DrawCensus;   // all zeros

// The full shuffled board (permutation of 0..gridSize-1) before taking the death points.
export function computePermutationFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number, gridSize?: number, census?: DrawCensus): number[];
// The death-point tiles (as the spec selects them from the permutation), from decoded key bytes.
export function computeDeathPointsFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number, deathPointsCount: number, gridSize?: number, census?: DrawCensus): number[];
// Same, taking the server seed as the casino publishes it.
export function computeDeathPoints(serverSeed: string, clientSeed: string, nonce: number, deathPointsCount: number, gridSize?: number): number[];
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean;

// Exact probability of surviving `steps` steps (no death point among the first `steps` tiles walked).
export function survivalProbability(deathPointsCount: number, steps: number, gridSize?: number): number;
// Reference (unrounded) multiplier at that depth: (1 - houseEdge) / survivalProbability.
export function theoreticalMultiplier(deathPointsCount: number, steps: number, houseEdge?: number, gridSize?: number): number;
```
