// Demo 影片自動模式（#demo=ningxia&script=video）：約 3 分鐘，畫面下方字幕條
// 先開螢幕錄影，再按空白鍵或點擊開始；全程自動，結束後停在收尾畫面。腳本對應 docs/demo-scenario.md §7
import { createStage } from './demo.js';
import { $ } from './util.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

export function createVideo(app, scenario) {
  const stage = createStage(app, scenario, { interactive: false });
  const { scene } = app, T = scene.THREE;
  const cap = $('caption');
  const V = { fuyin: '6300700008', fufu: '6300700010' };

  const say = (text) => { cap.textContent = text; cap.hidden = !text; };
  // 高亮某個元素（表單欄位、按鈕），讓觀眾知道畫面在操作哪裡
  const hl = (el, ms = 1600) => { if (!el) return; el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); el.classList.add('demo-hl'); setTimeout(() => el.classList.remove('demo-hl'), ms); };
  // 相機繞目標水平旋轉 deg 度
  const orbit = (deg, ms) => new Promise(res => {
    const { camera, controls } = scene, t0 = performance.now(), off0 = camera.position.clone().sub(controls.target);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      camera.position.copy(controls.target).add(off0.clone().applyAxisAngle(new T.Vector3(0, 1, 0), T.MathUtils.degToRad(deg) * e));
      k < 1 ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  });
  // 逐步拉動設定抽屜的滑桿（每步間隔 > 重算延遲，觀眾看得到地圖跟著變）
  async function slide(path, to, steps = 6, gap = 450) {
    const el = document.querySelector(`#settings [data-p="${path}"]`); if (!el) return;
    hl(el.closest('.srow'), steps * gap + 600);
    const from = +el.value;
    for (let i = 1; i <= steps; i++) { el.value = from + (to - from) * i / steps; el.dispatchEvent(new Event('input')); await wait(gap); }
  }

  async function run() {
    // ---------- ① 地圖操作與圖層（約 30 秒） ----------
    stage.closeAll(); stage.setMode('index'); app.timeline.set(0);
    stage.pose(stage.HOME.t, stage.HOME.p, 800);
    say('台北環衛模型：衛星影像鋪在真實地形上，紅色是溝鼠族群推估'); await wait(4000);
    say('滾輪縮放、拖曳平移、⌥＋拖曳旋轉');
    stage.pose([-1.6, 0, 4.6], [-2.6, 6.5, 11], 1800); await wait(1900);
    await orbit(20, 2200); await orbit(-20, 1800);
    // 先收起傳統市場、廚餘收受點，再依序打開，讓觀眾看到圖層出現
    stage.setCheck('t-tmarket', false); stage.setCheck('t-recycle', false);
    say('圖層可根據相關地點計算，顯示老鼠熱區');
    stage.pose([-2.4, 0, 5.6], [-2.9, 2.6, 8.4], 2000); await wait(1500);
    hl($('t-tmarket').closest('.row')); stage.setCheck('t-tmarket', true); await wait(3000);
    hl($('t-recycle').closest('.row')); stage.setCheck('t-recycle', true); await wait(3000);
    say('熱度可以「里」為單位檢視、並顯示近期定期噴藥的里（環保局日程）');
    hl($('t-vfill').closest('.row')); stage.setCheck('t-vfill', true); await wait(3000);
    hl($('t-spray').closest('.row')); stage.setCheck('t-spray', true); await wait(3500);
    stage.setCheck('t-vfill', false); stage.setCheck('t-spray', false);

    // ---------- ② 寧夏故事（約 60 秒；同台上腳本） ----------
    // 影片字幕寫給觀眾看（台上模式的步驟提示維持簡短版，兩者分開）
    const STORY = [
      ['全市族群指數：發現近兩週回報暴增', 6000],
      ['暴增位置為寧夏夜市（舉例）', 7500],
      ['點擊星明里，可看到等級為高、近 30 天回報量大增', 9500],
      ['建立寧夏投藥任務：確認範圍、模型預估狀況', 12000],
      ['通知清單：範圍 3 里＋外溢環帶', 9000],
    ];
    for (let i = 0; i < STORY.length; i++) { say(STORY[i][0]); stage.run(i); await wait(STORY[i][1]); }
    say('模擬投藥流程：投藥開始推播誤食提醒 → 族群壓低 → 回收完成推播');
    stage.run(5); await wait(1600);
    for (const t0 = performance.now(); (app.timeline.playing || app.timeline.day < 30) && performance.now() - t0 < 25000;) await wait(200);   // 等播放到第 30 天
    await wait(4000);

    // ---------- ③ 萬華建立任務＋猛禽提示（約 50 秒） ----------
    stage.closeAll(); stage.setMode('index'); stage.setCheck('t-vfill', false); app.timeline.set(0);
    say('另一個熱點：萬華福音里（直興市場、東三水街）');
    stage.atVillage(V.fuyin, [-0.8, 3.2, 3.6]); await wait(2000);
    app.selectVillage(V.fuyin); await wait(5500);
    say('從資訊卡「以此里建立任務」');
    hl(document.querySelector('#card [data-act=new-task]')); await wait(1500);
    app.newTask([V.fuyin]); await wait(2500);
    say('在地圖上點選鄰里，加入任務範圍');
    app.taskUI.toggleVillage(V.fufu, true); hl($('tf-chips')); await wait(4500);
    say('選擇投藥（第二代抗凝血劑）→ 系統自動檢查猛禽二次中毒風險');
    hl(document.querySelector('#taskform [data-f="bait.kind"]')); await wait(2500);
    hl($('tf-raptor'), 6000); await wait(7500);
    say('因附近有鳳頭蒼鷹紀錄 → 改用捕鼠籠，避免二次中毒');
    const trap = document.querySelector('#taskform input[name=ttype][value=trap]');
    hl(trap.closest('label')); trap.click(); await wait(4500);
    say('同樣有模型預估：比較範圍內與外溢環帶的族群變化');
    await wait(400); hl($('tf-preview'), 7000); await wait(8500);
    app.taskUI.close();

    // ---------- ④ 設定與文獻來源（約 30 秒） ----------
    stage.pose(stage.HOME.t, stage.HOME.p, 1500);
    say('設定：模型參數即時預覽，每個參數標示文獻來源或「假設」');
    app.settingsUI.open(); await wait(6000);
    say('拉動參數（例：餐飲業者強度），地圖即時重算');
    await slide('factors.food.weight', 3); await wait(4000);
    await slide('factors.food.weight', 1, 4, 350); await wait(1000);
    say('任務類型參數：撲殺率、外溢比例都有來源標示');
    document.querySelector('#settings [data-st=tasks]').click(); await wait(6500);
    const srcs = document.querySelector('#settings .srcs'); if (srcs) { srcs.open = true; hl(srcs, 3500); srcs.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
    say('文獻清單：Byers 2019、Buckle 2012、Hong 2019（臺灣猛禽抗凝血劑殘留）等'); await wait(7000);
    app.settingsUI.close();

    // ---------- ⑤ 收尾（約 10 秒） ----------
    say('鼠類是第一個主題，期待未來有其他環衛主題陸續整合，使平台不只服務單一議題');
    stage.run(6); await wait(11000);
    say('');
  }

  // 開始提示：先開螢幕錄影，再按空白鍵或點擊開始
  const gate = $('video-gate');
  gate.hidden = false;
  let started = false;
  const start = (e) => { if (started) return; if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return; e.preventDefault(); started = true; gate.hidden = true; run().catch(err => { console.error(err); say('影片腳本中斷：' + err.message); }); };
  addEventListener('keydown', start); gate.addEventListener('click', start);
  return { run };
}
