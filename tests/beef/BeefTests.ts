import assert from 'assert';
import * as crypto from 'crypto';
import {
  computeDeathPoints,
  computeDeathPointsFromBuffer,
  verifyHash,
  theoreticalMultiplier,
  survivalProbability,
  DEATH_POINTS_BY_DIFFICULTY,
  GRID_SIZE,
  HOUSE_EDGE,
} from '../../src/rng';
import { loadDataset, buildSeedMap } from '../../src/loader';

// ── Known-answer test vectors: real bets from data/beef-master-6000bets.json ──
// First 7 bets of the first revealed epoch, covering all 4 difficulties.
const SERVER_SEED      = 'fcf0584ae26b61deecc138adfc788ef039d69814c172a7d71667b5c9cdc661fb';
const SERVER_SEED_HASH = 'b86763e0dc0f362d83e9bf1e6466f9be05434a502b7ea5fd1f96c2873b2bbcfe';
const CLIENT_SEED      = '8AgNlaGR1fxeiy93';

const VECTORS = [
  {
    nonce: 0, difficulty: 1, deathPointsCount: 1,
    expectedPositions: [5],
    outcome: 'win' as const,
    apiMultiplier: '1.052631578947368421',
    payoutMultiplier: '1.044210526315789474',
    amountWon: '0.010442105263157895',
    amountBet: '0.010000000000000000',
  },
  {
    nonce: 1, difficulty: 2, deathPointsCount: 3,
    expectedPositions: [1, 9, 15],
    outcome: 'win' as const,
    apiMultiplier: '1.176470588235294118',
    payoutMultiplier: '1.167058823529411765',
    amountWon: '0.011670588235294118',
    amountBet: '0.010000000000000000',
  },
  {
    nonce: 2, difficulty: 3, deathPointsCount: 5,
    expectedPositions: [6, 15, 16, 18, 19],
    outcome: 'win' as const,
    apiMultiplier: '1.333333333333333333',
    payoutMultiplier: '1.322666666666666666',
    amountWon: '0.013226666666666667',
    amountBet: '0.010000000000000000',
  },
  {
    nonce: 3, difficulty: 4, deathPointsCount: 10,
    expectedPositions: [2, 3, 5, 8, 10, 13, 15, 16, 18, 19],
    outcome: 'win' as const,
    apiMultiplier: '2.000000000000000000',
    payoutMultiplier: '1.984',
    amountWon: '0.01984',
    amountBet: '0.010000000000000000',
  },
  {
    nonce: 4, difficulty: 1, deathPointsCount: 1,
    expectedPositions: [1],
    outcome: 'win' as const,
    apiMultiplier: '1.052631578947368421',
    payoutMultiplier: '1.044210526315789474',
    amountWon: '0.010442105263157895',
    amountBet: '0.010000000000000000',
  },
  {
    nonce: 5, difficulty: 2, deathPointsCount: 3,
    expectedPositions: [10, 11, 18],
    outcome: 'win' as const,
    apiMultiplier: '1.176470588235294118',
    payoutMultiplier: '1.167058823529411765',
    amountWon: '0.011670588235294118',
    amountBet: '0.010000000000000000',
  },
  {
    nonce: 6, difficulty: 3, deathPointsCount: 5,
    expectedPositions: [6, 8, 11, 17, 18],
    outcome: 'win' as const,
    apiMultiplier: '1.333333333333333333',
    payoutMultiplier: '1.322666666666666666',
    amountWon: '0.013226666666666667',
    amountBet: '0.010000000000000000',
  },
] as const;

// ── Full dataset (available once captured and committed) ─────────────────────
const ds = loadDataset();
const seedMap = buildSeedMap(ds.seeds);

// ── Cryptographic Core ───────────────────────────────────────────────────────

describe('Cryptographic Core — Known-Answer Tests (7 bets × all 4 difficulties)', () => {
  it('computeDeathPoints matches expected positions for all 7 test vectors', () => {
    for (const v of VECTORS) {
      const computed = computeDeathPoints(SERVER_SEED, CLIENT_SEED, v.nonce, v.deathPointsCount);
      assert.deepStrictEqual(
        computed, [...v.expectedPositions],
        `nonce=${v.nonce} difficulty=${v.difficulty}: expected ${JSON.stringify(v.expectedPositions)}, got ${JSON.stringify(computed)}`,
      );
    }
  });

  it('computeDeathPointsFromBuffer matches computeDeathPoints (buffer/string parity)', () => {
    for (const v of VECTORS) {
      const key     = Buffer.from(SERVER_SEED, 'hex');
      const fromBuf = computeDeathPointsFromBuffer(key, CLIENT_SEED, v.nonce, v.deathPointsCount);
      const fromStr = computeDeathPoints(SERVER_SEED, CLIENT_SEED, v.nonce, v.deathPointsCount);
      assert.deepStrictEqual(fromBuf, fromStr);
    }
  });

  it('HMAC key is hex-decoded (not UTF-8) — only hex decoding produces the live positions', () => {
    const v = VECTORS[0];
    const computed = computeDeathPoints(SERVER_SEED, CLIENT_SEED, v.nonce, v.deathPointsCount);
    assert.deepStrictEqual(computed, [...v.expectedPositions]);
  });

  it('all death points in range [0, 19] for every vector', () => {
    for (const v of VECTORS) {
      const positions = computeDeathPoints(SERVER_SEED, CLIENT_SEED, v.nonce, v.deathPointsCount);
      for (const p of positions) assert.ok(p >= 0 && p <= 19, `position ${p} out of range at nonce=${v.nonce}`);
    }
  });

  it('returned count matches requested deathPointsCount', () => {
    for (const v of VECTORS) {
      const positions = computeDeathPoints(SERVER_SEED, CLIENT_SEED, v.nonce, v.deathPointsCount);
      assert.strictEqual(positions.length, v.deathPointsCount);
    }
  });

  it('death positions have no duplicates', () => {
    for (const v of VECTORS) {
      const positions = computeDeathPoints(SERVER_SEED, CLIENT_SEED, v.nonce, v.deathPointsCount);
      assert.strictEqual(new Set(positions).size, positions.length);
    }
  });

  it('death positions are sorted ascending', () => {
    for (const v of VECTORS) {
      const positions = computeDeathPoints(SERVER_SEED, CLIENT_SEED, v.nonce, v.deathPointsCount);
      for (let i = 1; i < positions.length; i++) assert.ok(positions[i] > positions[i - 1]);
    }
  });

  it('SHA-256(serverSeed) === serverSeedHashed for the test epoch', () => {
    assert.strictEqual(verifyHash(SERVER_SEED, SERVER_SEED_HASH), true);
  });

  it('verifyHash rejects a tampered seed (negative control)', () => {
    assert.strictEqual(verifyHash('0'.repeat(64), SERVER_SEED_HASH), false);
  });

  it('different client seeds produce different death positions (nonce/client both active inputs)', () => {
    const a = computeDeathPoints(SERVER_SEED, CLIENT_SEED, 0, 3);
    const b = computeDeathPoints(SERVER_SEED, 'XXXXXXXXXXXXXXXX', 0, 3);
    assert.notDeepStrictEqual(a, b);
  });

  it('different nonces produce different death positions', () => {
    const a = computeDeathPoints(SERVER_SEED, CLIENT_SEED, 0, 3);
    const b = computeDeathPoints(SERVER_SEED, CLIENT_SEED, 1, 3);
    assert.notDeepStrictEqual(a, b);
  });

  it('throws if deathPointsCount >= gridSize', () => {
    assert.throws(() => computeDeathPoints(SERVER_SEED, CLIENT_SEED, 0, 20));
  });
});

// ── Payout / probability formulas ────────────────────────────────────────────

describe('Payout Formulas', () => {
  it('theoreticalMultiplier with 0.8% edge matches API payoutMultiplier for 1-step wins', () => {
    for (const v of VECTORS) {
      if (v.outcome !== 'win') continue;
      const computed = theoreticalMultiplier(v.deathPointsCount, 1, 0.008);
      const api      = parseFloat(v.payoutMultiplier);
      assert.ok(
        Math.abs(computed - api) < 1e-10,
        `diff=${v.difficulty}: computed=${computed}, api=${api}`,
      );
    }
  });

  it('theoreticalMultiplier with 0% edge matches API raw multiplier for 1-step wins', () => {
    for (const v of VECTORS) {
      if (v.outcome !== 'win') continue;
      const computed = theoreticalMultiplier(v.deathPointsCount, 1, 0);
      const api      = parseFloat(v.apiMultiplier);
      assert.ok(
        Math.abs(computed - api) < 1e-10,
        `diff=${v.difficulty}: computed=${computed}, api=${api}`,
      );
    }
  });

  it('survival probability for first step equals (gridSize − m) / gridSize', () => {
    for (const [level, dpc] of Object.entries(DEATH_POINTS_BY_DIFFICULTY)) {
      const p = survivalProbability(dpc, 1);
      const expected = (GRID_SIZE - dpc) / GRID_SIZE;
      assert.ok(Math.abs(p - expected) < 1e-15, `diff=${level}: p=${p}, expected=${expected}`);
    }
  });

  it('house edge is exactly 0.8% — raw × 0.992 = payout for every (m, k)', () => {
    for (const dpc of [1, 3, 5, 10]) {
      for (let k = 1; k <= GRID_SIZE - dpc; k++) {
        const rawMult    = theoreticalMultiplier(dpc, k, 0);
        const payoutMult = theoreticalMultiplier(dpc, k, HOUSE_EDGE);
        assert.ok(Math.abs(payoutMult / rawMult - (1 - HOUSE_EDGE)) < 1e-12);
      }
    }
  });

  it('DEATH_POINTS_BY_DIFFICULTY constants match Duel /cross-road/config (EASY=1, MEDIUM=3, HARD=5, EXPERT=10)', () => {
    assert.strictEqual(DEATH_POINTS_BY_DIFFICULTY[1], 1);
    assert.strictEqual(DEATH_POINTS_BY_DIFFICULTY[2], 3);
    assert.strictEqual(DEATH_POINTS_BY_DIFFICULTY[3], 5);
    assert.strictEqual(DEATH_POINTS_BY_DIFFICULTY[4], 10);
  });
});

// ── Full Dataset Verification ────────────────────────────────────────────────

describe('Full Dataset Verification — every bet and every revealed seed', () => {
  it(`recomputes death points for every bet (${ds.bets.length} bets) with 0 mismatches`, () => {
    let checked = 0;
    let mismatches = 0;
    for (const b of ds.bets) {
      const ss = seedMap.get(b.seed.serverSeedHashed);
      if (!ss) continue;
      const dpc = DEATH_POINTS_BY_DIFFICULTY[b.response.difficulty_level];
      const key = Buffer.from(ss, 'hex');
      const computed = computeDeathPointsFromBuffer(key, b.seed.clientSeed, b.seed.nonce, dpc);
      const expected = [...b.response.mines_positions].sort((a, c) => a - c);
      if (JSON.stringify(computed) !== JSON.stringify(expected)) mismatches++;
      checked++;
    }
    assert.strictEqual(mismatches, 0, `${mismatches}/${checked} mismatches`);
    assert.ok(checked > 0);
  });

  it('verifies SHA-256(serverSeed) === serverSeedHashed for every revealed seed', () => {
    let mismatches = 0;
    let checked = 0;
    for (const [hash, serverSeed] of seedMap) {
      if (!verifyHash(serverSeed, hash)) mismatches++;
      checked++;
    }
    assert.strictEqual(mismatches, 0);
    assert.ok(checked > 0);
  });
});

// ── Payout accuracy on live data ─────────────────────────────────────────────

describe('Payout Accuracy — every winning bet in the dataset', () => {
  it('win_amount = bet_amount × payout_multiplier for all wins (tolerance 1e-10)', () => {
    let checked = 0;
    for (const b of ds.bets) {
      if (b.response.outcome === 'loss') continue;
      if (!b.response.no_house_edge_multiplier) continue;
      const expected = parseFloat(b.response.amount_currency) * parseFloat(b.response.no_house_edge_multiplier);
      const actual   = parseFloat(b.response.amount_won);
      assert.ok(
        Math.abs(expected - actual) < 1e-10,
        `round ${b.response.round_id}: expected ${expected}, got ${actual}`,
      );
      checked++;
    }
    assert.ok(checked > 0);
  });

  it('loss bets always record amount_won = 0', () => {
    let losses = 0;
    for (const b of ds.bets) {
      if (b.response.outcome !== 'loss') continue;
      assert.strictEqual(b.response.amount_won, '0');
      losses++;
    }
    assert.ok(losses > 0);
  });
});
