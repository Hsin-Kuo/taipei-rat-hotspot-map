// 管理工具用的 100 m 網格 + 里界（讀 build.mjs 的輸出，不重跑整個建置）
// 輸出：
//   dist/data/villages.geojson  456 里（code=10 碼村里代碼、name、district）
//   dist/data/grid.json         網格中繼資料（TM2 原點、格數、四角經緯度、因子清單、里代碼表）
//   dist/data/grid.bin          Uint16 ×N 里索引（0 = 市外）｜補齊 4-byte｜ Float32 ×N ×因子數（每格原始量，未模糊）
// 前端依設定頁的「範圍（σ）、強度、飽和」即時把原始量模糊、加權成承載量 K。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import shp from 'shpjs';
import proj4 from 'proj4';
import * as turf from '@turf/turf';
import { TWD97_TM2 } from './lib/twd97.mjs';

const RAW = path.resolve('raw'), OUT = path.resolve('dist/data');
const CELL = 100;
const BOUNDARY_VERSION = '2026-09';     // 里界版本（民政局 SHP 下載時點），任務範圍會記錄此值
const toTM2 = proj4('EPSG:4326', TWD97_TM2);
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const load = async (f) => JSON.parse(await readFile(path.join(OUT, f), 'utf8'));

// ---------- 里界 ----------
const li = await shp(await readFile(path.join(RAW, 'li_boundary.zip')));
const villages = li.features.map(f => {
  const p = f.properties;
  // 原始 SHP 有少數退化 ring（< 4 點），simplify 會丟例外 → 先剔除
  const polys = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates])
    .map(rings => rings.filter(r => new Set(r.map(p => p.join())).size >= 3)).filter(rings => rings.length);
  const feat = turf.truncate(turf.simplify(turf.multiPolygon(polys), { tolerance: 0.00002, highQuality: true }), { precision: 6, mutate: true });
  const c = turf.centerOfMass(feat).geometry.coordinates.map(r6);
  feat.properties = { code: String(p.CPTVID), name: p.VNAME, district: p.TNAME, areaKm2: +(p.AREA / 1e6).toFixed(3), centroid: c };
  return feat;
}).sort((a, b) => a.properties.code.localeCompare(b.properties.code));
await writeFile(path.join(OUT, 'villages.geojson'), JSON.stringify({ type: 'FeatureCollection', boundaryVersion: BOUNDARY_VERSION, features: villages }));

// ---------- 網格範圍（市界 bbox，TM2 對齊 100 m） ----------
const city = await load('city.geojson');
const [bx0, by0, bx1, by1] = turf.bbox(city);
const c0 = toTM2.forward([bx0, by0]), c1 = toTM2.forward([bx1, by1]), c2 = toTM2.forward([bx0, by1]), c3 = toTM2.forward([bx1, by0]);
const x0 = Math.floor(Math.min(c0[0], c2[0]) / CELL) * CELL - CELL, y0 = Math.floor(Math.min(c0[1], c3[1]) / CELL) * CELL - CELL;
const nx = Math.ceil((Math.max(c1[0], c3[0]) - x0) / CELL) + 1, ny = Math.ceil((Math.max(c1[1], c2[1]) - y0) / CELL) + 1;
const N = nx * ny;

// ---------- 里索引光柵（格心落在哪個里；1-based，0 = 市外） ----------
const vid = new Uint16Array(N);
const centerLL = (i, j) => toTM2.inverse([x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL]);
villages.forEach((v, k) => {
  const [lo0, la0, lo1, la1] = turf.bbox(v);
  const a = toTM2.forward([lo0, la0]), b = toTM2.forward([lo1, la1]);
  const i0 = Math.max(0, Math.floor((a[0] - x0) / CELL) - 1), i1 = Math.min(nx - 1, Math.ceil((b[0] - x0) / CELL) + 1);
  const j0 = Math.max(0, Math.floor((a[1] - y0) / CELL) - 1), j1 = Math.min(ny - 1, Math.ceil((b[1] - y0) / CELL) + 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (vid[j * nx + i]) continue;
    if (turf.booleanPointInPolygon(centerLL(i, j), v)) vid[j * nx + i] = k + 1;
  }
});
// 小於一格的里可能一格都沒分到：把里中心所在格指給它，確保每個里至少一格
let tiny = 0;
villages.forEach((v, k) => {
  if (vid.includes(k + 1)) return;
  const [x, y] = toTM2.forward(v.properties.centroid);
  vid[Math.floor((y - y0) / CELL) * nx + Math.floor((x - x0) / CELL)] = k + 1; tiny++;
});

// ---------- 環境因子原始量（權重規則與 build.mjs 熱力相同：餐飲 = √同門牌店數，其餘每點 1） ----------
const FACTORS = {
  sewer:   { label: '污水人孔', pts: (await load('sewer_manholes.json')).map(p => [p[0], p[1], 1]) },
  storm:   { label: '雨水人孔', pts: (await load('storm_manholes.json')).map(p => [p[0], p[1], 1]) },
  market:  { label: '攤販集中場', pts: (await load('markets.json')).map(m => [m.lon, m.lat, 1]) },
  tmarket: { label: '傳統市場', pts: (await load('markets_trad.json')).map(m => [m.lon, m.lat, 1]) },
  food:    { label: '餐飲業者', pts: (await load('food.json')).map(p => [p[0], p[1], Math.sqrt(p[2])]) },
  garbage: { label: '垃圾車停靠點', pts: (await load('garbage_stops.json')).map(p => [p[0], p[1], 1]) },
};
const keys = Object.keys(FACTORS);
const vals = keys.map(() => new Float32Array(N));
const stats = {};
keys.forEach((k, fi) => {
  let inside = 0, sum = 0;
  for (const [lon, lat, w] of FACTORS[k].pts) {
    const [x, y] = toTM2.forward([lon, lat]);
    const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
    vals[fi][j * nx + i] += w; inside++; sum += w;
  }
  stats[k] = { label: FACTORS[k].label, points: FACTORS[k].pts.length, inGrid: inside, sum: +sum.toFixed(1) };
});

// ---------- 寫檔 ----------
const fOff = Math.ceil(N * 2 / 4) * 4;          // Float32 區段需 4-byte 對齊
const buf = Buffer.alloc(fOff + N * 4 * keys.length);
Buffer.from(vid.buffer).copy(buf, 0);
keys.forEach((k, fi) => Buffer.from(vals[fi].buffer).copy(buf, fOff + N * 4 * fi));
await writeFile(path.join(OUT, 'grid.bin'), buf);
const corner = (x, y) => toTM2.inverse([x, y]).map(r6);
await writeFile(path.join(OUT, 'grid.json'), JSON.stringify({
  cell: CELL, nx, ny, x0, y0, crs: 'EPSG:3826',
  // 四角（左下、左上、右上、右下）經緯度；格 (i,j) 中 j=0 在南
  bounds: [corner(x0, y0), corner(x0, y0 + ny * CELL), corner(x0 + nx * CELL, y0 + ny * CELL), corner(x0 + nx * CELL, y0)],
  layout: { vid: 'uint16', factors: 'float32', factorsOffset: fOff, order: keys },
  factors: stats,
  villages: villages.map(v => v.properties.code),
  boundaryVersion: BOUNDARY_VERSION,
}));
const cityCells = vid.reduce((a, v) => a + (v > 0), 0);
console.log(`villages ${villages.length}（${tiny} 個小里以中心格補上）；grid ${nx}×${ny} = ${N} 格，市內 ${cityCells} 格；grid.bin ${(buf.length / 1e6).toFixed(2)} MB`);
console.table(stats);
