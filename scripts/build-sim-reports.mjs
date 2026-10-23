// demo 用模擬回報：以承載量 K 為機率分布，產生過去 90 天的回報（固定亂數種子，可重現）
// 輸出 dist/data/reports_sim.json（與匯入格式相同，每筆 simulated: true）
// 規模參考：環保局 2026-02 鼠患通報 258 件/月 → 90 天約 750 件；demo 取 600 件。
import { readFile, writeFile } from 'node:fs/promises';
import { makeGrid, computeEnv, isoOf } from '../dist/js/engine.js';
import { DEFAULTS } from '../dist/js/params.js';

const END = process.argv[2] || '2026-10-23';       // 最後一天（含）
const COUNT = 600, DAYS = 90, SEED = 20261024;

let s = SEED >>> 0;                                 // mulberry32
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (pairs) => { let x = rnd() * pairs.reduce((a, p) => a + p[1], 0); for (const [v, w] of pairs) if ((x -= w) <= 0) return v; return pairs.at(-1)[0]; };

const meta = JSON.parse(await readFile('dist/data/grid.json', 'utf8'));
const bin = await readFile('dist/data/grid.bin');
const G = makeGrid(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const { K } = computeEnv(G, DEFAULTS);
// 機率 ∝ K²：讓回報集中在熱區，但低 K 的地方仍偶有回報
const cdf = new Float64Array(G.M); let acc = 0;
for (let m = 0; m < G.M; m++) cdf[m] = (acc += K[m] * K[m]);
const sampleCell = () => { const x = rnd() * acc; let lo = 0, hi = G.M - 1; while (lo < hi) { const mid = (lo + hi) >> 1; cdf[mid] < x ? lo = mid + 1 : hi = mid; } return lo; };

const reports = [];
for (let n = 0; n < COUNT; n++) {
  const g = G.cells[sampleCell()];
  const [lon, lat] = G.lonlatOf(g % G.nx + rnd(), Math.floor(g / G.nx) + rnd());
  const day = -Math.floor(rnd() * DAYS);
  const hour = pick([[6, 1], [8, 1], [12, 1], [19, 3], [21, 4], [23, 3], [2, 1]]), min = Math.floor(rnd() * 60);
  const species = pick([['norway', 60], ['roof', 20], ['house', 10], ['unknown', 10]]);
  reports.push({
    id: 'sim-' + String(n + 1).padStart(4, '0'),
    lon: +lon.toFixed(6), lat: +lat.toFixed(6),
    time: `${isoOf(day, END)}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+08:00`,
    species,
    confidence: species === 'unknown' ? +(0.2 + rnd() * 0.3).toFixed(2) : +(0.5 + rnd() * 0.5).toFixed(2),
    count: pick([[1, 70], [2, 20], [3, 7], [5, 3]]),
    evidence: pick([['live', 45], ['dead', 15], ['droppings', 20], ['gnaw', 8], ['burrow', 12]]),
    simulated: true,
  });
}
reports.sort((a, b) => a.time.localeCompare(b.time));
await writeFile('dist/data/reports_sim.json', JSON.stringify({ note: '模擬資料：依環境因子推估的承載量產生，非真實通報', seed: SEED, end: END, reports }));
const bySp = reports.reduce((o, r) => (o[r.species] = (o[r.species] || 0) + 1, o), {});
console.log(`reports_sim.json：${reports.length} 筆（${reports[0].time.slice(0, 10)} ~ ${reports.at(-1).time.slice(0, 10)}）`, bySp);
