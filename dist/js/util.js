// 共用小工具
export const $ = (id) => document.getElementById(id);
// 匯入的任務／回報是外部資料，插入 innerHTML 前一律跳脫
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 臺北時間的今天（YYYY-MM-DD）
export const taipeiToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
