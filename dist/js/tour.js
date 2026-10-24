// 新手導覽：第一次開啟時自動出現，右上角「?」可隨時重看；demo／影片模式不自動出現。
// 以聚光燈標出介面區塊，旁邊放說明卡；聚光範圍內可以直接操作（例如地圖那一步可拖曳、縮放）。
// 每一步都是「進入時設成該步需要的狀態」，所以上一步、下一步、跳步都一致；結束時收回面板與資訊卡。
import { $ } from './util.js';

const DONE_KEY = 'taipei-env-model.tour.v1';
const doneRead = () => { try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return false; } };
const doneWrite = () => { try { localStorage.setItem(DONE_KEY, '1'); } catch {} };

export function createTour(app) {
  const { scene, villages, G } = app, T = scene.THREE;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- 相機 ----------
  const HOME = { t: [-0.4, 0, 1.4], p: [-6, 19, 29] };
  const pose = (t, p, ms = 1200) => scene.flyTo(new T.Vector3(...t), new T.Vector3(...p), ms);
  const atVillage = (code, [dx, dy, dz] = [-0.9, 3.4, 3.8], ms = 1200) => { const [lon, lat] = villages.props(code).centroid, x = scene.X(lon), z = scene.Z(lat); pose([x, 0, z], [x + dx, dy, z + dz], ms); };
  // 推估最高的里（示範資訊卡用）
  const topVillage = () => { let best = -1, k0 = -1; (app.byVillage || []).forEach((v, k) => { if (v > best) { best = v; k0 = k; } }); return k0 >= 0 ? G.villages[k0] : null; };

  // ---------- 目標區塊（回傳一組元素或矩形，取聯集） ----------
  const els = (...sel) => () => sel.map(s => typeof s === 'string' ? document.querySelector(s) : s).filter(e => e && !e.hidden && e.offsetParent !== null);
  const rowOf = (id) => $(id)?.closest('.row');
  const mapArea = () => {   // 地圖可操作區：面板右側、時間軸上方
    const p = $('panel').getBoundingClientRect(), tl = $('timeline'), tb = $('topbar').getBoundingClientRect();
    const mobile = matchMedia('(max-width: 720px)').matches;
    const bottom = tl && !tl.hidden ? tl.getBoundingClientRect().top - 12 : innerHeight - 60;
    return mobile ? [{ left: 8, top: tb.bottom + 8, right: innerWidth - 8, bottom: p.top - 8 }] : [{ left: p.right + 16, top: tb.bottom + 12, right: innerWidth - 16, bottom }];
  };

  // ---------- 步驟 ----------
  let sampleCode = null;
  const STEPS = [
    { title: '歡迎使用台北環衛模型', body: `
        <p>這是用衛星影像和真實地形做成的台北立體模型。目前的主題是<b>鼠類</b>：地圖上的紅色代表依環境條件推估的溝鼠族群，顏色越深代表越多。</p>
        <p class="tour-note">這是推估值，不是實際捕鼠或通報數。</p>
        <p>接下來大約一分鐘，帶你看地圖怎麼讀、工具怎麼用。</p>`,
      enter() { app.setTab('layers'); pose(HOME.t, HOME.p); }, primary: '開始導覽' },
    { title: '移動地圖', target: mapArea, interactive: true, body: `
        <p>在亮起來的區域直接試試看：</p>
        <ul><li><b>拖曳</b>：平移</li><li><b>滾輪</b>：縮放</li><li><b>⌥ 或右鍵＋拖曳</b>：旋轉、傾斜</li><li><b>點行政區</b>：鏡頭飛過去；拉近後點任一個<b>里</b>，會打開它的資訊卡</li></ul>` },
    { title: '讀懂熱區', target: () => [...els('#pane-layers section:first-of-type h2', '#pane-layers .seg', '#ramp-index', '#ramp-change', '#pane-layers .slider')(), rowOf('t-heat')].filter(Boolean),
      enter() { app.setTab('layers'); }, interactive: true, body: `
        <p><b>族群指數</b>：全市第 99 百分位定為 100，橘到深紅代表由低到高。</p>
        <p><b>變化</b>：和環境基準相比。藍色是被防治任務壓低的地方，紅色是因回報或外溢而升高的地方。</p>
        <p>不透明度調低一點，可以看到底下的街道。</p>` },
    { title: '以「里」為單位來看', target: () => [rowOf('t-vfill'), $('vfill-legend'), rowOf('t-spray'), rowOf('t-vlines')].filter(e => e && !e.hidden),
      enter() { app.setTab('layers'); }, interactive: true, body: `
        <p><b>里分級著色</b>把網格彙總成每個里的等級，適合排定處理的優先順序。</p>
        <p><b>近期定期噴藥的里</b>標出環保局日程中最近噴過藥的里。</p>
        <p>可以現在打開看看，導覽結束後設定會保留。</p>` },
    { title: '推估用到哪些地點', target: els('#pane-layers section:nth-of-type(2)'),
      enter() { app.setTab('layers'); }, interactive: true, body: `
        <p>熱區是由這些環境因子算出來的：攤販集中場、傳統市場、餐飲業者、垃圾車停靠點、廚餘收受點，再加上污水與雨水下水道。</p>
        <p>打開圖層就能看到位置，滑鼠移到點上會顯示名稱。</p>` },
    { title: '時間軸：過去與預測', target: els('#timeline'), skip: () => $('timeline').hidden, interactive: true, body: `
        <p>時間軸涵蓋<b>過去 90 天到未來 30 天</b>。拖曳或按播放，看族群怎麼變化；<b>今天以後是模型預測</b>。</p>
        <p>軸上的記號是任務與回報的日期。</p>` },
    { title: '點里看詳情', target: els('#card'), interactive: true,
      enter() {
        sampleCode = topVillage(); if (!sampleCode) return;
        app.setTab('layers'); atVillage(sampleCode, [-0.9, 3.4, 3.8], 1000); app.selectVillage(sampleCode);
      },
      leave() { app.selectVillage(null); },
      body: () => { const p = sampleCode && villages.props(sampleCode); return `
        <p>這是目前推估最高的里${p ? `：<b>${esc(p.district)} ${esc(p.name)}</b>` : ''}。</p>
        <p>資訊卡會列出等級、近 30 天回報、進行中的任務，也可以從這裡直接<b>以此里建立任務</b>。</p>
        <p>按 <kbd>Esc</kbd> 或卡片上的關閉鈕收起。</p>`; } },
    { title: '規劃防治任務', target: els('nav.tabs', '#pane-tasks'), enter() { app.setTab('tasks'); pose(HOME.t, HOME.p); }, interactive: true, body: `
        <p>在「任務」分頁新增<b>投藥、環境清消、捕鼠籠、填補鼠洞</b>。範圍以里為單位，可以直接在地圖上點選。</p>
        <p>建立前會看到<b>模型預估</b>的效果與外溢範圍；投藥時若附近有鳳頭蒼鷹紀錄，會提醒二次中毒風險。完成後可產生民眾通知清單。</p>` },
    { title: '回報', target: els('nav.tabs', '#pane-reports'), enter() { app.setTab('reports'); }, interactive: true, body: `
        <p>「回報」分頁是民眾或巡查的目擊紀錄，可以依鼠種篩選。只有<b>溝鼠</b>回報會提高族群估計，影響隨距離和時間遞減。</p>
        <p class="tour-note">目前預載的是模擬資料，也可以匯入自己的 JSON。</p>` },
    { title: '右上角的工具', target: els('#topbar'), enter() { app.setTab('layers'); }, body: `
        <ul><li><b>任務列表</b>：用表格檢視全部任務，可搜尋、篩選、匯出。</li>
        <li><b>身分</b>：記錄是誰建立或修改任務（示範用，不限制權限）。</li>
        <li><b>⚙ 設定</b>：調整模型參數，地圖即時重算；每個參數都標示文獻來源或「假設」。</li>
        <li><b>?</b>：隨時重看這段導覽。</li></ul>` },
    { title: '其他環衛主題', target: els('#panel label.theme'), body: `
        <p>鼠類是第一個主題。登革熱病媒蚊、髒亂點、空氣品質等主題規劃中，會沿用同一套地圖與任務流程。</p>` },
    { title: '開始使用吧', body: `
        <p>建議從這三件事開始：</p>
        <ol><li>拉近你關心的區域，點里看資訊卡。</li><li>切到「變化」模式，播放時間軸。</li><li>在「任務」分頁試著建立一個任務，看模型預估。</li></ol>
        <p>想看完整的使用情境，可以開啟<a href="model.html#demo=ningxia" target="_blank" rel="noopener">寧夏夜市示範</a>（另開分頁，資料為模擬）。</p>`,
      enter() { app.setTab('layers'); pose(HOME.t, HOME.p); }, primary: '完成' },
  ];

  // ---------- 畫面元件：四片遮罩（中間留洞可操作）＋外框＋說明卡 ----------
  const root = document.createElement('div'); root.className = 'tour'; root.hidden = true;
  root.innerHTML = `<div class="tour-shade"></div><div class="tour-shade"></div><div class="tour-shade"></div><div class="tour-shade"></div>
    <div class="tour-ring" aria-hidden="true"></div>
    <section class="tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <div class="tour-head"><span class="tour-step" id="tour-step"></span><button type="button" class="tour-x" id="tour-skip" aria-label="略過導覽">略過</button></div>
      <h3 id="tour-title"></h3>
      <div class="tour-body" id="tour-body"></div>
      <div class="tour-dots" id="tour-dots" aria-hidden="true"></div>
      <div class="tour-actions"><button type="button" class="btn" id="tour-prev">上一步</button><button type="button" class="btn primary" id="tour-next">下一步</button></div>
    </section>`;
  document.body.appendChild(root);
  const shades = [...root.querySelectorAll('.tour-shade')], ring = root.querySelector('.tour-ring'), card = root.querySelector('.tour-card');

  let cur = -1, raf = 0, prevFocus = null;
  const visibleSteps = () => STEPS.map((s, i) => i).filter(i => !STEPS[i].skip?.());

  function unionRect(list) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const x of list) { const q = x.getBoundingClientRect ? x.getBoundingClientRect() : x; if (!q || q.right - q.left < 1) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
    return l === Infinity ? null : { left: l, top: t, right: r, bottom: b };
  }
  function layout() {
    const s = STEPS[cur]; if (!s) return;
    const list = s.target ? s.target() : [];
    const pad = 6; let h = list.length ? unionRect(list) : null;
    if (h) h = { left: Math.max(4, h.left - pad), top: Math.max(4, h.top - pad), right: Math.min(innerWidth - 4, h.right + pad), bottom: Math.min(innerHeight - 4, h.bottom + pad) };
    const W = innerWidth, H = innerHeight;
    if (!h) { // 沒有目標：整片遮罩、說明卡置中
      Object.assign(shades[0].style, { left: '0', top: '0', width: W + 'px', height: H + 'px' });
      for (const sh of shades.slice(1)) sh.style.width = sh.style.height = '0';
      ring.style.display = 'none';
      card.style.left = Math.round((W - card.offsetWidth) / 2) + 'px'; card.style.top = Math.round((H - card.offsetHeight) / 2) + 'px';
      return;
    }
    // 上、下、左、右四片
    Object.assign(shades[0].style, { left: '0', top: '0', width: W + 'px', height: h.top + 'px' });
    Object.assign(shades[1].style, { left: '0', top: h.bottom + 'px', width: W + 'px', height: Math.max(0, H - h.bottom) + 'px' });
    Object.assign(shades[2].style, { left: '0', top: h.top + 'px', width: h.left + 'px', height: (h.bottom - h.top) + 'px' });
    Object.assign(shades[3].style, { left: h.right + 'px', top: h.top + 'px', width: Math.max(0, W - h.right) + 'px', height: (h.bottom - h.top) + 'px' });
    ring.style.display = ''; Object.assign(ring.style, { left: h.left + 'px', top: h.top + 'px', width: (h.right - h.left) + 'px', height: (h.bottom - h.top) + 'px' });
    root.classList.toggle('tour-block', !s.interactive);
    // 說明卡：優先放右側，其次左側、下方、上方；都放不下就貼在洞內角落
    const cw = card.offsetWidth, ch = card.offsetHeight, g = 14, M = 12;
    const fits = [
      [h.right + g, Math.min(Math.max(M, h.top), H - ch - M), h.right + g + cw <= W - M],
      [h.left - g - cw, Math.min(Math.max(M, h.top), H - ch - M), h.left - g - cw >= M],
      [Math.min(Math.max(M, h.left), W - cw - M), h.bottom + g, h.bottom + g + ch <= H - M],
      [Math.min(Math.max(M, h.left), W - cw - M), h.top - g - ch, h.top - g - ch >= M],
    ].find(f => f[2]) || [W - cw - M - 8, H - ch - M - 8];
    card.style.left = Math.round(fits[0]) + 'px'; card.style.top = Math.round(fits[1]) + 'px';
  }
  // 面板捲動、相機飛行、資訊卡展開時目標會移動：跟著重算
  const tick = () => { layout(); raf = requestAnimationFrame(tick); };

  function show(i) {
    const order = visibleSteps(); if (!order.length) return;
    const pos = Math.max(0, Math.min(order.length - 1, i));
    if (cur >= 0) STEPS[cur].leave?.();
    cur = order[pos];
    const s = STEPS[cur];
    s.enter?.();
    $('tour-step').textContent = `${pos + 1} / ${order.length}`;
    $('tour-title').textContent = s.title;
    $('tour-body').innerHTML = typeof s.body === 'function' ? s.body() : s.body;
    $('tour-dots').innerHTML = order.map((_, k) => `<i class="${k === pos ? 'on' : ''}"></i>`).join('');
    $('tour-prev').hidden = pos === 0;
    $('tour-next').textContent = s.primary || (pos === order.length - 1 ? '完成' : '下一步');
    const targets = s.target ? s.target() : [];
    const first = targets.find(e => e instanceof Element); first?.scrollIntoView?.({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    card.classList.remove('tour-in'); void card.offsetWidth; card.classList.add('tour-in');
    // 資訊卡那一步：卡片內容非同步出現，下一幀再更新文字
    if (typeof s.body === 'function') setTimeout(() => { if (STEPS[cur] === s) $('tour-body').innerHTML = s.body(); }, 60);
    $('tour-next').focus({ preventScroll: true });
  }
  const step = (d) => { const order = visibleSteps(), pos = order.indexOf(cur); if (pos + d >= order.length) return end(true); show(pos + d); };

  function onKey(e) {
    if (root.hidden) return;
    if (e.target.closest?.('input, select, textarea') && e.key !== 'Escape') return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(false); }
    else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest?.('a, button:not(#tour-next)'))) { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  }

  function start() {
    if (!root.hidden) return;
    prevFocus = document.activeElement;
    app.taskUI?.close?.(); app.taskTable?.toggle?.(false); app.settingsUI?.close?.(); app.selectVillage(null);
    root.hidden = false; document.body.classList.add('tour-on'); cur = -1;
    show(0); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    addEventListener('keydown', onKey, true);
  }
  function end(finished) {
    if (root.hidden) return;
    STEPS[cur]?.leave?.(); cur = -1;
    root.hidden = true; document.body.classList.remove('tour-on'); cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey, true);
    app.setTab('layers'); app.selectVillage(null);
    doneWrite();
    (prevFocus && prevFocus.focus ? prevFocus : $('btn-tour'))?.focus?.({ preventScroll: true });
  }

  $('tour-next').addEventListener('click', () => step(1));
  $('tour-prev').addEventListener('click', () => step(-1));
  $('tour-skip').addEventListener('click', () => end(false));
  $('btn-tour')?.addEventListener('click', start);

  // 第一次開啟自動出現（demo／影片模式、或網址帶 #tour=0 時不自動）；網址帶 #tour 會強制開啟
  const hash = new URLSearchParams(location.hash.slice(1));
  const force = hash.has('tour') && hash.get('tour') !== '0';
  if (!app.demo && (force || (!doneRead() && hash.get('tour') !== '0'))) setTimeout(start, 700);

  return { start, end, show: (i) => { if (root.hidden) start(); show(i); }, get step() { return cur; }, steps: STEPS };
}
