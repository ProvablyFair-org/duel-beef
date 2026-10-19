/**
 * Statistical tests for mines audit.
 *
 * chiSquaredTest       — goodness-of-fit with exact p-values via regularized incomplete gamma.
 * chiSquaredPValue     — standalone p-value computation.
 * lag1Autocorrelation  — lag-1 autocorrelation of a numeric series.
 * runsTest             — Wald-Wolfowitz runs test on a win/loss (0/1) series.
 * inverseCriticalZ     — two-tailed critical z for Bonferroni thresholds.
 */

// ── Chi-squared ────────────────────────────────────────────────────────────────

export interface ChiSquaredResult {
  chi2: number;
  df: number;
  pValue: number;
}

/**
 * Chi-squared goodness-of-fit.
 * Bins with expected < 5 are pooled with their neighbours before the test.
 * Returns chi2, degrees of freedom, and exact p-value via regularized incomplete gamma.
 */
export function chiSquaredTest(
  observed: number[],
  expected: number[],
): ChiSquaredResult {
  if (observed.length !== expected.length) {
    throw new Error('observed and expected must have the same length');
  }

  // Pool bins with expected < 5 — front tail
  let obs = [...observed];
  let exp = [...expected];

  while (obs.length > 2 && exp[0] < 5) {
    obs[1] += obs[0]; exp[1] += exp[0];
    obs.shift(); exp.shift();
  }
  // Back tail
  while (obs.length > 2 && exp[exp.length - 1] < 5) {
    const n = obs.length;
    obs[n - 2] += obs[n - 1]; exp[n - 2] += exp[n - 1];
    obs.pop(); exp.pop();
  }

  let chi2 = 0;
  for (let i = 0; i < obs.length; i++) {
    if (exp[i] > 0) {
      chi2 += (obs[i] - exp[i]) ** 2 / exp[i];
    }
  }

  const df     = obs.length - 1;
  const pValue = 1 - regularizedGamma(df / 2, chi2 / 2);

  return { chi2, df, pValue };
}

/**
 * Chi-squared p-value for given chi2 statistic and degrees of freedom.
 * Exact computation via regularized incomplete gamma.
 */
export function chiSquaredPValue(chi2: number, df: number): number {
  return 1 - regularizedGamma(df / 2, chi2 / 2);
}

// ── Regularized incomplete gamma (exact) ──────────────────────────────────────

/**
 * Regularized lower incomplete gamma P(a, x) = γ(a,x)/Γ(a).
 * Uses series expansion for x < a+1, continued fraction for x >= a+1.
 * Accuracy: ~14 significant digits (Lanczos log-Γ + series/CF).
 */
function regularizedGamma(a: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return 0;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaCF(a, x);
}

function logGamma(z: number): number {
  // Lanczos approximation, g=7, n=9
  const c = [
     0.99999999999980993,
    676.5203681218851,
   -1259.1392167224028,
    771.32342877765313,
   -176.61502916214059,
     12.507343278686905,
     -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaSeries(a: number, x: number): number {
  const lnGa = logGamma(a);
  let ap  = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < 300; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 3e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGa);
}

function gammaCF(a: number, x: number): number {
  const lnGa = logGamma(a);
  let b  = x + 1 - a;
  let c  = 1 / 1e-30;
  let d  = 1 / b;
  let h  = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d  = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
    c  = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d  = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGa) * h;
}

// ── Lag-1 autocorrelation ─────────────────────────────────────────────────────

export function lag1Autocorrelation(series: number[]): number {
  const n    = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n - 1; i++) num += (series[i] - mean) * (series[i + 1] - mean);
  for (let i = 0; i < n; i++)     den += (series[i] - mean) ** 2;
  return den === 0 ? 0 : num / den;
}

// ── Wald-Wolfowitz runs test ──────────────────────────────────────────────────

export interface RunsTestResult {
  runs: number;
  expected: number;
  z: number;
  pValue: number;
}

/**
 * Wald–Wolfowitz runs test on a WIN/LOSS series (1 = win, 0 = loss): n1 = wins, n2 = losses,
 * R = number of runs (maximal blocks of equal outcomes),
 *   E[R] = 2·n1·n2/n + 1,   Var[R] = 2·n1·n2·(2·n1·n2 − n) / (n²·(n − 1)),
 *   z = (R − E[R]) / √Var[R],   two-sided p.
 *
 * Until 2026-10-06 this dichotomised the series at its MEDIAN with `>=`. On a 0/1 series whose
 * losses outnumber its wins the median is 0, every round is "above" it, n2 = 0, Var[R] = 0, and the
 * test returned z = 0, p = 1 whatever the sequence (Pass 1 difficulty 4, 10 death points, win rate
 * 0.499415). With wins in the majority the median split was already the win/loss split, so
 * difficulties 1–3 are unchanged. Same correction as Duel Mines src/sim-census.ts runsFromCensus.
 */
export function runsTest(series: number[]): RunsTestResult {
  const n = series.length;
  if (n === 0) throw new Error('runsTest: empty series');
  let n1 = 0;
  let runs = 1;
  for (let i = 0; i < n; i++) {
    const x = series[i];
    if (x !== 0 && x !== 1) throw new Error(`runsTest: series[${i}] = ${x} is not a 0/1 outcome`);
    if (x === 1) n1++;
    if (i > 0 && x !== series[i - 1]) runs++;
  }
  const n2 = n - n1;
  const expected  = (2 * n1 * n2) / n + 1;
  const varRuns   = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const z         = varRuns > 0 ? (runs - expected) / Math.sqrt(varRuns) : 0;
  const pValue    = 2 * (1 - normalCDF(Math.abs(z)));
  return { runs, expected, z, pValue };
}

// ── Inverse critical z ────────────────────────────────────────────────────────

/** Two-tailed critical z for a given alpha (Abramowitz & Stegun 26.2.23). */
export function inverseCriticalZ(alpha: number): number {
  const p = alpha / 2;
  const t = Math.sqrt(-2 * Math.log(p));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  // Abramowitz & Stegun approximation, max error < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.sign(x) * y;
}

/**
 * P(X >= k) for X ~ Binomial(n, p). Same arithmetic as the local copy in src/simulate.ts (which
 * produced the committed test_a/test_b binomial p-values), exported so the verifier can
 * recompute those figures instead of reading them.
 */
export function binomSurvival(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let cdf = 0;
  for (let i = 0; i < k; i++) cdf += binomPMF(i, n, p);
  return Math.max(0, 1 - cdf);
}
function binomPMF(k: number, n: number, p: number): number {
  let logP = 0;
  for (let i = 0; i < k; i++) logP += Math.log(n - i) - Math.log(i + 1);
  logP += k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logP);
}
