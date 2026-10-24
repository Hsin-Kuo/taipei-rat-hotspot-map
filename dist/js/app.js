// 管理工具主程式：載入網格 → 承載量 → 逐日模擬 → 熱區貼圖；時間軸切換日期
import { createScene } from './scene.js';
import * as E from './engine.js';
import { renderHeat } from './heat.js';
import { createTimeline } from './timeline.js';
import { store, DEMO_ID } from './store.js';
import { createVillages, CLASS_LABELS, classOf, classRanges } from './villages.js';
import { renderCard } from './card.js';
import { createTasks } from './tasks.js';
import { openNotify } from './notify.js';
import { createReports } from './reports.js';
import { createSettings } from './settings.js';
import { createTaskTable } from './tasktable.js';
import { createSpray } from './spray.js';
import { themeSelect } from './themes.js';
import { PERSONAS } from './params.js';
import { $, taipeiToday } from './util.js';

const classOfIndex = (v) => classOf(v, 'index');
const P = new URLSearchParams(location.search);
// Demo 情境（?demo=ningxia）：載入情境資料並固定「今天」；否則 ?today=YYYY-MM-DD 可固定日期，預設為臺北時間今天
const DEMO = DEMO_ID ? await fetch(`data/demo_${DEMO_ID}.json`).then(r => { if (!r.ok) throw new Error('找不到情境 ' + DEMO_ID); return r.json(); }).catch(e => { $('loading').textContent = '載入失敗：' + e.message; throw e; }) : null;
if (DEMO) store.seed(DEMO);
const TODAY = DEMO ? DEMO.today : /^\d{4}-\d{2}-\d{2}$/.test(P.get('today') || '') ? P.get('today') : taipeiToday();
const RANGE = [-90, 30];

try { await main(); } catch (e) { $('loading').textContent = '載入失敗：' + e.message; console.error(e); }

async function main() {
  const [scene, gridMeta, gridBuf, simReports, villageFc, raptor, spraySched] = await Promise.all([
    createScene(),
    fetch('data/grid.json').then(r => r.json()),
    fetch('data/grid.bin').then(r => r.arrayBuffer()),
    DEMO ? { reports: DEMO.reports } : fetch('data/reports_sim.json').then(r => r.json()),
    fetch('data/villages.geojson').then(r => r.json()),
    fetch('data/raptor.json').then(r => r.json()),
    fetch('data/spray_schedule.json').then(r => r.json()),
  ]);
  const G = E.makeGrid(gridMeta, gridBuf);
  const app = {
    G, scene, today: TODAY, params: store.params(),
    env: null, sim: null, day: 0, heatMode: 'index',
    get tasks() { return store.tasks; },                                   // 使用者建立的任務
    get allTasks() { return [...store.tasks, ...(app.spray?.tasks || [])]; },   // ＋定期噴藥（進模型用）
    get reports() { return [...simReports.reports, ...store.reports]; },
    get persona() { return PERSONAS.find(p => p.id === store.persona) || PERSONAS[0]; },
    raptorPts: raptor.points, boundaryVersion: gridMeta.boundaryVersion, E, demo: DEMO,
  };
  const geoCache = new Map();
  const villages = app.villages = createVillages(scene, G, villageFc);
  app.spray = createSpray(app, spraySched);
  // 回報 → 所在里（依 id 快取）
  const repVill = new Map();
  app.reportVillage = (r) => { if (!repVill.has(r.id)) { const c = G.cellOf(r.lon, r.lat); repVill.set(r.id, c >= 0 && G.vid[c] ? G.villages[G.vid[c] - 1] : null); } return repVill.get(r.id); };
  // 某里是否在任務的外溢環帶
  const ringSets = new WeakMap();
  app.inRing = (t, k) => {
    const tp = app.params.tasks[t.type]; if (!tp || !t.scope?.villages?.length) return false;
    const geo = geoCache.get(t.scope.villages.join(',') + '|' + (tp.spill > 0 ? tp.ring : 0)); if (!geo) return false;
    if (!ringSets.has(geo)) ringSets.set(geo, new Set(geo.ring));
    const set = ringSets.get(geo); return G.vCells[k].some(m => set.has(m));
  };
  const heatCanvas = document.createElement('canvas');

  // 環境（因子設定改變時）→ 模擬（任務或成長參數改變時）→ 貼圖（日期、模式、回報改變時）
  function recomputeEnv() { app.env = E.computeEnv(G, app.params); app.baseByVillage = E.byVillage(G, app.env.K); geoCache.clear(); recomputeSim(); }
  function recomputeSim() {
    const t0 = performance.now();
    app.sim = E.simulate(G, app.env, app.params, app.allTasks, TODAY, RANGE, geoCache);
    app.simMs = Math.round(performance.now() - t0);
    timeline.setMarks(app.tasks, app.reports.filter(r => app.params.reports.species.includes(r.species)));
    redraw();
  }
  function redraw() {
    const boost = E.reportBoost(G, app.params, app.reports, app.day, TODAY);
    app.values = E.estimate(G, app.sim, boost, app.day);
    app.byVillage = E.byVillage(G, app.values);
    if (villages.state.fill) {
      scene.setHeat(null);
      villages.paintFill(app.heatMode === 'change' ? app.byVillage.map((v, k) => v - app.baseByVillage[k]) : app.byVillage, app.heatMode);
      renderFillLegend();
    } else {
      $('vfill-legend').hidden = true;
      villages.clearFill();
      renderHeat(G, app.values, app.env.K, app.heatMode, heatCanvas);
      scene.setHeat(heatCanvas, gridMeta.bounds);
    }
    if (villages.selected) renderCard(app, villages.selected);
    reportsUI?.paint();
    app.spray?.paint();
  }

  // 里分級著色圖例（依目前熱區模式）
  let legendMode = null;
  function renderFillLegend() {
    const el = $('vfill-legend'); el.hidden = false;
    if (legendMode === app.heatMode) return; legendMode = app.heatMode;
    el.innerHTML = `<div class="lg-title">${app.heatMode === 'change' ? '全里平均與環境基準差' : '全里平均族群指數'}</div>` +
      classRanges(app.heatMode).map(([lab, range, col]) => `<span><i style="background:${col}"></i>${lab}<em>${range}</em></span>`).join('');
  }

  // ---------- 里：近距離時 hover 顯示里、點擊開資訊卡；遠距離維持行政區（點擊飛至該區） ----------
  const NEAR = 16;   // 相機到目標距離（km）小於此值視為近距離
  app.selectVillage = (code) => { villages.setSelected(code); renderCard(app, code); };
  scene.hooks.hover = (ll) => {
    const code = ll && scene.camDist() < NEAR ? villages.codeAt(ll) : null;
    villages.setHover(code);
    if (!code) return null;
    const k = G.vIndex.get(code) - 1, v = app.byVillage[k];
    const action = tasks.editing ? (tasks.editing.scope.villages.includes(code) ? '點擊移出任務範圍' : '點擊加入任務範圍') : '點擊看詳情';
    return villages.tipHtml(code, `族群指數 ${v.toFixed(0)}（${CLASS_LABELS.index[classOfIndex(v)]}）· ${action}`);
  };
  scene.hooks.click = (ll) => {
    const code = ll && scene.camDist() < NEAR ? villages.codeAt(ll) : null;
    if (!code) return false;
    if (tasks.editing) return tasks.toggleVillage(code);    // 編輯任務時：點里 = 加入／移出範圍
    app.selectVillage(code); return true;
  };
  addEventListener('keydown', e => { if (e.key === 'Escape' && villages.selected) app.selectVillage(null); });
  $('t-vlines').addEventListener('change', e => villages.setLines(e.target.checked));
  $('t-vfill').addEventListener('change', e => { villages.state.fill = e.target.checked; redraw(); });

  const timeline = createTimeline($('timeline'), { d0: RANGE[0], d1: RANGE[1], today: TODAY, onChange: (d) => { app.day = d; redraw(); } });
  const applyTimelineVisible = () => {
    const on = app.params.display.timeline;
    $('timeline').hidden = !on;
    document.body.classList.toggle('has-timeline', on);
    if (!on) { timeline.stop(); timeline.set(0); }
  };
  applyTimelineVisible();

  // 熱區模式：族群指數 / 與環境基準相比的變化
  document.querySelectorAll('input[name=heat-mode]').forEach(r => r.addEventListener('change', e => {
    app.heatMode = e.target.value;
    $('ramp-index').hidden = app.heatMode !== 'index'; $('ramp-change').hidden = app.heatMode !== 'change';
    redraw();
  }));

  // ---------- 左側分頁、任務、通知、身分 ----------
  app.setTab = (name) => {
    document.querySelectorAll('[role=tab]').forEach(b => { const on = b.dataset.tab === name; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    document.querySelectorAll('[role=tabpanel]').forEach(p => { p.hidden = p.id !== 'pane-' + name; });
  };
  document.querySelectorAll('[role=tab]').forEach(b => b.addEventListener('click', () => app.setTab(b.dataset.tab)));
  app.openNotify = (t) => openNotify(app, t);
  const tasks = app.taskUI = createTasks(app);
  const reportsUI = app.reportsUI = createReports(app);
  app.settingsUI = createSettings(app);
  app.taskTable = createTaskTable(app);
  app.newTask = (codes) => tasks.newTask(codes);
  app.openTask = (id) => tasks.openTask(id);
  // 新增地點：功能尚未實作，先提示
  $('btn-add-place').addEventListener('click', () => { $('add-place-msg').hidden = false; });
  themeSelect($('theme'));     // 目前只有鼠類可選，其餘主題顯示「待整合」
  const sel = $('persona');
  sel.innerHTML = PERSONAS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  sel.value = app.persona.id;
  sel.addEventListener('change', () => store.setPersona(sel.value));

  // Demo 情境：頂端徽章＋重置（情境資料只在記憶體，重新載入即還原）
  if (DEMO) {
    $('demo-badge').hidden = false;
    $('demo-title').textContent = DEMO.title;
    $('btn-demo-reset').addEventListener('click', () => location.reload());
  }

  recomputeEnv();
  $('loading').classList.add('done');
  Object.assign(app, { recomputeEnv, recomputeSim, redraw, timeline, applyTimelineVisible, E });
  window.__app = app;
}
