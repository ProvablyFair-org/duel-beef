/**
 * Spec self-test — docs/ALGORITHM.md §5 vectors and properties, run against src/rng.ts.
 *
 * Written by the clean-room implementer together with src/rng.ts, from docs/ALGORITHM.md and the module
 * interface alone (never from Duel's code). Integrated 20 Oct 2026: the checks are unchanged; only the
 * import path, the mocha wrapper and the reporting (failures collected instead of printed) were adapted.
 * The served-figure chain of §3.2 is not part of src/rng.ts's interface, so the self-test reproduces it
 * with exact BigInt rationals to check the §5 money figures. 3,000 random rounds use fresh random seeds.
 */
import { createHash, createHmac, randomBytes } from "crypto";
import {
  GRID_SIZE,
  HOUSE_EDGE,
  DEATH_POINTS_BY_DIFFICULTY,
  maxSteps,
  maxFairFor,
  drawFromChunk,
  newDrawCensus,
  computePermutationFromBuffer,
  computeDeathPointsFromBuffer,
  computeDeathPoints,
  verifyHash,
  survivalProbability,
  theoreticalMultiplier,
} from "../../src/rng";
import * as assert from "assert";

const EXPECTED_CHECKS = 105;

function runSelftest(): { pass: number; total: number; failed: string[] } {
  let pass = 0;
  let total = 0;
  const failed: string[] = [];
  function check(name: string, ok: boolean, detail = ""): void {
    total++;
    if (ok) pass++;
    else failed.push(`${name}${detail ? "  " + detail : ""}`);
  }
  const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

  // ---------- exact decimal helpers for §3.2 ----------
  interface Q { n: bigint; d: bigint }
  const pow10 = (k: number): bigint => 10n ** BigInt(k);
  function dec(s: string): Q {
    const [i, f = ""] = s.split(".");
    return { n: BigInt((i ?? "0") + f), d: pow10(f.length) };
  }
  const mul = (a: Q, b: Q): Q => ({ n: a.n * b.n, d: a.d * b.d });
  const div = (a: Q, b: Q): Q => ({ n: a.n * b.d, d: a.d * b.n });
  /** round half-up to D decimals (all values here are positive) */
  function q(a: Q, D: number): Q {
    const s = (2n * a.n * pow10(D) + a.d) / (2n * a.d);
    return { n: s, d: pow10(D) };
  }
  function fmt(a: Q, D: number): string {
    const s = (a.n * pow10(D)) / a.d; // a is already on a 10^D grid when called
    const str = s.toString().padStart(D + 1, "0");
    return `${str.slice(0, -D)}.${str.slice(-D)}`;
  }
  const trim = (s: string): string => s.replace(/0+$/, "").replace(/\.$/, "");
  const pk = (m: number, k: number): Q => ({ n: BigInt(20 - m - (k - 1)), d: BigInt(20 - (k - 1)) });
  /** §3.2 chain: M_1 = q18(20/(20-m)); M_k = q18(M_(k-1) / q14(p_k)) */
  function chain(m: number, k: number): Q {
    let M = q({ n: 20n, d: BigInt(20 - m) }, 18);
    for (let s = 2; s <= k; s++) M = q(div(M, q(pk(m, s), 14)), 18);
    return M;
  }
  const EDGE_F = dec("0.992");

  // ---------- §5 vectors ----------
  interface Vec {
    id: string;
    seed: string;
    commitment?: string;
    client: string;
    nonce: number;
    diff: number;
    K: number;
    amount: string;
    hmac0: string;
    u32: number;
    mod0: number;
    j: number[];
    a: number[];
    death: number[];
    win: boolean;
    reached: number;
    M?: string; // served multiplier field (M_k on win, M_(reached-1) or 1 on loss)
    edge?: string;
    won: string;
    rungs?: [string, string][];
  }
  const V: Vec[] = [
    {
      id: "V1", seed: "fcf0584ae26b61deecc138adfc788ef039d69814c172a7d71667b5c9cdc661fb",
      commitment: "b86763e0dc0f362d83e9bf1e6466f9be05434a502b7ea5fd1f96c2873b2bbcfe",
      client: "8AgNlaGR1fxeiy93", nonce: 0, diff: 1, K: 1, amount: "0.01",
      hmac0: "1b34db470ca62d03e3cfc2726cfa0dca1040b8e76cfffa9b49f66ffdb3d2ff97", u32: 456448839, mod0: 19,
      j: [19, 18, 12, 14, 4, 14, 7, 3, 2, 3, 8, 0, 3, 4, 2, 1, 1, 0, 1],
      a: [5, 13, 9, 6, 1, 11, 15, 10, 0, 8, 17, 2, 3, 7, 16, 4, 14, 12, 18, 19],
      death: [5], win: true, reached: 1,
      M: "1.052631578947368421", edge: "1.044210526315789474", won: "0.010442105263157895",
    },
    {
      id: "V2", seed: "fcf0584ae26b61deecc138adfc788ef039d69814c172a7d71667b5c9cdc661fb",
      client: "8AgNlaGR1fxeiy93", nonce: 7, diff: 4, K: 1, amount: "0.01",
      hmac0: "0e513ba4d88506d04746536d0840040e611599f2032768a04f2cde86848d7ea4", u32: 240204708, mod0: 8,
      j: [8, 4, 7, 8, 14, 12, 7, 10, 4, 8, 2, 7, 2, 3, 5, 1, 2, 2, 1],
      a: [0, 11, 6, 15, 1, 5, 3, 9, 13, 2, 16, 18, 10, 17, 12, 14, 19, 7, 4, 8],
      death: [0, 1, 2, 3, 5, 6, 9, 11, 13, 15], win: false, reached: 1,
      M: "1.000000000000000000", won: "0",
    },
    {
      id: "V3", seed: "fa0d2372508ea04cb2ca8c321085432e47f57e1a8d7e52ffbf5277844627fae0",
      commitment: "d648f7438936f09d1ec3737ed9bd8b3ef79369f09f139724140da41af0f11b2f",
      client: "QW1UGwpr3IxbGxgO", nonce: 0, diff: 2, K: 1, amount: "10",
      hmac0: "fbe83cf4622e429da057f95b14524b4e3f4528a3609b0f07b45e614ca924b873", u32: 4226301172, mod0: 12,
      j: [12, 7, 1, 8, 9, 6, 6, 5, 7, 0, 0, 6, 1, 2, 4, 4, 3, 0, 0],
      a: [11, 16, 15, 3, 19, 4, 2, 17, 13, 10, 0, 18, 5, 14, 6, 9, 8, 1, 7, 12],
      death: [11, 15, 16], win: true, reached: 1,
      M: "1.176470588235294118", edge: "1.167058823529411765", won: "11.670588235294117651",
    },
    {
      id: "V4", seed: "0347bfcda37123edea059f239f019628c6283209bdcf559d00338dc894d2b059",
      commitment: "36df4d00a5d056b9423e79e337b9c2f249d2c4dcefebf3e3062d9845eb37db6c",
      client: "pfauditmo2180iw", nonce: 2, diff: 3, K: 1, amount: "0.01",
      hmac0: "1f47d5bfb3c869fc308b1936d937272cd6c69bc9736e89e341fc6af3ad4c56b1", u32: 524801471, mod0: 11,
      j: [11, 15, 16, 14, 13, 8, 7, 1, 8, 9, 4, 0, 1, 2, 2, 1, 2, 1, 1],
      a: [19, 3, 10, 5, 18, 6, 2, 12, 0, 4, 9, 17, 1, 7, 8, 13, 14, 16, 15, 11],
      death: [3, 5, 10, 18, 19], win: true, reached: 1,
      M: "1.333333333333333333", edge: "1.322666666666666666", won: "0.013226666666666667",
    },
    {
      id: "V5", seed: "b8191951aae4437f5be0355f55968e224e779c1ae9d816f37134c0d8a3846342",
      commitment: "5f480bfbb6e5efe5daec1d240036e5bd063679c51346944ef7dfeda5f5e8b76a",
      client: "zsZvRuV71KhtyR7w", nonce: 0, diff: 3, K: 5, amount: "0.01",
      hmac0: "5e47398e0c927b3f1b6212d681fe45ce13cd3df051bd40a0a5d3bec34f6d614d", u32: 1581726094, mod0: 14,
      j: [14, 2, 3, 12, 15, 1, 12, 1, 1, 5, 1, 4, 7, 0, 2, 1, 3, 2, 0],
      a: [8, 6, 10, 17, 9, 18, 0, 7, 4, 11, 5, 13, 19, 16, 1, 15, 12, 3, 2, 14],
      death: [6, 8, 9, 10, 17], win: true, reached: 5,
      M: "5.162837162837138156", edge: "5.121534465534441051", won: "0.051215344655344411",
      rungs: [
        ["1.333333333333333333", "0.73684210526316"],
        ["1.809523809523804353", "0.72222222222222"],
        ["2.505494505494506044", "0.70588235294118"],
        ["3.549450549450532482", "0.6875"],
        ["5.162837162837138156", "0.66666666666667"],
      ],
    },
    {
      id: "V6", seed: "b8191951aae4437f5be0355f55968e224e779c1ae9d816f37134c0d8a3846342",
      client: "zsZvRuV71KhtyR7w", nonce: 12, diff: 3, K: 5, amount: "0.01",
      hmac0: "bdbd3938c6beddf4a8ed2d5f4c11f2524498faaf1b2156ca51965a1a3426b335", u32: 3183294776, mod0: 16,
      j: [16, 1, 4, 0, 8, 7, 11, 1, 0, 1, 5, 0, 4, 2, 1, 1, 1, 0, 1],
      a: [6, 3, 15, 14, 9, 10, 2, 17, 13, 5, 12, 19, 18, 11, 7, 8, 0, 4, 1, 16],
      death: [3, 6, 9, 14, 15], win: false, reached: 4,
      M: "2.505494505494506044", won: "0",
    },
  ];

  for (const v of V) {
    const key = Buffer.from(v.seed, "hex");
    const m = DEATH_POINTS_BY_DIFFICULTY[v.diff] as number;
    if (v.commitment) check(`${v.id} commitment SHA-256(hex-decoded seed)`, verifyHash(v.seed, v.commitment));
    // Step 1/2 for t=0, recomputed in the test
    const d0 = createHmac("sha256", key).update(`${v.client}:${v.nonce}:0`, "utf8").digest();
    check(`${v.id} HMAC(t=0)`, d0.toString("hex") === v.hmac0);
    check(`${v.id} u32 BE of t=0`, d0.readUInt32BE(0) === v.u32, `${d0.readUInt32BE(0)}`);
    check(`${v.id} drawFromChunk(u32, 20)`, drawFromChunk(v.u32, 20) === v.mod0);
    // all 19 draws via the exported drawFromChunk on each fresh HMAC
    const js: number[] = [];
    for (let t = 0; t < 19; t++) {
      const d = createHmac("sha256", key).update(`${v.client}:${v.nonce}:${t}`, "utf8").digest();
      let r: number | null = null;
      for (let c = 0; c < 8 && r === null; c++) r = drawFromChunk(d.readUInt32BE(c * 4), 20 - t);
      js.push(r as number);
    }
    check(`${v.id} j (19 draws)`, eq(js, v.j));
    // replay the listed j on the identity: must give the listed a (consistency of the vector itself)
    const replay = Array.from({ length: 20 }, (_, n) => n);
    v.j.forEach((j, t) => { const i = 19 - t; [replay[i], replay[j]] = [replay[j] as number, replay[i] as number]; });
    check(`${v.id} spec j replays to spec a`, eq(replay, v.a));
    const census = newDrawCensus();
    const perm = computePermutationFromBuffer(key, v.client, v.nonce, GRID_SIZE, census);
    check(`${v.id} permutation a`, eq(perm, v.a));
    check(`${v.id} census 19/19/0/0`, eq(census, { draws: 19, chunksRead: 19, rejectedChunks: 0, cursorAdvances: 0 }), JSON.stringify(census));
    const death = computeDeathPoints(v.seed, v.client, v.nonce, m);
    check(`${v.id} deathPoints (m=${m})`, eq(death, v.death), JSON.stringify(death));
    // §2 Step 4
    const f = Math.min(...death);
    const win = f >= v.K;
    const reached = win ? v.K : f + 1;
    check(`${v.id} outcome ${v.win ? "win" : "loss"}, reached ${v.reached}`, win === v.win && reached === v.reached);
    if (v.id === "V6") check(`${v.id} current_step [0,1,2,3]`, eq(Array.from({ length: reached }, (_, n) => n), [0, 1, 2, 3]));
    // §3.2 / §3.3 served figures
    if (win) {
      const M = chain(m, v.K);
      check(`${v.id} served multiplier M_${v.K}`, fmt(M, 18) === v.M, fmt(M, 18));
      const edge = q(mul(M, EDGE_F), 18);
      check(`${v.id} edge multiplier q18(M*0.992)`, fmt(edge, 18) === v.edge, fmt(edge, 18));
      const won = q(mul(mul(dec(v.amount), M), EDGE_F), 18);
      check(`${v.id} amount_won q18(amount*M*0.992)`, fmt(won, 18) === v.won, fmt(won, 18));
    } else {
      const served = reached === 1 ? "1.000000000000000000" : fmt(chain(m, reached - 1), 18);
      check(`${v.id} loss: served multiplier`, served === v.M, served);
      check(`${v.id} loss: amount_won 0`, v.won === "0");
    }
    if (v.rungs) {
      v.rungs.forEach(([mk, wc], idx) => {
        const k = idx + 1;
        const Mk = fmt(chain(m, k), 18);
        const wck = trim(fmt(q(pk(m, k + 1), 14), 14));
        check(`${v.id} rung k=${k} M_k / q14(p_(k+1))`, Mk === mk && wck === wc, `${Mk} ${wck}`);
      });
    }
  }
  // §3.2 V3 note: 10 x edge mult would give ...650 (the alternative is distinguishable)
  {
    const M = chain(3, 1);
    const alt = q(mul(dec("10"), q(mul(M, EDGE_F), 18)), 18);
    check("V3 alternative q18(10*q18(M*0.992)) = ...650 (differs)", fmt(alt, 18) === "11.670588235294117650");
  }
  // V5 exact reference
  {
    const t = theoreticalMultiplier(5, 5);
    check("V5 theoreticalMultiplier(5,5) ~ 0.992*15504/3003", Math.abs(t / (0.992 * 15504 / 3003) - 1) < 1e-15, `${t}`);
  }

  // ---------- properties ----------
  check("GRID_SIZE 20, HOUSE_EDGE 0.008", GRID_SIZE === 20 && HOUSE_EDGE === 0.008);
  check("DEATH_POINTS_BY_DIFFICULTY 1/3/5/10", eq(DEATH_POINTS_BY_DIFFICULTY, { 1: 1, 2: 3, 3: 5, 4: 10 }));
  check("maxSteps 19/17/15/10", eq([1, 3, 5, 10].map(maxSteps), [19, 17, 15, 10]));
  check("survivalProbability k=1 = 0.95/0.85/0.75/0.5", eq([1, 3, 5, 10].map((m) => survivalProbability(m, 1)), [0.95, 0.85, 0.75, 0.5]));
  check("survivalProbability beyond maxSteps = 0", [1, 3, 5, 10].every((m) => survivalProbability(m, maxSteps(m) + 1) === 0));
  {
    const t = theoreticalMultiplier(10, 10);
    check("theoreticalMultiplier(10,10) = 183277.952 (O5)", Math.abs(t - 183277.952) < 1e-9, `${t}`);
  }
  {
    let maxRel = 0;
    let cells = 0;
    for (const m of [1, 3, 5, 10]) for (let k = 1; k <= maxSteps(m); k++) {
      cells++;
      const M = chain(m, k);
      const rel = Math.abs(Number(M.n) / Number(M.d) / theoreticalMultiplier(m, k, 0) - 1);
      if (rel > maxRel) maxRel = rel;
    }
    check(`chain M_k vs exact fair, ${cells} cells, max rel dev < 4.1e-14`, cells === 61 && maxRel < 4.1e-14, maxRel.toExponential(3));
  }
  // draw window
  {
    const ok = Array.from({ length: 19 }, (_, n) => n + 2).every((r) => {
      const L = maxFairFor(r);
      return L === Math.floor(2 ** 32 / r) * r && 2 ** 32 - L < r && L % r === 0;
    });
    check("maxFairFor(r) = floor(2^32/r)*r, r=2..20", ok);
    check("maxFairFor = 2^32 for r = 2,4,8,16 (no rejection)", [2, 4, 8, 16].every((r) => maxFairFor(r) === 2 ** 32));
    const worst = Math.max(...Array.from({ length: 19 }, (_, n) => (2 ** 32 - maxFairFor(n + 2)) / 2 ** 32));
    // §2 Step 2 quotes "<= 3.7e-9"; the exact worst case is 16/2^32 = 3.725e-9 at r = 20 (spec rounds to 2 s.f.)
    check("worst rejection probability r<=20 is 16/2^32 at r=20 (~3.7e-9 at 2 s.f.)",
      worst === 16 / 2 ** 32 && worst.toPrecision(2) === "3.7e-9", worst.toExponential(3));
    check("drawFromChunk(4294967289,19)=18; (4294967290,19)=null", drawFromChunk(4294967289, 19) === 18 && drawFromChunk(4294967290, 19) === null);
    check("drawFromChunk(2^32-1, 20) = null; (2^32-1, 16) = 15", drawFromChunk(2 ** 32 - 1, 20) === null && drawFromChunk(2 ** 32 - 1, 16) === 15);
  }
  // random rounds: ranges, census consistency, census-neutral, string == buffer entry points
  {
    const N = 3000;
    const total = newDrawCensus();
    let permOk = true, deathOk = true, neutral = true, sameEntry = true;
    let safe0 = 0;
    for (let i = 0; i < N; i++) {
      const seed = randomBytes(32).toString("hex");
      const key = Buffer.from(seed, "hex");
      const client = randomBytes(8).toString("base64");
      const nonce = i;
      const c = newDrawCensus();
      const p1 = computePermutationFromBuffer(key, client, nonce, GRID_SIZE, c);
      const p2 = computePermutationFromBuffer(key, client, nonce);
      if (!eq(p1, p2)) neutral = false;
      if (!eq([...p1].sort((x, y) => x - y), Array.from({ length: 20 }, (_, n) => n))) permOk = false;
      total.draws += c.draws; total.chunksRead += c.chunksRead; total.rejectedChunks += c.rejectedChunks; total.cursorAdvances += c.cursorAdvances;
      for (const m of [1, 3, 5, 10]) {
        const d = computeDeathPointsFromBuffer(key, client, nonce, m);
        if (d.length !== m || new Set(d).size !== m || d.some((x) => x < 0 || x >= 20 || !Number.isInteger(x))) deathOk = false;
        if (!eq(d, [...p1.slice(0, m)].sort((x, y) => x - y))) deathOk = false;
        if (m === 10 && Math.min(...d) >= 1) safe0++;
        if (i < 200 && !eq(d, computeDeathPoints(seed, client, nonce, m))) sameEntry = false;
      }
    }
    check(`${N} random rounds: permutation of 0..19`, permOk);
    check(`${N} random rounds: m distinct death points in [0,19], = first m slots`, deathOk);
    check("passing a census changes nothing computed", neutral);
    check("computeDeathPoints(hex) == computeDeathPointsFromBuffer", sameEntry);
    check("census: draws = 19 per round", total.draws === 19 * N, JSON.stringify(total));
    check("census: chunksRead = draws + rejectedChunks; cursorAdvances = rejectedChunks",
      total.chunksRead === total.draws + total.rejectedChunks && total.cursorAdvances === total.rejectedChunks);
    const z = (safe0 / N - 0.5) / Math.sqrt(0.25 / N);
    check(`EXPERT tile 0 safe frequency ~ 0.5 (|z| < 5)`, Math.abs(z) < 5, `${safe0}/${N} z=${z.toFixed(2)}`);
  }
  // hash check true/false
  {
    const s = V[0]!.seed;
    const h = V[0]!.commitment!;
    check("verifyHash true (upper-case commitment accepted)", verifyHash(s, h.toUpperCase()));
    check("verifyHash false for wrong hash", !verifyHash(s, V[2]!.commitment!));
    const asciiHash = createHash("sha256").update(s, "utf8").digest("hex");
    check("verifyHash false for SHA-256 of ASCII hex form", !verifyHash(s, asciiHash));
    check("verifyHash false for malformed seed", !verifyHash("zz" + s.slice(2), h) && !verifyHash(s.slice(1), h));
  }

  return { pass, total, failed };
}

describe("Spec self-test — src/rng.ts against docs/ALGORITHM.md (clean-room rebuild)", function () {
  this.timeout(300_000);
  it(`all ${EXPECTED_CHECKS} spec vector and property checks pass`, () => {
    const r = runSelftest();
    assert.deepStrictEqual(r.failed, []);
    assert.strictEqual(r.total, EXPECTED_CHECKS);
    assert.strictEqual(r.pass, EXPECTED_CHECKS);
  });
});
