// 黑客松 demo 情境「寧夏夜市」→ dist/data/demo_ningxia.json（規格：docs/demo-scenario.md）
// 內容：固定的情境日期、全市背景回報＋寧夏暴增回報、4 筆預載任務（含修改紀錄）、兩則臺北通推播（概念示意）
import { writeFile } from 'node:fs/promises';
import { isoOf } from '../dist/js/engine.js';
import { PERSONAS } from '../dist/js/params.js';
import { loadGridEnv, generateBackground, rng, cellSampler, randomPointIn, hhmm } from './lib/sim-reports.mjs';

const D = '2026-11-02';                               // 情境的「今天」
const d = (n) => isoOf(n, D);
const BOUNDARY = '2026-09';
const V = { xingming: '6300600007', guangneng: '6300600008', chaoyang: '6300600006', fuyin: '6300700008', fufu: '6300700010', wenxiang: '6300500030', zhongyang: '6300400033' };
const SCOPE = [V.chaoyang, V.xingming, V.guangneng];   // 依村里代碼排序（與表單一致）

const { G, env } = await loadGridEnv();

// ---------- 回報 ----------
const background = generateBackground({ G, env, end: d(-1), seed: 20261102, idPrefix: 'demo-bg-' });
// 寧夏暴增：30 筆溝鼠，集中在 3 里，D−14～D−1 逐日增加
const { rnd, pick } = rng(20261103);
const inScope = new Set(SCOPE.map(c => G.vIndex.get(c)));
const sample = cellSampler(G, Array.from(env.K, (k, m) => inScope.has(G.vid[G.cells[m]]) ? k : 0), rnd);
// 每日筆數固定（D−14 起），呈現逐日增加，合計 30
const PER_DAY = [0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 5];
const days = PER_DAY.flatMap((n, i) => Array(n).fill(i - 14));
const spike = [];
for (let n = 0; n < days.length; n++) {
  const [lon, lat] = randomPointIn(G, sample(), rnd);
  const day = days[n], hour = pick([[21, 3], [22, 4], [23, 4], [0, 2], [6, 2], [7, 1]]);
  spike.push({
    id: 'demo-nx-' + String(n + 1).padStart(3, '0'), lon, lat,
    time: `${d(day)}T${hhmm(hour, Math.floor(rnd() * 60))}`,
    species: 'norway', confidence: +(0.65 + rnd() * 0.35).toFixed(2),
    count: pick([[1, 55], [2, 30], [3, 10], [5, 5]]),
    evidence: pick([['live', 45], ['dead', 20], ['burrow', 20], ['droppings', 15]]),
    simulated: true, source: pick([['1999 通報', 5], ['里辦公處', 3], ['清潔隊巡查', 2]]),
  });
}
const reports = [...background, ...spike].sort((a, b) => a.time.localeCompare(b.time));

// ---------- 任務 ----------
const P = Object.fromEntries(PERSONAS.map(p => [p.id, p]));
const at = (date, hm) => new Date(`${date}T${hm}:00+08:00`).toISOString();
const hist = (entries) => entries.map(([date, hm, who, action, summary, changes = []]) => ({ at: at(date, hm), by: who, byName: P[who].name, action, changes, summary }));
function task(o, history) {
  const h = hist(history), first = h[0], last = h.at(-1);
  return {
    scope: { type: 'villages', villages: o.villages, geometry: null, boundaryVersion: BOUNDARY },
    executor: { kind: 'team', team: '', squad: '', vendor: '', contract: '', other: '', ...o.executor },
    bait: { kind: 'sgar', points: null, ...o.bait },
    followups: { carcass: { date: d(0), done: false }, residue: { date: d(0), done: false }, ...o.followups },
    budget: { planned: null, actual: null, ...o.budget },
    notify: { enabled: true, methods: ['board'], date: o.start, ...o.notify },
    note: '', ...o, villages: undefined,
    history: h, createdBy: first.by, createdByName: first.byName, createdAt: first.at, updatedAt: last.at, updatedBy: last.by,
  };
}
const ningxiaCount = spike.length;
const tasks = [
  task({ id: 'demo-task-ningxia', caseNo: 'RC-202611-001', type: 'poison', status: 'planned', villages: SCOPE,
    start: d(2), end: d(8), executor: { team: '大同區', squad: '第一分隊' }, bait: { kind: 'sgar', points: 24 },
    followups: { carcass: { date: d(9), done: false }, residue: { date: d(15), done: false } },
    budget: { planned: 85000 }, notify: { methods: ['board', 'flyer', 'app'], date: d(0) },
    note: `寧夏夜市周邊兩週內溝鼠回報 ${ningxiaCount} 件。夜市收攤後投放，使用加蓋餌站，翌晨巡查補餌。` },
  [[d(-1), '16:20', 'epb-vector', 'create', '建立任務'],
   [d(-1), '17:05', 'epb-vector', 'edit', '投藥點數：（空） → 24', [['bait.points', null, 24]]]]),
  task({ id: 'demo-task-wanhua', caseNo: 'RC-202609-014', type: 'clean', status: 'done', villages: [V.fuyin, V.fufu],
    start: d(-32), end: d(-30), executor: { team: '萬華區', squad: '第三分隊' },
    followups: { carcass: { date: d(-29), done: true }, residue: { date: d(-29), done: false } },
    budget: { planned: 40000, actual: 36500 }, notify: { methods: ['board'], date: d(-35) },
    note: '東三水街與直興市場周邊巷弄清除堆積物、廚餘，並封閉破損垃圾桶。' },
  [[d(-38), '10:12', 'epb-vector', 'create', '建立任務'],
   [d(-29), '15:40', 'team-wanhua', 'edit', '狀態：規劃中 → 已完成；鼠屍清理完成：否 → 是；實際支出：（空） → 36500', [['status', 'planned', 'done'], ['followups.carcass.done', false, true], ['budget.actual', null, 36500]]]]),
  task({ id: 'demo-task-dongmen', caseNo: 'RC-202610-022', type: 'trap', status: 'active', villages: [V.wenxiang],
    start: d(-5), end: d(10), executor: { kind: 'vendor', vendor: '示範除鼠股份有限公司', contract: 'TPE-115-RC-007' },
    followups: { carcass: { date: d(11), done: false }, residue: { date: d(11), done: false } },
    budget: { planned: 60000 }, notify: { methods: ['board', 'flyer'], date: d(-7) },
    note: '東門市場攤商反映；市場內外共設置 40 個捕鼠籠，每日巡籠。' },
  [[d(-9), '09:30', 'market-office', 'create', '建立任務'],
   [d(-5), '08:10', 'vendor-demo', 'edit', '狀態：規劃中 → 執行中', [['status', 'planned', 'active']]]]),
  task({ id: 'demo-task-zhongyang', caseNo: 'RC-202610-027', type: 'fill', status: 'planned', villages: [V.zhongyang],
    start: d(12), end: d(14), executor: { team: '中山區', squad: '' },
    followups: { carcass: { date: d(15), done: false }, residue: { date: d(15), done: false } },
    budget: { planned: 30000 }, notify: { methods: ['board'], date: d(9) },
    note: '四平街商圈後巷與建國市場周邊鼠洞填補。' },
  [[d(-3), '14:00', 'epb-vector', 'create', '建立任務']]),
].map(t => { delete t.villages; return t; });

// ---------- 臺北通推播（概念示意）----------
const push = [
  { id: 'push-1', taskId: 'demo-task-ningxia', date: d(2), time: '07:30', recipients: 'scope+ring',
    title: '【鼠類防治投藥】', body: '大同區星明里、光能里、朝陽里 11/4–11/10 進行投藥，餌站已加蓋。請看顧孩童與寵物，勿觸碰餌站；發現鼠屍請勿徒手拾取，請撥 1999。' },
  { id: 'push-2', taskId: 'demo-task-ningxia', date: d(15), time: '10:00', recipients: 'scope',
    title: '【投藥作業結束】', body: '星明里等 3 里的殘餘藥劑已於 11/17 全數回收，感謝您的配合。' },
];

const out = { id: 'ningxia', title: '寧夏夜市', today: D, persona: 'epb-vector', mainTask: 'demo-task-ningxia', scope: SCOPE,
  note: 'Demo 情境：回報、任務與推播皆為模擬資料', reports, tasks, push };
await writeFile('dist/data/demo_ningxia.json', JSON.stringify(out));
console.log(`demo_ningxia.json：D=${D}，回報 ${reports.length}（背景 ${background.length}＋寧夏 ${spike.length}），任務 ${tasks.length}，推播 ${push.length}`);
const perDay = {}; for (const r of spike) { const k = r.time.slice(5, 10); perDay[k] = (perDay[k] || 0) + 1; }
console.log('寧夏每日回報', Object.entries(perDay).sort().map(([k, v]) => `${k}:${v}`).join(' '));
