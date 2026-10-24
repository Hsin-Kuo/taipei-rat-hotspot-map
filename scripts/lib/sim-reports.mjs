// 模擬回報產生器（build-sim-reports.mjs 與 build-demo.mjs 共用）：以承載量 K 為機率分布，固定亂數種子可重現
import { readFile } from 'node:fs/promises';
import { makeGrid, computeEnv, isoOf } from '../../dist/js/engine.js';
import { DEFAULTS } from '../../dist/js/params.js';

export function rng(seed) {                           // mulberry32
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (pairs) => { let x = rnd() * pairs.reduce((a, p) => a + p[1], 0); for (const [v, w] of pairs) if ((x -= w) <= 0) return v; return pairs.at(-1)[0]; };
  return { rnd, pick };
}

export async function loadGridEnv() {
  const meta = JSON.parse(await readFile('dist/data/grid.json', 'utf8'));
  const bin = await readFile('dist/data/grid.bin');
  const G = makeGrid(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  return { G, env: computeEnv(G, DEFAULTS) };
}

// 依權重（每個市內格一個值）抽格子
export function cellSampler(G, weights, rnd) {
  const cdf = new Float64Array(G.M); let acc = 0;
  for (let m = 0; m < G.M; m++) cdf[m] = (acc += weights[m]);
  return () => { const x = rnd() * acc; let lo = 0, hi = G.M - 1; while (lo < hi) { const mid = (lo + hi) >> 1; cdf[mid] < x ? lo = mid + 1 : hi = mid; } return lo; };
}

export function randomPointIn(G, m, rnd) {
  const g = G.cells[m];
  const [lon, lat] = G.lonlatOf(g % G.nx + rnd(), Math.floor(g / G.nx) + rnd());
  return [+lon.toFixed(6), +lat.toFixed(6)];
}

export const HOURS = [[6, 1], [8, 1], [12, 1], [19, 3], [21, 4], [23, 3], [2, 1]];
export const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`;

// 全市背景回報：end（含）往前 days 天，count 筆；機率 ∝ K²（集中在熱區，但低 K 處仍偶有回報）
export function generateBackground({ G, env, end, count = 600, days = 90, seed = 20261024, idPrefix = 'sim-' }) {
  const { rnd, pick } = rng(seed);
  const sample = cellSampler(G, Array.from(env.K, k => k * k), rnd);
  const reports = [];
  for (let n = 0; n < count; n++) {
    const [lon, lat] = randomPointIn(G, sample(), rnd);
    const day = -Math.floor(rnd() * days);
    const hour = pick(HOURS), min = Math.floor(rnd() * 60);
    const species = pick([['norway', 60], ['roof', 20], ['house', 10], ['unknown', 10]]);
    reports.push({
      id: idPrefix + String(n + 1).padStart(4, '0'), lon, lat,
      time: `${isoOf(day, end)}T${hhmm(hour, min)}`,
      species,
      confidence: species === 'unknown' ? +(0.2 + rnd() * 0.3).toFixed(2) : +(0.5 + rnd() * 0.5).toFixed(2),
      count: pick([[1, 70], [2, 20], [3, 7], [5, 3]]),
      evidence: pick([['live', 45], ['dead', 15], ['droppings', 20], ['gnaw', 8], ['burrow', 12]]),
      simulated: true,
    });
  }
  return reports.sort((a, b) => a.time.localeCompare(b.time));
}
