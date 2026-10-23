// 臺北市陳情系統類別資料：抓齊所有月份 → raw/petition/<民國年月>.csv，並彙整每月件數 → raw/petition/monthly_summary.json
// 用途：環保局「水質病媒管制科」受理件數 = 鼠類＋病媒通報的全市時間序列（無地址、無分區）
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const DIR = path.resolve('raw/petition');
await mkdir(DIR, { recursive: true });
const UA = { 'User-Agent': 'taipei-rat-map/0.1 (research)' };
const DATASET = 'cb423c17-88eb-4231-a725-f1b93247d1bf';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 新聞轉述的環保局鼠患通報件數（BBC 中文 2026-10；僅供對照）
const PUBLISHED_RODENT = { '11401': 11, '11402': 24, '11403': 26, '11404': 20, '11501': 37, '11502': 258, '11503': 90, '11504': 76 };

async function resourceList() {
  const res = await fetch('https://data.gov.tw/api/v2/rest/dataset/121792', { headers: UA });
  if (!res.ok) throw new Error('data.gov.tw HTTP ' + res.status);
  const d = await res.json(); const r = d.result ?? d;
  return r.distribution.map(x => { const m = /^(\d{5})案件類別趨勢明細表/.exec(x.resourceDescription); const rid = /resource\/([0-9a-f-]{36})\/download/.exec(x.resourceDownloadUrl)?.[1]; return m && rid ? { ym: m[1], rid } : null; }).filter(Boolean).sort((a, b) => a.ym.localeCompare(b.ym));
}

async function download(ym, rid) {
  const file = path.join(DIR, ym + '.csv');
  try { const s = await stat(file); if (s.size > 100000) return 'cached'; } catch {}
  for (let t = 1; t <= 3; t++) {
    const res = await fetch(`https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=${rid}`, { headers: UA, redirect: 'follow' });
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok && buf.length > 100000) { await writeFile(file, buf); return 'ok'; }
    await sleep(8000 * t);
  }
  throw new Error(`${ym} 下載失敗`);
}

function summarize(ym, buf) {
  let txt = buf.toString('utf8').replace(/^﻿/, '');
  const rows = parse(txt, { columns: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true });
  const cols = Object.keys(rows[0] || {});
  const hasOrg = cols.includes('受理機關'), hasSec = cols.includes('受理科室');
  const isEnv = (r) => /環境保護局|環保局/.test(r['受理機關'] || '');
  const env = hasOrg ? rows.filter(isEnv) : [];
  const vec = hasSec ? env.filter(r => r['受理科室'] === '水質病媒管制科') : [];
  const sub = (name) => vec.filter(r => (r['案件次類別'] || r['案件子類別'] || '') === name).length;
  return { ym, year: 1911 + +ym.slice(0, 3), month: +ym.slice(3), rows: rows.length, schema: hasSec ? 'v2' : 'v1',
    envBureau: hasOrg ? env.length : null, vectorSection: hasSec ? vec.length : null,
    vecRoadClean: hasSec ? sub('路面清潔（含行人果皮箱、菸蒂、狗便）') : null, vecOther: hasSec ? sub('其他事項') : null, vecInspection: hasSec ? sub('環保稽查') : null,
    publishedRodent: PUBLISHED_RODENT[ym] ?? null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = await resourceList();
  console.log(`資源 ${list.length} 個月：${list[0].ym} → ${list[list.length - 1].ym}`);
  const summary = []; let failed = 0;
  for (const { ym, rid } of list) {
    try {
      const st = await download(ym, rid);
      const s = summarize(ym, await readFile(path.join(DIR, ym + '.csv')));
      summary.push(s);
      console.log(`${st === 'cached' ? '  ' : 'DL'} ${ym}  rows ${s.rows}  schema ${s.schema}  病媒科 ${s.vectorSection ?? '-'}`);
      if (st !== 'cached') await sleep(2500);
    } catch (e) { failed++; console.error('FAIL', ym, e.message); }
  }
  await writeFile(path.join(DIR, 'monthly_summary.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), dataset: DATASET, page: 'https://data.taipei/dataset/detail?id=' + DATASET, months: summary }, null, 1));
  const csv = ['ym,year,month,rows,schema,envBureau,vectorSection,vecRoadClean,vecOther,vecInspection,publishedRodent', ...summary.map(s => [s.ym, s.year, s.month, s.rows, s.schema, s.envBureau, s.vectorSection, s.vecRoadClean, s.vecOther, s.vecInspection, s.publishedRodent].map(v => v ?? '').join(','))].join('\n');
  await writeFile(path.join(DIR, 'monthly_summary.csv'), csv + '\n');
  console.log(`完成：${summary.length} 個月，失敗 ${failed}`);
  if (failed) process.exit(1);
}
