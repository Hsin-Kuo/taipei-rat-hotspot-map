// 遊戲衛星底圖：Copernicus Sentinel-2 L2A 真彩色（TCI，10 m）。
// 從 AWS Open Data 的公開鏡像（Element 84 Earth Search STAC，不需帳號）只讀台北範圍，
// 投影到遊戲的 svg 座標、調暗去飽和（市界外再壓暗），輸出 dist/data/satellite.jpg 與 satellite.json。
// 授權：Copernicus Sentinel data licence，散布時須標示「Contains modified Copernicus Sentinel data <年份>」。
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { PNG } from 'pngjs';
import { fromUrl } from 'geotiff';
import { TWD97_TM2 } from './lib/twd97.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'dist', 'data');
const STAC = 'https://earth-search.aws.element84.com/v1/search';
const BBOX = [121.45, 24.96, 121.67, 25.21];   // 台北市（WGS84，含餘裕）
const PX_PER_UNIT = 1.6;                        // 輸出解析度：svg 1 單位 = 1.6 px（1000×1100 → 1600×1760）
const GRADE = { saturation: 0.55, brightness: 0.95, gamma: 1.0, tint: [14, 18, 23], tintMix: 0.1 }; // 調暗去飽和、往背景色靠
const BG = [14, 18, 23];                        // 影像範圍外（與遊戲背景 #0E1217 相同）
const OUTSIDE_DIM = 0.45;                       // 市界外也顯示，但亮度只有市界內的這個比例，台北市才突出
const SCENE = process.argv[2] ?? null;          // 可指定 item id；預設挑雲量最低的近期影像

// ---------- 1. 挑影像 ----------
const body = { collections: ['sentinel-2-l2a'], bbox: BBOX, limit: 20, query: { 'eo:cloud_cover': { lt: 3 } }, sortby: [{ field: 'properties.datetime', direction: 'desc' }] };
const res = await fetch(STAC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
if (!res.ok) throw new Error(`STAC ${res.status}`);
const items = (await res.json()).features;
// 雲量低於 0.1% 的裡面挑最新的（城市樣貌較準）；都沒有就退回雲量最低的
const usable = items.filter((f) => f.assets.visual);
const item = SCENE ? items.find((f) => f.id === SCENE)
  : usable.filter((f) => f.properties['eo:cloud_cover'] < 0.1).sort((a, b) => b.properties.datetime.localeCompare(a.properties.datetime))[0]
    ?? usable.sort((a, b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover'])[0];
if (!item) throw new Error('找不到合適的 Sentinel-2 影像');
const date = item.properties.datetime.slice(0, 10), year = date.slice(0, 4);
console.log(`影像：${item.id}（${date}，雲量 ${item.properties['eo:cloud_cover'].toFixed(3)}%）`);

// ---------- 2. 遊戲 svg 座標 ↔ TWD97 ↔ UTM ----------
const game = JSON.parse(await readFile(path.join(DATA, 'districts_game.json'), 'utf8'));
const T = game.svgTransform;
if (!T) throw new Error('districts_game.json 缺 svgTransform，請先 npm run build:game');
const [, , VW, VH] = game.viewBox;
const epsg = item.properties['proj:epsg'] ?? item.properties['proj:code']?.split(':')[1];
const UTM = `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
const tm2ToUtm = proj4(TWD97_TM2, UTM);
const svgToTm2 = (sx, sy) => [(sx - T.offX) / T.scale + T.minX, (T.h - sy - T.offY) / T.scale + T.minY];

// ---------- 3. 讀 COG 的台北視窗 ----------
const tiff = await fromUrl(item.assets.visual.href);
const img = await tiff.getImage();
const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution(); // ry 為負
const W = img.getWidth(), H = img.getHeight();
let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
for (const [sx, sy] of [[0, 0], [VW, 0], [0, VH], [VW, VH], [VW / 2, 0], [VW / 2, VH], [0, VH / 2], [VW, VH / 2]]) {
  const [ux, uy] = tm2ToUtm.forward(svgToTm2(sx, sy));
  ux0 = Math.min(ux0, ux); uy0 = Math.min(uy0, uy); ux1 = Math.max(ux1, ux); uy1 = Math.max(uy1, uy);
}
const win = [Math.max(0, Math.floor((ux0 - ox) / rx) - 2), Math.max(0, Math.floor((uy1 - oy) / ry) - 2), Math.min(W, Math.ceil((ux1 - ox) / rx) + 2), Math.min(H, Math.ceil((uy0 - oy) / ry) + 2)];
console.log(`讀取視窗 ${win.join(',')}（${win[2] - win[0]}×${win[3] - win[1]} px，原圖 ${W}×${H}）…`);
const t0 = Date.now();
const rgb = await img.readRasters({ window: win, interleave: true, samples: [0, 1, 2] });
const ww = win[2] - win[0], wh = win[3] - win[1];
console.log(`  完成（${((Date.now() - t0) / 1000).toFixed(0)}s）`);

// ---------- 4. 市界遮罩（svg 座標的掃描線填滿） ----------
const OW = Math.round(VW * PX_PER_UNIT), OH = Math.round(VH * PX_PER_UNIT);
const rings = [];
for (const d of game.districts) for (const sub of d.svgPath.split('M').filter(Boolean)) rings.push(sub.replace(/Z/g, '').split('L').map((p) => p.split(',').map(Number)));
const mask = new Uint8Array(OW * OH);
for (let v = 0; v < OH; v++) {
  const sy = (v + 0.5) / PX_PER_UNIT, xs = [];
  for (const r of rings) for (let k = 0, m = r.length - 1; k < r.length; m = k++) { const [xa, ya] = r[k], [xb, yb] = r[m]; if ((ya > sy) !== (yb > sy)) xs.push(xa + (sy - ya) * (xb - xa) / (yb - ya)); }
  xs.sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2) for (let u = Math.max(0, Math.ceil(xs[k] * PX_PER_UNIT - 0.5)); u <= Math.min(OW - 1, Math.floor(xs[k + 1] * PX_PER_UNIT - 0.5)); u++) mask[v * OW + u] = 1;
}

// ---------- 5. 重投影＋雙線性取樣＋調色 ----------
const png = new PNG({ width: OW, height: OH, colorType: 2 });
const sample = (fx, fy, c) => {
  const x0 = Math.max(0, Math.min(ww - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(wh - 2, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
  const i = (y, x) => rgb[(y * ww + x) * 3 + c];
  return (i(y0, x0) * (1 - tx) + i(y0, x0 + 1) * tx) * (1 - ty) + (i(y0 + 1, x0) * (1 - tx) + i(y0 + 1, x0 + 1) * tx) * ty;
};
let inside = 0;
for (let v = 0; v < OH; v++) for (let u = 0; u < OW; u++) {
  const o = (v * OW + u) * 4;
  let r = BG[0], g = BG[1], b = BG[2];
  const inCity = mask[v * OW + u] === 1;
  if (inCity) inside++;
  const [ux, uy] = tm2ToUtm.forward(svgToTm2((u + 0.5) / PX_PER_UNIT, (v + 0.5) / PX_PER_UNIT));
  const fx = (ux - ox) / rx - win[0] - 0.5, fy = (uy - oy) / ry - win[1] - 0.5;
  if (fx >= 0 && fy >= 0 && fx <= ww - 1 && fy <= wh - 1) { // 圖幅範圍外維持背景色
    r = sample(fx, fy, 0); g = sample(fx, fy, 1); b = sample(fx, fy, 2);
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const dim = inCity ? 1 : OUTSIDE_DIM;
    [r, g, b] = [r, g, b].map((c, k) => {
      let x = L + (c - L) * GRADE.saturation;                                          // 去飽和
      x = 255 * Math.pow(Math.max(0, x) / 255, GRADE.gamma) * GRADE.brightness * dim;  // 調暗（市界外再壓暗）
      return x * (1 - GRADE.tintMix) + GRADE.tint[k] * GRADE.tintMix;                  // 往背景色靠
    });
  }
  png.data[o] = Math.round(Math.min(255, Math.max(0, r))); png.data[o + 1] = Math.round(Math.min(255, Math.max(0, g))); png.data[o + 2] = Math.round(Math.min(255, Math.max(0, b))); png.data[o + 3] = 255;
}
const pngFile = path.join(DATA, 'satellite.png'), jpgFile = path.join(DATA, 'satellite.jpg');
await writeFile(pngFile, PNG.sync.write(png));
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', pngFile, '--out', jpgFile], { stdio: 'ignore' });
const meta = { file: 'satellite.jpg', width: OW, height: OH, viewBox: game.viewBox, scene: item.id, date, cloudCover: item.properties['eo:cloud_cover'], attribution: `Contains modified Copernicus Sentinel data ${year}`, source: 'Copernicus Sentinel-2 L2A TCI，經 AWS Open Data（Element 84 Earth Search）取得', grade: GRADE, outsideDim: OUTSIDE_DIM, builtAt: new Date().toISOString() };
await writeFile(path.join(DATA, 'satellite.json'), JSON.stringify(meta, null, 2));
const kb = (await readFile(jpgFile)).length / 1024;
console.log(`輸出 ${path.relative(ROOT, jpgFile)}：${OW}×${OH}，市界內 ${(inside / (OW * OH) * 100).toFixed(0)}% 像素，${kb.toFixed(0)} KB`);
