// 里：里界線、里分級著色、滑鼠提示、外框
// 里界線與分級著色都畫在與衛星貼圖同尺寸的 canvas 上，再由 scene.setOverlay 疊到地表
import { esc } from './util.js';

export const CLASS_BREAKS = { index: [30, 50, 70, 85, 110, 140], change: [-30, -15, -7, -2, 2, 7, 15, 30] };   // 變化：接近 0 切得較細
export const CLASS_LABELS = { index: ['低', '中低', '中', '中高', '高', '很高', '極高'], change: ['大幅壓低', '明顯壓低', '壓低', '略降', '持平', '略升', '升高', '明顯升高', '大幅升高'] };
export const CLASS_COLORS = {
  index: ['rgba(255,236,200,.55)', 'rgba(250,200,120,.65)', 'rgba(240,140,60,.72)', 'rgba(222,92,48,.76)', 'rgba(190,40,40,.8)', 'rgba(140,16,40,.86)', 'rgba(88,6,48,.92)'],
  change: ['rgba(22,72,156,.88)', 'rgba(52,108,190,.8)', 'rgba(110,158,218,.72)', 'rgba(178,206,238,.62)', 'rgba(240,236,228,.3)', 'rgba(246,200,168,.62)', 'rgba(238,150,104,.72)', 'rgba(214,82,56,.8)', 'rgba(160,26,38,.88)'],
};
// 分級圖例的區間文字
export function classRanges(mode) {
  const b = CLASS_BREAKS[mode], sg = (v) => mode === 'change' && v > 0 ? '+' + v : String(v);
  return CLASS_LABELS[mode].map((lab, k) => [lab, k === 0 ? `< ${sg(b[0])}` : k === b.length ? `≥ ${sg(b[k - 1])}` : `${sg(b[k - 1])} ~ ${sg(b[k])}`, CLASS_COLORS[mode][k]]);
}
export const classOf = (v, mode) => { const b = CLASS_BREAKS[mode]; let k = 0; while (k < b.length && v >= b[k]) k++; return k; };

export function createVillages(scene, G, fc) {
  const feats = fc.features;
  const byCode = new Map(feats.map(f => [f.properties.code, f]));
  const [cw, ch] = scene.texSize, [W, S, E, N] = scene.texBounds;
  const bounds = [[W, S], [W, N], [E, N], [E, S]];
  const px = (lon, lat) => [(lon - W) / (E - W) * cw, (N - lat) / (N - S) * ch];
  const polys = (g) => g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  const path = (ctx, f) => { ctx.beginPath(); for (const rings of polys(f.geometry)) for (const ring of rings) { ring.forEach(([lo, la], k) => { const [x, y] = px(lo, la); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); } };

  // 里界線（靜態，畫一次）
  const lineCv = document.createElement('canvas'); lineCv.width = cw; lineCv.height = ch;
  { const g = lineCv.getContext('2d'); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.6; g.lineJoin = 'round';
    for (const f of feats) { path(g, f); g.stroke(); } }
  const fillCv = document.createElement('canvas'); fillCv.width = cw; fillCv.height = ch;

  const state = { lines: true, fill: false };
  const setLines = (on) => { state.lines = on; scene.setOverlay('vlines', on ? { canvas: lineCv, bounds, alpha: .75, z: 2 } : null); };
  // vals：每里數值（依 G.villages 順序）；mode 決定分級
  function paintFill(vals, mode) {
    const g = fillCv.getContext('2d'); g.clearRect(0, 0, cw, ch);
    G.villages.forEach((code, k) => { const f = byCode.get(code); if (!f) return; g.fillStyle = CLASS_COLORS[mode][classOf(vals[k], mode)]; path(g, f); g.fill('evenodd'); });
    scene.setOverlay('vfill', { canvas: fillCv, bounds, alpha: 1, z: 1 });
  }
  const clearFill = () => scene.setOverlay('vfill', null);
  // 近期定期噴藥的里：青綠色虛線外框＋淡色填滿
  const sprayCv = document.createElement('canvas'); sprayCv.width = cw; sprayCv.height = ch;
  function paintSpray(codes) {
    if (!codes) { scene.setOverlay('vspray', null); return; }
    const g = sprayCv.getContext('2d'); g.clearRect(0, 0, cw, ch);
    g.fillStyle = 'rgba(31,158,143,.16)'; g.strokeStyle = 'rgba(16,120,108,.95)'; g.lineWidth = 3.5; g.setLineDash([9, 6]); g.lineJoin = 'round';
    for (const c of codes) { const f = byCode.get(c); if (!f) continue; path(g, f); g.fill('evenodd'); g.stroke(); }
    scene.setOverlay('vspray', { canvas: sprayCv, bounds, alpha: 1, z: 3 });
  }

  // 外框：hover（白）與選取（綠）
  const hoverMat = scene.lineMat(0xffffff, 2.5), selMat = scene.lineMat(0x1f7a46, 4);
  const cache = new Map();
  const outline = (code, mat) => { const key = code + (mat === selMat ? ':s' : mat === scopeMat ? ':o' : ':h'); if (!cache.has(key)) { const o = scene.geoOutline(byCode.get(code).geometry, mat); o.visible = false; cache.set(key, o); } return cache.get(key); };
  let hoverCode = null, selCode = null;
  function setHover(code) { if (code === hoverCode) return; if (hoverCode) outline(hoverCode, hoverMat).visible = false; hoverCode = code; if (code && code !== selCode) outline(code, hoverMat).visible = true; }
  function setSelected(code) { if (selCode) outline(selCode, selMat).visible = false; selCode = code; if (code) { if (hoverCode === code) outline(code, hoverMat).visible = false; outline(code, selMat).visible = true; } }

  // 任務範圍：編輯中任務的里以橘色外框標示
  const scopeMat = scene.lineMat(0xe8572c, 3);
  let scopeCodes = new Set();
  function setScope(codes) {
    const next = new Set(codes || []);
    for (const c of scopeCodes) if (!next.has(c)) outline(c, scopeMat).visible = false;
    for (const c of next) outline(c, scopeMat).visible = true;
    scopeCodes = next;
  }

  const codeAt = (ll) => { if (!ll) return null; const c = G.cellOf(ll[0], ll[1]); return c >= 0 && G.vid[c] ? G.villages[G.vid[c] - 1] : null; };
  const props = (code) => byCode.get(code)?.properties;
  const tipHtml = (code, line2) => { const p = props(code); return `<b>${esc(p.district)} ${esc(p.name)}</b><span class="k">${line2}</span>`; };

  setLines(true);
  return { feats, byCode, props, codeAt, setLines, paintFill, clearFill, setHover, setSelected, setScope, paintSpray, tipHtml, state, get selected() { return selCode; } };
}
