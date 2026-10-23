// 模型參數：預設值 + 設定頁用的說明（單位、範圍、來源）
// src 為 null 表示「假設」，設定頁會標示；有文獻者填引用鍵，對應 SOURCES。

export const SOURCES = {};

export const FACTOR_LABELS = {
  sewer: '污水人孔', storm: '雨水人孔', market: '攤販集中場', tmarket: '傳統市場', food: '餐飲業者', garbage: '垃圾車停靠點',
};
export const TASK_TYPES = {
  poison: '投藥', clean: '環境清消', trap: '捕鼠籠', fill: '填補鼠洞',
};
export const SPECIES = { norway: '溝鼠', roof: '屋頂鼠', house: '小家鼠', unknown: '不確定' };
export const EVIDENCE = { live: '活體', dead: '屍體', droppings: '糞便', gnaw: '咬痕', burrow: '鼠洞' };

export const DEFAULTS = {
  base: { r: 0.025, kFloor: 0.05 },
  factors: {
    sewer:   { sigma: 250, weight: 1, growth: 1, sat: 1 },
    storm:   { sigma: 250, weight: 1, growth: 1, sat: 1 },
    market:  { sigma: 450, weight: 1, growth: 1, sat: 1 },
    tmarket: { sigma: 350, weight: 1, growth: 1, sat: 1 },
    food:    { sigma: 200, weight: 1, growth: 1, sat: 1 },
    garbage: { sigma: 200, weight: 1, growth: 1, sat: 1 },
  },
  tasks: {
    poison: { kill: 0.8,  killPer: 'task', kDrop: 0,   kHalf: 0,   spill: 0.05, ring: 300 },
    clean:  { kill: 0.1,  killPer: 'task', kDrop: 0.4, kHalf: 21,  spill: 0.3,  ring: 300 },
    trap:   { kill: 0.02, killPer: 'day',  kDrop: 0,   kHalf: 0,   spill: 0.05, ring: 300 },
    fill:   { kill: 0,    killPer: 'task', kDrop: 0.3, kHalf: 180, spill: 0.15, ring: 300 },
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
  'base.r':      { label: '族群成長率 r', unit: '/日', min: 0.005, max: 0.08, step: 0.001, src: null, note: '族群低於承載量時的回升速度' },
  'base.kFloor': { label: '背景承載量', unit: '', min: 0, max: 0.3, step: 0.01, src: null, note: '沒有任何因子的地方仍有少量族群' },
  'factor.sigma':  { label: '範圍 σ', unit: 'm', min: 50, max: 800, step: 10, src: null },
  'factor.weight': { label: '強度', unit: '', min: 0, max: 3, step: 0.1, src: null },
  'factor.growth': { label: '增加程度', unit: '×', min: 0.25, max: 3, step: 0.05, src: null, note: '此因子主導的格子，族群回升速度倍率' },
  'factor.sat':    { label: '飽和', unit: '', min: 0, max: 6, step: 0.1, src: null, note: '0 = 線性；越大越早飽和' },
  'task.kill':  { label: '扣除比例', unit: '', min: 0, max: 1, step: 0.01, src: null },
  'task.kDrop': { label: '承載量降幅', unit: '', min: 0, max: 0.9, step: 0.01, src: null },
  'task.kHalf': { label: '承載量恢復半衰期', unit: '日', min: 1, max: 730, step: 1, src: null },
  'task.spill': { label: '外溢比例', unit: '', min: 0, max: 1, step: 0.01, src: null },
  'task.ring':  { label: '環帶寬度', unit: 'm', min: 100, max: 1000, step: 50, src: null },
  'reports.base':   { label: '升溫幅度', unit: '指數', min: 0, max: 100, step: 1, src: null },
  'reports.half':   { label: '半衰期', unit: '日', min: 1, max: 120, step: 1, src: null },
  'reports.radius': { label: '影響半徑', unit: 'm', min: 50, max: 500, step: 10, src: null },
  'raptor.buffer':    { label: '猛禽提示外擴', unit: 'm', min: 200, max: 5000, step: 100, src: null },
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
