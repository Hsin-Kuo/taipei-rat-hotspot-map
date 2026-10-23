// 匯出遊戲用的 12 區屬性、擴散邊層與 SVG 多邊形 → dist/data/districts_game.json
// 只讀 dist/data/*（不重跑 build.mjs）。用法：npm run build:game
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';
import proj4 from 'proj4';
import { TWD97_TM2 } from './lib/twd97.mjs';
import { parse as parseCsv } from 'csv-parse/sync';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'dist', 'data');
const OUT = path.join(DATA, 'districts_game.json');
const readJson = async (f) => JSON.parse(await readFile(path.join(DATA, f), 'utf8'));

// ---------- 手動表 ----------
const ID = { 大同區: 'DT', 中正區: 'ZZ', 萬華區: 'WH', 大安區: 'DA', 中山區: 'ZS', 松山區: 'SS', 信義區: 'XY', 文山區: 'WS', 內湖區: 'NH', 南港區: 'NG', 士林區: 'SL', 北投區: 'BT' };
// 臺北市政府民政局「115 年 1-12 月各區人口數」ods，115 年 9 月（2026-09）戶籍人口／戶數。使用者決定寫死，不即時更新。
const POPULATION_2026_09 = {
  SS: { pop: 185700, households: 81318 }, XY: { pop: 199198, households: 91105 }, DA: { pop: 279617, households: 121045 },
  ZS: { pop: 210441, households: 103910 }, ZZ: { pop: 142673, households: 65870 }, DT: { pop: 115605, households: 54748 },
  WH: { pop: 167175, households: 81709 }, WS: { pop: 252102, households: 111325 }, NG: { pop: 111371, households: 50313 },
  NH: { pop: 265437, households: 112233 }, SL: { pop: 255580, households: 109580 }, BT: { pop: 233973, households: 101790 },
};
const POPULATION_TOTAL = 2418872;
const RIVERS = { 淡水河: ['BT', 'SL', 'DT', 'WH'], 基隆河: ['BT', 'SL', 'ZS', 'SS', 'NH', 'NG'], 新店溪: ['ZZ', 'WH', 'WS'], 景美溪: ['WS'] };
const MOUNTAIN = ['BT', 'SL', 'NH', 'NG', 'WS'];
const SVG = { w: 1000, h: 1100, pad: 20, simplifyDeg: 0.0006 };


// ---------- 讀資料 ----------
const geo = await readJson('districts.geojson');
const stats = await readJson('district_stats.json');
const markets = await readJson('markets.json');
const tradMarkets = await readJson('markets_trad.json');
const garbage = await readJson('garbage_stops.json');
const food = await readJson('food.json');
const sewer = await readJson('sewer_manholes.json');
const storm = await readJson('storm_manholes.json');
const foodWaste = (await readJson('food_waste_nodes.json')).nodes;

const feats = geo.features;
if (feats.length !== 12) throw new Error(`expected 12 districts, got ${feats.length}`);
const byName = new Map(feats.map((f) => [f.properties.name, f]));
const bboxes = feats.map((f) => turf.bbox(f));
function districtOf(lon, lat) {
  for (let k = 0; k < feats.length; k++) {
    const b = bboxes[k];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (turf.booleanPointInPolygon([lon, lat], feats[k])) return feats[k].properties.name;
  }
  return null;
}
const zero = () => Object.fromEntries(feats.map((f) => [f.properties.name, 0]));

// ---------- 分區計數 ----------
const cFood = zero(), cNight = zero(), cTrad = zero(), cGarb = zero(), cSewer = zero(), cStorm = zero(), cTons = zero();
let unassigned = { food: 0, trad: 0, sewer: 0 };
for (const r of food) { const d = districtOf(r[0], r[1]); if (d) cFood[d] += r[2]; else unassigned.food++; }
for (const m of markets) if (cNight[m.district] != null) cNight[m.district]++;
for (const t of tradMarkets) { const d = districtOf(t.lon, t.lat); if (d) cTrad[d]++; else unassigned.trad++; }
for (const g of garbage) if (cGarb[g[4]] != null) cGarb[g[4]]++;
for (const s of sewer) { const d = districtOf(s[0], s[1]); if (d) cSewer[d]++; else unassigned.sewer++; }
for (const s of storm) if (cStorm[s[3]] != null) cStorm[s[3]]++;
for (const n of foodWaste) if (cTons[n.district] != null) cTons[n.district] += n.tons;
console.log('unassigned (outside all districts):', unassigned);

const ext = Object.fromEntries(stats.rows.map((r) => [r.name, r]));
const ratPerKVals = stats.rows.map((r) => r.ratPerK);
const rpMin = Math.min(...ratPerKVals), rpMax = Math.max(...ratPerKVals);

// ---------- SVG 投影 ----------
const toTM2 = proj4('EPSG:4326', TWD97_TM2);
const simplified = feats.map((f) => turf.simplify(f, { tolerance: SVG.simplifyDeg, highQuality: true }));
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const projected = simplified.map((f) =>
  f.geometry.coordinates.map((poly) =>
    poly.map((ring) =>
      ring.map(([lon, lat]) => {
        const [x, y] = toTM2.forward([lon, lat]);
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        return [x, y];
      }))));
const scale = Math.min((SVG.w - 2 * SVG.pad) / (maxX - minX), (SVG.h - 2 * SVG.pad) / (maxY - minY));
const offX = (SVG.w - (maxX - minX) * scale) / 2, offY = (SVG.h - (maxY - minY) * scale) / 2;
const toSvg = ([x, y]) => [((x - minX) * scale + offX), (SVG.h - ((y - minY) * scale + offY))];
const f1 = (v) => Math.round(v * 10) / 10;
const svgPaths = projected.map((polys) =>
  polys.map((poly) => poly.map((ring) => 'M' + ring.map((p) => toSvg(p).map(f1).join(',')).join('L') + 'Z').join('')).join(''));
const svgCentroids = feats.map((f) => toSvg(toTM2.forward(f.properties.centroid)).map(f1));

// ---------- 區屬性 ----------
const districts = feats.map((f, i) => {
  const name = f.properties.name, id = ID[name], area = f.properties.areaKm2;
  const p = POPULATION_2026_09[id];
  return {
    id, name, population: p.pop, households: p.households, areaKm2: area,
    density: Math.round(p.pop / area),
    avgAge: ext[name].avgAge, old40: ext[name].old40, ratPerK: ext[name].ratPerK,
    foodCount: cFood[name], nightMarketCount: cNight[name], tradMarketCount: cTrad[name], garbageStops: cGarb[name],
    sewerManholes: cSewer[name], stormManholes: cStorm[name],
    sewerManholeDensity: Math.round(cSewer[name] / area), stormManholeDensity: Math.round(cStorm[name] / area),
    foodWasteNodeTons: cTons[name],
    mountainAdjacent: MOUNTAIN.includes(id),
    riverAdjacent: Object.values(RIVERS).some((r) => r.includes(id)),
    reportPropensity: Math.round((0.75 + 0.6 * (ext[name].ratPerK - rpMin) / (rpMax - rpMin)) * 1000) / 1000,
    svgPath: svgPaths[i], svgCentroid: svgCentroids[i], centroid: f.properties.centroid,
  };
});
const sumPop = districts.reduce((s, d) => s + d.population, 0);
if (sumPop !== POPULATION_TOTAL) throw new Error(`population sum ${sumPop} != ${POPULATION_TOTAL}`);
const idOf = Object.fromEntries(districts.map((d) => [d.name, d.id]));
const byId = Object.fromEntries(districts.map((d) => [d.id, d]));

// ---------- 邊層 ----------
// geo：共享邊界長度 ≈ buffer(a, 10 m) ∩ b 的面積 / 20 m
const geoRaw = [];
for (let i = 0; i < feats.length; i++) {
  const a = turf.buffer(feats[i], 0.01, { units: 'kilometers' });
  for (let j = 0; j < feats.length; j++) {
    if (i === j) continue;
    let inter = null;
    try { inter = turf.intersect(turf.featureCollection([a, feats[j]])); } catch { inter = null; }
    if (!inter) continue;
    const lenM = turf.area(inter) / 20;
    if (lenM < 100) continue; // < 100 m 視為只碰一點
    geoRaw.push({ from: idOf[feats[i].properties.name], to: idOf[feats[j].properties.name], lenM });
  }
}
// 對稱化：取兩向平均
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pairLen = new Map();
for (const e of geoRaw) { const k = pairKey(e.from, e.to); pairLen.set(k, (pairLen.get(k) ?? 0) + e.lenM / 2); }
const geoEdges = [];
for (const [k, lenM] of pairLen) {
  const [a, b] = k.split('|');
  geoEdges.push({ from: a, to: b, lenM }, { from: b, to: a, lenM });
}
const maxLenFrom = {};
for (const e of geoEdges) maxLenFrom[e.from] = Math.max(maxLenFrom[e.from] ?? 0, e.lenM);
const r3 = (v) => Math.round(v * 1000) / 1000;
const geoLayer = geoEdges.map((e) => ({ from: e.from, to: e.to, w: r3(Math.max(0.2, e.lenM / maxLenFrom[e.from])), sharedKm: r3(e.lenM / 1000) }));

const maxSewerDens = Math.max(...districts.map((d) => d.sewerManholeDensity));
const sewerLayer = geoLayer.map((e) => ({ from: e.from, to: e.to, w: r3(Math.sqrt(byId[e.from].sewerManholeDensity * byId[e.to].sewerManholeDensity) / maxSewerDens) }));

// ---------- 垃圾車：公開資料只有停靠點（都在區內）。路徑來自 scripts/route-trucks.mjs（沿馬路 A*）；
// 跨區邊 = 路徑沿馬路繞行時實際切過的鄰區，權重依切過的車次數。 ----------
const truckRows = parseCsv(await readFile(path.join(ROOT, 'raw', 'garbage_trucks.csv'), 'utf8'), { columns: true, bom: true, skip_empty_lines: true });
const toTM2pt = (lon, lat) => toTM2.forward([lon, lat]);
let routed = null;
try { routed = JSON.parse(await readFile(path.join(ROOT, 'raw', 'truck_routes.json'), 'utf8')); } catch { routed = null; }
const truckMap = new Map();
const crossCount = {}; // `${home}|${other}` → 車次數
if (routed) {
  for (const tk of routed.trucks) {
    truckMap.set(tk.id, { id: tk.id, district: tk.district, trips: tk.trips.map((tr) => ({ start: tr.start, end: tr.end, route: tr.route, stopIdx: tr.stopIdx ?? [], pts: tr.pts.flatMap(([x, y]) => toSvg([x, y]).map(f1)) })) });
    for (const tr of tk.trips) for (const d of tr.crossed ?? []) { const k = `${tk.district}|${d}`; crossCount[k] = (crossCount[k] ?? 0) + 1; }
  }
  console.log(`垃圾車：使用沿路路徑 ${routed.trucks.length} 台（${routed.cellM} m 格網，${routed.builtAt}）`);
} else {
  const tripMap = new Map();
  for (const r of truckRows) {
    const coord = (v) => { const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/); return m ? +m[0] : NaN; };
    const lon = coord(r['經度']), lat = coord(r['緯度']), id = ID[r['行政區']];
    if (!id || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const key = `${r['車號']}|${r['路線']}|${r['車次']}`;
    if (!tripMap.has(key)) tripMap.set(key, { truck: r['車號'], route: r['路線'], district: id, stops: [] });
    tripMap.get(key).stops.push({ t: +r['抵達時間'], lon, lat });
  }
  for (const t of tripMap.values()) {
    t.stops.sort((a, b) => a.t - b.t);
    if (!truckMap.has(t.truck)) truckMap.set(t.truck, { id: t.truck, district: t.district, trips: [] });
    truckMap.get(t.truck).trips.push({ start: t.stops[0].t, end: t.stops[t.stops.length - 1].t, route: t.route, stopIdx: t.stops.map((_, k) => k), pts: t.stops.flatMap((p) => toSvg(toTM2pt(p.lon, p.lat)).map(f1)) });
  }
  console.log('垃圾車：未找到 raw/truck_routes.json，使用停靠點直線、無跨區邊（可執行 npm run route:trucks）');
}
const trucks = [...truckMap.values()].map((k) => ({ ...k, trips: k.trips.sort((a, b) => a.start - b.start) }));
const maxCross = Math.max(1, ...Object.values(crossCount));
const garbageLayer = [];
for (const [k, n] of Object.entries(crossCount)) {
  const [from, to] = k.split('|');
  const w = r3(0.3 + 0.7 * n / maxCross);
  garbageLayer.push({ from, to, w, trips: n }, { from: to, to: from, w, trips: n });
}
console.log('垃圾車跨區邊（車次數）:', Object.entries(crossCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' '));
const riverMap = new Map();
for (const seq of Object.values(RIVERS)) {
  for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) {
    const w = j - i === 1 ? 1 : j - i === 2 ? 0.5 : 0;
    if (!w) continue;
    const k = pairKey(seq[i], seq[j]);
    riverMap.set(k, Math.max(riverMap.get(k) ?? 0, w));
  }
}
const riverLayer = [];
for (const [k, w] of riverMap) { const [a, b] = k.split('|'); riverLayer.push({ from: a, to: b, w }, { from: b, to: a, w }); }
const mountainLayer = [];
for (const a of MOUNTAIN) for (const b of MOUNTAIN) if (a !== b) mountainLayer.push({ from: a, to: b, w: 1 });

// ---------- 捷運（只供畫面）：捷運工程局路網圖與車站點位，EPSG:3826 ----------
// 工程名稱 → 營運路線與官方代表色。EXTENSION_NOT_OPEN 列出尚未通車的延伸段（以虛線表示）；信義線東延段已通車。
const METRO_LINES = {
  R: { name: '淡水信義線', color: '#E3002C', parts: ['淡水線', '信義線', '信義線東延段'] },
  G: { name: '松山新店線', color: '#008659', parts: ['新店線', '小南門線', '碧潭支線', '松山線'] },
  O: { name: '中和新蘆線', color: '#F8B61C', parts: ['中和線', '蘆洲線', '新莊線'] },
  BL: { name: '板南線', color: '#0070BD', parts: ['板橋線', '南港線', '土城線'] },
  BR: { name: '文湖線', color: '#C48C31', parts: ['木柵線', '內湖線'] },
  Y: { name: '環狀線', color: '#FFDB00', parts: ['環狀線'] },
};
const EXTENSION_NOT_OPEN = new Set([]);
const lineOf = (routeName) => Object.entries(METRO_LINES).find(([, v]) => v.parts.includes(routeName))?.[0] ?? null;
function dp(pts, tol) { // Douglas–Peucker（公尺）
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); const [xa, ya] = pts[a], [xb, yb] = pts[b]; const vx = xb - xa, vy = yb - ya, L2 = vx * vx + vy * vy || 1;
    let md = 0, mi = -1;
    for (let k = a + 1; k < b; k++) { const [x, y] = pts[k]; const t = Math.max(0, Math.min(1, ((x - xa) * vx + (y - ya) * vy) / L2)); const d = Math.hypot(x - xa - vx * t, y - ya - vy * t); if (d > md) { md = d; mi = k; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, k) => keep[k]);
}
let metro = null;
try {
  const routesFc = JSON.parse((await readFile(path.join(ROOT, 'raw', 'mrt_routes.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const stationsFc = JSON.parse((await readFile(path.join(ROOT, 'raw', 'mrt_stations.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const unknown = new Set();
  const segments = [];
  for (const f of routesFc.features) {
    const rn = f.properties.RouteName, line = lineOf(rn);
    if (!line) { unknown.add(rn); continue; }
    const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const part of parts) segments.push({ line, route: rn, extension: EXTENSION_NOT_OPEN.has(rn), d: 'M' + dp(part.map(([x, y]) => [x, y]), 8).map((p) => toSvg(p).map(f1).join(',')).join('L') });
  }
  const tm2ToWgs = proj4(TWD97_TM2, 'EPSG:4326');
  const stations = stationsFc.features.map((f) => {
    const [x, y] = f.geometry.coordinates; const [lon, lat] = tm2ToWgs.forward([x, y]);
    const dn = districtOf(lon, lat);
    return dn ? { name: f.properties.NAME, district: ID[dn], svg: toSvg([x, y]).map(f1) } : null;
  }).filter(Boolean);
  metro = { lines: Object.entries(METRO_LINES).map(([id, v]) => ({ id, name: v.name, color: v.color })), segments, stations };
  console.log(`捷運：${segments.length} 段線形、台北市內車站 ${stations.length}/${stationsFc.features.length}${unknown.size ? `；未歸類路線 ${[...unknown].join('、')}` : ''}`);
} catch (e) { console.log('捷運：未找到 raw/mrt_*.json，略過（npm run fetch 會下載）', e.message); }

const out = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  viewBox: [0, 0, SVG.w, SVG.h],
  // TWD97 (x,y) → svg：sx = (x - minX)·scale + offX；sy = h − ((y − minY)·scale + offY)。衛星底圖用它對齊
  svgTransform: { minX, minY, scale, offX, offY, h: SVG.h },
  districts,
  layers: [
    { id: 'geo', edges: geoLayer },
    { id: 'sewer', edges: sewerLayer },
    { id: 'garbage', edges: garbageLayer },
    { id: 'river', edges: riverLayer },
    { id: 'mountain', edges: mountainLayer },
  ],
  trucks,
  metro,
  foodWasteNodes: foodWaste.map((n) => ({ district: idOf[n.district], name: n.name, tons: n.tons, status: n.status })),
  rivers: RIVERS,
  sources: {
    population: '臺北市政府民政局「115 年 1-12 月各區人口數」，115 年 9 月（2026-09）戶籍人口',
    ratPerK_avgAge_old40: 'EcoSentinel（ecosentinel.tw，2026）：見鼠地圖 2026-05 通報 ÷ 千宅；內政部房屋稅籍 114Q4',
    counts: 'data.taipei 開放資料（餐飲、攤販集中場、公有市場、垃圾車停靠點、污水／雨水人孔），見 taipei_rat README',
    foodWasteNodes: 'EcoSentinel 整理之疑似廚餘暫置點（未經官方證實）',
    trucks: '環保局「臺北市垃圾車點位路線資訊」（data.gov.tw 136515）：停靠點依抵達時間排序；停靠點之間沿新工處「寬度超過 8 公尺道路」路面與民政局門牌分布以 A* 近似行車路徑（非實際行駛軌跡）。只含公開資料有的停靠點之間，不含進焚化廠；跨區邊為路徑沿馬路實際切過的鄰區',
    roads: '工務局新工處「臺北市寬度超過8公尺道路GIS圖資」（2014–2016 測繪）',
    metro: '捷運工程局「臺北都會區大眾捷運系統路網圖」與「車站點位圖」（data.gov.tw 121208、121140）；工程名稱歸類到營運路線為本專案整理，僅供畫面',
  },
};
await writeFile(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}`);
console.table(districts.map((d) => ({ id: d.id, name: d.name, pop: d.population, dens: d.density, food: d.foodCount, night: d.nightMarketCount, trad: d.tradMarketCount, garb: d.garbageStops, sewerD: d.sewerManholeDensity, stormD: d.stormManholeDensity, tons: d.foodWasteNodeTons, old40: d.old40, rp: d.reportPropensity })));
console.log('geo edges:', geoLayer.length / 2, 'pairs');
for (const d of districts) console.log(d.id, '→', geoLayer.filter((e) => e.from === d.id).map((e) => `${e.to}(${e.w})`).join(' '));
