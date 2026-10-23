// 防治任務：清單（左側「任務」分頁）＋表單（右側面板）＋稽核紀錄＋猛禽二次中毒提示＋模型預估
import { TASK_TYPES, BAITS, EXECUTORS, NOTIFY_METHODS, clone } from './params.js';
import { STATUS } from './card.js';
import { TASK_COLORS } from './timeline.js';
import { store, download } from './store.js';
import { $, esc } from './util.js';

const get = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
const set = (o, path, v) => { const ks = path.split('.'), last = ks.pop(); let a = o; for (const k of ks) a = a[k] ??= {}; a[last] = v; };
// 攤平成 path → 值，用來比對修改了哪些欄位
const flat = (o, pre = '', out = {}) => { for (const [k, v] of Object.entries(o || {})) { if (['history', 'updatedAt', 'updatedBy'].includes(k)) continue; const p = pre ? pre + '.' + k : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, p, out); else out[p] = Array.isArray(v) ? v.join(',') : v; } return out; };
const FIELD_LABELS = { caseNo: '案號', type: '類型', 'scope.villages': '範圍', start: '開始', end: '結束', status: '狀態', 'executor.kind': '執行單位', 'executor.team': '清潔隊', 'executor.squad': '分隊', 'executor.vendor': '廠商', 'executor.contract': '合約編號', 'executor.other': '其他單位',
  'bait.kind': '藥劑', 'bait.points': '投藥點數', 'followups.carcass.date': '鼠屍清理日', 'followups.carcass.done': '鼠屍清理完成', 'followups.residue.date': '藥物回收日', 'followups.residue.done': '藥物回收完成',
  'budget.planned': '預算', 'budget.actual': '實際支出', 'notify.enabled': '通知民眾', 'notify.method': '通知方式', 'notify.date': '通知日期', note: '備註' };

export function createTasks(app) {
  const { G, villages, E } = app;
  const form = $('taskform'), list = $('task-list');
  let draft = null, isNew = false, previewTimer = 0;
  const districts = [...new Set(villages.feats.map(f => f.properties.district))];
  const vName = (c) => { const p = villages.props(c); return p ? `${p.district.replace('區', '')} ${p.name}` : c; };

  function newDraft(codes = []) {
    const ym = app.today.slice(0, 7).replace('-', '');
    return {
      id: 'task-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      caseNo: `RC-${ym}-${String(store.tasks.length + 1).padStart(3, '0')}`,
      type: 'poison', status: 'planned',
      scope: { type: 'villages', villages: [...codes], geometry: null, boundaryVersion: app.boundaryVersion },
      start: app.today, end: E.isoOf(6, app.today),
      executor: { kind: 'team', team: villages.props(codes[0])?.district || '', squad: '', vendor: '', contract: '', other: '' },
      bait: { kind: 'sgar', points: null },
      followups: { carcass: { date: E.isoOf(7, app.today), done: false }, residue: { date: E.isoOf(14, app.today), done: false } },
      budget: { planned: null, actual: null },
      notify: { enabled: true, method: 'board', date: E.isoOf(-3, app.today) },
      note: '', history: [],
    };
  }

  // ---------- 清單 ----------
  function renderList() {
    const filter = $('task-filter').value;
    const ts = store.tasks.filter(t => filter === 'all' || (filter === 'open' ? !['done', 'cancelled'].includes(t.status) : t.status === filter))
      .slice().sort((a, b) => b.start.localeCompare(a.start));
    $('task-count').textContent = store.tasks.length;
    list.innerHTML = ts.length ? ts.map(t => `
      <li><button type="button" class="task-row ${t.status === 'cancelled' ? 'cancelled' : ''} ${draft?.id === t.id ? 'on' : ''}" data-id="${esc(t.id)}">
        <span class="tdot" style="background:${TASK_COLORS[t.type]}"></span>
        <span class="tmain"><b>${esc(t.caseNo)}</b> ${TASK_TYPES[t.type]}<br>
        <span class="k">${esc(t.start)}～${esc(t.end).slice(5)} · ${t.scope.villages.length} 里 · ${STATUS[t.status]}</span></span>
      </button></li>`).join('') : '<li class="muted">尚無任務。按「新增任務」，或拉近模型點選里後從資訊卡建立。</li>';
    list.querySelectorAll('.task-row').forEach(b => b.addEventListener('click', () => openTask(b.dataset.id)));
  }
  $('task-filter').addEventListener('change', renderList);
  $('btn-new-task').addEventListener('click', () => newTask([]));

  // ---------- 表單 ----------
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
  const inp = (path, type = 'text', attrs = '') => { const v = get(draft, path); return type === 'checkbox' ? `<input type="checkbox" data-f="${path}" ${v ? 'checked' : ''} ${attrs}>` : `<input type="${type}" data-f="${path}" value="${esc(v ?? '')}" ${attrs}>`; };
  function renderForm() {
    const t = draft;
    form.innerHTML = `
      <header class="card-h"><div><div class="eyebrow">${isNew ? '新增任務' : '編輯任務'}</div><h3>${esc(t.caseNo)}</h3></div><button class="x" type="button" data-act="close" aria-label="關閉">×</button></header>
      <div class="fgrid">
        <label class="full">案號${inp('caseNo', 'text', 'required maxlength="40"')}</label>
        <fieldset class="full seg seg4" role="radiogroup" aria-label="類型">${Object.entries(TASK_TYPES).map(([k, v]) => `<label><input type="radio" name="ttype" data-f="type" value="${k}" ${k === t.type ? 'checked' : ''}><span>${v}</span></label>`).join('')}</fieldset>
      </div>
      <h4>範圍 <span class="count" id="tf-scount"></span></h4>
      <div class="scope-pick">
        <select id="tf-district" aria-label="行政區"><option value="">選擇行政區…</option>${districts.map(d => `<option>${d}</option>`).join('')}</select>
        <div id="tf-vlist" class="vlist"></div>
      </div>
      <div id="tf-chips" class="chips scope-chips"></div>
      <p class="hint">也可以拉近模型後直接點選里來加入或移除。</p>
      <div id="tf-raptor"></div>
      <h4>執行時間</h4>
      <div class="fgrid"><label>開始${inp('start', 'date')}</label><label>結束${inp('end', 'date')}</label></div>
      <h4>執行單位</h4>
      <div class="fgrid">
        <label class="full"><select data-f="executor.kind" aria-label="執行單位">${opt(EXECUTORS, t.executor.kind)}</select></label>
        <label data-when="executor.kind=team">清潔隊<select data-f="executor.team">${t.executor.team ? '' : '<option value="" selected>（依範圍帶入）</option>'}${districts.map(d => `<option ${d === t.executor.team ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label data-when="executor.kind=team">分隊${inp('executor.squad', 'text', 'placeholder="例：第一分隊" maxlength="30"')}</label>
        <label data-when="executor.kind=vendor">廠商名稱${inp('executor.vendor', 'text', 'maxlength="60"')}</label>
        <label data-when="executor.kind=vendor">合約編號${inp('executor.contract', 'text', 'maxlength="40"')}</label>
        <label class="full" data-when="executor.kind=other">單位名稱${inp('executor.other', 'text', 'maxlength="60"')}</label>
      </div>
      <div data-when="type=poison">
        <h4>藥劑</h4>
        <div class="fgrid"><label class="full"><select data-f="bait.kind" aria-label="藥劑種類">${opt(BAITS, t.bait.kind)}</select></label>
          <label>投藥點數${inp('bait.points', 'number', 'min="0" step="1"')}</label></div>
      </div>
      <h4>配套措施</h4>
      <div class="fgrid">
        <label>鼠屍清理${inp('followups.carcass.date', 'date')}</label><label class="chk">${inp('followups.carcass.done', 'checkbox')}已完成</label>
        <label data-when="type=poison">殘餘藥物回收${inp('followups.residue.date', 'date')}</label><label class="chk" data-when="type=poison">${inp('followups.residue.done', 'checkbox')}已完成</label>
      </div>
      <h4>經費（新臺幣）</h4>
      <div class="fgrid"><label>預算${inp('budget.planned', 'number', 'min="0" step="1000"')}</label><label>實際支出${inp('budget.actual', 'number', 'min="0" step="1000"')}</label></div>
      <h4>民眾通知</h4>
      <div class="fgrid">
        <label class="chk full">${inp('notify.enabled', 'checkbox')}通知範圍內與外溢環帶的里</label>
        <label data-when="notify.enabled">方式<select data-f="notify.method">${opt(NOTIFY_METHODS, t.notify.method)}</select></label>
        <label data-when="notify.enabled">通知日期${inp('notify.date', 'date')}</label>
      </div>
      <h4>狀態與備註</h4>
      <div class="fgrid"><label class="full"><select data-f="status" aria-label="狀態">${opt(Object.fromEntries(Object.entries(STATUS).filter(([k]) => k !== 'cancelled' || t.status === 'cancelled')), t.status)}</select></label>
        <label class="full">備註<textarea data-f="note" rows="2" maxlength="500">${esc(t.note)}</textarea></label></div>
      <div id="tf-preview" class="preview"></div>
      <p id="tf-err" class="err" role="alert"></p>
      <div class="actions">
        <button class="btn primary" type="button" data-act="save">${isNew ? '建立任務' : '儲存修改'}</button>
        ${isNew ? '' : '<button class="btn" type="button" data-act="notify">通知清單</button>'}
        ${!isNew && t.status !== 'cancelled' ? '<button class="btn danger" type="button" data-act="cancel">取消任務</button>' : ''}
      </div>
      ${t.history.length ? `<h4>修改紀錄</h4><ol class="hist">${t.history.slice().reverse().map(h => `<li><b>${esc(h.byName)}</b> · ${esc(tpeTime(h.at))}<br><span class="k">${esc(h.summary)}</span></li>`).join('')}</ol>` : ''}`;
    form.hidden = false;
    form.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const p = el.dataset.f;
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Math.max(0, +el.value)) : el.value;
      set(draft, p, v);
      if (p === 'caseNo') form.querySelector('h3').textContent = v;
      refresh();
    }));
    form.querySelector('[data-act=close]').addEventListener('click', close);
    form.querySelector('[data-act=save]').addEventListener('click', save);
    form.querySelector('[data-act=notify]')?.addEventListener('click', () => app.openNotify(store.tasks.find(x => x.id === draft.id)));
    form.querySelector('[data-act=cancel]')?.addEventListener('click', cancelTask);
    $('tf-district').addEventListener('change', renderVillageList);
    if (draft.scope.villages[0]) { $('tf-district').value = villages.props(draft.scope.villages[0])?.district || ''; }
    renderVillageList();
    refresh();
  }

  function renderVillageList() {
    const d = $('tf-district').value, box = $('tf-vlist');
    if (!d) { box.innerHTML = ''; return; }
    const vs = villages.feats.filter(f => f.properties.district === d);
    const sel = new Set(draft.scope.villages);
    box.innerHTML = `<label class="chk all"><input type="checkbox" data-all ${vs.every(f => sel.has(f.properties.code)) ? 'checked' : ''}>全選 ${esc(d)}（${vs.length} 里）</label>` +
      vs.map(f => `<label class="chk"><input type="checkbox" data-v="${f.properties.code}" ${sel.has(f.properties.code) ? 'checked' : ''}>${esc(f.properties.name)}</label>`).join('');
    box.querySelectorAll('[data-v]').forEach(cb => cb.addEventListener('change', () => toggleVillage(cb.dataset.v, cb.checked)));
    box.querySelector('[data-all]').addEventListener('change', (e) => { for (const f of vs) toggleVillage(f.properties.code, e.target.checked, false); renderVillageList(); refresh(); });
  }

  function toggleVillage(code, on, rerender = true) {
    if (!draft) return false;
    const s = new Set(draft.scope.villages);
    (on ?? !s.has(code)) ? s.add(code) : s.delete(code);
    draft.scope.villages = G.villages.filter(c => s.has(c));     // 依代碼排序，方便比對
    // 尚未指定清潔隊時，帶入第一個里所屬的區
    if (!draft.executor.team && draft.scope.villages[0]) { draft.executor.team = villages.props(draft.scope.villages[0]).district; const sel = form.querySelector('[data-f="executor.team"]'); if (sel) sel.value = draft.executor.team; }
    if (rerender) { const cb = form.querySelector(`[data-v="${code}"]`); if (cb) cb.checked = s.has(code); refresh(); }
    return true;
  }

  // 依目前草稿更新：條件欄位、範圍標籤、猛禽提示、模型預估
  function refresh() {
    form.querySelectorAll('[data-when]').forEach(el => { const [p, v] = el.dataset.when.split('='); const cur = get(draft, p); el.hidden = v === undefined ? !cur : String(cur) !== v; });
    const vs = draft.scope.villages;
    $('tf-scount').textContent = vs.length ? `${vs.length} 里` : '';
    $('tf-chips').innerHTML = vs.map(c => `<span class="sp">${esc(vName(c))}<button type="button" data-rm="${c}" aria-label="移除 ${esc(vName(c))}">×</button></span>`).join('');
    $('tf-chips').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => toggleVillage(b.dataset.rm, false)));
    villages.setScope(vs);
    // 猛禽二次中毒提示（投藥）
    const rb = $('tf-raptor');
    if (draft.type === 'poison' && vs.length) {
      const { buffer, sinceYear } = app.params.raptor;
      const hits = E.pointsNear(G, vs, app.raptorPts.filter(p => p[2] >= sinceYear), buffer);
      rb.innerHTML = hits.length ? `<div class="warn"><b>猛禽二次中毒風險</b>範圍外擴 ${buffer / 1000} km 內有 ${hits.length} 筆鳳頭蒼鷹紀錄（${sinceYear} 年以後，最近 ${Math.max(...hits.map(h => h[2]))} 年）。
        建議優先考慮捕鼠籠或環境清消；若需投藥，使用加蓋餌站、縮短投藥期並加強鼠屍清理與殘藥回收。<span class="k">紀錄來自公民科學資料，部分座標精度約 1 km。</span></div>` : `<div class="ok">範圍外擴 ${buffer / 1000} km 內無 ${sinceYear} 年以後的鳳頭蒼鷹紀錄。</div>`;
    } else rb.innerHTML = '';
    clearTimeout(previewTimer); previewTimer = setTimeout(preview, 200);
  }

  // 模型預估：把草稿加進任務清單試算，比較範圍與外溢環帶的族群指數
  function preview() {
    const box = $('tf-preview'); if (!box || !draft) return;
    const vs = draft.scope.villages;
    if (!vs.length || !draft.start) { box.innerHTML = ''; return; }
    const tasks = store.tasks.filter(t => t.id !== draft.id).concat(draft.status === 'cancelled' ? [] : [draft]);
    const sim = E.simulate(G, app.env, app.params, tasks, app.today, [-90, 30]);
    const geo = E.taskGeometry(G, app.env, vs, app.params.tasks[draft.type].ring);
    const mean = (ms, day) => { const di = Math.min(sim.nd - 1, Math.max(0, day - sim.d0)); let s = 0; for (const m of ms) s += sim.N[di * G.M + m]; return ms.length ? s / ms.length : 0; };
    const kMean = (ms) => { let s = 0; for (const m of ms) s += app.env.K[m]; return ms.length ? s / ms.length : 0; };
    const s0 = E.dayOf(draft.start, app.today), e0 = E.dayOf(draft.end || draft.start, app.today);
    const inRange = (d) => d >= -90 && d <= 30;
    const row = (label, d) => inRange(d) ? `<tr><td>${label}<br><span class="k">${E.isoOf(d, app.today)}</span></td><td>${mean(geo.scope, d).toFixed(0)}</td><td>${mean(geo.ring, d).toFixed(0)}</td></tr>` : '';
    box.innerHTML = `<h4>模型預估（族群指數）</h4>
      <table class="ptable"><thead><tr><th></th><th>範圍內</th><th>外溢環帶</th></tr></thead><tbody>
      <tr><td>環境基準</td><td>${kMean(geo.scope).toFixed(0)}</td><td>${kMean(geo.ring).toFixed(0)}</td></tr>
      ${row('開工前一日', s0 - 1)}${row('完工隔日', e0 + 1)}${row('完工後 30 天', e0 + 30)}
      </tbody></table>
      <p class="k">環帶寬 ${app.params.tasks[draft.type].ring} m，共 ${geo.ring.length} 格；超出時間軸（−90～+30 天）的日期不顯示。</p>`;
  }

  function validate() {
    const t = draft, errs = [];
    if (!t.caseNo.trim()) errs.push('請填案號');
    if (store.tasks.some(x => x.id !== t.id && x.caseNo === t.caseNo.trim())) errs.push('案號重複');
    if (!t.scope.villages.length) errs.push('請至少選一個里');
    if (!t.start) errs.push('請填開始日期');
    if (t.end && t.end < t.start) errs.push('結束日期早於開始日期');
    if (t.executor.kind === 'vendor' && !t.executor.vendor.trim()) errs.push('請填廠商名稱');
    return errs;
  }

  function stamp(t, action, changes) {
    const who = app.persona;
    const summary = action === 'create' ? '建立任務' : action === 'cancel' ? '取消任務' : changes.map(([p, a, b]) => `${FIELD_LABELS[p] || p}：${fmt(fmtField(p, a))} → ${fmt(fmtField(p, b))}`).join('；');
    t.history = [...(t.history || []), { at: new Date().toISOString(), by: who.id, byName: who.name, action, changes, summary }];
    if (action === 'create') { t.createdBy = who.id; t.createdByName = who.name; t.createdAt = t.history.at(-1).at; }
    t.updatedAt = t.history.at(-1).at; t.updatedBy = who.id;
  }
  const ENUMS = { status: STATUS, type: TASK_TYPES, 'executor.kind': EXECUTORS, 'bait.kind': BAITS, 'notify.method': NOTIFY_METHODS };
  const fmtField = (p, v) => p === 'scope.villages' ? (v ? String(v).split(',').map(vName).join('、') : '') : ENUMS[p]?.[v]?.replace(/（.*）/, '') ?? v;
  const fmt = (v) => v === '' || v == null ? '（空）' : v === true ? '是' : v === false ? '否' : String(v).length > 40 ? String(v).slice(0, 40) + '…' : v;
  const tpeTime = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

  function save() {
    const errs = validate();
    $('tf-err').textContent = errs.join('；');
    if (errs.length) return;
    draft.caseNo = draft.caseNo.trim();
    const t = clone(draft);
    if (isNew) stamp(t, 'create', []);
    else {
      const prev = store.tasks.find(x => x.id === t.id), a = flat(prev), b = flat(t);
      const changes = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k] && !k.startsWith('created')).map(k => [k, a[k] ?? null, b[k] ?? null]);
      if (!changes.length) { $('tf-err').textContent = '沒有變更'; return; }
      stamp(t, 'edit', changes);
    }
    store.upsertTask(t);
    const created = isNew;
    draft = clone(t); isNew = false;
    app.recomputeSim(); renderList(); renderForm();
    if (created && t.notify.enabled) app.openNotify(t);
  }

  function cancelTask() {
    if (!confirm(`取消任務 ${draft.caseNo}？取消後不進模型，但保留紀錄，無法刪除。`)) return;
    const t = clone(store.tasks.find(x => x.id === draft.id));
    t.status = 'cancelled'; stamp(t, 'cancel', [['status', draft.status, 'cancelled']]);
    store.upsertTask(t); draft = clone(t);
    app.recomputeSim(); renderList(); renderForm();
  }

  function open(t, fresh) {
    draft = clone(t); isNew = fresh;
    draft.history ||= [];
    app.selectVillage(null);
    renderForm(); renderList();
    app.setTab('tasks');
  }
  function newTask(codes) { open(newDraft(codes), true); }
  function openTask(id) { const t = store.tasks.find(x => x.id === id); if (t) open(t, false); }
  function close() { draft = null; form.hidden = true; villages.setScope([]); renderList(); }

  // 稽核紀錄匯出（全部任務的建立／修改／取消）
  $('btn-audit').addEventListener('click', () => {
    const rows = store.tasks.flatMap(t => (t.history || []).map(h => [tpeTime(h.at), h.byName, h.by, t.caseNo, TASK_TYPES[t.type], { create: '建立', edit: '修改', cancel: '取消' }[h.action] || h.action, h.summary]));
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    const cell = (v) => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    download(`稽核紀錄_${app.today}.csv`, '\ufeff' + [['時間（臺北）', '身分', '身分代碼', '案號', '類型', '動作', '內容'], ...rows].map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  });

  renderList();
  return { newTask, openTask, close, toggleVillage, renderList, get editing() { return draft; } };
}
