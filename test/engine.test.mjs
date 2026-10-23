import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeGrid, computeEnv, simulate, taskGeometry, reportBoost, estimate, byVillage, pointsNear, dayOf } from '../dist/js/engine.js';
import { DEFAULTS, clone, mergeParams } from '../dist/js/params.js';

const meta = JSON.parse(readFileSync('dist/data/grid.json', 'utf8'));
const bin = readFileSync('dist/data/grid.bin');
const G = makeGrid(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const P = clone(DEFAULTS);
const env = computeEnv(G, P);
const TODAY = '2026-10-24';
const V = '6300500020';                                   // 中正區龍福里
const vm = (vals, code) => byVillage(G, vals)[G.vIndex.get(code) - 1];
const task = (o) => ({ id: 't', type: 'poison', status: 'planned', scope: { type: 'villages', villages: [V], geometry: null }, start: '2026-10-01', end: '2026-10-01', ...o });

test('grid：456 里、市內格數與里索引一致', () => {
  assert.equal(G.villages.length, 456);
  assert.equal(G.vCells.reduce((a, c) => a + c.length, 0), G.M);
  assert.ok(G.vCells.every(c => c.length > 0));
});

test('K：0 以上、p99 = 100、萬華高於北投山區', () => {
  assert.ok(env.K.every(v => v > 0 && Number.isFinite(v)));
  const s = Float32Array.from(env.K).sort();
  assert.ok(Math.abs(s[Math.floor(s.length * .99)] - 100) < 1);
  const at = (lon, lat) => env.K[G.cellIdx[G.cellOf(lon, lat)]];
  assert.ok(at(121.4997, 25.0375) > 3 * at(121.5450, 25.1700), '西門町 vs 陽明山');
});

test('無任務：族群維持平衡', () => {
  const sim = simulate(G, env, P, [], TODAY);
  const last = estimate(G, sim, null, 30);
  let maxRel = 0; for (let m = 0; m < G.M; m++) maxRel = Math.max(maxRel, Math.abs(last[m] - env.K[m]) / env.K[m]);
  assert.ok(maxRel < 1e-3, `maxRel ${maxRel}`);
});

test('投藥：當日扣除約 kill，之後回升但 30 天內仍低於 K', () => {
  const sim = simulate(G, env, P, [task()], TODAY);
  const k = vm(env.K, V), d = dayOf('2026-10-01', TODAY);
  const after = vm(estimate(G, sim, null, d), V);
  assert.ok(after < k * 0.3 && after > k * 0.15, `after ${after / k}`);
  const later = vm(estimate(G, sim, null, d + 30), V);
  assert.ok(later > after && later < k, `later ${later / k}`);
});

test('外溢：環帶增加量 = 扣除量 × spill（r=0 時守恆）', () => {
  const P0 = clone(P); P0.base.r = 0; const e0 = computeEnv(G, P0);
  const sim = simulate(G, e0, P0, [task()], TODAY);
  const geo = taskGeometry(G, e0, [V], P0.tasks.poison.ring);
  const di = dayOf('2026-10-01', TODAY) - sim.d0;
  const sum = (ms, d) => { let s = 0; for (const m of ms) s += sim.N[d * G.M + m]; return s; };
  const removed = sum(geo.scope, di - 1) - sum(geo.scope, di);
  const gained = sum(geo.ring, di) - sum(geo.ring, di - 1);
  assert.ok(geo.ring.length > 0);
  assert.ok(Math.abs(gained - removed * P0.tasks.poison.spill) < removed * 1e-4, `${gained} vs ${removed * 0.05}`);
});

test('已取消任務不進模型', () => {
  const sim = simulate(G, env, P, [task({ status: 'cancelled' })], TODAY);
  assert.equal(sim.active, 0);
});

test('環境清消：K 暫降後依半衰期恢復', () => {
  const sim = simulate(G, env, P, [task({ type: 'clean', start: '2026-04-01', end: '2026-04-03' })], TODAY, [-240, 30]);
  const k = vm(env.K, V), d = dayOf('2026-04-03', TODAY);
  const low = vm(estimate(G, sim, null, d + 3), V), rec = vm(estimate(G, sim, null, d + 200), V);
  assert.ok(low < 0.85 * k && rec > 0.9 * k, `${low / k} → ${rec / k}`);
});

test('回報加成：中心最高、半徑外為 0、半衰期後減半', () => {
  const rp = { lon: 121.4997, lat: 25.0375, time: '2026-10-10', species: 'norway', confidence: 1, evidence: 'live' };
  const c = G.cellIdx[G.cellOf(rp.lon, rp.lat)];
  const b0 = reportBoost(G, P, [rp], dayOf(rp.time, TODAY), TODAY);
  const bh = reportBoost(G, P, [rp], dayOf(rp.time, TODAY) + P.reports.half, TODAY);
  assert.ok(b0[c] > 0 && Math.abs(bh[c] / b0[c] - 0.5) < 1e-3);
  const far = G.cellIdx[G.cellOf(121.5097, 25.0375)];
  assert.equal(b0[far], 0);
  assert.equal(reportBoost(G, P, [{ ...rp, species: 'roof' }], 0, TODAY)[c], 0, '非溝鼠不進模型');
});

test('猛禽提示：範圍 1 km 內的點才算', () => {
  const [lon, lat] = meta.bounds[0]; // 隨便一個遠點
  const c = G.vCells[G.vIndex.get(V) - 1][0], g = G.cells[c];
  const [clon, clat] = G.lonlatOf(g % G.nx + .5, Math.floor(g / G.nx) + .5);
  const hits = pointsNear(G, [V], [[clon + 0.005, clat], [lon, lat]], 1000);
  assert.equal(hits.length, 1);
});

test('mergeParams：舊設定缺欄位補預設', () => {
  const m = mergeParams({ base: { r: 0.01 }, bogus: 1 });
  assert.equal(m.base.r, 0.01); assert.equal(m.base.kFloor, DEFAULTS.base.kFloor); assert.ok(!('bogus' in m));
});

test('dayOf：以臺北日界計算', () => {
  assert.equal(dayOf('2026-10-10T02:00:00+08:00', TODAY), -14);
  assert.equal(dayOf('2026-10-10T23:59:00+08:00', TODAY), -14);
  assert.equal(dayOf('2026-10-24', TODAY), 0);
});

test('投藥：第二代藥劑撲殺率高於第一代', () => {
  const at = (kind) => { const sim = simulate(G, env, P, [task({ bait: { kind } })], TODAY); return vm(estimate(G, sim, null, dayOf('2026-10-01', TODAY)), V); };
  assert.ok(at('sgar') < at('fgar'));
});
