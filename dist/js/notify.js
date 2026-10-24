// 民眾通知清單：範圍內＋外溢環帶經過的里、里長聯絡（使用者匯入）、公告稿範本；只產生與匯出，不實際發送
import { TASK_TYPES, BAITS, EXECUTORS, notifyMethodsText } from './params.js';
import { store, download } from './store.js';
import { $, esc } from './util.js';

const csvCell = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
// CSV 公式注入防護：以 = + - @ 開頭的值加上單引號
const safe = (v) => /^[=+\-@]/.test(String(v ?? '')) ? "'" + v : v;

export function affectedVillages(app, t) {
  const { G, E } = app;
  const geo = E.taskGeometry(G, app.env, t.scope.villages, app.params.tasks[t.type].ring);
  const ring = new Set(); for (const m of geo.ring) ring.add(G.villages[G.vid[G.cells[m]] - 1]);
  const scope = new Set(t.scope.villages);
  for (const c of scope) ring.delete(c);
  return [...[...scope].map(c => [c, '範圍內']), ...[...ring].sort().map(c => [c, '外溢環帶'])];
}

function executorText(t) {
  const x = t.executor || {};
  return x.kind === 'team' ? `${x.team}清潔隊${x.squad ? x.squad : ''}` : x.kind === 'vendor' ? `${x.vendor}（受託廠商）` : x.kind === 'other' ? x.other : EXECUTORS[x.kind] || '';
}

export function noticeText(app, t) {
  const names = t.scope.villages.map(c => { const p = app.villages.props(c); return p ? p.district + p.name : c; });
  const lines = [
    `【鼠類防治作業公告】`,
    `為維護環境衛生，${executorText(t)}將於 ${t.start}${t.end && t.end !== t.start ? ` 至 ${t.end}` : ''} 在${names.join('、')}執行${TASK_TYPES[t.type]}作業（案號 ${t.caseNo}）。`,
  ];
  if (t.type === 'poison') lines.push(`本次使用${(BAITS[t.bait?.kind] || '').replace(/（.*）/, '')}，${t.bait?.points ? `共設置 ${t.bait.points} 處加蓋餌站，` : ''}請勿觸碰餌站，並看管好兒童與寵物。發現鼠屍請勿徒手拾取，請通報清潔隊處理。`);
  if (t.type === 'clean') lines.push('作業期間請配合清除住家周邊堆積物與廚餘，並將垃圾密封、勿落地。');
  if (t.type === 'trap') lines.push('作業期間將設置捕鼠籠，請勿移動或觸碰。');
  if (t.type === 'fill') lines.push('作業期間將填補建物周邊與水溝之鼠洞，請配合開放檢查。');
  lines.push('鄰近里別亦可能有鼠隻移入，請一併注意門窗、排水孔防護及食物收納。', `聯絡窗口：${executorText(t)}`);
  return lines.join('\n');
}

export function openNotify(app, t) {
  if (!t) return;
  const dlg = $('notify');
  const rows = affectedVillages(app, t);
  const text = noticeText(app, t);
  const render = () => {
    const c = store.contacts;
    dlg.querySelector('tbody').innerHTML = rows.map(([code, rel]) => { const p = app.villages.props(code) || {}; const k = c[code] || {};
      return `<tr><td>${esc(p.district)}</td><td>${esc(p.name)}</td><td><span class="rel ${rel === '範圍內' ? 'in' : ''}">${rel}</span></td><td>${esc(k.chief || '')}</td><td>${esc(k.phone || '')}</td></tr>`; }).join('');
    dlg.querySelector('.ncount').textContent = `範圍內 ${rows.filter(r => r[1] === '範圍內').length} 里、外溢環帶 ${rows.filter(r => r[1] !== '範圍內').length} 里；里長資料 ${rows.filter(([code]) => c[code]?.chief).length} 筆`;
  };
  dlg.innerHTML = `
    <form method="dialog" class="dlg">
      <header class="card-h"><div><div class="eyebrow">民眾通知 · ${esc(t.caseNo)}</div><h3>通知清單</h3></div><button class="x" value="close" aria-label="關閉">×</button></header>
      <p class="ncount muted"></p>
      <div class="ntable-wrap"><table class="ntable"><thead><tr><th>區</th><th>里</th><th>關係</th><th>里長</th><th>電話</th></tr></thead><tbody></tbody></table></div>
      <p class="hint">里長姓名與電話目前沒有開放資料，可匯入 CSV（欄位：村里代碼,里長,電話；或 區,里,里長,電話）。資料只存在本機瀏覽器。</p>
      <h4>公告稿範本 <span class="count">${esc(notifyMethodsText(t))}${t.notify?.date ? ' · ' + esc(t.notify.date) : ''}</span></h4>
      <textarea class="ntext" rows="8">${esc(text)}</textarea>
      <div class="actions">
        <button class="btn" type="button" data-act="csv">匯出通知清單 CSV</button>
        <button class="btn" type="button" data-act="copy">複製公告稿</button>
        <label class="btn">匯入里長 CSV<input type="file" accept=".csv,text/csv" hidden></label>
      </div>
      <p class="hint">設計構想（本 demo 未實作）：串接臺北通 APP，推播給訂閱上述里別的使用者。</p>
    </form>`;
  render();
  dlg.querySelector('[data-act=csv]').addEventListener('click', () => {
    const c = store.contacts;
    const head = ['案號', '任務類型', '開始', '結束', '區', '里', '村里代碼', '關係', '里長', '電話'];
    const body = rows.map(([code, rel]) => { const p = app.villages.props(code) || {}; const k = c[code] || {}; return [t.caseNo, TASK_TYPES[t.type], t.start, t.end, p.district, p.name, code, rel, k.chief, k.phone]; });
    download(`通知清單_${t.caseNo}.csv`, '﻿' + [head, ...body].map(r => r.map(v => csvCell(safe(v))).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  });
  dlg.querySelector('[data-act=copy]').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(dlg.querySelector('.ntext').value); e.target.textContent = '已複製'; } catch { dlg.querySelector('.ntext').select(); }
  });
  dlg.querySelector('input[type=file]').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = importContacts(app, await f.text()); render(); alert(`已匯入 ${n} 筆里長資料`); }
    catch (err) { alert('匯入失敗：' + err.message); }
  });
  dlg.showModal();
}

// 簡易 CSV 解析（支援雙引號欄位）
function parseCsv(txt) {
  const rows = []; let row = [], cur = '', q = false;
  txt = txt.replace(/^﻿/, '');
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

function importContacts(app, txt) {
  const rows = parseCsv(txt); if (rows.length < 2) throw new Error('沒有資料列');
  const h = rows[0].map(s => s.trim());
  const ix = (names) => h.findIndex(x => names.includes(x));
  const iCode = ix(['村里代碼', 'code', 'VILLCODE']), iD = ix(['區', '行政區']), iV = ix(['里', '村里']), iC = ix(['里長', '里長姓名']), iP = ix(['電話', '里辦公處電話']);
  if (iC < 0) throw new Error('找不到「里長」欄位');
  if (iCode < 0 && (iD < 0 || iV < 0)) throw new Error('需要「村里代碼」或「區」＋「里」欄位');
  const byName = new Map(app.villages.feats.map(f => [f.properties.district + f.properties.name, f.properties.code]));
  const c = { ...store.contacts }; let n = 0;
  for (const r of rows.slice(1)) {
    const code = iCode >= 0 ? r[iCode].trim() : byName.get(r[iD].trim() + r[iV].trim());
    if (!code || !app.villages.byCode.has(code)) continue;
    c[code] = { chief: (r[iC] || '').trim().slice(0, 30), phone: iP >= 0 ? (r[iP] || '').trim().slice(0, 30) : '' }; n++;
  }
  store.setContacts(c);
  return n;
}
