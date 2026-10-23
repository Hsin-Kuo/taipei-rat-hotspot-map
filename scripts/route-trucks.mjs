// 讓垃圾車沿馬路走：把新工處「寬度超過 8 公尺道路」路面與民政局門牌點烙成 20 m 成本格網，
// 同一車次相鄰停靠點之間用 A* 找最低成本路徑（道路面便宜、門牌巷弄中等、其他地方貴）。
// 只路由公開資料有的部分（停靠點之間），不推估進焚化廠或回程。
// 另記錄每個車次的路徑實際穿過哪些行政區（沿馬路繞行時會切過鄰區邊緣），供擴散層使用。
// 輸出 raw/truck_routes.json（TWD97 公尺座標），build-game-data.mjs 讀它取代直線。
// 這不是真正的路網（沒有單行道等規則），只求畫面上「看起來在馬路上」。
globalThis.self = globalThis;
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import shp from 'shpjs';
import proj4 from 'proj4';
import { parse as parseCsv } from 'csv-parse/sync';
import { TWD97_TM2 } from './lib/twd97.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'raw');
const toTM2 = proj4('EPSG:4326', TWD97_TM2);

// ---------- 參數 ----------
const CELL = 20;                         // 公尺／格
const COST = { road: 1, lane: 2.5, other: 8 }; // 每格成本（相對值）
const BBOX = { x0: 290000, y0: 2752000, x1: 320000, y1: 2790000 }; // 台北市 TWD97 範圍（含餘裕）
const SIMPLIFY_M = 25;                   // 輸出前的 Douglas–Peucker 容差
const CROSS_SAMPLE_M = 60;               // 判斷穿過哪些區時，沿路徑每隔幾公尺取樣一次
const ID = { 大同區: 'DT', 中正區: 'ZZ', 萬華區: 'WH', 大安區: 'DA', 中山區: 'ZS', 松山區: 'SS', 信義區: 'XY', 文山區: 'WS', 內湖區: 'NH', 南港區: 'NG', 士林區: 'SL', 北投區: 'BT' };

const W = Math.ceil((BBOX.x1 - BBOX.x0) / CELL), H = Math.ceil((BBOX.y1 - BBOX.y0) / CELL);
const cost = new Float32Array(W * H).fill(COST.other);
const cx = (x) => Math.floor((x - BBOX.x0) / CELL), cy = (y) => Math.floor((y - BBOX.y0) / CELL);
const inGrid = (i, j) => i >= 0 && j >= 0 && i < W && j < H;
const t0 = Date.now();

// ---------- 1. 門牌點 → 巷弄格（串流讀 116 萬筆） ----------
{
  const rl = createInterface({ input: createReadStream(path.join(RAW, 'taipei_housenum.csv'), 'utf8') });
  let header = null, n = 0;
  for await (const line of rl) {
    if (!header) { header = line.split(','); continue; }
    const cols = line.split(',');
    const x = +cols[9], y = +cols[10];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const i = cx(x), j = cy(y);
    if (inGrid(i, j)) { cost[j * W + i] = COST.lane; n++; }
  }
  console.log(`門牌 ${n} 筆 → 巷弄格  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ---------- 2. 道路面 → 道路格（掃描線填滿 + 膨脹一格） ----------
{
  const fc = await shp(await readFile(path.join(RAW, 'road8m.zip')));
  const roadCells = new Uint8Array(W * H);
  let polys = 0;
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
    for (const ring of rings) {
      const pts = ring.map(([lon, lat]) => toTM2.forward([lon, lat]));
      let minY = Infinity, maxY = -Infinity;
      for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
      for (let j = Math.max(0, cy(minY)); j <= Math.min(H - 1, cy(maxY)); j++) {
        const yc = BBOX.y0 + (j + 0.5) * CELL;
        const xs = [];
        for (let k = 0, m = pts.length - 1; k < pts.length; m = k++) {
          const [xa, ya] = pts[k], [xb, yb] = pts[m];
          if ((ya > yc) !== (yb > yc)) xs.push(xa + (yc - ya) * (xb - xa) / (yb - ya));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, cx(xs[k])); i <= Math.min(W - 1, cx(xs[k + 1])); i++) roadCells[j * W + i] = 1;
      }
      // 細路面可能填不到任何格心：至少把頂點所在格標起來
      for (const [x, y] of pts) { const i = cx(x), j = cy(y); if (inGrid(i, j)) roadCells[j * W + i] = 1; }
    }
    polys++;
  }
  let n = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (roadCells[j * W + i]) {
    n++;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (inGrid(i + di, j + dj)) cost[(j + dj) * W + i + di] = Math.min(cost[(j + dj) * W + i + di], (di || dj) ? COST.lane : COST.road);
  }
  console.log(`道路面 ${polys} 個 → 道路格 ${n}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ---------- 3. A*（8 方向，二元堆） ----------
class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) { const k = this.k, v = this.v; k.push(key); v.push(val); let i = k.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } }
  pop() { const k = this.k, v = this.v; const top = v[0]; const lk = k.pop(), lv = v.pop(); if (k.length) { k[0] = lk; v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; } } return top; }
  get size() { return this.k.length; }
}
const g = new Float32Array(W * H), closed = new Uint8Array(W * H), came = new Int32Array(W * H);
const touched = [];
function astar(ax, ay, bx, by) {
  const si = cx(ax), sj = cy(ay), ti = cx(bx), tj = cy(by);
  if (!inGrid(si, sj) || !inGrid(ti, tj)) return [[ax, ay], [bx, by]];
  const s = sj * W + si, t = tj * W + ti;
  if (s === t) return [[ax, ay], [bx, by]];
  for (const n of touched) { g[n] = 0; closed[n] = 0; came[n] = 0; }
  touched.length = 0;
  const open = new Heap();
  g[s] = 0; came[s] = -1; touched.push(s);
  const h = (n) => Math.hypot((n % W) - ti, Math.floor(n / W) - tj) * COST.road;
  open.push(h(s), s);
  let found = false, expanded = 0;
  while (open.size) {
    const n = open.pop();
    if (closed[n]) continue;
    closed[n] = 1; expanded++;
    if (n === t) { found = true; break; }
    if (expanded > 400000) break; // 安全閥
    const i = n % W, j = (n - i) / W;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (!inGrid(ni, nj)) continue;
      const m = nj * W + ni;
      if (closed[m]) continue;
      const step = (di && dj ? Math.SQRT2 : 1) * (cost[m] + cost[n]) / 2;
      const ng = g[n] + step;
      if (!came[m] && m !== s) { came[m] = n; g[m] = ng; touched.push(m); open.push(ng + h(m), m); }
      else if (ng < g[m]) { came[m] = n; g[m] = ng; open.push(ng + h(m), m); }
    }
  }
  if (!found) return [[ax, ay], [bx, by]];
  const cells = [];
  for (let n = t; n !== -1 && n !== s; n = came[n]) cells.push(n);
  cells.push(s); cells.reverse();
  const pts = cells.map((n) => [BBOX.x0 + ((n % W) + 0.5) * CELL, BBOX.y0 + (Math.floor(n / W) + 0.5) * CELL]);
  pts[0] = [ax, ay]; pts[pts.length - 1] = [bx, by];
  return simplify(pts, SIMPLIFY_M);
}
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [xa, ya] = pts[a], [xb, yb] = pts[b]; const vx = xb - xa, vy = yb - ya, L2 = vx * vx + vy * vy || 1;
    for (let k = a + 1; k < b; k++) { const [x, y] = pts[k]; const tt = Math.max(0, Math.min(1, ((x - xa) * vx + (y - ya) * vy) / L2)); const d = Math.hypot(x - xa - vx * tt, y - ya - vy * tt); if (d > maxD) { maxD = d; idx = k; } }
    if (maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// ---------- 4. 讀停靠點，排車次，逐段路由 ----------
const rows = parseCsv(await readFile(path.join(RAW, 'garbage_trucks.csv'), 'utf8'), { columns: true, bom: true, skip_empty_lines: true });
const coord = (v) => { const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/); return m ? +m[0] : NaN; };
const tripMap = new Map();
for (const r of rows) {
  const lon = coord(r['經度']), lat = coord(r['緯度']), id = ID[r['行政區']];
  if (!id || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
  const key = `${r['車號']}|${r['路線']}|${r['車次']}`;
  if (!tripMap.has(key)) tripMap.set(key, { truck: r['車號'], route: r['路線'], trip: r['車次'], district: id, stops: [] });
  tripMap.get(key).stops.push({ t: +r['抵達時間'], xy: toTM2.forward([lon, lat]) });
}

// 行政區多邊形（dist/data/districts.geojson，WGS84）→ 判斷路徑穿過哪些區
const districtsFc = JSON.parse(await readFile(path.join(ROOT, 'dist', 'data', 'districts.geojson'), 'utf8'));
const dPolys = districtsFc.features.map((f) => ({ id: ID[f.properties.name], rings: (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => poly.map((ring) => ring.map(([lon, lat]) => toTM2.forward([lon, lat])))) }));
for (const d of dPolys) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const poly of d.rings) for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } d.bbox = [x0, y0, x1, y1]; }
const inRing = (ring, x, y) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) inside = !inside; } return inside; };
function districtAt(x, y) {
  for (const d of dPolys) {
    if (x < d.bbox[0] || x > d.bbox[2] || y < d.bbox[1] || y > d.bbox[3]) continue;
    for (const poly of d.rings) if (inRing(poly[0], x, y) && !poly.slice(1).some((h) => inRing(h, x, y))) return d.id;
  }
  return null;
}
function crossedDistricts(pts) {
  const seen = new Set();
  for (let k = 1; k < pts.length; k++) {
    const [xa, ya] = pts[k - 1], [xb, yb] = pts[k];
    const n = Math.max(1, Math.ceil(Math.hypot(xb - xa, yb - ya) / CROSS_SAMPLE_M));
    for (let i = 0; i <= n; i++) { const d = districtAt(xa + (xb - xa) * i / n, ya + (yb - ya) * i / n); if (d) seen.add(d); }
  }
  return [...seen];
}

const cache = new Map();
const route = (a, b) => { const key = `${a[0].toFixed(0)},${a[1].toFixed(0)}>${b[0].toFixed(0)},${b[1].toFixed(0)}`; let r = cache.get(key); if (!r) { r = astar(a[0], a[1], b[0], b[1]); cache.set(key, r); } return r; };
const trucks = new Map();
let legs = 0, straightKm = 0, routedKm = 0, crossTrips = 0;
const len = (pts) => { let s = 0; for (let k = 1; k < pts.length; k++) s += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return s; };
const trips = [...tripMap.values()].sort((a, b) => a.truck.localeCompare(b.truck) || a.stops[0].t - b.stops[0].t);
for (const t of trips) {
  t.stops.sort((a, b) => a.t - b.t);
  if (!trucks.has(t.truck)) trucks.set(t.truck, { id: t.truck, district: t.district, trips: [] });
  const out = [t.stops[0].xy];
  const stopIdx = [0]; // 每個停靠點在 out 中的頂點索引（A* 的每段路徑頭尾就是停靠點，簡化時會保留）
  for (let k = 1; k < t.stops.length; k++) {
    const a = t.stops[k - 1].xy, b = t.stops[k].xy;
    const p = route(a, b); straightKm += Math.hypot(b[0] - a[0], b[1] - a[1]); routedKm += len(p); legs++; out.push(...p.slice(1));
    stopIdx.push(out.length - 1);
  }
  const crossed = crossedDistricts(out).filter((d) => d !== t.district);
  if (crossed.length) crossTrips++;
  trucks.get(t.truck).trips.push({ start: t.stops[0].t, end: t.stops[t.stops.length - 1].t, route: t.route, crossed, stopIdx, pts: out.map(([x, y]) => [Math.round(x), Math.round(y)]) });
  if (legs % 500 < t.stops.length) console.log(`  ${legs} 段  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
const outFile = path.join(RAW, 'truck_routes.json');
await writeFile(outFile, JSON.stringify({ builtAt: new Date().toISOString(), cellM: CELL, cost: COST, trucks: [...trucks.values()] }));
console.log(`完成：${trucks.size} 台車、${trips.length} 車次、${legs} 段，直線 ${(straightKm / 1000).toFixed(0)} km → 路由 ${(routedKm / 1000).toFixed(0)} km；${crossTrips} 個車次沿路切過鄰區。寫入 ${path.relative(ROOT, outFile)}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
