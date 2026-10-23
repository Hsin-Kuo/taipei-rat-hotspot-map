// 餐飲業者四份來源：下載 → 只留臺北市餐飲 → raw/food/
//   1. 食藥署 食品業者登錄資料集（ZIP 內 CSV，約 83 萬列，取「餐飲場所」且地址為臺北市）
//   2. 財政部 全國營業(稅籍)登記（322 MB CSV 串流，取行業代號 56 開頭且營業地址為臺北市）
//   3. 臺北市衛生局 餐飲衛生管理分級評核業者
//   4. 民政局 臺北市門牌位置數值資料（地址 → TWD97 座標 用）
// 之後執行 scripts/geocode.py 與 scripts/merge_food.py（見 package.json 的 prep:food）
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import JSZip from 'jszip';

const DIR = path.resolve('raw/food');
await mkdir(DIR, { recursive: true });
const UA = { 'User-Agent': 'taipei-rat-map/0.1' };
const isTaipei = (a) => a.startsWith('臺北市') || a.startsWith('台北市');

export const FOOD_SOURCES = {
  fda: { name: '食品業者登錄資料集', agency: '衛生福利部食品藥物管理署', page: 'https://data.gov.tw/dataset/8938', url: 'https://data.fda.gov.tw/data/opendata/export/97/csv' },
  fia: { name: '全國營業(稅籍)登記資料集', agency: '財政部財政資訊中心', page: 'https://data.gov.tw/dataset/9400', url: 'https://eip.fia.gov.tw/data/BGMOPEN1.csv' },
  hygiene: { name: '臺北市通過餐飲衛生管理分級評核業者', agency: '臺北市政府衛生局', page: 'https://data.gov.tw/dataset/145738', url: 'https://data.taipei/api/dataset/59579c19-a561-4564-8c0f-545bfb32c0f6/resource/c5646d80-9118-4439-b924-075f96371d75/download' },
  housenum: { name: '臺北市門牌位置數值資料', agency: '臺北市政府民政局', page: 'https://data.taipei/dataset/detail?id=b7c8e724-1e98-45ee-a0bd-f3840623ed97', url: 'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=ce76ca0c-7f94-4935-ab47-1d2a41ca2abb' },
};

// 極簡 CSV 列解析（處理引號與引號內逗號）
function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
const q = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';

async function fdaTask() {
  const res = await fetch(FOOD_SOURCES.fda.url, { headers: UA });
  if (!res.ok) throw new Error('fda HTTP ' + res.status);
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  const entry = Object.values(zip.files).find(f => f.name.endsWith('.csv'));
  const txt = (await entry.async('string')).replace(/^﻿/, '');
  const lines = txt.split(/\r?\n/); const out = [lines[0]]; let n = 0;
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const r = splitCsv(lines[i]); if (r.length >= 5 && r[4] === '餐飲場所' && isTaipei(r[2])) { out.push(lines[i]); n++; } }
  await writeFile(path.join(DIR, 'fda_taipei_food.csv'), out.join('\n') + '\n');
  return n;
}

async function fiaTask() {
  const res = await fetch(FOOD_SOURCES.fia.url, { headers: UA });
  if (!res.ok) throw new Error('fia HTTP ' + res.status);
  let rest = '', n = 0, first = true;
  const filter = new Transform({
    transform(chunk, _e, cb) {
      rest += chunk.toString('utf8'); const lines = rest.split('\n'); rest = lines.pop();
      const keep = [];
      for (const ln of lines) {
        if (first) { first = false; keep.push(ln.replace(/^﻿/, '')); continue; }
        if (!ln.startsWith('"臺北市') && !ln.startsWith('臺北市')) continue;
        const r = splitCsv(ln.replace(/\r$/, ''));
        if (r.length >= 16 && [8, 10, 12, 14].some(i => (r[i] || '').startsWith('56'))) { keep.push(ln); n++; }
      }
      cb(null, keep.length ? keep.join('\n') + '\n' : '');
    },
  });
  await pipeline(Readable.fromWeb(res.body), filter, createWriteStream(path.join(DIR, 'fia_taipei_food.csv')));
  return n;
}

async function plainTask(key, file) {
  const res = await fetch(FOOD_SOURCES[key].url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(key + ' HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path.join(DIR, file)));
  return (await readFile(path.join(DIR, file), 'utf8')).split('\n').length - 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tasks = { fda: fdaTask, fia: fiaTask, hygiene: () => plainTask('hygiene', 'hygiene.csv'), housenum: () => plainTask('housenum', '../taipei_housenum.csv') };
  const only = process.argv.slice(2);
  const manifest = { fetchedAt: new Date().toISOString(), files: {} };
  let failed = 0;
  for (const [k, fn] of Object.entries(tasks)) {
    if (only.length && !only.includes(k)) continue;
    try { const n = await fn(); manifest.files[k] = { ...FOOD_SOURCES[k], rows: n }; console.log(`OK   ${k}  ${n} 列  ${FOOD_SOURCES[k].name}`); }
    catch (e) { failed++; console.error(`FAIL ${k}: ${e.message}`); }
  }
  await writeFile(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (failed) process.exit(1);
}
