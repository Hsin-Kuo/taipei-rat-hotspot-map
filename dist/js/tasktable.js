// 任務列表：底部全寬抽屜，可搜尋、篩選、排序、匯出；點一列開啟任務表單
import { TASK_TYPES, EXECUTORS, notifyMethodsText } from './params.js';
import { STATUS } from './card.js';
import { TASK_COLORS } from './timeline.js';
import { store, download } from './store.js';
import { $, esc } from './util.js';

const tpe = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)).slice(5);   // MM-DD HH:mm
const money = (n) => n == null || n === '' ? '' : n >= 10000 ? `${+(n / 1e4).toFixed(1)} 萬` : `${n.toLocaleString()} 元`;

export function createTaskTable(app) {
  const el = $('tasktable');
  const st = { q: '', status: 'open', sort: 'start', dir: -1, recurring: false };   // 定期噴藥預設不顯示

  const vName = (c) => { const p = app.villages.props(c); return p ? p.district.replace('區', '') + p.name : c; };
  const executor = (t) => { const x = t.executor || {}; return x.kind === 'team' ? `${(x.team || '').replace('區', '')}清潔隊${x.squad ? ' ' + x.squad : ''}` : x.kind === 'vendor' ? x.vendor || '外包廠商' : x.kind === 'other' ? x.other || '其他' : EXECUTORS[x.kind] || ''; };
  const followups = (t) => { const f = t.followups || {}, items = [f.carcass, ...(t.type === 'poison' ? [f.residue] : [])].filter(Boolean); return [items.filter(i => i.done).length, items.length]; };
  const scopeText = (t) => { const vs = t.scope?.villages || [], ds = [...new Set(vs.map(c => app.villages.props(c)?.district.replace('區', '')))]; return `${ds.join('、')} ${vs.length} 里`; };
  // 每欄：標題、排序鍵、顯示
  const COLS = [
    ['caseNo', '案號', t => t.caseNo, t => `<b>${esc(t.caseNo)}</b>`],
    ['type', '類型', t => t.type, t => `<span class="tdot" style="background:${TASK_COLORS[t.type]}"></span>${TASK_TYPES[t.type]}`],
    ['start', '期間', t => t.start, t => `${esc(t.start.slice(5))}～${esc((t.end || t.start).slice(5))}`],
    ['scope', '範圍', t => t.scope?.villages?.length || 0, t => `<span title="${esc((t.scope?.villages || []).map(vName).join('、'))}">${esc(scopeText(t))}</span>`],
    ['executor', '執行單位', t => executor(t), t => esc(executor(t))],
    ['budget', '經費（預算／實支）', t => t.budget?.actual ?? t.budget?.planned ?? -1, t => `${money(t.budget?.planned) || '—'}／${money(t.budget?.actual) || '—'}`],
    ['follow', '配套', t => { const [a, b] = followups(t); return b ? a / b : -1; }, t => { const [a, b] = followups(t); return b ? `<span class="${a === b ? 'okc' : ''}">${a}/${b}</span>` : '—'; }],
    ['notify', '民眾通知', t => t.notify?.enabled ? t.notify.date || '' : '', t => t.notify?.enabled ? `${esc(notifyMethodsText(t))} ${esc((t.notify.date || '').slice(5))}` : '不通知'],
    ['status', '狀態', t => ['planned', 'active', 'done', 'cancelled'].indexOf(t.status), t => `<span class="stag s-${t.status}">${STATUS[t.status]}</span>`],
    ['createdBy', '建立者', t => t.createdByName || '', t => esc(t.createdByName || '')],
    ['updatedAt', '最後修改', t => t.updatedAt || '', t => { const h = t.history?.at(-1); return h ? `${esc(tpe(h.at))} <span class="k">${esc(h.byName)}</span>` : ''; }],
  ];

  function rows() {
    const q = st.q.trim().toLowerCase(), col = COLS.find(c => c[0] === st.sort);
    return (st.recurring ? [...store.tasks, ...app.spray.tasks] : store.tasks).filter(t => st.status === 'all' || (st.status === 'open' ? !['done', 'cancelled'].includes(t.status) : t.status === st.status))
      .filter(t => !q || [t.caseNo, TASK_TYPES[t.type], executor(t), t.note, ...(t.scope?.villages || []).map(vName)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : 0) * st.dir; });
  }

  function render() {
    if (el.hidden) return;
    const rs = rows(), editing = app.taskUI?.current?.id;
    el.querySelector('tbody').innerHTML = rs.length ? rs.map(t => `<tr data-id="${esc(t.id)}" tabindex="0" class="${t.status === 'cancelled' ? 'cancelled' : ''} ${t.recurring ? 'recurring' : ''} ${t.id === editing ? 'on' : ''}">${COLS.map(c => `<td>${c[3](t)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${COLS.length}" class="muted">${store.tasks.length ? '沒有符合條件的任務' : '尚無任務'}</td></tr>`;
    el.querySelectorAll('th[data-k]').forEach(th => { th.setAttribute('aria-sort', th.dataset.k === st.sort ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'); });
    el.querySelector('.tt-count').textContent = `${rs.length} / ${store.tasks.length + (st.recurring ? app.spray.count : 0)} 件`;
    const recById = new Map(st.recurring ? app.spray.tasks.map(t => [t.id, t]) : []);
    el.querySelectorAll('tbody tr[data-id]').forEach(tr => {
      // 定期噴藥是唯讀：開該里的資訊卡（顯示上次／下次噴藥）
      const t = recById.get(tr.dataset.id);
      const go = () => t ? app.selectVillage(t.scope.villages[0]) : app.openTask(tr.dataset.id);
      tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
  }

  el.innerHTML = `
    <header class="tt-h"><h3>任務列表</h3><span class="tt-count count"></span>
      <input type="search" class="tt-q" placeholder="搜尋案號、里名、執行單位、備註" aria-label="搜尋任務">
      <select class="tt-status" aria-label="狀態"><option value="open">未結案</option><option value="all">全部</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label class="chk tt-rec"><input type="checkbox" class="tt-recurring">含定期噴藥</label>
      <button class="btn" type="button" data-act="csv">匯出 CSV</button>
      <button class="btn primary" type="button" data-act="new">＋ 新增任務</button>
      <button class="x" type="button" data-act="close" aria-label="關閉任務列表">×</button></header>
    <div class="tt-wrap"><table class="tt"><thead><tr>${COLS.map(c => `<th data-k="${c[0]}" scope="col"><button type="button">${c[1]}</button></th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
  el.querySelector('.tt-q').addEventListener('input', e => { st.q = e.target.value; render(); });
  el.querySelector('.tt-status').addEventListener('change', e => { st.status = e.target.value; render(); });
  el.querySelector('.tt-recurring').addEventListener('change', e => { st.recurring = e.target.checked; render(); });
  el.querySelectorAll('th[data-k] button').forEach(b => b.addEventListener('click', () => { const k = b.parentElement.dataset.k; st.dir = st.sort === k ? -st.dir : 1; st.sort = k; render(); }));
  el.querySelector('[data-act=close]').addEventListener('click', () => toggle(false));
  el.querySelector('[data-act=new]').addEventListener('click', () => app.newTask([]));
  el.querySelector('[data-act=csv]').addEventListener('click', () => {
    const cell = (v) => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const head = ['案號', '類型', '開始', '結束', '範圍', '村里代碼', '執行單位', '合約編號', '預算', '實際支出', '配套完成', '民眾通知', '狀態', '建立者', '備註'];
    const body = rows().map(t => { const [a, b] = followups(t); return [t.caseNo, TASK_TYPES[t.type], t.start, t.end, (t.scope?.villages || []).map(vName).join('、'), (t.scope?.villages || []).join(' '), executor(t), t.executor?.contract, t.budget?.planned, t.budget?.actual, b ? `${a}/${b}` : '', t.notify?.enabled ? `${notifyMethodsText(t)} ${t.notify.date || ''}` : '不通知', STATUS[t.status], t.createdByName, t.note]; });
    download(`任務列表_${app.today}.csv`, '﻿' + [head, ...body].map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  });

  function toggle(on = el.hidden) {
    el.hidden = !on;
    document.body.classList.toggle('has-tasktable', on);
    $('btn-tasktable').setAttribute('aria-pressed', on);
    if (on) { render(); el.querySelector('.tt-q').focus(); }
  }
  $('btn-tasktable').addEventListener('click', () => toggle());
  $('btn-tasktable-2').addEventListener('click', () => toggle(true));
  return { render, toggle };
}
