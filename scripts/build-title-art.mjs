// 遊戲入口畫面背景（1920×1080）：全部用本專案資料合成。
//   1. Copernicus Sentinel-2 L2A 真彩色（AWS 公開鏡像），壓暗、去飽和、偏冷色
//   2. dist/data/heat.png：鼠患環境熱力（下水道、夜市、餐飲、垃圾車…）當「燃燒的城市」光暈
//   3. raw/truck_routes.json：垃圾車沿路路徑，琥珀細光
//   4. raw/mrt_routes.json：捷運路線，各線代表色細光
//   5. 行政區界淡線、左側壓暗（放標題）、暗角
// 輸出 dist/data/title.jpg 與 title.json。授權標示同衛星底圖：Contains modified Copernicus Sentinel data <年份>。
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { PNG } from 'pngjs';
import { fromUrl } from 'geotiff';
import { TWD97_TM2 } from './lib/twd97.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'dist', 'data'), RAW = path.join(ROOT, 'raw');
const W = 1920, H = 1080;
const M_PER_PX = 30;                 // 1080 px 高 ≈ 32 km
const CITY_AT = 0.64;                // 台北市中心放在畫面寬度的這個比例
const wgsToTm2 = proj4('EPSG:4326', TWD97_TM2);

// ---------- 畫面座標 ----------
const districts = JSON.parse(await readFile(path.join(DATA, 'districts.geojson'), 'utf8'));
let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
for (const f of districts.features) for (const poly of f.geometry.coordinates) for (const [lon, lat] of poly[0]) {
  const [x, y] = wgsToTm2.forward([lon, lat]); bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
}
const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
const X0 = cx - CITY_AT * W * M_PER_PX, Y1 = cy + 0.5 * H * M_PER_PX; // 左上角的 TM2
const toPx = (x, y) => [(x - X0) / M_PER_PX, (Y1 - y) / M_PER_PX];
const fromPx = (u, v) => [X0 + u * M_PER_PX, Y1 - v * M_PER_PX];

const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H);

// ---------- 1. 衛星底 ----------
const sat = JSON.parse(await readFile(path.join(DATA, 'satellite.json'), 'utf8').catch(() => 'null'));
const STAC = 'https://earth-search.aws.element84.com/v1/search';
const body = sat?.scene ? { collections: ['sentinel-2-l2a'], ids: [sat.scene] } : { collections: ['sentinel-2-l2a'], bbox: [121.45, 24.96, 121.67, 25.21], limit: 10, query: { 'eo:cloud_cover': { lt: 0.1 } }, sortby: [{ field: 'properties.datetime', direction: 'desc' }] };
const item = (await (await fetch(STAC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()).features[0];
if (!item) throw new Error('找不到 Sentinel-2 影像');
const year = item.properties.datetime.slice(0, 4);
const epsg = item.properties['proj:epsg'] ?? item.properties['proj:code']?.split(':')[1];
const tm2ToUtm = proj4(TWD97_TM2, `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`);
const img = await (await fromUrl(item.assets.visual.href)).getImage();
const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
for (const [u, v] of [[0, 0], [W, 0], [0, H], [W, H]]) { const [a, b] = tm2ToUtm.forward(fromPx(u, v)); ux0 = Math.min(ux0, a); uy0 = Math.min(uy0, b); ux1 = Math.max(ux1, a); uy1 = Math.max(uy1, b); }
const win = [Math.max(0, Math.floor((ux0 - ox) / rx)), Math.max(0, Math.floor((uy1 - oy) / ry)), Math.min(img.getWidth(), Math.ceil((ux1 - ox) / rx)), Math.min(img.getHeight(), Math.ceil((uy0 - oy) / ry))];
const SUB = 2; // 讀成 20 m 解析度就夠（輸出 30 m/px）
const ww = Math.ceil((win[2] - win[0]) / SUB), wh = Math.ceil((win[3] - win[1]) / SUB);
console.log(`衛星：${item.id}，讀取 ${win[2] - win[0]}×${win[3] - win[1]} px → ${ww}×${wh}…`);
const rgb = await img.readRasters({ window: win, width: ww, height: wh, interleave: true, samples: [0, 1, 2], resampleMethod: 'bilinear' });
const sx = (win[2] - win[0]) / ww, sy = (win[3] - win[1]) / wh;
for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
  const [ea, nb] = tm2ToUtm.forward(fromPx(u + 0.5, v + 0.5));
  const fx = ((ea - ox) / rx - win[0]) / sx - 0.5, fy = ((nb - oy) / ry - win[1]) / sy - 0.5;
  const i = v * W + u;
  if (fx < 0 || fy < 0 || fx > ww - 1 || fy > wh - 1) { R[i] = 10; G[i] = 13; B[i] = 17; continue; }
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const s = (c) => { const p = (yy, xx) => rgb[(yy * ww + xx) * 3 + c]; return (p(y0, x0) * (1 - tx) + p(y0, x0 + 1) * tx) * (1 - ty) + (p(y0 + 1, x0) * (1 - tx) + p(y0 + 1, x0 + 1) * tx) * ty; };
  const r = s(0), g = s(1), b = s(2), L = 0.299 * r + 0.587 * g + 0.114 * b;
  // 壓暗、去飽和、偏冷
  const k = (c) => (L + (c - L) * 0.3) * 0.42;
  R[i] = k(r) * 0.85 + 10 * 0.15; G[i] = k(g) * 0.85 + 13 * 0.15; B[i] = k(b) * 0.85 + 20 * 0.15 + 3;
}

// ---------- 2. 鼠患熱力光暈 ----------
const heatMeta = JSON.parse(await readFile(path.join(DATA, 'heat.json'), 'utf8'));
const heat = PNG.sync.read(await readFile(path.join(DATA, 'heat.png')));
const [hx0, hy0] = wgsToTm2.forward(heatMeta.bounds[0]);           // 西南角
const hcell = heatMeta.cell;
for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
  const [x, y] = fromPx(u + 0.5, v + 0.5);
  const hu = (x - hx0) / hcell, hv = heat.height - (y - hy0) / hcell;
  if (hu < 0 || hv < 0 || hu >= heat.width - 1 || hv >= heat.height - 1) continue;
  const o = ((hv | 0) * heat.width + (hu | 0)) * 4, a = heat.data[o + 3] / 255;
  if (a <= 0) continue;
  const i = v * W + u, gain = 1.1;
  R[i] += heat.data[o] * a * gain; G[i] += heat.data[o + 1] * a * gain * 0.85; B[i] += heat.data[o + 2] * a * gain * 0.7;
}

// ---------- 3–4. 路線細光（沿線取樣、高斯點） ----------
function glowLine(pts, [r, g, b], strength, sigma = 1.1, stepM = 12) {
  const rad = Math.ceil(sigma * 2.5), w = [];
  for (let d = -rad; d <= rad; d++) w.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
  for (let k = 1; k < pts.length; k++) {
    const [xa, ya] = pts[k - 1], [xb, yb] = pts[k], L = Math.hypot(xb - xa, yb - ya), n = Math.max(1, Math.ceil(L / stepM));
    for (let s = 0; s <= n; s++) {
      const [pu, pv] = toPx(xa + (xb - xa) * s / n, ya + (yb - ya) * s / n);
      const iu = Math.round(pu), iv = Math.round(pv);
      for (let dv = -rad; dv <= rad; dv++) for (let du = -rad; du <= rad; du++) {
        const u = iu + du, v = iv + dv; if (u < 0 || v < 0 || u >= W || v >= H) continue;
        const f = strength * w[du + rad] * w[dv + rad] * (stepM / M_PER_PX), i = v * W + u;
        R[i] += r * f; G[i] += g * f; B[i] += b * f;
      }
    }
  }
}
const trucks = JSON.parse(await readFile(path.join(RAW, 'truck_routes.json'), 'utf8'));
let nTrips = 0;
for (const tk of trucks.trucks) for (const tr of tk.trips) { glowLine(tr.pts, [242, 179, 61], 0.16, 0.9); nTrips++; }
const LINE_COLOR = { 淡水線: '#E3002C', 信義線: '#E3002C', 信義線東延段: '#E3002C', 新店線: '#008659', 小南門線: '#008659', 碧潭支線: '#008659', 松山線: '#008659', 中和線: '#F8B61C', 蘆洲線: '#F8B61C', 新莊線: '#F8B61C', 板橋線: '#0070BD', 南港線: '#0070BD', 土城線: '#0070BD', 木柵線: '#C48C31', 內湖線: '#C48C31', 環狀線: '#FFDB00' };
const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const mrt = JSON.parse((await readFile(path.join(RAW, 'mrt_routes.json'), 'utf8')).replace(/^﻿/, ''));
for (const f of mrt.features) {
  const c = LINE_COLOR[f.properties.RouteName]; if (!c) continue;
  for (const part of f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates) glowLine(part, hex(c), 0.2, 1.1);
}

// ---------- 5. 區界淡線、左側壓暗、暗角 ----------
for (const f of districts.features) for (const poly of f.geometry.coordinates) glowLine(poly[0].map(([lon, lat]) => wgsToTm2.forward([lon, lat])), [232, 225, 210], 0.12, 0.7, 10);
const png = new PNG({ width: W, height: H, colorType: 2 });
for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
  const i = v * W + u, o = i * 4;
  const left = Math.min(1, Math.max(0, (u / W - 0.08) / 0.42));         // 0 → 1，左側 8%–50% 漸亮
  const dx = (u / W - CITY_AT) * 1.25, dy = (v / H - 0.5);
  const vig = Math.max(0.25, 1 - 0.75 * (dx * dx + dy * dy));            // 以城市為中心的暗角
  const m = (0.28 + 0.72 * left * left) * vig;
  // 柔和的高光壓縮，避免熱點過曝
  const tone = (c) => 255 * (1 - Math.exp(-(c * m) / 210));
  png.data[o] = Math.min(255, tone(R[i])); png.data[o + 1] = Math.min(255, tone(G[i])); png.data[o + 2] = Math.min(255, tone(B[i])); png.data[o + 3] = 255;
}
const pngFile = path.join(DATA, 'title.png'), jpgFile = path.join(DATA, 'title.jpg');
await writeFile(pngFile, PNG.sync.write(png));
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', pngFile, '--out', jpgFile], { stdio: 'ignore' });
await writeFile(path.join(DATA, 'title.json'), JSON.stringify({ file: 'title.jpg', width: W, height: H, cityAt: CITY_AT, scene: item.id, attribution: `Contains modified Copernicus Sentinel data ${year}`, layers: ['Sentinel-2 L2A TCI', 'heat.png', `垃圾車路徑 ${nTrips} 車次`, '捷運路網', '行政區界'], builtAt: new Date().toISOString() }, null, 2));
console.log(`輸出 ${path.relative(ROOT, jpgFile)}：${W}×${H}，${((await readFile(jpgFile)).length / 1024).toFixed(0)} KB`);
