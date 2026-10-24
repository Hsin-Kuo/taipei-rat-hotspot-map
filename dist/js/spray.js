// 定期噴藥（環保局戶外環境噴藥日程表）：預載 dist/data/spray_schedule.json，可匯入同格式 JSON 取代
// 每筆 = 某里某日的一次噴藥，轉成唯讀的定期任務（type 'spray'，recurring: true）進模型
import { $, esc } from './util.js';

const KEY = 'taipei-rat-tool/spray-v1';     // 匯入的日程（獨立於任務資料，約 0.5 MB）

export function validateSchedule(obj, villageCodes) {
  const list = Array.isArray(obj) ? obj : obj?.entries;
  if (!Array.isArray(list)) throw new Error('找不到 entries 陣列');
  const ok = [], bad = [];
  list.forEach((e, i) => {
    const date = String(e.date || ''), code = String(e.code || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) bad.push([i + 1, '日期格式須為 YYYY-MM-DD']);
    else if (!villageCodes.has(code)) bad.push([i + 1, '村里代碼不存在']);
    else ok.push({ date, code, district: String(e.district || '').slice(0, 10), village: String(e.village || '').slice(0, 10), source: String(e.source || '匯入').slice(0, 80) });
  });
  return { ok, bad, source: String(obj.source || '匯入的日程').slice(0, 120), url: /^https:\/\//.test(obj.url || '') ? obj.url : '' };
}

export function createSpray(app, preloaded) {
  const { G, villages, E } = app;
  let sched = preloaded, origin = 'preload';
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s?.entries?.length) { sched = s; origin = 'import'; } } catch { /* 無法讀取就用預載 */ }

  let byCode, tasks;
  function index() {
    byCode = new Map();
    for (const e of sched.entries) { if (!byCode.has(e.code)) byCode.set(e.code, []); byCode.get(e.code).push(e.date); }
    for (const ds of byCode.values()) ds.sort();
    tasks = sched.entries.map(e => {
      const d = E.dayOf(e.date, app.today);
      return { id: `spray-${e.date}-${e.code}`, caseNo: `定期-${e.date.slice(2).replace(/-/g, '')}-${e.code.slice(-3)}`, type: 'spray', recurring: true,
        status: d < 0 ? 'done' : d === 0 ? 'active' : 'planned', scope: { type: 'villages', villages: [e.code], geometry: null },
        start: e.date, end: e.date, executor: { kind: 'team', team: villages.props(e.code)?.district || e.district },
        createdByName: '環保局日程表', source: e.source, notify: { enabled: true, methods: ['board'], date: E.isoOf(d - 2, app.today) } };
    });
  }
  index();

  // 里在某日前後的噴藥日（上次 ≤ day < 下次）
  function around(code, day) {
    const ds = byCode.get(code) || [], iso = E.isoOf(day, app.today);
    let last = null, next = null;
    for (const x of ds) { if (x <= iso) last = x; else { next = x; break; } }
    return { last, next };
  }
  // 範圍內的里在 [start−pad, end+pad] 內的噴藥
  function near(codes, start, end, pad = 14) {
    const a = E.isoOf(E.dayOf(start, app.today) - pad, app.today), b = E.isoOf(E.dayOf(end || start, app.today) + pad, app.today);
    return codes.flatMap(c => (byCode.get(c) || []).filter(d => d >= a && d <= b).map(d => [c, d])).sort((p, q) => p[1].localeCompare(q[1]));
  }

  // 地圖：目前檢視日前後 7 天內噴藥的里（虛線外框）
  let show = false;
  function paint() {
    if (!show) { villages.paintSpray(null); return; }
    const a = E.isoOf(app.day - 7, app.today), b = E.isoOf(app.day + 7, app.today);
    const codes = new Set(sched.entries.filter(e => e.date >= a && e.date <= b).map(e => e.code));
    villages.paintSpray(codes);
    $('c-spray').textContent = codes.size + ' 里';
  }
  $('t-spray').addEventListener('change', e => { show = e.target.checked; paint(); });

  function renderInfo() {
    const r = sched.range || [sched.entries[0]?.date, sched.entries.at(-1)?.date];
    $('spray-info').innerHTML = `${origin === 'import' ? '匯入' : '預載'} ${sched.entries.length.toLocaleString()} 筆，${esc(r[0] || '')}～${esc(r[1] || '')}<br>
      <span class="k">${sched.url ? `<a href="${esc(sched.url)}" target="_blank" rel="noopener">${esc(sched.source)}</a>` : esc(sched.source)}</span>`;
    $('btn-spray-reset').hidden = origin !== 'import';
  }
  $('spray-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const msg = $('spray-msg');
    try {
      const v = validateSchedule(JSON.parse(await f.text()), G.vIndex);
      if (!v.ok.length) throw new Error('沒有可用的資料列');
      sched = { source: v.source, url: v.url, entries: v.ok.sort((p, q) => p.date.localeCompare(q.date)) };
      sched.range = [sched.entries[0].date, sched.entries.at(-1).date];
      origin = 'import';
      try { localStorage.setItem(KEY, JSON.stringify(sched)); } catch { msg.textContent = '（瀏覽器無法儲存，重新整理後會回到預載）'; }
      index(); renderInfo(); app.recomputeSim();
      msg.textContent = `匯入 ${v.ok.length} 筆${v.bad.length ? `；略過 ${v.bad.length} 筆（${v.bad.slice(0, 3).map(([i, w]) => `第 ${i} 筆：${w}`).join('；')}）` : ''}` + msg.textContent;
    } catch (err) { msg.textContent = '匯入失敗：' + err.message; }
  });
  $('btn-spray-reset').addEventListener('click', () => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    sched = preloaded; origin = 'preload'; index(); renderInfo(); app.recomputeSim(); $('spray-msg').textContent = '已還原預載日程';
  });
  renderInfo();

  return { get tasks() { return tasks; }, around, near, paint, get count() { return sched.entries.length; } };
}
