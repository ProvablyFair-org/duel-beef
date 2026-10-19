/**
 * EXACT ARITHMETIC for the multiplier formula — integer binomials and rational comparison.
 * (Ported 2026-09-26 from Duel Mines src/exact.ts: same formula family on 20 tiles, edge 0.992.)
 *
 * WHY THIS MODULE EXISTS. Every multiplier comparison in this package used to be
 * `|parseFloat(served) − theoreticalMultiplier(m, k)| ≤ 1e-6` — an ABSOLUTE bound on a figure the
 * API publishes to 18 decimals, computed on both sides in floating point. A served multiplier off
 * the formula by 1e-7 passed. Here the closed form is an exact rational,
 *
 *     multiplier(m, k)            = C(20, k) / C(20 − m, k)
 *     no_house_edge_multiplier    = C(20, k) · 992 / (C(20 − m, k) · 1000)
 *
 * (Duel's naming quirk, as in Mines: the field called no_house_edge_multiplier is the PAID multiplier,
 * with the 0.8 % edge applied; `multiplier` is the raw combinatoric value.)
 *
 * with C(n, k) an integer computed in BigInt, and the served decimal string is parsed exactly, so
 * the deviation of a served value from the formula is MEASURED exactly rather than estimated.
 *
 * THE BOUND, AND WHY IT IS NOT ZERO. The operator evaluates k > 1 multipliers in IEEE-754 double and
 * prints 18 digits of the result (e.g. Phase E, difficulty 1, k = 5: served 1.333333333333335164 for
 * the exact 4/3), so a served value carries double-precision error and an exact test would FAIL an
 * honest operator on floating-point noise it cannot avoid. MULT_REL_TOL = 1e-12 is the reproduction
 * rule's own relative bound; Steps 8, 10 and 20 print the WORST measured relative deviation beside it
 * on every run, so the headroom is visible rather than asserted. It replaced an ABSOLUTE 1e-6 on
 * parsed doubles, which passed a served multiplier moved by 1e-7.
 */

export const GRID = 20;

/** Relative bound for a served multiplier against the exact closed form. See the header. */
export const MULT_REL_TOL = 1e-12;

/** House-edge retention as an exact fraction: 0.992 = 992/1000. */
export const EDGE_NUM = 992n;
export const EDGE_DEN = 1000n;

/** C(n, k) as an exact integer. 0 outside 0 ≤ k ≤ n. */
export function binomialBig(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}

export interface Rational { num: bigint; den: bigint }

/** The closed-form multiplier at (m, k) as an exact rational; `withEdge` applies 992/1000. */
export function exactMultiplier(m: number, k: number, withEdge: boolean): Rational {
  const num = binomialBig(GRID, k) * (withEdge ? EDGE_NUM : 1n);
  const den = binomialBig(GRID - m, k) * (withEdge ? EDGE_DEN : 1n);
  if (den === 0n) throw new Error(`multiplier undefined at m=${m}, k=${k} (k exceeds the ${GRID - m} safe tiles)`);
  return { num, den };
}

/** Parse a plain decimal string ("2.270454545454545454") exactly: value = int / 10^scale. */
export function parseDecimal(s: string): { int: bigint; scale: number } {
  if (typeof s !== 'string' || !/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a plain decimal: ${JSON.stringify(s)}`);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [a, b = ''] = body.split('.');
  const int = BigInt(a + b) * (neg ? -1n : 1n);
  return { int, scale: b.length };
}

/**
 * |served − exact| / exact, computed exactly and returned as a double. A served value that is not
 * a plain decimal string returns Infinity, so a malformed field can never satisfy the bound.
 */
export function relativeDeviation(served: string | null | undefined, exact: Rational): number {
  if (served === null || served === undefined) return Infinity;
  let d: { int: bigint; scale: number };
  try { d = parseDecimal(served); } catch { return Infinity; }
  const pow = 10n ** BigInt(d.scale);
  // served/pow − num/den = (served·den − num·pow) / (pow·den); relative to num/den → ÷ (num·pow)
  const diff = d.int * exact.den - exact.num * pow;
  const absDiff = diff < 0n ? -diff : diff;
  const denom = exact.num * pow;
  if (absDiff === 0n) return 0;
  // Scale to keep 30 significant digits through the BigInt division, then to a double.
  const SCALE = 10n ** 30n;
  return Number((absDiff * SCALE) / denom) / 1e30;
}

/** Exact comparison of two rationals: −1, 0, 1. Denominators must be positive. */
export function compareRational(a: Rational, b: Rational): number {
  const l = a.num * b.den, r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

/**
 * THE COUNTING ANCHOR (profile BEEF-18; ported 2026-09-26 from Duel Mines src/exact.ts). Enumerates
 * every one of the 2^20 subsets of the 20 path tiles once and tallies, for each size m, how many
 * m-subsets have their lowest tile at index ≥ k — i.e. how many death-point sets let a player who
 * walks tiles 0 … k−1 survive. That tally is reached by COUNTING, with no binomial formula anywhere in
 * the path, so it is independent of every closed form this package or the operator uses.
 *
 * Returns survive[m][k] (m, k = 0..20) and total[m] = number of m-subsets.
 */
export function enumerateSurvivalCounts(): { survive: number[][]; total: number[] } {
  const total = new Array(GRID + 1).fill(0);
  const byLow: number[][] = Array.from({ length: GRID + 1 }, () => new Array(GRID + 1).fill(0));
  const limit = 1 << GRID;
  for (let s = 0; s < limit; s++) {
    let x = s - ((s >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    const m = (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
    const low = s === 0 ? GRID : 31 - Math.clz32(s & -s);
    total[m]++;
    byLow[m][low]++;
  }
  // A death set avoids the path prefix {0..k−1} iff its lowest tile is >= k.
  const survive: number[][] = Array.from({ length: GRID + 1 }, () => new Array(GRID + 1).fill(0));
  for (let m = 0; m <= GRID; m++) {
    let acc = 0;
    for (let b = GRID; b >= 0; b--) {
      acc += byLow[m][b];
      survive[m][b] = acc;
    }
  }
  return { survive, total };
}
