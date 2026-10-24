// 模型參數：預設值 + 設定頁用的說明（單位、範圍、來源）
// src 為 null 表示「假設」，設定頁會標示；有文獻者填引用鍵陣列，對應 SOURCES。
// 文獻整理日期 2026-10-24；部分數字為轉引（見 docs/mvp-tool-spec.md 參數表）。

export const SOURCES = {
  bentley1959: 'Bentley, Bathard & Riley (1959) The rates of recovery of sewer rat populations after poisoning. J Hyg 57:291–298. doi:10.1017/S0022172400020155',
  byers2019: 'Byers et al. (2019) Rats about town: a systematic review of rat movement in urban ecosystems. Front Ecol Evol 7:13. doi:10.3389/fevo.2019.00013',
  byers2019trap: 'Byers et al. (2019) Rat in a cage: trappability of urban Norway rats. Front Ecol Evol 7:68. doi:10.3389/fevo.2019.00068',
  buckle2012: 'Buckle, Klemann & Prescott (2012) Brodifacoum is effective against Norway rats in a Y139C resistance focus. Pest Manag Sci 68:1579–1585. doi:10.1002/ps.3352',
  richards1981: 'Richards (1981) Field trials of bromadiolone against infestations of warfarin-resistant R. norvegicus. J Hyg 86:363–367',
  esther2022: 'Esther et al. (2022) Sanitary measures considerably improve the management of resistant Norway rats on livestock farms. Pest Manag Sci 78:1620–1629. doi:10.1002/ps.6780',
  lee2018: 'Lee et al. (2018) Effects of culling on Leptospira interrogans carriage by rats. Emerg Infect Dis 24:356. doi:10.3201/eid2402.171371',
  hong2019: 'Hong et al. (2019) Frequent detection of anticoagulant rodenticides in raptors sampled in Taiwan reflects government rodent control policy. Sci Total Environ 691:1051–1058. doi:10.1016/j.scitotenv.2019.07.076',
  trra2017: '台灣猛禽研究會（林務局 106 年度計畫）臺北都會區鳳頭蒼鷹繁殖監測：平均巢間距約 2.05 km（摘要數字，待核對全文）',
};
// 藥劑種類（投藥任務）
export const BAITS = { sgar: '第二代抗凝血劑（如 brodifacoum、bromadiolone）', fgar: '第一代抗凝血劑（如 warfarin）', other: '其他' };

export const FACTOR_LABELS = {
  sewer: '污水人孔', storm: '雨水人孔', market: '攤販集中場', tmarket: '傳統市場', food: '餐飲業者', garbage: '垃圾車停靠點',
};
export const TASK_TYPES = {
  poison: '投藥', clean: '環境清消', trap: '捕鼠籠', fill: '填補鼠洞', spray: '定期噴藥',
};
// 由環保局日程表預載的定期任務類型（唯讀，不能在表單建立）
export const RECURRING_TYPES = ['spray'];
export const SPECIES = { norway: '溝鼠', roof: '屋頂鼠', house: '小家鼠', unknown: '不確定' };
export const EVIDENCE = { live: '活體', dead: '屍體', droppings: '糞便', gnaw: '咬痕', burrow: '鼠洞' };

export const DEFAULTS = {
  base: { r: 0.02, kFloor: 0.05 },
  factors: {
    sewer:   { sigma: 250, weight: 1, growth: 1, sat: 1 },
    storm:   { sigma: 250, weight: 1, growth: 1, sat: 1 },
    market:  { sigma: 450, weight: 1, growth: 1, sat: 1 },
    tmarket: { sigma: 350, weight: 1, growth: 1, sat: 1 },
    food:    { sigma: 200, weight: 1, growth: 1, sat: 1 },
    garbage: { sigma: 200, weight: 1, growth: 1, sat: 1 },
  },
  tasks: {
    poison: { kill: 0.8,  killPer: 'task', kDrop: 0,   kHalf: 0,   spill: 0.1,  ring: 300, baitKill: { sgar: 0.95, fgar: 0.7 } },
    clean:  { kill: 0.1,  killPer: 'task', kDrop: 0.3, kHalf: 60,  spill: 0.3,  ring: 300 },
    trap:   { kill: 0.023, killPer: 'day', kDrop: 0,   kHalf: 0,   spill: 0.05, ring: 300 },
    fill:   { kill: 0,    killPer: 'task', kDrop: 0.2, kHalf: 120, spill: 0.15, ring: 300 },
    spray:  { kill: 0,    killPer: 'task', kDrop: 0.05, kHalf: 7,  spill: 0,    ring: 300 },   // 戶外環境噴藥：對象是蚊蟲，僅假設順帶清理水溝堆積物
  },
  reports: {
    base: 30, half: 21, radius: 150,
    evidence: { live: 1, dead: 0.9, droppings: 0.6, gnaw: 0.4, burrow: 0.8 },
    species: ['norway'],
  },
  raptor: { buffer: 1000, sinceYear: 2016 },
  display: { timeline: true, heatMode: 'index' },
};

// 設定頁欄位說明：path → { label, unit, min, max, step, src, note }
export const META = {
  'base.r':      { label: '族群成長率 r', unit: '/日', min: 0.005, max: 0.08, step: 0.001, src: ['bentley1959', 'byers2019'], note: '下水道族群毒殺後約 6 個月回到原水準；此值已含周邊遷入' },
  'base.kFloor': { label: '背景承載量', unit: '', min: 0, max: 0.3, step: 0.01, src: null, note: '沒有任何因子的地方仍有少量族群' },
  'factor.sigma':  { label: '範圍 σ', unit: 'm', min: 50, max: 800, step: 10, src: null },
  'factor.weight': { label: '強度', unit: '', min: 0, max: 3, step: 0.1, src: null },
  'factor.growth': { label: '增加程度', unit: '×', min: 0.25, max: 3, step: 0.05, src: null, note: '此因子主導的格子，族群回升速度倍率' },
  'factor.sat':    { label: '飽和', unit: '', min: 0, max: 6, step: 0.1, src: null, note: '0 = 線性；越大越早飽和' },
  'task.kill':  { label: '扣除比例', unit: '', min: 0, max: 1, step: 0.001, src: ['richards1981'], note: 'bromadiolone 投餌 7 天約 81%' },
  'task.baitKill': { label: '依藥劑撲殺率', unit: '', min: 0, max: 1, step: 0.01, src: ['buckle2012'], note: '第二代 21–35 天約 95%；第一代 70% 為假設（缺都市田間數據）' },
  'task.kDrop': { label: '承載量降幅', unit: '', min: 0, max: 0.9, step: 0.01, src: null, note: '清消 30%、填補鼠洞 20% 為假設' },
  'task.kHalf': { label: '承載量恢復半衰期', unit: '日', min: 1, max: 730, step: 1, src: ['esther2022'], note: '衛生改善使反彈延後約 85 天（畜牧場）；鼠洞填補後約 6 個月回到原水準' },
  'task.spill': { label: '外溢比例', unit: '', min: 0, max: 1, step: 0.01, src: ['lee2018'], note: '撲殺會擾動族群、促成移動（定性證據）；比例為假設' },
  'task.ring':  { label: '環帶寬度', unit: 'm', min: 100, max: 1000, step: 50, src: ['byers2019'], note: '親子代平均距離約 45 m，推定移動可達 0–353 m' },
  'reports.base':   { label: '升溫幅度', unit: '指數', min: 0, max: 100, step: 1, src: null },
  'reports.half':   { label: '半衰期', unit: '日', min: 1, max: 120, step: 1, src: null },
  'reports.radius': { label: '影響半徑', unit: 'm', min: 50, max: 500, step: 10, src: ['byers2019'], note: '每日活動約 10–20 m、街廓尺度 30–150 m；150 m 涵蓋同一街廓' },
  'reports.evidence': { label: '跡證權重', unit: '', min: 0, max: 1.5, step: 0.05, src: null },
  'raptor.buffer':    { label: '猛禽提示外擴', unit: 'm', min: 200, max: 5000, step: 100, src: ['hong2019', 'trra2017'], note: '臺灣猛禽肝臟過半檢出抗凝血劑；1 km ≈ 臺北鳳頭蒼鷹平均巢間距之半（推估，無官方標準）' },
  'raptor.sinceYear': { label: '鳳頭蒼鷹紀錄起始年', unit: '', min: 1985, max: 2026, step: 1, src: null },
};

export const clone = (o) => JSON.parse(JSON.stringify(o));
// 以 DEFAULTS 為骨架合併已存設定（新版增加的欄位自動補預設）
export function mergeParams(saved) {
  const out = clone(DEFAULTS);
  const walk = (dst, src) => { for (const k in src) { if (!(k in dst)) continue; if (dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) walk(dst[k], src[k] || {}); else dst[k] = src[k]; } };
  if (saved) walk(out, saved);
  return out;
}

// demo 身分：只記錄誰建立／修改，不限制權限（正式版接臺北通或公務帳號，依角色授權）
export const PERSONAS = [
  { id: 'epb-vector', name: '環保局水質病媒管制科 承辦人', org: '環保局' },
  { id: 'team-wanhua', name: '萬華區清潔隊 分隊長', org: '萬華區清潔隊' },
  { id: 'market-office', name: '市場處 管理員', org: '市場處' },
  { id: 'vendor-demo', name: '外包除鼠廠商（示範）', org: '外包廠商' },
];
export const EXECUTORS = { team: '區清潔隊', vector: '環保局水質病媒管制科', market: '市場處', vendor: '外包除鼠公司', other: '其他' };
export const NOTIFY_METHODS = { board: '里辦公處公告', flyer: '張貼公告／傳單', sms: '簡訊', app: '臺北通推播（規劃中）' };
