// 底部時間軸：過去 90 天 → 今天 → 未來 30 天；標出任務期間與每日回報量
import { isoOf, dayOf } from './engine.js';
import { TASK_TYPES } from './params.js';
import { esc } from './util.js';

export const TASK_COLORS = { poison: '#c0392b', clean: '#2f86c4', trap: '#8e6bbf', fill: '#7a5638', spray: '#1f9e8f' };

export function createTimeline(el, { d0, d1, today, onChange }) {
  el.innerHTML = `
    <button class="tl-play btn" type="button" aria-label="播放">▶</button>
    <div class="tl-main">
      <div class="tl-head"><b class="tl-date"></b><span class="tl-tag"></span><button class="tl-today btn-link" type="button">回到今天</button></div>
      <div class="tl-track">
        <svg class="tl-marks" preserveAspectRatio="none" aria-hidden="true"></svg>
        <input class="tl-range" type="range" min="${d0}" max="${d1}" step="1" value="0" aria-label="日期">
      </div>
      <div class="tl-scale"><span>${isoOf(d0, today).slice(5)}</span><span class="tl-now">今天</span><span>${isoOf(d1, today).slice(5)}</span></div>
    </div>`;
  const q = (c) => el.querySelector(c);
  const range = q('.tl-range'), svg = q('.tl-marks'), play = q('.tl-play');
  const span = d1 - d0;
  q('.tl-now').style.left = `${(-d0) / span * 100}%`;
  let day = 0, timer = null;
  function set(d, fire = true) {
    day = Math.max(d0, Math.min(d1, d)); range.value = day;
    q('.tl-date').textContent = isoOf(day, today);
    const tag = q('.tl-tag');
    tag.textContent = day === 0 ? '今天' : day > 0 ? `預測 +${day} 天` : `${-day} 天前`;
    tag.className = 'tl-tag ' + (day > 0 ? 'future' : day === 0 ? 'now' : 'past');
    if (fire) onChange(day);
  }
  range.addEventListener('input', () => set(+range.value));
  q('.tl-today').addEventListener('click', () => set(0));
  function stop() { clearInterval(timer); timer = null; play.textContent = '▶'; play.setAttribute('aria-label', '播放'); }
  play.addEventListener('click', () => {
    if (timer) return stop();
    if (day >= d1) set(d0);
    play.textContent = '❚❚'; play.setAttribute('aria-label', '暫停');
    timer = setInterval(() => { if (day >= d1) stop(); else set(day + 1); }, 120);
  });
  // 標記：任務 = 依類型著色的橫條；回報 = 每日數量直方圖
  function setMarks(tasks, reports) {
    const W = 1000, H = 30, x = (d) => (d - d0) / span * W;
    let s = `<line x1="${x(0)}" x2="${x(0)}" y1="0" y2="${H}" class="tl-todayline"/>`;
    const counts = new Array(span + 1).fill(0);
    for (const r of reports) { const d = dayOf(r.time, today); if (d >= d0 && d <= d1) counts[d - d0]++; }
    const mx = Math.max(1, ...counts);
    counts.forEach((c, i) => { if (c) { const h = 12 * c / mx; s += `<rect x="${x(d0 + i) + 1}" y="${H - h}" width="${W / span - 1.5}" height="${h}" class="tl-rep"/>`; } });
    const live = tasks.filter(t => t.status !== 'cancelled');
    live.forEach((t, k) => {
      const a = Math.max(d0, dayOf(t.start, today)), b = Math.min(d1, dayOf(t.end || t.start, today));
      if (b < d0 || a > d1) return;
      s += `<rect x="${x(a)}" y="${2 + (k % 3) * 5}" width="${Math.max(4, x(b + 1) - x(a))}" height="4" rx="2" fill="${TASK_COLORS[t.type]}"><title>${esc(t.caseNo)} ${TASK_TYPES[t.type]}</title></rect>`;
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = s;
  }
  set(0, false);
  return { set, setMarks, get day() { return day; }, stop };
}
