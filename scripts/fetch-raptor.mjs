// 鳳頭蒼鷹 (Accipiter trivirgatus) 觀察紀錄：GBIF + iNaturalist，只取 CC0 / CC BY 授權，存 raw/raptor/
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve('raw/raptor');
await mkdir(DIR, { recursive: true });
const UA = { 'User-Agent': 'taipei-rat-map/0.1 (research; contact via repo)' };
const BBOX = { w: 121.44, s: 24.95, e: 121.68, n: 25.22 };
const TAXON = 'Accipiter trivirgatus';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function gbif() {
  const poly = `POLYGON((${BBOX.w} ${BBOX.s},${BBOX.e} ${BBOX.s},${BBOX.e} ${BBOX.n},${BBOX.w} ${BBOX.n},${BBOX.w} ${BBOX.s}))`;
  const out = []; const datasets = {};
  for (const license of ['CC0_1_0', 'CC_BY_4_0']) {
    for (let offset = 0; ; offset += 300) {
      const u = `https://api.gbif.org/v1/occurrence/search?scientificName=${encodeURIComponent(TAXON)}&geometry=${encodeURIComponent(poly)}&hasCoordinate=true&license=${license}&limit=300&offset=${offset}`;
      const res = await fetch(u, { headers: UA }); if (!res.ok) throw new Error('gbif HTTP ' + res.status);
      const d = await res.json();
      for (const o of d.results) {
        if (o.decimalLatitude == null) continue;
        datasets[o.datasetKey] = o.datasetName || o.datasetKey;
        out.push({ src: 'gbif', id: o.key, datasetKey: o.datasetKey, lon: o.decimalLongitude, lat: o.decimalLatitude, date: o.eventDate ? o.eventDate.slice(0, 10) : null, year: o.year ?? null,
          dataset: o.datasetName || '', basis: o.basisOfRecord || '', unc: o.coordinateUncertaintyInMeters ?? null, license: o.license || license });
      }
      if (d.endOfRecords || d.results.length === 0) break;
      await sleep(200);
    }
  }
  // 解析資料集名稱與授權（occurrence 回傳常缺 datasetName）
  for (const key of Object.keys(datasets)) {
    try { const d = await (await fetch(`https://api.gbif.org/v1/dataset/${key}`, { headers: UA })).json(); datasets[key] = { title: d.title, license: d.license || '' }; } catch { datasets[key] = { title: key, license: '' }; }
  }
  for (const o of out) o.dataset = datasets[o.datasetKey]?.title || o.dataset;
  await writeFile(path.join(DIR, 'gbif.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), taxon: TAXON, bbox: BBOX, datasets, records: out }));
  return out.length;
}

async function inat() {
  const out = [];
  for (let page = 1; ; page++) {
    const u = `https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(TAXON)}&quality_grade=research&license=cc0,cc-by&geoprivacy=open&nelat=${BBOX.n}&nelng=${BBOX.e}&swlat=${BBOX.s}&swlng=${BBOX.w}&per_page=200&page=${page}&order_by=observed_on`;
    const res = await fetch(u, { headers: UA }); if (!res.ok) throw new Error('inat HTTP ' + res.status);
    const d = await res.json();
    for (const o of d.results) {
      if (!o.geojson || o.obscured) continue;
      const [lon, lat] = o.geojson.coordinates;
      out.push({ src: 'inat', id: o.id, lon, lat, date: (o.observed_on || '').slice(0, 10) || null, year: o.observed_on ? +o.observed_on.slice(0, 4) : null,
        dataset: 'iNaturalist', basis: 'HUMAN_OBSERVATION', unc: o.positional_accuracy ?? null, license: o.license_code || '', url: o.uri });
    }
    if (d.results.length < 200 || page * 200 >= d.total_results) break;
    await sleep(1000);   // iNat 禮貌速率
  }
  await writeFile(path.join(DIR, 'inat.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), taxon: TAXON, bbox: BBOX, records: out }));
  return out.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const g = await gbif(); console.log(`OK   gbif  ${g} 筆（CC0 / CC BY）`);
  const i = await inat(); console.log(`OK   inat  ${i} 筆（CC0 / CC BY，研究等級，未模糊化）`);
}
