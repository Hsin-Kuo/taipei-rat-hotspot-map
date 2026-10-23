// 下載五份原始資料到 raw/，並記錄 manifest。
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const RAW = path.resolve('raw');
export const SOURCES = [
  { file: 'sewer_lines.csv',     name: '臺北市污水下水道管線',       agency: '工務局衛工處',
    url: 'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=88157465-4794-41a2-a409-6180b3952f6b',
    page: 'https://data.taipei/dataset/detail?id=af1e6e42-5ffc-4be0-983f-51c03d5d1b17' },
  { file: 'sewer_manholes.csv',  name: '臺北市污水下水道人孔',       agency: '工務局衛工處',
    url: 'https://data.taipei/api/dataset/e858ba08-52d5-4afb-bc6e-ed1cd9a27a3b/resource/c0e06fbb-6a9d-4bcf-9458-bea0269e91ee/download',
    page: 'https://data.gov.tw/dataset/136379' },
  { file: 'sewer_inlets.csv',    name: '臺北市污水下水道陰井',       agency: '工務局衛工處',
    url: 'https://data.taipei/api/dataset/a333ae12-b612-435a-8b8a-751ef4c77339/resource/21c0f889-6d32-4245-9983-6989b7db4643/download',
    page: 'https://data.gov.tw/dataset/136377' },
  { file: 'storm_manholes.csv',  name: '臺北市水利處雨水下水道人孔資料', agency: '工務局水利處',
    url: 'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=dcaebd40-45e1-48f6-9d2e-00e1c0283f8a',
    page: 'https://data.taipei/dataset/detail?id=3e62c860-0753-4c79-8fe1-bcb3e0243534' },
  { file: 'markets.csv',         name: '臺北市攤販集中場',           agency: '市場處',
    url: 'https://data.taipei/api/dataset/c013d9ec-a550-46bd-ac60-45f085930706/resource/4874f750-b972-4c42-ad76-986960670c70/download',
    page: 'https://data.gov.tw/dataset/121594' },
  { file: 'garbage_trucks.csv',  name: '臺北市垃圾車點位路線資訊',   agency: '環境保護局',
    url: 'https://data.taipei/api/dataset/6bb3304b-4f46-4bb0-8cd1-60c66dcd1cae/resource/a6e90031-7ec4-4089-afb5-361a4efe7202/download',
    page: 'https://data.gov.tw/dataset/136515' },
  { file: 'markets_trad.csv',    name: '臺北市傳統市(商)場',          agency: '市場處',
    url: 'https://data.taipei/api/dataset/89bebb3a-990d-4070-bd67-631a575f6d4a/resource/35acfce1-2c4d-4c70-aa75-601cdab2b3f7/download',
    page: 'https://data.gov.tw/dataset/121593' },
  { file: 'recycle_points.csv',  name: '臺北市垃圾資源回收、廚餘回收限時收受點', agency: '環境保護局',
    url: 'https://data.taipei/api/dataset/1acf38f3-1509-4cb1-898a-9b1d4f31a3af/resource/0263f0ce-403a-45ed-a407-c69285b6cad2/download',
    page: 'https://data.gov.tw/dataset/132357' },
  { file: 'road8m.zip',          name: '臺北市寬度超過8公尺道路GIS圖資', agency: '工務局新工處',
    url: 'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=074a401d-45a2-4748-bf62-7d5372d53d45',
    page: 'https://data.taipei/dataset/detail?id=ee2e4015-8844-48fb-aa57-31209909b0fc' },
  { file: 'mrt_routes.json',     name: '臺北都會區大眾捷運系統路網圖', agency: '捷運工程局',
    url: 'https://data.taipei/api/dataset/afccd2ac-75b1-4362-9099-45983e332776/resource/1139b06e-8128-4a07-8148-f27f038bd8b4/download',
    page: 'https://data.gov.tw/dataset/121208' },
  { file: 'mrt_stations.json',   name: '臺北都會區大眾捷運系統車站點位圖', agency: '捷運工程局',
    url: 'https://data.taipei/api/dataset/758e5ae0-e6ee-448b-81f5-316eb68a5ba7/resource/a63e3278-9d10-4916-9f24-e5a4d78afb31/download',
    page: 'https://data.gov.tw/dataset/121140' },
  { file: 'dtm/taipei_dem.zip',  name: '分幅_臺北市20MDEM(2025)（全臺灣20公尺網格數值地形模型）', agency: '內政部地政司',
    url: 'https://www.tgos.tw/MDE/VirtualDir_TC/Product/60e634ea-7c59-47a4-a967-ac33694e0d05/%E5%88%86%E5%B9%85_%E8%87%BA%E5%8C%97%E5%B8%8220MDEM(2025).zip',
    page: 'https://data.gov.tw/dataset/175239' },
  { file: 'dtm/newtaipei_dem.zip', name: '分幅_新北市20MDEM(2025)（補市界外山系）', agency: '內政部地政司',
    url: 'https://www.tgos.tw/MDE/VirtualDir_TC/Product/9574dbb5-ca32-4ea3-aaf7-a9f582b9357b/%E5%88%86%E5%B9%85_%E6%96%B0%E5%8C%97%E5%B8%8220MDEM(2025).zip',
    page: 'https://data.gov.tw/dataset/175239' },
  { file: 'li_boundary.zip',     name: '臺北市里界圖',               agency: '民政局',
    url: 'https://data.taipei/api/dataset/6b17b31d-4e16-495e-95b1-9fd1f47c80d8/resource/145e30da-58f3-45db-a125-8adc3fde2620/download',
    page: 'https://data.taipei/dataset/detail?id=6b17b31d-4e16-495e-95b1-9fd1f47c80d8' },
];

async function download(src) {
  const res = await fetch(src.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${src.name}: HTTP ${res.status} ${src.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`${src.name}: 檔案過小 (${buf.length} bytes)，疑似錯誤頁`);
  await writeFile(path.join(RAW, src.file), buf);
  return buf.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(RAW, { recursive: true });
  await mkdir(path.join(RAW, 'dtm'), { recursive: true });
  const manifest = { fetchedAt: new Date().toISOString(), files: {} };
  let failed = 0;
  for (const src of SOURCES) {
    try {
      const size = await download(src);
      manifest.files[src.file] = { name: src.name, agency: src.agency, page: src.page, bytes: size };
      console.log(`OK   ${src.file}  ${(size / 1e6).toFixed(2)} MB  ${src.name}`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${src.file}: ${e.message}`);
      // 保留既有檔案（若有）
      try { const s = await stat(path.join(RAW, src.file)); manifest.files[src.file] = { name: src.name, agency: src.agency, page: src.page, bytes: s.size, stale: true }; } catch {}
    }
  }
  await writeFile(path.join(RAW, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (failed) process.exit(1);
}
