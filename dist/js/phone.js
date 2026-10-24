// 臺北通推播（概念示意）：右下角手機外框，依時間軸日期顯示已送達的推播
// 狀態只由「目前檢視日」決定：日期 ≥ 推播日就顯示，往回拖會收回，播放與拖曳都不會亂
// 不使用臺北通官方 logo；卡片標示「概念示意」
import { affectedVillages } from './notify.js';
import { $, esc } from './util.js';

const WEEK = '日一二三四五六';

export function createPhone(app, pushes) {
  const el = $('phone');
  const days = pushes.map(p => app.E.dayOf(p.date, app.today));
  let shown = new Set(), dismissed = false;

  // 發送對象文字（範圍＋外溢環帶的里，依任務與目前參數計算）
  function recipients(p) {
    const t = app.allTasks.find(x => x.id === p.taskId); if (!t) return '';
    const rows = affectedVillages(app, t), inScope = rows.filter(r => r[1] === '範圍內').length, ring = rows.length - inScope;
    return p.recipients === 'scope+ring' ? `範圍 ${inScope} 里＋外溢環帶 ${ring} 里的訂閱者` : `範圍 ${inScope} 里的訂閱者`;
  }

  function render(list) {
    const last = list.at(-1);
    const md = `${+last.date.slice(5, 7)} 月 ${+last.date.slice(8)} 日 星期${WEEK[new Date(last.date + 'T12:00:00+08:00').getUTCDay()]}`;
    el.innerHTML = `
      <div class="ph-frame" role="img" aria-label="臺北通推播概念示意">
        <div class="ph-notch"></div>
        <div class="ph-status"><span>${esc(last.time)}</span><span>5G ▮▮▮</span></div>
        <div class="ph-clock">${esc(last.time)}</div>
        <div class="ph-date">${md}</div>
        <div class="ph-list">${list.slice().reverse().map((p, i) => `
          <div class="ph-card ${i === 0 && !shown.has(p.id) ? 'new' : ''}">
            <div class="ph-app"><i aria-hidden="true">北</i><b>臺北通</b><span class="ph-concept">概念示意</span><span class="ph-when">${esc(p.date.slice(5).replace('-', '/'))} ${esc(p.time)}</span></div>
            <div class="ph-title">環境衛生通知 ${esc(p.title)}</div>
            <div class="ph-body">${esc(p.body)}</div>
            <div class="ph-to">發送對象：${esc(recipients(p))}</div>
          </div>`).join('')}</div>
      </div>
      <button class="ph-x" type="button" aria-label="收起手機">×</button>`;
    el.querySelector('.ph-x').addEventListener('click', () => { dismissed = true; el.hidden = true; });
  }

  // 依目前檢視日更新；回傳本次新出現的推播（播放時用來暫停時間軸）
  function update(day) {
    const list = pushes.filter((p, i) => days[i] <= day);
    if (!list.length) { el.hidden = true; shown = new Set(); dismissed = false; return []; }
    const fresh = list.filter(p => !shown.has(p.id));
    if (fresh.length) dismissed = false;
    // 往回拖：收回日期之後的推播
    for (const id of [...shown]) if (!list.some(p => p.id === id)) shown.delete(id);
    if (fresh.length || !el.innerHTML || list.length !== el.querySelectorAll('.ph-card').length) render(list);
    for (const p of list) shown.add(p.id);
    el.hidden = dismissed;
    return fresh;
  }

  return { update, show() { dismissed = false; el.hidden = false; } };
}
