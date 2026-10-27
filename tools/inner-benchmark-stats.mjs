/** Statistics for constructed, paired simulator experiments. Rates are fractions. */
const Z95 = 1.959963984540054;
export function wilsonInterval(successes, n, z = Z95) {
  if (!Number.isInteger(n) || n < 0 || !Number.isInteger(successes) || successes < 0 || successes > n) throw new Error('Invalid binomial counts');
  if (!n) return null;
  const p = successes / n, zz = z * z, den = 1 + zz / n;
  const centre = (p + zz / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + zz / (4 * n * n)) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function binomialTail(k, n, p, upper) {
  if (p <= 0) return upper ? Number(k <= 0) : 1;
  if (p >= 1) return upper ? 1 : Number(k >= n);
  const lo = upper ? k : 0, hi = upper ? n : k;
  if (lo > hi) return 0;
  let logChoose = 0, logs = [], largest = -Infinity;
  for (let i = 0; i <= n; i++) {
    if (i) logChoose += Math.log(n - i + 1) - Math.log(i);
    if (i >= lo && i <= hi) {
      const v = logChoose + i * Math.log(p) + (n - i) * Math.log1p(-p);
      logs.push(v); largest = Math.max(largest, v);
    }
  }
  return Math.min(1, Math.exp(largest) * logs.reduce((s, v) => s + Math.exp(v - largest), 0));
}

/** Two-sided Clopper-Pearson interval, inverted by bisection (no normal approximation). */
export function exactBinomialInterval(k, n, alpha = 0.05) {
  if (!n) return null;
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n || alpha <= 0 || alpha >= 1) throw new Error('Invalid exact interval arguments');
  const bisect = (target, increasing, fn) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if ((fn(mid) < target) === increasing) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  const low = k ? bisect(alpha / 2, true, p => binomialTail(k, n, p, true)) : 0;
  const high = k < n ? bisect(alpha / 2, false, p => binomialTail(k, n, p, false)) : 1;
  return [low, high];
}

export function summarizeMetric(input) {
  const values = input.filter(v => typeof v === 'number' && Number.isFinite(v));
  const n = values.length;
  if (!n) return {n:0, mean:null, sd:null, se:null, ci95:null, min:null, max:null};
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  const se = sd === null ? null : sd / Math.sqrt(n);
  return {n, mean, sd, se, ci95:se === null ? null : [mean - Z95 * se, mean + Z95 * se], min:Math.min(...values), max:Math.max(...values)};
}

export const isCompleted = row => row.status === 'completed';
export function summarizeGroup(rows) {
  const completed = rows.filter(isCompleted), wins = completed.filter(r => r.winner === 'ally').length;
  const metrics = new Set(completed.flatMap(r => Object.keys(r.metrics || {})));
  const survival = completed.map(r => r.metrics?.mainFinalAlive).filter(v => v === 0 || v === 1);
  const survivors = survival.reduce((sum, v) => sum + v, 0);
  return {
    attempted: rows.length, completed: completed.length,
    failed: rows.filter(r => r.status === 'failed').length,
    limited: rows.filter(r => r.status === 'limited').length,
    wins, losses:completed.filter(r => r.winner === 'enemy').length,
    draws:completed.filter(r => r.winner === 'draw').length,
    winRate:completed.length ? wins / completed.length : null,
    winRateCI95:wilsonInterval(wins, completed.length),
    winRateDenominator:'Completed battles, including true draws; excludes failures and host round-limit censoring',
    mainSurvival:{observed:survival.length, survivors, rate:survival.length ? survivors / survival.length : null, ci95:wilsonInterval(survivors, survival.length)},
    metrics:Object.fromEntries([...metrics].sort().map(k => [k, summarizeMetric(completed.map(r => r.metrics?.[k]))])),
    firstObservedRounds:Object.fromEntries([...new Set(completed.flatMap(r => Object.keys(r.firstObservedRounds || {})))].sort().map(k => {
      const metric = summarizeMetric(completed.map(r => r.firstObservedRounds?.[k]));
      return [k, {...metric, observed:metric.n, completed:completed.length, observationRate:completed.length ? metric.n / completed.length : null}];
    })),
    failureReasons:[...new Set(rows.filter(r => r.status === 'failed').map(r => r.error?.message || 'Unknown error'))]
  };
}

export function pairedWinDifference(rowsA, rowsB) {
  const key = r => `${r.matchupId}:${r.seed}`;
  const a = new Map(rowsA.filter(isCompleted).map(r => [key(r), r]));
  const b = new Map(rowsB.filter(isCompleted).map(r => [key(r), r]));
  let n = 0, aOnly = 0, bOnly = 0, bothWin = 0, neitherWin = 0;
  for (const [k, ar] of a) {
    const br = b.get(k); if (!br) continue;
    n++; const aw = ar.winner === 'ally', bw = br.winner === 'ally';
    if (aw && bw) bothWin++; else if (aw) aOnly++; else if (bw) bOnly++; else neitherWin++;
  }
  if (!n) return {n:0, difference:null, ci95:null, aOnly:0, bOnly:0, bothWin:0, neitherWin:0};
  // With probability >=95%, both 97.5% exact discordance intervals cover.
  // Subtraction gives a conservative paired difference interval without treating pairs as independent.
  const ia = exactBinomialInterval(aOnly, n, 0.025), ib = exactBinomialInterval(bOnly, n, 0.025);
  return {n, difference:(bOnly - aOnly) / n, ci95:[Math.max(-1, ib[0] - ia[1]), Math.min(1, ib[1] - ia[0])],
    aOnly, bOnly, bothWin, neitherWin,
    direction:'B minus A win probability; draw scores zero for win-rate purposes',
    method:'Paired discordance; conservative 95% Bonferroni interval from two 97.5% exact Clopper-Pearson binomial intervals'};
}
