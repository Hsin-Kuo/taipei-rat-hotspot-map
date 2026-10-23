// 3D 模型頂面貼圖：Copernicus Sentinel-2 L2A 真彩色（10 m）為底，依臺北市都市計畫使用分區圖分類上色，做成「動畫城市」風格。
//   1. 讀取與遊戲衛星底圖同一景影像（satellite.json 的 scene），重投影到經緯度格網（對齊 model.html 的 uv）
//   2. 使用分區（細部計畫，15,518 個多邊形，TWD97、屬性 Big5）柵格化成類別：山林／綠地／水域／機場／市區；
//      市界內沒有被任何分區覆蓋的像素多為道路，再以衛星顏色區分道路與植被
//   3. 以「亮度 → 色階」重新著色（保留衛星的明暗細節），各類別用不同色階與混合比例
// 輸出 dist/data/model_texture.jpg 與 model_texture.json
// 授權：Contains modified Copernicus Sentinel data <年份>；使用分區圖為政府資料開放授權條款第 1 版
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { PNG } from 'pngjs';
import { fromUrl } from 'geotiff';
import JSZip from 'jszip';
import { parseShp, parseDbf } from 'shpjs';
import { TWD97_TM2 } from './lib/twd97.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'dist', 'data');
const STAC = 'https://earth-search.aws.element84.com/v1/search';
const RES = 0.0001;                                   // 輸出解析度（度），約 10 m，與 Sentinel-2 原生解析度相當
const ZONING_ZIP = path.join(ROOT, 'raw', 'city3d', 'zoning_detail.zip');

// ---------- 0. 範圍：市界外擴少許 ----------
const city = JSON.parse(await readFile(path.join(DATA, 'city.geojson'), 'utf8'));
const cityPolys = (city.geometry ?? city).type === 'MultiPolygon' ? (city.geometry ?? city).coordinates : [(city.geometry ?? city).coordinates];
let W = 180, S = 90, E = -180, N = -90;
for (const p of cityPolys) for (const [x, y] of p[0]) { W = Math.min(W, x); E = Math.max(E, x); S = Math.min(S, y); N = Math.max(N, y); }
W -= 0.002; S -= 0.002; E += 0.002; N += 0.002;
const OW = Math.round((E - W) / RES), OH = Math.round((N - S) / RES);
E = W + OW * RES; S = N - OH * RES;
console.log(`輸出格網 ${OW}×${OH}（${RES}°）`);

// ---------- 1. 影像 ----------
let sceneId = process.argv[2];
if (!sceneId) { try { sceneId = JSON.parse(await readFile(path.join(DATA, 'satellite.json'), 'utf8')).scene; } catch {} }
const body = sceneId ? { collections: ['sentinel-2-l2a'], ids: [sceneId] }
  : { collections: ['sentinel-2-l2a'], bbox: [W, S, E, N], limit: 20, query: { 'eo:cloud_cover': { lt: 1 } }, sortby: [{ field: 'properties.datetime', direction: 'desc' }] };
const res = await fetch(STAC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
if (!res.ok) throw new Error(`STAC ${res.status}`);
const item = (await res.json()).features.find(f => f.assets.visual);
if (!item) throw new Error('找不到 Sentinel-2 影像');
const date = item.properties.datetime.slice(0, 10), year = date.slice(0, 4);
console.log(`影像：${item.id}（${date}，雲量 ${item.properties['eo:cloud_cover'].toFixed(3)}%）`);
const epsg = item.properties['proj:epsg'] ?? item.properties['proj:code']?.split(':')[1];
const toUtm = proj4('EPSG:4326', `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`);
const tiff = await fromUrl(item.assets.visual.href);
const img = await tiff.getImage();
const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
for (const [x, y] of [[W, S], [W, N], [E, S], [E, N], [(W + E) / 2, S], [(W + E) / 2, N]]) { const [ux, uy] = toUtm.forward([x, y]); ux0 = Math.min(ux0, ux); uy0 = Math.min(uy0, uy); ux1 = Math.max(ux1, ux); uy1 = Math.max(uy1, uy); }
const win = [Math.max(0, Math.floor((ux0 - ox) / rx) - 2), Math.max(0, Math.floor((uy1 - oy) / ry) - 2), Math.min(img.getWidth(), Math.ceil((ux1 - ox) / rx) + 2), Math.min(img.getHeight(), Math.ceil((uy0 - oy) / ry) + 2)];
const t0 = Date.now();
const rgb = await img.readRasters({ window: win, interleave: true, samples: [0, 1, 2] });
const ww = win[2] - win[0], wh = win[3] - win[1];
console.log(`  讀取 ${ww}×${wh} px（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
const sample = (fx, fy, c) => {
  const x0 = Math.max(0, Math.min(ww - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(wh - 2, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0)), i = (y, x) => rgb[(y * ww + x) * 3 + c];
  return (i(y0, x0) * (1 - tx) + i(y0, x0 + 1) * tx) * (1 - ty) + (i(y0 + 1, x0) * (1 - tx) + i(y0 + 1, x0 + 1) * tx) * ty;
};
const R0 = new Float32Array(OW * OH * 3);
for (let v = 0; v < OH; v++) for (let u = 0; u < OW; u++) {
  const [ux, uy] = toUtm.forward([W + (u + .5) * RES, N - (v + .5) * RES]);
  const fx = (ux - ox) / rx - win[0] - .5, fy = (uy - oy) / ry - win[1] - .5, o = (v * OW + u) * 3;
  R0[o] = sample(fx, fy, 0); R0[o + 1] = sample(fx, fy, 1); R0[o + 2] = sample(fx, fy, 2);
}

// ---------- 2. 柵格化（掃描線、偶奇規則） ----------
function fillPolys(target, value, rings, px) {   // rings：同一多邊形的所有環（經緯度）；px：經緯度 → [u, v]
  const pr = rings.map(r => r.map(px)); let vmin = Infinity, vmax = -Infinity;
  for (const r of pr) for (const [, y] of r) { vmin = Math.min(vmin, y); vmax = Math.max(vmax, y); }
  for (let v = Math.max(0, Math.floor(vmin)); v <= Math.min(OH - 1, Math.ceil(vmax)); v++) {
    const sy = v + .5, xs = [];
    for (const r of pr) for (let k = 0, m = r.length - 1; k < r.length; m = k++) { const [xa, ya] = r[k], [xb, yb] = r[m]; if ((ya > sy) !== (yb > sy)) xs.push(xa + (sy - ya) * (xb - xa) / (yb - ya)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let u = Math.max(0, Math.ceil(xs[k] - .5)); u <= Math.min(OW - 1, Math.floor(xs[k + 1] - .5)); u++) target[v * OW + u] = value;
  }
}
const lonlatPx = ([x, y]) => [(x - W) / RES, (N - y) / RES];
const inCity = new Uint8Array(OW * OH);
for (const p of cityPolys) fillPolys(inCity, 1, p, lonlatPx);

// 類別：0 未覆蓋、1 市區、2 機場、3 綠地、4 山林、5 水域
const C = { NONE: 0, URBAN: 1, AIRPORT: 2, PARK: 3, FOREST: 4, WATER: 5 };
const classOf = (name) => {
  if (!name || /規劃範圍|計畫範圍/.test(name)) return -1;
  if (/河川|行水區|河道|排水溝|水溝|溝渠|防洪|沉砂池|水利設施/.test(name)) return C.WATER;
  if (/保護區|陽明山公園|農業區|風景區|保存區$|休閒農業|露營|溫泉|遊樂區|娛樂區|動物園|公墓|軍人公墓/.test(name)) return C.FOREST;
  if (/公園|綠地|綠帶|兒童遊樂|體育場|中正紀念堂/.test(name)) return C.PARK;
  if (/機場/.test(name)) return C.AIRPORT;
  return C.URBAN;
};
const zip = await JSZip.loadAsync(await readFile(ZONING_ZIP));
const shpName = Object.keys(zip.files).filter(n => n.endsWith('.shp')).sort((a, b) => zip.files[b]._data.uncompressedSize - zip.files[a]._data.uncompressedSize)[0].slice(0, -4);
const geoms = parseShp(await zip.file(shpName + '.shp').async('arraybuffer'));
const rows = parseDbf(await zip.file(shpName + '.dbf').async('arraybuffer'), 'big5');
const tm2ToLL = proj4(TWD97_TM2, 'EPSG:4326');
const tmPx = ([x, y]) => lonlatPx(tm2ToLL.forward([x, y]));
const cls = new Uint8Array(OW * OH);
const order = [C.URBAN, C.AIRPORT, C.PARK, C.FOREST, C.WATER];   // 後畫覆蓋先畫
const byClass = new Map(order.map(c => [c, []]));
rows.forEach((r, i) => { const c = classOf(r['使用分區'] || r['分區簡稱']); if (c >= 0) byClass.get(c).push(geoms[i]); });
for (const c of order) for (const g of byClass.get(c)) { const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; for (const p of polys) fillPolys(cls, c, p, tmPx); }
console.log('  分區多邊形：', Object.fromEntries(order.map(c => [Object.keys(C).find(k => C[k] === c), byClass.get(c).length])));

// ---------- 3. 調色 ----------
// 3a. 市界內自動色階（1%、99.5% 百分位）
const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]; let n = 0;
for (let i = 0; i < OW * OH; i++) if (inCity[i]) { n++; for (let c = 0; c < 3; c++) hist[c][Math.max(0, Math.min(255, Math.round(R0[i * 3 + c])))]++; }
const pct = (h, p) => { let s = 0; for (let k = 0; k < 256; k++) { s += h[k]; if (s >= n * p) return k; } return 255; };
const lo = hist.map(h => pct(h, .01)), hi = hist.map(h => pct(h, .995));
// 3b. 色階（亮度 0..1 → 顏色）：動畫風格、偏暖、飽和
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ramp = (stops) => { const s = stops.map(hex); return (t) => { t = Math.min(.999, Math.max(0, t)) * (s.length - 1); const i = Math.floor(t), f = t - i; return [0, 1, 2].map(k => s[i][k] + (s[i + 1][k] - s[i][k]) * f); }; };
const PAL = {
  urban:   { ramp: ramp(['#6f6a63', '#b9ab98', '#e9dcc6', '#fbf4e6']), mix: .45 },
  road:    { ramp: ramp(['#8d8a84', '#d8d3c8', '#f1ede4']), mix: .7 },
  airport: { ramp: ramp(['#7c8186', '#c4c9cc', '#e6e9ea']), mix: .6 },
  park:    { ramp: ramp(['#2f6b2c', '#5fa83f', '#9fd36a', '#d4ef9c']), mix: .62 },
  forest:  { ramp: ramp(['#173d22', '#2f6a35', '#4f9145', '#8cc070']), mix: .6 },
  veg:     { ramp: ramp(['#244f2a', '#4f9145', '#93c76c']), mix: .55 },
  water:   { ramp: ramp(['#1d5d93', '#2f86c4', '#62b4e2', '#a9dcf2']), mix: .82 },
  bank:    { ramp: ramp(['#8f8a74', '#cfc6a8', '#ece4cc']), mix: .5 },
};
const png = new PNG({ width: OW, height: OH, colorType: 2 });
const area = {}; const px2 = (RES * 111.32 * Math.cos(25.07 * Math.PI / 180)) * (RES * 110.574);
for (let i = 0; i < OW * OH; i++) {
  let r = (R0[i * 3] - lo[0]) / (hi[0] - lo[0]) * 255, g = (R0[i * 3 + 1] - lo[1]) / (hi[1] - lo[1]) * 255, b = (R0[i * 3 + 2] - lo[2]) / (hi[2] - lo[2]) * 255;
  const L = Math.min(1, Math.max(0, (.299 * r + .587 * g + .114 * b) / 255));
  const veg = g > r * 1.04 && g > b * 1.0 && L < .62;
  let key;
  if (!inCity[i]) key = null;
  else switch (cls[i]) {
    case C.WATER: key = veg ? 'park' : L > .5 ? 'bank' : 'water'; break;
    case C.FOREST: key = 'forest'; break;
    case C.PARK: key = veg || L < .45 ? 'park' : 'urban'; break;
    case C.AIRPORT: key = veg ? 'park' : 'airport'; break;
    case C.URBAN: key = veg && L < .4 ? 'veg' : 'urban'; break;
    default: key = veg ? 'veg' : 'road';
  }
  // 整體略增飽和、偏暖
  const Lr = .299 * r + .587 * g + .114 * b; r = Lr + (r - Lr) * 1.25 + 6; g = Lr + (g - Lr) * 1.25 + 2; b = Lr + (b - Lr) * 1.25 - 4;
  if (key) { const p = PAL[key], t = p.ramp(Math.pow(L, .9)); r = r * (1 - p.mix) + t[0] * p.mix; g = g * (1 - p.mix) + t[1] * p.mix; b = b * (1 - p.mix) + t[2] * p.mix; area[key] = (area[key] || 0) + px2; }
  png.data[i * 4] = Math.max(0, Math.min(255, Math.round(r))); png.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g))); png.data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b))); png.data[i * 4 + 3] = 255;
}
const pngFile = path.join(DATA, 'model_texture.png'), jpgFile = path.join(DATA, 'model_texture.jpg');
await writeFile(pngFile, PNG.sync.write(png));
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '84', pngFile, '--out', jpgFile], { stdio: 'ignore' });
const meta = { image: 'data/model_texture.jpg', bounds: [W, S, E, N], width: OW, height: OH, res: RES, scene: item.id, date,
  attribution: `Contains modified Copernicus Sentinel data ${year}；臺北市都市計畫使用分區圖（都市發展局）`,
  classAreaKm2: Object.fromEntries(Object.entries(area).map(([k, v]) => [k, +v.toFixed(1)])), levels: { lo, hi }, builtAt: new Date().toISOString() };
await writeFile(path.join(DATA, 'model_texture.json'), JSON.stringify(meta, null, 2));
console.log(`輸出 ${path.relative(ROOT, jpgFile)}（${((await readFile(jpgFile)).length / 1e6).toFixed(2)} MB），各類面積 km²：`, meta.classAreaKm2);
