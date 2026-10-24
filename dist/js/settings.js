// 設定抽屜：模型參數即時預覽；每個參數標示來源（文獻或「假設」）；還原預設、匯出匯入
import { DEFAULTS, META, SOURCES, FACTOR_LABELS, TASK_TYPES, EVIDENCE, clone, mergeParams } from './params.js';
import { store, download } from './store.js';
import { $, esc } from './util.js';

const get = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
const set = (o, path, v) => { const ks = path.split('.'), last = ks.pop(); let a = o; for (const k of ks) a = a[k]; a[last] = v; };
const SRC_KEYS = Object.keys(SOURCES);
const FORMAT = 'taipei-rat-params/v1';

// 哪些參數改了要重算環境（K、r），其餘只需重跑模擬或重畫
const ENV_PATHS = /^(base\.|factors\.)/;

export function createSettings(app) {
  const el = $('settings');
  let tab = 'factors', timer = 0, needEnv = false;

  const badge = (meta) => meta?.src?.length
    ? meta.src.map(k => `<a class="src" href="#src-${k}" title="${esc(SOURCES[k])}">[${SRC_KEYS.indexOf(k) + 1}]</a>`).join('')
    : '<span class="assume" title="尚無文獻依據，為模型假設">假設</span>';
  const fmt = (v, meta) => meta.step < 0.01 ? (+v).toFixed(3) : meta.step < 1 ? (+v).toFixed(2) : String(Math.round(v));
  function slider(path, metaKey, label, src) {
    const m = src === undefined ? META[metaKey] : { ...META[metaKey], src }, v = get(app.params, path), d = get(DEFAULTS, path);
    return `<div class="srow ${v !== d ? 'changed' : ''}" data-row="${path}">
      <label for="s-${path}">${label || m.label}${m.unit ? ` <span class="unit">${m.unit}</span>` : ''} ${badge(m)}</label>
      <input type="range" id="s-${path}" data-p="${path}" min="${m.min}" max="${m.max}" step="${m.step}" value="${v}">
      <output>${fmt(v, m)}</output>
      ${m.note && !label ? `<p class="snote">${esc(m.note)}</p>` : ''}
    </div>`;
  }

  function body() {
    const P = app.params;
    if (tab === 'factors') return `
      <p class="hint">承載量 K = 背景值 + 各因子（點位密度經高斯擴散、正規化、飽和後）的加權平均。全市 K 的 p99 = 100。</p>
      <div class="sgroup"><h4>族群</h4>${slider('base.r', 'base.r')}${slider('base.kFloor', 'base.kFloor')}</div>
      ${Object.keys(P.factors).map(k => `<div class="sgroup"><h4>${FACTOR_LABELS[k]}</h4>
        ${slider(`factors.${k}.sigma`, 'factor.sigma')}${slider(`factors.${k}.weight`, 'factor.weight')}${slider(`factors.${k}.growth`, 'factor.growth')}${slider(`factors.${k}.sat`, 'factor.sat')}</div>`).join('')}`;
    if (tab === 'tasks') return `
      <p class="hint">任務在執行期間逐日扣除族群；被移除的族群中「外溢比例」移往範圍外的環帶（依環帶內承載量分配）。降承載量的任務結束後依半衰期恢復。</p>
      ${Object.entries(TASK_TYPES).map(([k, name]) => { const t = P.tasks[k]; return `<div class="sgroup"><h4>${name}</h4>
        ${k === 'poison' ? slider('tasks.poison.baitKill.sgar', 'task.baitKill', '撲殺率（第二代抗凝血劑）') + slider('tasks.poison.baitKill.fgar', 'task.baitKill', '撲殺率（第一代抗凝血劑）') + slider('tasks.poison.kill', 'task.kill', '撲殺率（其他藥劑）', ['richards1981']) : ''}
        ${k === 'clean' || k === 'trap' ? slider(`tasks.${k}.kill`, 'task.kill', t.killPer === 'day' ? '每日扣除比例（約每週 15%）' : '扣除比例（整個任務期間）', null) : ''}
        ${k === 'spray' ? '<p class="hint">環保局戶外環境噴藥（蚊蟲）。對鼠類沒有直接撲殺，預設只假設順帶清理水溝堆積物，承載量小幅暫降。設 0 即完全不影響模型。</p>' : ''}
        ${['clean', 'fill', 'spray'].includes(k) ? slider(`tasks.${k}.kDrop`, 'task.kDrop', null, k === 'spray' ? null : undefined) + slider(`tasks.${k}.kHalf`, 'task.kHalf', null, k === 'spray' ? null : undefined) : ''}
        ${slider(`tasks.${k}.spill`, 'task.spill')}${slider(`tasks.${k}.ring`, 'task.ring')}</div>`; }).join('')}
      <div class="sgroup"><h4>猛禽二次中毒提示</h4>${slider('raptor.buffer', 'raptor.buffer')}${slider('raptor.sinceYear', 'raptor.sinceYear')}</div>`;
    if (tab === 'reports') return `
      <p class="hint">溝鼠回報在估計值上加成：升溫幅度 × 辨識信心 × 跡證權重，於影響半徑內依距離線性遞減，並依半衰期消退。</p>
      <div class="sgroup"><h4>回報加成</h4>${slider('reports.base', 'reports.base')}${slider('reports.half', 'reports.half')}${slider('reports.radius', 'reports.radius')}</div>
      <div class="sgroup"><h4>跡證權重 <span class="assume">假設</span></h4>${Object.entries(EVIDENCE).map(([k, v]) => slider(`reports.evidence.${k}`, 'reports.evidence', v)).join('')}</div>`;
    return `
      <div class="sgroup"><h4>時間軸</h4>
        <div class="row"><label for="s-timeline">顯示時間軸（過去 90 天～未來 30 天）</label><span class="switch"><input type="checkbox" id="s-timeline" ${P.display.timeline ? 'checked' : ''}><i></i></span></div>
        <p class="hint">關閉後只顯示今天的狀態。今天 = ${esc(app.today)}（可用網址參數 ?today=YYYY-MM-DD 固定 demo 日期）。</p></div>
      <div class="sgroup"><h4>儲存</h4><p class="hint">任務、匯入的回報與設定存在這台電腦的瀏覽器（localStorage）。換瀏覽器或清除網站資料就會消失，請定期匯出備份。${store.saveOk ? '' : '<b>目前瀏覽器無法寫入儲存空間，重新整理後資料不會保留。</b>'}</p>
        <div class="actions"><button class="btn" type="button" data-act="export-all">匯出全部資料</button><label class="btn">匯入全部資料<input type="file" data-act="import-all" accept=".json" hidden></label></div></div>`;
  }

  function render() {
    el.innerHTML = `
      <header class="card-h"><div><div class="eyebrow">模型參數 · 即時預覽</div><h3>設定</h3></div><button class="x" type="button" data-act="close" aria-label="關閉">×</button></header>
      <nav class="tabs stabs" role="tablist">${Object.entries({ factors: '環境因子', tasks: '任務類型', reports: '回報', display: '顯示' }).map(([k, v]) => `<button role="tab" type="button" data-st="${k}" aria-selected="${k === tab}">${v}</button>`).join('')}</nav>
      <div class="sbody">${body()}</div>
      <div class="actions sfoot">
        <button class="btn" type="button" data-act="reset">還原預設值</button>
        <button class="btn" type="button" data-act="export">匯出設定</button>
        <label class="btn">匯入設定<input type="file" data-act="import" accept=".json" hidden></label>
        <span class="sstat" id="s-stat"></span>
      </div>
      <details class="srcs"><summary>參數來源（${SRC_KEYS.length}）</summary><ol>${SRC_KEYS.map(k => `<li id="src-${k}">${esc(SOURCES[k])}</li>`).join('')}</ol>
        <p class="hint">標「假設」的參數尚無直接文獻依據，為模型設計者的假設值；文獻整理於 2026-10-24，部分為轉引。</p></details>`;
    el.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.st; render(); }));
    el.querySelectorAll('[data-p]').forEach(inp => inp.addEventListener('input', () => {
      const path = inp.dataset.p, v = +inp.value;
      set(app.params, path, v);
      const row = inp.closest('.srow'); row.querySelector('output').textContent = fmt(v, META[metaOf(path)]);
      row.classList.toggle('changed', v !== get(DEFAULTS, path));
      schedule(ENV_PATHS.test(path));
    }));
    el.querySelector('#s-timeline')?.addEventListener('change', (e) => { app.params.display.timeline = e.target.checked; store.setParams(app.params); app.applyTimelineVisible(); });
    el.querySelector('[data-act=close]').addEventListener('click', close);
    el.querySelector('[data-act=reset]').addEventListener('click', () => { if (!confirm('把所有模型參數還原成預設值？')) return; app.params = clone(DEFAULTS); store.setParams(null); app.applyTimelineVisible(); app.recomputeEnv(); render(); });
    el.querySelector('[data-act=export]').addEventListener('click', () => download('模型參數.json', { format: FORMAT, exportedAt: new Date().toISOString(), params: app.params }));
    el.querySelector('[data-act=import]').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); if (j.format !== FORMAT) throw new Error('不是本工具匯出的設定檔'); app.params = mergeParams(j.params); store.setParams(app.params); app.applyTimelineVisible(); app.recomputeEnv(); render(); }
      catch (err) { alert('匯入失敗：' + err.message); }
    });
    el.querySelector('[data-act=export-all]')?.addEventListener('click', () => download(`鼠類防治資料_${app.today}.json`, store.exportAll()));
    el.querySelector('[data-act=import-all]')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); if (!confirm(`以檔案內容取代目前的 ${store.tasks.length} 筆任務與 ${store.reports.length} 筆匯入回報？`)) return; store.importAll(j); location.reload(); }
      catch (err) { alert('匯入失敗：' + err.message); }
    });
  }
  const metaOf = (path) => path.startsWith('base.') ? path : path.startsWith('factors.') ? 'factor.' + path.split('.').pop() : path.startsWith('tasks.poison.baitKill') ? 'task.baitKill' : path.startsWith('tasks.') ? 'task.' + path.split('.').pop() : path.startsWith('reports.evidence') ? 'reports.evidence' : path;

  function schedule(env) {
    needEnv ||= env;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const t0 = performance.now();
      needEnv ? app.recomputeEnv() : app.recomputeSim();
      needEnv = false;
      store.setParams(app.params);
      const s = $('s-stat'); if (s) s.textContent = `已重算 ${Math.round(performance.now() - t0)} ms`;
    }, 120);
  }

  function open() { render(); el.hidden = false; el.querySelector('.x').focus(); }
  function close() { el.hidden = true; $('btn-settings').focus(); }
  $('btn-settings').addEventListener('click', () => el.hidden ? open() : close());
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) close(); });
  return { open, close };
}
