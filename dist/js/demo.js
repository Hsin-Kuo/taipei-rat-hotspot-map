// Demo 台上逐步模式：按 → / PageDown 前進、← / PageUp 退回（簡報筆可用）
// 每一步都是「設定成該步的完整狀態」，所以退回、跳步或中途用滑鼠操作後再前進，畫面都一致
import { themeOverviewHtml } from './themes.js';
import { $ } from './util.js';

export function createStage(app, scenario, { interactive = true } = {}) {
  const { scene, villages } = app, T = scene.THREE;
  const main = () => app.allTasks.find(t => t.id === scenario.mainTask);
  const focus = scenario.scope[1] ?? scenario.scope[0];                     // 星明里（寧夏夜市所在）

  // ---------- 共用動作 ----------
  const setCheck = (id, on) => { const el = $(id); if (el.checked !== on) el.click(); };
  const setMode = (mode) => { const r = document.querySelector(`input[name=heat-mode][value=${mode}]`); if (!r.checked) r.click(); };
  const closeAll = () => {
    const dlg = $('notify'); if (dlg.open) dlg.close();
    app.selectVillage(null); app.taskUI.close(); app.taskTable.toggle(false);
    $('theme-overlay').hidden = true; app.timeline.stop();
  };
  const HOME = { t: [-0.4, 0, 1.4], p: [-6, 19, 29] };
  const pose = (t, p, ms = 1400) => scene.flyTo(new T.Vector3(...t), new T.Vector3(...p), ms);
  const atVillage = (code, [dx, dy, dz], ms) => { const [lon, lat] = villages.props(code).centroid, x = scene.X(lon), z = scene.Z(lat); pose([x, 0, z], [x + dx, dy, z + dz], ms); };

  // ---------- 7 個步驟（對應 docs/demo-scenario.md §6） ----------
  const STEPS = [
    { label: '全市族群指數：最近兩週回報暴增', go() { closeAll(); app.setTab('layers'); setMode('index'); setCheck('t-vfill', false); app.timeline.set(0); pose(HOME.t, HOME.p); } },
    { label: '飛到寧夏夜市，里分級著色', go() { closeAll(); app.setTab('layers'); setMode('index'); setCheck('t-vfill', true); app.timeline.set(0); atVillage(focus, [-0.9, 3.4, 3.8]); } },
    { label: '星明里：等級高、近 30 天回報', go() { closeAll(); setMode('index'); setCheck('t-vfill', true); app.timeline.set(0); atVillage(focus, [-0.9, 3.4, 3.8], 600); app.selectVillage(focus); } },
    { label: '寧夏投藥任務：範圍、猛禽提示、模型預估', go() { closeAll(); setMode('index'); setCheck('t-vfill', true); app.timeline.set(0); atVillage(focus, [-0.9, 3.4, 3.8], 600); app.openTask(scenario.mainTask); } },
    { label: '通知清單：範圍 3 里＋外溢環帶', go() { closeAll(); app.timeline.set(0); app.openTask(scenario.mainTask); app.openNotify(main()); } },
    { label: '切「變化」並播放：投藥 → 推播 → 回收', go() {
      closeAll(); app.setTab('layers'); setCheck('t-vfill', false); setMode('change'); atVillage(focus, [-1.4, 5.2, 5.8]);
      app.timeline.set(0); setTimeout(() => { if (cur === 5) app.timeline.play(); }, 1500);      // 相機到位後才開始播放
    } },
    { label: '收尾：台北環衛模型的其他主題', go() { closeAll(); setMode('index'); setCheck('t-vfill', false); app.timeline.set(0); pose(HOME.t, HOME.p); $('theme-overlay').innerHTML = themeOverviewHtml(); $('theme-overlay').hidden = false; } },
  ];

  let cur = -1;
  const chip = $('stage-chip');
  function go(i) {
    cur = Math.max(0, Math.min(STEPS.length - 1, i));
    STEPS[cur].go();
    chip.innerHTML = `<b>${cur + 1}/${STEPS.length}</b> ${STEPS[cur].label}`;
    chip.hidden = false;
  }
  if (interactive) {
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, select, textarea') || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(cur + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(cur - 1); }
    });
    chip.hidden = false;
    chip.innerHTML = '按 <kbd>→</kbd> 開始（<kbd>←</kbd> 退回）';
  }
  // 影片模式：只執行步驟，不顯示步驟提示
  const run = (i) => { cur = i; STEPS[i].go(); };
  return { go, run, get step() { return cur; }, steps: STEPS, closeAll, atVillage, pose, setCheck, setMode, HOME };
}
