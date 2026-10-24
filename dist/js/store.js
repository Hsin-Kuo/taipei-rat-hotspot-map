// 瀏覽器端儲存（localStorage）＋ JSON 匯出匯入
// 只用於 demo：資料留在本機瀏覽器，不同裝置、不同瀏覽器之間不共享。
import { mergeParams } from './params.js';

const KEY = 'taipei-rat-tool/v1';
// Demo 情境模式（?demo=<id>）：資料只放記憶體，不讀寫 localStorage；重新載入即回到初始狀態
// 也接受 #demo=<id>：有些靜態主機轉址時會丟掉 ?query
export const DEMO_ID = (() => { try { const v = new URLSearchParams(location.search).get('demo') || new URLSearchParams(location.hash.slice(1)).get('demo'); return v && /^[a-z0-9-]{1,40}$/.test(v) ? v : null; } catch { return null; } })();
const empty = () => ({ tasks: [], reports: [], params: null, persona: null, seq: 0, contacts: {} });

function read() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); return s && typeof s === 'object' ? { ...empty(), ...s } : empty(); }
  catch { return empty(); }
}
let state = DEMO_ID ? empty() : read();
let saveOk = true;
function save() {
  if (DEMO_ID) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); saveOk = true; }
  catch { saveOk = false; }            // 無痕模式或儲存空間滿：照常運作，只是不會保留
}

export const store = {
  get tasks() { return state.tasks; },
  get reports() { return state.reports; },
  get persona() { return state.persona; },
  get contacts() { return state.contacts || {}; },          // 村里代碼 → { chief, phone }（使用者匯入，僅存本機）
  setContacts(c) { state.contacts = c; save(); },
  get saveOk() { return saveOk; },
  params() { return mergeParams(state.params); },
  setParams(p) { state.params = p; save(); },
  setPersona(id) { state.persona = id; save(); },
  nextSeq() { state.seq = (state.seq || 0) + 1; save(); return state.seq; },
  upsertTask(t) { const i = state.tasks.findIndex(x => x.id === t.id); i >= 0 ? state.tasks[i] = t : state.tasks.push(t); save(); },
  clearReports() { state.reports = []; save(); },
  addReports(list) { const ids = new Set(state.reports.map(r => r.id)); for (const r of list) if (!ids.has(r.id)) state.reports.push(r); save(); },
  exportAll() { return { format: KEY, exportedAt: new Date().toISOString(), tasks: state.tasks, reports: state.reports, params: state.params }; },
  importAll(obj) {
    if (!obj || obj.format !== KEY) throw new Error('不是本工具匯出的檔案');
    state = { ...state, tasks: obj.tasks || [], reports: obj.reports || [], params: obj.params ?? state.params }; save();
  },
  reset() { state = empty(); save(); },
  // 情境模式：以情境資料初始化（深拷貝，操作不會改到原始資料）
  seed(data) { state = { ...empty(), tasks: JSON.parse(JSON.stringify(data.tasks || [])), persona: data.persona || null }; },
  get demo() { return DEMO_ID; },
};

export function download(name, data, type = 'application/json') {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
