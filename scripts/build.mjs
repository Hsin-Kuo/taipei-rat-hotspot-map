// 清洗原始資料 → dist/data/*.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import shp from 'shpjs';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import * as turf from '@turf/turf';
import { tm2ToLonLat, inTaipeiTM2, parseDMS } from './lib/twd97.mjs';
import { SOURCES } from './fetch.mjs';

const RAW = path.resolve('raw');
const OUT = path.resolve('dist/data');
await mkdir(OUT, { recursive: true });

const readCsv = async (file, encoding = 'utf8') => {
  const buf = await readFile(path.join(RAW, file));
  const txt = encoding === 'utf8' ? buf.toString('utf8').replace(/^﻿/, '') : iconv.decode(buf, encoding);
  return parse(txt, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
};
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const meta = { builtAt: new Date().toISOString(), sources: {}, counts: {}, dropped: {} };
let manifest = {};
try { manifest = JSON.parse(await readFile(path.join(RAW, 'manifest.json'), 'utf8')); } catch {}
for (const s of SOURCES) meta.sources[s.file] = { name: s.name, agency: s.agency, page: s.page, ...(manifest.files?.[s.file] ?? {}) };
meta.fetchedAt = manifest.fetchedAt ?? null;
try { const fm = JSON.parse(await readFile(path.resolve('raw/food/manifest.json'), 'utf8')); for (const [k, v] of Object.entries(fm.files)) meta.sources['food:' + k] = v; meta.foodFetchedAt = fm.fetchedAt; } catch {}

// ---------- 1. 里界 → 行政區 ----------
console.log('[1/5] 里界 → 行政區');
const li = await shp(await readFile(path.join(RAW, 'li_boundary.zip')));
const byDistrict = new Map();
for (const f of li.features) {
  const d = f.properties.TNAME;
  if (!byDistrict.has(d)) byDistrict.set(d, []);
  byDistrict.get(d).push(turf.feature(f.geometry));
}
const districts = [];
for (const [name, feats] of byDistrict) {
  // 座標截到 7 位小數避免 polyclip 精度問題，再一次 union 整區
  const snapped = feats.map(f => turf.truncate(f, { precision: 7, coordinates: 2, mutate: false }));
  let merged;
  try {
    merged = turf.union(turf.featureCollection(snapped));
  } catch (e) {
    console.warn(`  ${name}: 直接 union 失敗 (${e.message.slice(0, 60)}…)，改用 buffer 法`);
    const buffered = snapped.map(f => turf.buffer(f, 0.5, { units: 'meters' }));
    merged = turf.buffer(turf.union(turf.featureCollection(buffered)), -0.5, { units: 'meters' });
  }
  // 去掉細碎孔洞：只保留面積 > 2000 m² 的 ring
  const geom = merged.geometry;
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  const cleaned = polys.map(rings => rings.filter((ring, i) => i === 0 || turf.area(turf.polygon([ring])) > 2000))
                       .filter(rings => turf.area(turf.polygon([rings[0]])) > 20000);
  let feature = turf.simplify(turf.multiPolygon(cleaned), { tolerance: 0.00004, highQuality: true });
  const centroid = turf.centerOfMass(feature).geometry.coordinates.map(r5);
  feature.properties = { name, li: feats.length, areaKm2: +(turf.area(feature) / 1e6).toFixed(2), centroid };
  districts.push(feature);
}
districts.sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'zh-Hant'));
// 市界 + 300 m 緩衝，供各點位資料集做「落在台北市內」檢核（剔除座標打錯而跑到市外的點）
const cityUnion = turf.union(turf.featureCollection(districts.map(d => turf.feature(d.geometry))));
await writeFile(path.join(OUT, 'city.geojson'), JSON.stringify(turf.simplify(cityUnion, { tolerance: 0.00005, highQuality: true })));   // 市界外框（地形貼圖描邊用）
const cityBuffer = turf.simplify(turf.buffer(cityUnion, 0.3, { units: 'kilometers' }), { tolerance: 0.0003 });
await writeFile(path.join(OUT, 'city_plinth.geojson'), JSON.stringify(turf.simplify(turf.buffer(cityUnion, 0.35, { units: 'kilometers' }), { tolerance: 0.0002, highQuality: true })));   // 底盤外框（市界外擴 350 m）
const cityBbox = turf.bbox(cityBuffer);
const inCity = (lon, lat) => lon >= cityBbox[0] && lon <= cityBbox[2] && lat >= cityBbox[1] && lat <= cityBbox[3] && turf.booleanPointInPolygon([lon, lat], cityBuffer);
await writeFile(path.join(OUT, 'districts.geojson'), JSON.stringify(turf.featureCollection(districts)));
meta.counts.districts = districts.length;
meta.counts.li = li.features.length;
console.log(`  ${districts.length} 區, ${li.features.length} 里`);

// ---------- 2. 污水人孔 ----------
console.log('[2/5] 污水人孔');
const sewerMhRows = await readCsv('sewer_manholes.csv');
const sewerMh = new Map(); // id → [lon,lat]
const sewerManholes = [];
let dropSewerMh = 0;
for (const r of sewerMhRows) {
  const x = +r.X, y = +r.Y;
  if (!inTaipeiTM2(x, y)) { dropSewerMh++; continue; }
  const ll = tm2ToLonLat(x, y);
  if (!inCity(ll[0], ll[1])) { dropSewerMh++; continue; }
  const id = String(r['人孔編號']).replace(/['"\s]/g, '');
  sewerMh.set(id, ll);
  sewerManholes.push([ll[0], ll[1], +r['人孔深度'] || 0]);
}
meta.counts.sewerManholes = sewerManholes.length;
meta.dropped.sewerManholes = dropSewerMh;
await writeFile(path.join(OUT, 'sewer_manholes.json'), JSON.stringify(sewerManholes));
console.log(`  ${sewerManholes.length} 筆，丟棄 ${dropSewerMh}`);

// ---------- 2b. 污水陰井（只用來補管線端點座標，不進熱力） ----------
console.log('[2b] 污水陰井');
const inletRows = await readCsv('sewer_inlets.csv');
const sewerInlet = new Map();
let dropInlet = 0;
for (const r of inletRows) {
  const x = +r.X, y = +r.Y;
  if (!inTaipeiTM2(x, y)) { dropInlet++; continue; }
  const ll = tm2ToLonLat(x, y);
  if (!inCity(ll[0], ll[1])) { dropInlet++; continue; }
  sewerInlet.set(String(r['陰井編號']).replace(/['"\s]/g, ''), ll);
}
meta.counts.sewerInlets = sewerInlet.size;
meta.dropped.sewerInlets = dropInlet;
console.log(`  ${sewerInlet.size} 筆，丟棄 ${dropInlet}`);

// ---------- 3. 污水管線 join ----------
console.log('[3/5] 污水管線 join');
const lineRows = await readCsv('sewer_lines.csv');
const sewerLines = [];
let missing = 0, badGeom = 0;
const norm = (s) => String(s ?? '').replace(/['"\s]/g, '');
const lineClass = { trunk: 0, branch: 0, lateral: 0 };   // 人孔-人孔 / 人孔-陰井 / 陰井-陰井
for (const r of lineRows) {
  const ua = norm(r['上游人孔編號']), ub = norm(r['下游人孔編號']);
  const ma = sewerMh.get(ua), mb = sewerMh.get(ub);
  const a = ma || sewerInlet.get(ua), b = mb || sewerInlet.get(ub);
  if (!a || !b) { missing++; continue; }
  // 幾何長度檢核：端點編號打錯會接出跨越半個城市的直線；以資料集申報的管線長度為準
  const geoLen = Math.hypot((a[0] - b[0]) * 101000 * Math.cos(25.05 * Math.PI / 180), (a[1] - b[1]) * 110600);
  const stated = +r['管線長度'] || 0;
  if (geoLen > 300 && geoLen > 2.5 * stated + 50) { badGeom++; continue; }
  const kind = ma && mb ? 0 : (ma || mb) ? 1 : 2;
  lineClass[['trunk', 'branch', 'lateral'][kind]]++;
  sewerLines.push([a[0], a[1], b[0], b[1], kind]);
}
meta.counts.sewerLineClass = lineClass;
meta.counts.sewerLinesBadGeometry = badGeom;
meta.counts.sewerLinesRaw = lineRows.length;
meta.counts.sewerLines = sewerLines.length;
meta.joinRate = +(sewerLines.length / lineRows.length).toFixed(4);
console.log(`  ${sewerLines.length}/${lineRows.length} 段成功 (join rate ${(meta.joinRate * 100).toFixed(1)}%)，幾何檢核剔除 ${badGeom} 段`, lineClass);
if (meta.joinRate < 0.3) { console.error(`  join rate < 30%，請檢查人孔編號格式`); process.exit(1); }
// 註：管線端點約半數是陰井而非人孔，需同時查人孔與陰井資料集才能補齊座標。

// ---------- 3b. 污水管線向量二進位（放大時改畫 GPU 向量線） ----------
// 版面：uint32 n ｜ float32 ×4n（lon0,lat0,lon1,lat1，相對 ORIGIN 的差值，保留約 1e-8 度精度）｜ uint8 ×n（類別 0/1/2）
{
  const ORIGIN = [121.5, 25.05];
  const n = sewerLines.length;
  const buf = new ArrayBuffer(4 + n * 16 + n);
  new DataView(buf).setUint32(0, n, true);
  const f = new Float32Array(buf, 4, n * 4), k = new Uint8Array(buf, 4 + n * 16, n);
  sewerLines.forEach((l, i) => { f[i * 4] = l[0] - ORIGIN[0]; f[i * 4 + 1] = l[1] - ORIGIN[1]; f[i * 4 + 2] = l[2] - ORIGIN[0]; f[i * 4 + 3] = l[3] - ORIGIN[1]; k[i] = l[4]; });
  await writeFile(path.join(OUT, 'sewer_lines.bin'), Buffer.from(buf));
  meta.sewerLinesBin = { segments: n, origin: ORIGIN, bytes: buf.byteLength };
  console.log(`  向量檔 ${(buf.byteLength / 1e6).toFixed(2)} MB`);
}

// ---------- 4. 雨水人孔 ----------
console.log('[4/5] 雨水人孔');
const stormRows = await readCsv('storm_manholes.csv');
const stormManholes = [];
let dropStorm = 0;
for (const r of stormRows) {
  const x = +r['X坐標'], y = +r['Y坐標'];
  if (!inTaipeiTM2(x, y)) { dropStorm++; continue; }
  const ll = tm2ToLonLat(x, y);
  if (!inCity(ll[0], ll[1])) { dropStorm++; continue; }
  stormManholes.push([ll[0], ll[1], +r['人孔深度（m）'] || 0, r['行政區'] ?? '']);
}
meta.counts.stormManholes = stormManholes.length;
meta.dropped.stormManholes = dropStorm;
await writeFile(path.join(OUT, 'storm_manholes.json'), JSON.stringify(stormManholes));
console.log(`  ${stormManholes.length} 筆，丟棄 ${dropStorm}`);

// ---------- 5. 攤販集中場 ----------
console.log('[5/5] 攤販集中場');
const mRows = await readCsv('markets.csv', 'big5');
const mMap = new Map();
let dropM = 0;
for (const r of mRows) {
  const lon = parseDMS(r.GTag_longitude), lat = parseDMS(r.GTag_latitude);
  if (!(lon > 121.3 && lon < 121.8 && lat > 24.9 && lat < 25.3)) { dropM++; continue; }
  const key = `${r5(lon)},${r5(lat)}`;
  const name = (r.xbody || '').trim();
  if (mMap.has(key)) {
    const m = mMap.get(key);
    if (name && !m.names.includes(name)) m.names.push(name);
  } else {
    mMap.set(key, { names: name ? [name] : [], district: (r.stitle || '').trim() + '區',
      range: (r.xAddress || '').trim(), hours: `${r.xstartTime || ''}–${r.xendTime || ''}`, days: r.xcreatedDate || '', lon: r5(lon), lat: r5(lat) });
  }
}
const markets = [...mMap.values()].map(m => ({ name: m.names.join('／') || m.range, district: m.district, range: m.range, hours: m.hours, days: m.days, lon: m.lon, lat: m.lat }));
meta.counts.marketsRaw = mRows.length;
meta.counts.markets = markets.length;
meta.dropped.markets = dropM;
await writeFile(path.join(OUT, 'markets.json'), JSON.stringify(markets));
console.log(`  ${markets.length} 處（原始 ${mRows.length}，丟棄 ${dropM}）`);

// ---------- 5a. 垃圾車停靠點 + 傳統市場（食源因子） ----------
console.log('[5a] 垃圾車停靠點、傳統市場');
const num = (v) => parseFloat(String(v ?? '').replace(/[^\d.\-]/g, ''));
const gRows = await readCsv('garbage_trucks.csv');
const gMap = new Map();   // 同一地點多車次 → 合併，記錄車次數
let dropG = 0;
for (const r of gRows) {
  const lon = num(r['經度']), lat = num(r['緯度']);
  if (!(lon > 121.3 && lon < 121.8 && lat > 24.9 && lat < 25.3) || !inCity(lon, lat)) { dropG++; continue; }
  const k = `${lon.toFixed(5)},${lat.toFixed(5)}`;
  const g = gMap.get(k) || { lon: r5(lon), lat: r5(lat), n: 0, place: (r['地點'] || '').replace(/^臺北市/, ''), district: r['行政區'] || '', li: r['里別'] || '' };
  g.n++; gMap.set(k, g);
}
const garbageStops = [...gMap.values()];
await writeFile(path.join(OUT, 'garbage_stops.json'), JSON.stringify(garbageStops.map(g => [g.lon, g.lat, g.n, g.place, g.district])));
meta.counts.garbageRows = gRows.length; meta.counts.garbageStops = garbageStops.length; meta.dropped.garbage = dropG;
console.log(`  垃圾車 ${gRows.length} 車次 → ${garbageStops.length} 個停靠點，丟棄 ${dropG}`);

const tmRows = await readCsv('markets_trad.csv');
const tradMarkets = [];
let dropTm = 0;
for (const r of tmRows) {
  const lon = num(r.GTag_longitude), lat = num(r.GTag_latitude);
  if (!(lon > 121.3 && lon < 121.8 && lat > 24.9 && lat < 25.3) || !inCity(lon, lat)) { dropTm++; continue; }
  tradMarkets.push({ name: (r.stitle || '').trim(), addr: (r.xAddress || '').trim(), lon: r5(lon), lat: r5(lat) });
}
await writeFile(path.join(OUT, 'markets_trad.json'), JSON.stringify(tradMarkets));
meta.counts.tradMarkets = tradMarkets.length; meta.dropped.tradMarkets = dropTm;
console.log(`  傳統市場 ${tradMarkets.length} 處，丟棄 ${dropTm}`);

// ---------- 5a2. 廚餘限時收受點（圖層，不進熱力） ----------
console.log('[5a2] 廚餘限時收受點');
const rpRows = await readCsv('recycle_points.csv', 'big5');
const recyclePoints = []; let dropRp = 0, noFood = 0;
for (const r of rpRows) {
  const lon = num(r['經度']), lat = num(r['緯度']); const note = (r['備註'] || '').replace(/\s+/g, ' ').trim();
  if (!(lon > 121.3 && lon < 121.8 && lat > 24.9 && lat < 25.3) || !inCity(lon, lat)) { dropRp++; continue; }
  // 備註註明「不含廚餘」或「僅收受…一般垃圾」者不收廚餘，排除
  const acceptsFood = !(/不含廚餘/.test(note) || (/僅收受/.test(note) && !/廚餘/.test(note)));
  if (!acceptsFood) { noFood++; continue; }
  recyclePoints.push({ team: (r['分隊'] || '').replace(/\s+/g, ''), district: r['行政區'] || '', addr: (r['地址'] || '').replace(/^臺北市/, ''), hours: note.replace(/^開放時間[：:]?/, ''), lon: r5(lon), lat: r5(lat) });
}
await writeFile(path.join(OUT, 'recycle_points.json'), JSON.stringify(recyclePoints));
meta.counts.recyclePointsRaw = rpRows.length; meta.counts.recyclePoints = recyclePoints.length; meta.dropped.recyclePoints = { outside: dropRp, noFoodWaste: noFood };
console.log(`  ${recyclePoints.length} 處收廚餘（原始 ${rpRows.length}，不收廚餘 ${noFood}，市外 ${dropRp}）`);

// ---------- 5a3. 疑似廚餘暫置點（EcoSentinel 整理，未證實；圖層，不進熱力） ----------
console.log('[5a3] 疑似廚餘暫置點');
try {
  const fw = JSON.parse(await readFile(path.resolve('raw/food_waste_nodes.json'), 'utf8'));
  const nodes = fw.nodes.map(n => { const [lon, lat] = tm2ToLonLat(n.x, n.y); return { ...n, x: undefined, y: undefined, lon, lat }; });
  await writeFile(path.join(OUT, 'food_waste_nodes.json'), JSON.stringify({ source: fw.source, transcribedAt: fw.transcribedAt, nodes }));
  meta.counts.foodWasteNodes = nodes.length;
  meta.sources['foodwaste'] = { name: '疑似廚餘暫置點（EcoSentinel 整理）', agency: 'EcoSentinel 生態守護系統（民間）', page: 'https://www.ecosentinel.tw/', rows: nodes.length, license: '未標示；轉錄引用' };
  console.log(`  ${nodes.length} 處（精確 ${nodes.filter(n => n.accuracy.startsWith('門牌')).length}、街道中位點 ${nodes.filter(n => !n.accuracy.startsWith('門牌')).length}）`);
} catch (e) { console.warn('  略過廚餘暫置點：', e.message); }

// ---------- 5b. 餐飲業者（食藥署 + 稅籍 + 衛生局評核，已於 prep:food 合併並轉座標） ----------
console.log('[5b] 餐飲業者');
const FOOD_STACK = { mode: 'sqrt', cap: 10 };   // 同一門牌多家店的堆疊方式：'log' → 1+ln(n)；'sqrt' → √n；'cap' → min(n, cap)；'none' → n
const stackWeight = (n) => FOOD_STACK.mode === 'log' ? 1 + Math.log(n) : FOOD_STACK.mode === 'sqrt' ? Math.sqrt(n) : FOOD_STACK.mode === 'cap' ? Math.min(n, FOOD_STACK.cap) : n;
let foodPts = [], foodAddr = [];
try {
  const foodRows = parse((await readFile(path.resolve('raw/food/food_merged.csv'))).toString('utf8').replace(/^﻿/, ''), { columns: true, skip_empty_lines: true });
  const byAddr = new Map();   // 門牌（座標取到 0.5 m）→ 店家列表
  let dropFood = 0;
  for (const r of foodRows) {
    const x = +r.X, y = +r.Y;
    if (!inTaipeiTM2(x, y)) { dropFood++; continue; }
    { const ll = tm2ToLonLat(x, y); if (!inCity(ll[0], ll[1])) { dropFood++; continue; } }
    const k = `${Math.round(x * 2)},${Math.round(y * 2)}`;
    if (!byAddr.has(k)) byAddr.set(k, { x, y, rows: [] });
    byAddr.get(k).rows.push(r);
  }
  const catCount = {};
  for (const a of byAddr.values()) {
    const n = a.rows.length, w = stackWeight(n);
    const [lon, lat] = tm2ToLonLat(a.x, a.y);
    foodPts.push([lon, lat, w]);
    const cats = {}; for (const r of a.rows) if (r.category) cats[r.category] = (cats[r.category] || 0) + 1;
    const topCat = Object.entries(cats).sort((p, q) => q[1] - p[1])[0]?.[0] || '';
    if (topCat) catCount[topCat] = (catCount[topCat] || 0) + 1;
    const grade = a.rows.map(r => r.hygiene_grade).find(Boolean) || '';
    const addr = (a.rows[0].addr || '').replace(/^台北市/, '臺北市').replace(/^臺北市/, '');
    // [lon, lat, 店數, 代表店名, 行業類別, 評核等級, 地址]
    const rep = a.rows.find(r => r.sources.includes('hyg')) || a.rows.find(r => r.sources.includes('fia')) || a.rows[0];
    foodAddr.push([lon, lat, n, rep.name, topCat, grade, addr]);
  }
  meta.counts.foodRows = foodRows.length;
  meta.counts.foodAddresses = foodAddr.length;
  meta.dropped.food = dropFood;
  meta.foodStack = FOOD_STACK;
  meta.counts.foodCategories = Object.fromEntries(Object.entries(catCount).sort((p, q) => q[1] - p[1]).slice(0, 10));
  const maxStack = Math.max(...foodAddr.map(f => f[2]));
  await writeFile(path.join(OUT, 'food.json'), JSON.stringify(foodAddr));
  console.log(`  ${foodRows.length} 家，${foodAddr.length} 個門牌，最大堆疊 ${maxStack} 家（權重 ${stackWeight(maxStack).toFixed(2)}），丟棄 ${dropFood}`);
} catch (e) {
  console.warn('  略過餐飲：', e.message, '（先執行 npm run prep:food）');
}

// ---------- 5c. 鳳頭蒼鷹觀察紀錄（疊加圖層，不進熱力） ----------
console.log('[5c] 鳳頭蒼鷹');
const RAPTOR_MAX_UNC = 1000;  // 座標不確定度 ≤ 500 m 畫點；500–1000 m（中華鳥會 1 km 網格）畫 500 m 淡圈；> 1000 m（10 km 網格）丟棄
try {
  const gb = JSON.parse(await readFile(path.resolve('raw/raptor/gbif.json'), 'utf8'));
  const inat = JSON.parse(await readFile(path.resolve('raw/raptor/inat.json'), 'utf8'));
  const all = [...gb.records, ...inat.records];
  const seen = new Set(); const pts = []; let coarse = 0, outside = 0, dup = 0, dead = 0;
  const isDead = (o) => o.basis === 'PRESERVED_SPECIMEN' || o.basis === 'FOSSIL_SPECIMEN' || /roadkill|路殺/i.test(o.dataset || '');   // 標本與路殺不是活動紀錄
  const srcNames = []; const srcIdx = (n) => { let i = srcNames.indexOf(n); if (i < 0) { srcNames.push(n); i = srcNames.length - 1; } return i; };
  for (const o of all) {
    if (!(o.lon > 0 && o.lat > 0)) continue;
    if (isDead(o)) { dead++; continue; }
    if (o.unc != null && o.unc > RAPTOR_MAX_UNC) { coarse++; continue; }
    if (!inCity(o.lon, o.lat)) { outside++; continue; }
    const k = `${o.date || o.year}|${Math.round(o.lon * 1000)}|${Math.round(o.lat * 1000)}`;   // 同日同 ~100 m 視為重複
    if (seen.has(k)) { dup++; continue; } seen.add(k);
    pts.push([r5(o.lon), r5(o.lat), o.year ?? null, srcIdx(o.dataset || o.src), o.date || '', o.unc ?? null]);
  }
  pts.sort((a, b) => (a[2] || 0) - (b[2] || 0));
  const years = pts.map(p => p[2]).filter(Boolean);
  // 1 km 網格紀錄（不確定度 500–1000 m）依格心合併：[lon, lat, 筆數, 最早年, 最近年, srcIdx]
  const fine = pts.filter(p => p[5] == null || p[5] <= 500);
  const cellMap = new Map();
  for (const p of pts.filter(p => p[5] > 500)) { const k = `${p[0].toFixed(3)},${p[1].toFixed(3)}`; const c = cellMap.get(k) || [p[0], p[1], 0, 9999, 0, p[3]]; c[2]++; if (p[2]) { c[3] = Math.min(c[3], p[2]); c[4] = Math.max(c[4], p[2]); } cellMap.set(k, c); }
  const cells = [...cellMap.values()].map(c => [c[0], c[1], c[2], c[3] === 9999 ? null : c[3], c[4] || null, c[5]]);
  meta.counts.raptorFine = fine.length; meta.counts.raptorCells = cells.length;
  await writeFile(path.join(OUT, 'raptor.json'), JSON.stringify({ taxon: 'Accipiter trivirgatus', sources: srcNames, fields: ['lon', 'lat', 'year', 'srcIdx', 'date', 'uncM'], cellFields: ['lon', 'lat', 'count', 'minYear', 'maxYear', 'srcIdx'], yearRange: [Math.min(...years), Math.max(...years)], points: fine, cells }));
  meta.counts.raptorRaw = all.length; meta.counts.raptor = pts.length;
  meta.dropped.raptor = { coarse, outside, dup, dead };
  meta.sources['raptor:gbif'] = { name: 'GBIF 鳳頭蒼鷹出現紀錄（' + [...new Set(pts.map(p => srcNames[p[3]]))].filter(n => n !== 'iNaturalist').join('、') + '）', agency: 'GBIF / 各資料集提供者', page: 'https://www.gbif.org/species/2480593', rows: gb.records.length, license: 'CC0 / CC BY 4.0', fetchedAt: gb.fetchedAt };
  meta.sources['raptor:inat'] = { name: 'iNaturalist 研究等級觀察（鳳頭蒼鷹）', agency: 'iNaturalist 社群', page: 'https://www.inaturalist.org/taxa/5231', rows: inat.records.length, license: 'CC0 / CC BY', fetchedAt: inat.fetchedAt };
  console.log(`  精確 ${fine.length} 點、1 km 網格 ${cells.length} 格（共 ${pts.length} 筆；原始 ${all.length}；標本/路殺 ${dead}、座標過粗 ${coarse}、市外 ${outside}、重複 ${dup}），年份 ${Math.min(...years)}–${Math.max(...years)}`);
} catch (e) { console.warn('  略過鳳頭蒼鷹：', e.message, '（先執行 npm run fetch:raptor）'); }

// ---------- 5d. 陳情系統時間序列（方法面板折線圖用） ----------
console.log('[5d] 陳情系統時間序列');
try {
  const pj = JSON.parse(await readFile(path.resolve('raw/petition/monthly_summary.json'), 'utf8'));
  const months = pj.months.filter(m => m.rows > 0).sort((a, b) => a.ym.localeCompare(b.ym));
  const out = { fetchedAt: pj.fetchedAt, page: pj.page, series: months.map(m => [m.year, m.month, m.rows, m.envBureau, m.vectorSection, m.publishedRodent]),
    fields: ['year', 'month', 'allPetitions', 'envBureau', 'vectorSection', 'publishedRodent'], firstSectionMonth: months.find(m => m.vectorSection != null)?.ym ?? null };
  await writeFile(path.join(OUT, 'petition.json'), JSON.stringify(out));
  meta.counts.petitionMonths = months.length;
  meta.sources['petition'] = { name: '臺北市陳情系統類別資料', agency: '研考會', page: pj.page, rows: months.length + ' 個月', fetchedAt: pj.fetchedAt };
  console.log(`  ${months.length} 個月，受理科室欄位自 ${out.firstSectionMonth} 起`);
} catch (e) { console.warn('  略過陳情時間序列：', e.message, '（先執行 npm run fetch:petition）'); }

// ---------- 6. 熱力霧狀貼圖預計算 ----------
// 權重固定後直接在建置階段把熱力算成一張 RGBA PNG，前端用 BitmapLayer 貼一張圖即可。
console.log('[6/6] 熱力貼圖');
import proj4 from 'proj4';
import { PNG } from 'pngjs';
import { TWD97_TM2 } from './lib/twd97.mjs';
const toTM2 = proj4('EPSG:4326', TWD97_TM2);

export const HEAT = {
  weights: { market: 1, sewer: 1, storm: 1, food: 1, garbage: 1, tmarket: 1 },   // ← 權重定案改這裡，重跑 npm run build
  cell: 30,                                        // 貼圖解析度（公尺/像素）
  sigma: { sewer: 250, storm: 250, market: 450, food: 200, garbage: 200, tmarket: 350 },  // 高斯核 σ（公尺）
  gamma: 1.25,                                     // 對比：>1 壓暗低值、突顯核心
  ramp: [[74, 10, 18, 0], [157, 21, 34, 110], [232, 64, 44, 190], [255, 148, 82, 235], [255, 233, 201, 255]], // RGBA 色階
};
const { cell: CELL, sigma: SIGMA, weights: W } = HEAT;
const srcPts = { sewer: sewerManholes, storm: stormManholes, market: markets.map(m => [m.lon, m.lat]), ...(foodPts.length ? { food: foodPts } : {}), garbage: garbageStops.map(g => [g.lon, g.lat]), tmarket: tradMarkets.map(m => [m.lon, m.lat]) };
const bb = [Infinity, Infinity, -Infinity, -Infinity];
const tm = {};
for (const [k, pts] of Object.entries(srcPts)) {
  tm[k] = pts.map(p => { const [x, y] = toTM2.forward([p[0], p[1]]); return [x, y, k === 'food' ? p[2] : 1]; });
  for (const [x, y] of tm[k]) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
}
const pad = 3 * Math.max(...Object.values(SIGMA));
const x0 = Math.floor((bb[0] - pad) / CELL) * CELL, y0 = Math.floor((bb[1] - pad) / CELL) * CELL;
const nx = Math.ceil((bb[2] + pad - x0) / CELL), ny = Math.ceil((bb[3] + pad - y0) / CELL);
const blur1D = (src, dst, n, m, stride, step, kern, r) => {           // 一維高斯
  for (let a = 0; a < m; a++) for (let b = 0; b < n; b++) {
    let acc = 0; for (let d = -r; d <= r; d++) { const bb2 = b + d; if (bb2 >= 0 && bb2 < n) acc += src[a * stride + bb2 * step] * kern[d + r]; }
    dst[a * stride + b * step] = acc; }
};
const density = {};
for (const [k, pts] of Object.entries(tm)) {
  const counts = new Float32Array(nx * ny);
  for (const [x, y, w] of pts) counts[Math.floor((y - y0) / CELL) * nx + Math.floor((x - x0) / CELL)] += w;
  const sg = SIGMA[k] / CELL, r = Math.ceil(3 * sg);
  const kern = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sg * sg)));
  const ksum = kern.reduce((a, b) => a + b, 0); for (let i = 0; i < kern.length; i++) kern[i] /= ksum;
  const tmp = new Float32Array(nx * ny), out = new Float32Array(nx * ny);
  blur1D(counts, tmp, nx, ny, nx, 1, kern, r);   // 橫向
  blur1D(tmp, out, ny, nx, 1, nx, kern, r);      // 縱向
  const nz = Array.from(out).filter(v => v > 0).sort((a, b) => a - b);
  const p99 = nz[Math.floor(nz.length * 0.99)] || 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / p99);
  density[k] = out;
}
const srcKeys = Object.keys(density);
const wsum = srcKeys.reduce((a, k) => a + W[k], 0);
const png = new PNG({ width: nx, height: ny });
const lerp = (a, b, f) => a + (b - a) * f;
const rampAt = (t) => { const R = HEAT.ramp; const x = Math.min(0.9999, Math.max(0, t)) * (R.length - 1), i = Math.floor(x), f = x - i; return R[i].map((v, c) => Math.round(lerp(v, R[i + 1][c], f))); };
let maxScore = 0, lit = 0;
const tGrid = new Float32Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const idx = j * nx + i;
  let acc = 0; for (const k of srcKeys) acc += W[k] * density[k][idx];
  const t = Math.pow(acc / wsum, HEAT.gamma);
  maxScore = Math.max(maxScore, t); if (t > 0.05) lit++;
  tGrid[idx] = t;
  const [R, G, B, A] = rampAt(t);
  const o = ((ny - 1 - j) * nx + i) * 4;        // PNG 第 0 列在上方（北）
  png.data[o] = R; png.data[o + 1] = G; png.data[o + 2] = B; png.data[o + 3] = A;
}
await writeFile(path.join(OUT, 'heat.png'), PNG.sync.write(png));
// 貼圖四角（逆時針：左下、左上、右上、右下），WGS84
const corner = (x, y) => { const [lon, lat] = toTM2.inverse([x, y]); return [r5(lon), r5(lat)]; };
const heatBounds = [corner(x0, y0), corner(x0, y0 + ny * CELL), corner(x0 + nx * CELL, y0 + ny * CELL), corner(x0 + nx * CELL, y0)];
await writeFile(path.join(OUT, 'heat.json'), JSON.stringify({ image: 'data/heat.png', width: nx, height: ny, cell: CELL, bounds: heatBounds, weights: Object.fromEntries(srcKeys.map(k => [k, W[k]])), sigma: Object.fromEntries(srcKeys.map(k => [k, SIGMA[k]])), gamma: HEAT.gamma, normalize: 'p99', foodStack: FOOD_STACK }));
meta.heat = { width: nx, height: ny, cell: CELL, weights: Object.fromEntries(srcKeys.map(k => [k, W[k]])), sigma: Object.fromEntries(srcKeys.map(k => [k, SIGMA[k]])), gamma: HEAT.gamma, litPx: lit, sources: srcKeys };
console.log(`  ${nx}×${ny} px @ ${CELL} m，${lit} 個像素熱度 > 0.05`);

// ---------- 6b. 分區統計：熱力均值 vs 外部分區指標（方法面板比對表） ----------
console.log('[6b] 分區統計');
// 外部分區指標，轉錄自 EcoSentinel（ecosentinel.tw，2026）：鼠患/千宅 = 見鼠地圖 2026-05 通報 ÷ 住宅數；屋齡與住宅密度引自內政部房屋稅籍住宅依屋齡統計 114Q4。
// 注意：見鼠地圖通報只有 2026 年 5 月、且為平台上線初期，通報量受網路熟悉度與新聞熱度影響，不代表長期鼠況。
const DISTRICT_EXT = {
  '萬華區': { ratPerK: 1.06, avgAge: 42.0, old40: 0.67, density: 8087 }, '士林區': { ratPerK: 0.57, avgAge: 41.8, old40: 0.66, density: 1484 },
  '松山區': { ratPerK: 1.36, avgAge: 41.4, old40: 0.63, density: 7145 }, '大安區': { ratPerK: 1.23, avgAge: 41.3, old40: 0.62, density: 8659 },
  '信義區': { ratPerK: 1.38, avgAge: 40.6, old40: 0.60, density: 6900 }, '大同區': { ratPerK: 0.99, avgAge: 40.4, old40: 0.59, density: 8201 },
  '中正區': { ratPerK: 1.39, avgAge: 39.7, old40: 0.57, density: 6985 }, '北投區': { ratPerK: 0.44, avgAge: 38.3, old40: 0.58, density: 1504 },
  '中山區': { ratPerK: 0.93, avgAge: 37.9, old40: 0.54, density: 7074 }, '文山區': { ratPerK: 0.52, avgAge: 35.5, old40: 0.48, density: 3010 },
  '南港區': { ratPerK: 0.65, avgAge: 34.4, old40: 0.50, density: 1891 }, '內湖區': { ratPerK: 0.46, avgAge: 33.4, old40: 0.40, density: 2944 },
};
{
  const accD = Object.fromEntries(districts.map(d => [d.properties.name, { sum: 0, n: 0, hot: 0 }]));
  const bboxes = districts.map(d => turf.bbox(d));
  const STEP = 2;
  for (let j = 0; j < ny; j += STEP) for (let i = 0; i < nx; i += STEP) {
    const t = tGrid[j * nx + i]; const [lon, lat] = toTM2.inverse([x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL]);
    for (let k = 0; k < districts.length; k++) { const bb = bboxes[k]; if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
      if (turf.booleanPointInPolygon([lon, lat], districts[k])) { const o = accD[districts[k].properties.name]; o.sum += t; o.n++; if (t > 0.5) o.hot++; break; } }
  }
  const rows = districts.map(d => { const n = d.properties.name, o = accD[n], e = DISTRICT_EXT[n] || {}; return { name: n, meanHeat: +(o.sum / o.n).toFixed(3), hotShare: +(o.hot / o.n).toFixed(3), ...e }; }).sort((a, b) => b.meanHeat - a.meanHeat);
  const rank = (a) => { const s2 = [...a].sort((x, y) => y - x); return a.map(v => s2.indexOf(v) + 1); };
  const spearman = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length; return +(1 - 6 * ra.reduce((s2, r, i) => s2 + (r - rb[i]) ** 2, 0) / (n * (n * n - 1))).toFixed(2); };
  const pearson = (a, b) => { const n = a.length, ma = a.reduce((s2, v) => s2 + v) / n, mb = b.reduce((s2, v) => s2 + v) / n; let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (a[i] - ma) * (b[i] - mb); sx += (a[i] - ma) ** 2; sy += (b[i] - mb) ** 2; } return +(sxy / Math.sqrt(sx * sy)).toFixed(2); };
  const mh = rows.map(r => r.meanHeat), pk = rows.map(r => r.ratPerK), dn = rows.map(r => r.density), ag = rows.map(r => r.avgAge);
  const stats = { heat_vs_ratPerK: { spearman: spearman(mh, pk), pearson: pearson(mh, pk) }, heat_vs_density: { spearman: spearman(mh, dn), pearson: pearson(mh, dn) }, ratPerK_vs_density: { spearman: spearman(pk, dn), pearson: pearson(pk, dn) }, heat_vs_age: { spearman: spearman(mh, ag), pearson: pearson(mh, ag) } };
  await writeFile(path.join(OUT, 'district_stats.json'), JSON.stringify({ rows, stats, external: { source: 'EcoSentinel 生態守護系統（ecosentinel.tw，2026）', ratdar: '見鼠地圖 2026-05 通報 814 筆', housing: '內政部房屋稅籍住宅依屋齡統計 114Q4', caveat: '見鼠地圖通報僅 2026 年 5 月，且為平台上線初期，不代表長期鼠況' } }));
  meta.districtStats = stats;
  console.log('  熱力均值 vs 鼠患/千宅 Spearman', stats.heat_vs_ratPerK.spearman, '| vs 住宅密度', stats.heat_vs_density.spearman);
}

// ---------- 6c. 地形高度貼圖（內政部 20 m DEM → 經緯度對齊的 Terrarium PNG） ----------
console.log('[6c] 地形貼圖');
const TERRAIN = { bbox: [121.40, 24.92, 121.72, 25.26], res: 0.0003, exaggeration: 1.6 };   // 經緯度範圍、像素解析度（度，約 30 m）、前端放大倍率
try {
  const JSZip = (await import('jszip')).default;
  // 臺北市分幅為主，新北市分幅（若有）補市界外的山系
  const demFiles = []; for (const z of ['raw/dtm/taipei_dem.zip', 'raw/dtm/newtaipei_dem.zip']) { try { const zip = await JSZip.loadAsync(await readFile(path.resolve(z))); demFiles.push(...Object.values(zip.files)); } catch {} }
  // 把所有圖幅讀進 TM2 20 m 網格的雜湊表（key: "E,N"）
  const dem = new Map(); let demN = 0; const dbb = [Infinity, Infinity, -Infinity, -Infinity];
  const [W0, S0, E0, N0] = TERRAIN.bbox; const tmBB = [toTM2.forward([W0, S0]), toTM2.forward([E0, N0])];   // 只保留範圍內的格點
  for (const f of demFiles) {
    if (!f.name.endsWith('.grd')) continue;
    const txt = await f.async('string');
    for (const line of txt.split('\n')) { const t = line.trim(); if (!t) continue; const [e, n, h] = t.split(/\s+/).map(Number); if (!(e > 0)) continue;
      if (e < tmBB[0][0] - 500 || e > tmBB[1][0] + 500 || n < tmBB[0][1] - 500 || n > tmBB[1][1] + 500) continue;
      dem.set(`${Math.round(e / 20)},${Math.round(n / 20)}`, h); demN++;
      if (e < dbb[0]) dbb[0] = e; if (n < dbb[1]) dbb[1] = n; if (e > dbb[2]) dbb[2] = e; if (n > dbb[3]) dbb[3] = n; }
  }
  const sample = (e, n) => {   // 雙線性內插；缺值回 null
    const ge = e / 20, gn = n / 20, i0 = Math.floor(ge), j0 = Math.floor(gn), fx = ge - i0, fy = gn - j0;
    const v = (i, j) => dem.get(`${i},${j}`);
    const a = v(i0, j0), b = v(i0 + 1, j0), c = v(i0, j0 + 1), d = v(i0 + 1, j0 + 1);
    if (a == null || b == null || c == null || d == null) { const any = [a, b, c, d].filter(x => x != null); return any.length ? any.reduce((p, q) => p + q, 0) / any.length : null; }
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  const [W, S, E, N] = TERRAIN.bbox, R = TERRAIN.res;
  const tw = Math.round((E - W) / R), th = Math.round((N - S) / R);
  const tpng = new PNG({ width: tw, height: th });
  let hmin = Infinity, hmax = -Infinity, covered = 0;
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const lon = W + (i + 0.5) * R, lat = N - (j + 0.5) * R;       // PNG 第 0 列在北
    const [e, n] = toTM2.forward([lon, lat]);
    let h = sample(e, n); if (h == null || h < -50) h = 0; else { covered++; if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
    const v = Math.round((h + 32768) * 256);                       // Terrarium：h = R*256 + G + B/256 − 32768
    const o = (j * tw + i) * 4; tpng.data[o] = (v >> 16) & 255; tpng.data[o + 1] = (v >> 8) & 255; tpng.data[o + 2] = v & 255; tpng.data[o + 3] = 255;
  }
  await writeFile(path.join(OUT, 'terrain.png'), PNG.sync.write(tpng));
  await writeFile(path.join(OUT, 'terrain.json'), JSON.stringify({ image: 'data/terrain.png', bounds: TERRAIN.bbox, width: tw, height: th, encoding: 'terrarium', exaggeration: TERRAIN.exaggeration, elevationRange: [+hmin.toFixed(1), +hmax.toFixed(1)], source: '內政部地政司 20 公尺網格數值地形模型（2025 臺北市分幅）', datum: 'TWD97 / TWVD2001' }));
  meta.terrain = { demPoints: demN, width: tw, height: th, coveredPx: covered, elevationRange: [+hmin.toFixed(1), +hmax.toFixed(1)] };
  meta.sources['dtm'] = { name: '全臺灣 20 公尺網格數值地形模型 DTM（2025 臺北市、新北市分幅）', agency: '內政部地政司', page: 'https://data.gov.tw/dataset/175239', rows: demN + ' 格點', license: '政府資料開放授權條款第 1 版' };
  console.log(`  DEM ${demN} 點 → ${tw}×${th} px，高程 ${hmin.toFixed(0)}–${hmax.toFixed(0)} m，涵蓋 ${(100 * covered / (tw * th)).toFixed(0)}% 像素`);
} catch (e) { console.warn('  略過地形：', e.message, '（先執行 npm run fetch 取得 raw/dtm/taipei_dem.zip）'); }

// ---------- 7. 污水管線光柵化 ----------
// 30,092 段線以 Xiaolin Wu 反鋸齒畫到覆蓋率緩衝區，烤成單色透明 PNG，前端只貼一張圖。
console.log('[7/7] 污水管線貼圖');
const LINE = { cell: 10, color: [47, 211, 111], alphaMax: 170, bloom: 0.35, classWeight: [1, 0.55, 0.3] };  // 公尺/像素、RGB、最大透明度、鄰格暈染、主幹/支管/接戶管相對亮度
{
  const pts = sewerLines.map(l => [toTM2.forward([l[0], l[1]]), toTM2.forward([l[2], l[3]]), LINE.classWeight[l[4]]]);
  const lb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [a, b] of pts) for (const [x, y] of [a, b]) { lb[0] = Math.min(lb[0], x); lb[1] = Math.min(lb[1], y); lb[2] = Math.max(lb[2], x); lb[3] = Math.max(lb[3], y); }
  const C = LINE.cell, lx0 = Math.floor(lb[0] / C) * C - 2 * C, ly0 = Math.floor(lb[1] / C) * C - 2 * C;
  const lnx = Math.ceil((lb[2] - lx0) / C) + 3, lny = Math.ceil((lb[3] - ly0) / C) + 3;
  const cov = new Float32Array(lnx * lny);
  let lineW = 1;
  const plot = (x, y, c) => { if (x >= 0 && x < lnx && y >= 0 && y < lny) { const i = y * lnx + x; cov[i] = Math.min(1, cov[i] + c * lineW); } };
  const fpart = (v) => v - Math.floor(v), rfpart = (v) => 1 - fpart(v);
  const wuLine = (x0, y0, x1, y1) => {                                  // 像素座標（浮點）
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) { [x0, y0] = [y0, x0]; [x1, y1] = [y1, x1]; }
    if (x0 > x1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    const dx = x1 - x0, dy = y1 - y0, grad = dx === 0 ? 1 : dy / dx;
    const put = (x, y, c) => steep ? plot(y, x, c) : plot(x, y, c);
    let xend = Math.round(x0), yend = y0 + grad * (xend - x0), xgap = rfpart(x0 + 0.5);
    const xpx1 = xend; let ypx1 = Math.floor(yend);
    put(xpx1, ypx1, rfpart(yend) * xgap); put(xpx1, ypx1 + 1, fpart(yend) * xgap);
    let intery = yend + grad;
    xend = Math.round(x1); yend = y1 + grad * (xend - x1); xgap = fpart(x1 + 0.5);
    const xpx2 = xend; const ypx2 = Math.floor(yend);
    put(xpx2, ypx2, rfpart(yend) * xgap); put(xpx2, ypx2 + 1, fpart(yend) * xgap);
    for (let x = xpx1 + 1; x < xpx2; x++) { put(x, Math.floor(intery), rfpart(intery)); put(x, Math.floor(intery) + 1, fpart(intery)); intery += grad; }
  };
  pts.sort((p, q) => p[2] - q[2]);   // 淡的先畫，主幹最後蓋上
  for (const [a, b, w] of pts) { lineW = w; wuLine((a[0] - lx0) / C, (a[1] - ly0) / C, (b[0] - lx0) / C, (b[1] - ly0) / C); }
  // 輕微暈染讓線在縮小時不會斷裂
  const soft = new Float32Array(lnx * lny);
  for (let j = 0; j < lny; j++) for (let i = 0; i < lnx; i++) {
    const idx = j * lnx + i; let v = cov[idx];
    if (i > 0) v += cov[idx - 1] * LINE.bloom; if (i < lnx - 1) v += cov[idx + 1] * LINE.bloom;
    if (j > 0) v += cov[idx - lnx] * LINE.bloom; if (j < lny - 1) v += cov[idx + lnx] * LINE.bloom;
    soft[idx] = Math.min(1, v);
  }
  const lpng = new PNG({ width: lnx, height: lny });
  for (let j = 0; j < lny; j++) for (let i = 0; i < lnx; i++) {
    const v = soft[j * lnx + i]; const o = ((lny - 1 - j) * lnx + i) * 4;
    lpng.data[o] = LINE.color[0]; lpng.data[o + 1] = LINE.color[1]; lpng.data[o + 2] = LINE.color[2]; lpng.data[o + 3] = Math.round(v * LINE.alphaMax);
  }
  await writeFile(path.join(OUT, 'sewer_lines.png'), PNG.sync.write(lpng));
  const lc = (x, y) => { const [lon, lat] = toTM2.inverse([x, y]); return [r5(lon), r5(lat)]; };
  const lineBounds = [lc(lx0, ly0), lc(lx0, ly0 + lny * C), lc(lx0 + lnx * C, ly0 + lny * C), lc(lx0 + lnx * C, ly0)];
  await writeFile(path.join(OUT, 'sewer_lines.json'), JSON.stringify({ image: 'data/sewer_lines.png', width: lnx, height: lny, cell: C, bounds: lineBounds, segments: sewerLines.length, segmentsRaw: lineRows.length, classes: lineClass, vector: 'data/sewer_lines.bin', origin: [121.5, 25.05] }));
  meta.sewerLinesRaster = { width: lnx, height: lny, cell: C };
  console.log(`  ${lnx}×${lny} px @ ${C} m`);
}

// ---------- bbox / meta ----------
const all = [...sewerManholes, ...stormManholes, ...markets.map(m => [m.lon, m.lat])];
const lons = all.map(p => p[0]), lats = all.map(p => p[1]);
meta.bbox = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log('bbox', meta.bbox);
console.log('done →', OUT);
