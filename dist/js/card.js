// 右側資訊卡：里的族群指數走勢、近期回報、相關任務
import { dayOf, isoOf } from './engine.js';
import { SPECIES, TASK_TYPES } from './params.js';
import { classOf, CLASS_LABELS, CLASS_COLORS } from './villages.js';
import { $, esc } from './util.js';

export const STATUS = { planned: '規劃中', active: '執行中', done: '已完成', cancelled: '已取消' };

// 該里每日平均估計值 = 族群 N ＋ 回報加成（與地圖、上方數字同一算法；只算本里的格子，播放時重畫也夠快）
function series(app, k) {
  const { G, sim, E } = app, ms = G.vCells[k], inV = new Set(ms), out = new Float32Array(sim.nd);
  for (let d = 0; d < sim.nd; d++) { let s = 0; const o = d * G.M; for (const m of ms) s += sim.N[o + m]; out[d] = s; }
  for (const rp of app.reports) {
    const amp0 = E.reportAmp(app.params, rp); if (!amp0) continue;
    let w = 0; for (const [m, x] of E.reportCells(G, app.params, rp)) if (inV.has(m)) w += x;
    if (!w) continue;
    const t = E.dayOf(rp.time, app.today);
    for (let d = Math.max(0, t - sim.d0); d < sim.nd; d++) { const amp = amp0 * E.reportDecay(app.params, sim.d0 + d - t); if (amp < 0.05) break; out[d] += amp * w; }
  }
  for (let d = 0; d < sim.nd; d++) out[d] /= ms.length;
  return out;
}

function spark(app, vals, base) {
  const W = 300, H = 64, n = vals.length, mx = Math.max(base * 1.15, ...vals), x = (i) => i / (n - 1) * W, y = (v) => H - 4 - v / mx * (H - 10);
  const d = Array.from(vals, (v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const today = -app.sim.d0, cur = app.day - app.sim.d0;
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" role="img" aria-label="族群指數走勢">
    <rect x="${x(today)}" y="0" width="${W - x(today)}" height="${H}" class="spark-future"/>
    <line x1="0" x2="${W}" y1="${y(base)}" y2="${y(base)}" class="spark-base"/>
    <path d="${d}" class="spark-line"/>
    <line x1="${x(cur)}" x2="${x(cur)}" y1="0" y2="${H}" class="spark-cur"/>
  </svg>
  <div class="spark-axis"><span>${isoOf(app.sim.d0, app.today).slice(5)}</span><span>族群＋回報加成；虛線 = 環境基準 ${base.toFixed(0)}</span><span>${isoOf(app.sim.d0 + app.sim.nd - 1, app.today).slice(5)}</span></div>`;
}

export function renderCard(app, code) {
  const el = $('card');
  if (!code) { el.hidden = true; return; }
  const { G } = app, k = G.vIndex.get(code) - 1, p = app.villages.props(code);
  const vVal = app.byVillage[k], vBase = app.baseByVillage[k], delta = vVal - vBase;
  const cls = classOf(vVal, 'index');
  // 近 30 天（相對目前檢視日）回報
  const reps = app.reports.filter(r => app.reportVillage(r) === code).filter(r => { const a = app.day - dayOf(r.time, app.today); return a >= 0 && a < 30; });
  const bySp = Object.keys(SPECIES).map(s => [s, reps.filter(r => r.species === s).length]).filter(([, n]) => n);
  // 任務：範圍含此里，或此里在外溢環帶
  const tasks = app.tasks.filter(t => t.scope?.villages?.includes(code));
  const sp = app.spray.around(code, app.day), rel = (iso) => { const d = dayOf(iso, app.today) - app.day; return d === 0 ? '當天' : d < 0 ? `${-d} 天前` : `${d} 天後`; };
  const ringTasks = app.tasks.filter(t => t.status !== 'cancelled' && !t.scope?.villages?.includes(code) && app.inRing?.(t, k));
  const taskRow = (t, note = '') => `<li><button class="link" type="button" data-task="${esc(t.id)}">${esc(t.caseNo || t.id)}</button> ${TASK_TYPES[t.type] || ''} · ${STATUS[t.status] || ''} · ${esc(t.start)}${t.end && t.end !== t.start ? '～' + esc(t.end).slice(5) : ''}${note}</li>`;
  el.innerHTML = `
    <header class="card-h"><div><div class="eyebrow">${esc(p.district)} · ${esc(code)}</div><h3>${esc(p.name)}</h3></div>
      <button class="x" type="button" aria-label="關閉">×</button></header>
    <div class="kpis">
      <div><span class="kpi-v">${vVal.toFixed(0)}</span><span class="kpi-l">族群指數</span></div>
      <div><span class="lvl" style="background:${CLASS_COLORS.index[cls]};color:${cls >= 4 ? '#fff' : 'inherit'}">${CLASS_LABELS.index[cls]}</span><span class="kpi-l">等級</span></div>
      <div><span class="kpi-v ${delta < -0.5 ? 'down' : delta > 0.5 ? 'up' : ''}">${delta > 0 ? '+' : ''}${delta.toFixed(0)}</span><span class="kpi-l">與環境基準差</span></div>
    </div>
    <div class="card-date">${isoOf(app.day, app.today)}${app.day > 0 ? '（預測）' : ''}</div>
    ${spark(app, series(app, k), vBase)}
    <h4>近 30 天回報 <span class="count">${reps.length} 件</span></h4>
    ${bySp.length ? `<div class="chips">${bySp.map(([s, n]) => `<span class="sp sp-${s}">${SPECIES[s]} ${n}</span>`).join('')}</div>` : '<p class="muted">無</p>'}
    <h4>定期噴藥 <span class="count">環保局日程</span></h4>
    <p class="spray-line">上次 ${sp.last ? `<b>${sp.last.slice(5)}</b>（${rel(sp.last)}）` : '—'}　下次 ${sp.next ? `<b>${sp.next.slice(5)}</b>（${rel(sp.next)}）` : '—'}</p>
    <h4>防治任務 <span class="count">${tasks.length} 件</span></h4>
    ${tasks.length ? `<ul class="tasks">${tasks.map(t => taskRow(t)).join('')}</ul>` : '<p class="muted">無</p>'}
    ${ringTasks.length ? `<h4>位於外溢環帶</h4><ul class="tasks">${ringTasks.map(t => taskRow(t)).join('')}</ul>` : ''}
    <div class="actions"><button class="btn" type="button" data-act="new-task">以此里建立任務</button></div>
    <p class="foot">${esc(p.areaKm2)} km² · ${G.vCells[k].length} 格（100 m）· 回報含模擬資料</p>`;
  el.hidden = false;
  el.querySelector('.x').addEventListener('click', () => app.selectVillage(null));
  el.querySelector('[data-act=new-task]').addEventListener('click', () => app.newTask?.([code]));
  el.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => app.openTask?.(b.dataset.task)));
}
