// 里：里界線、里分級著色、滑鼠提示、外框
// 里界線與分級著色都畫在與衛星貼圖同尺寸的 canvas 上，再由 scene.setOverlay 疊到地表
import { esc } from './util.js';

export const CLASS_BREAKS = { index: [30, 50, 70, 85], change: [-15, -5, 5, 15] };
export const CLASS_LABELS = { index: ['低', '中低', '中', '中高', '高'], change: ['明顯壓低', '壓低', '持平', '升高', '明顯升高'] };
export const CLASS_COLORS = {
  index: ['rgba(255,236,200,.55)', 'rgba(250,200,120,.65)', 'rgba(240,140,60,.72)', 'rgba(215,70,40,.78)', 'rgba(160,20,35,.85)'],
  change: ['rgba(30,90,200,.8)', 'rgba(110,160,220,.65)', 'rgba(240,236,228,.35)', 'rgba(240,150,90,.7)', 'rgba(200,45,35,.82)'],
};
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

  // 外框：hover（白）與選取（綠）
  const hoverMat = scene.lineMat(0xffffff, 2.5), selMat = scene.lineMat(0x1f7a46, 4);
  const cache = new Map();
  const outline = (code, mat) => { const key = code + (mat === selMat ? ':s' : ':h'); if (!cache.has(key)) { const o = scene.geoOutline(byCode.get(code).geometry, mat); o.visible = false; cache.set(key, o); } return cache.get(key); };
  let hoverCode = null, selCode = null;
  function setHover(code) { if (code === hoverCode) return; if (hoverCode) outline(hoverCode, hoverMat).visible = false; hoverCode = code; if (code && code !== selCode) outline(code, hoverMat).visible = true; }
  function setSelected(code) { if (selCode) outline(selCode, selMat).visible = false; selCode = code; if (code) { if (hoverCode === code) outline(code, hoverMat).visible = false; outline(code, selMat).visible = true; } }

  const codeAt = (ll) => { if (!ll) return null; const c = G.cellOf(ll[0], ll[1]); return c >= 0 && G.vid[c] ? G.villages[G.vid[c] - 1] : null; };
  const props = (code) => byCode.get(code)?.properties;
  const tipHtml = (code, line2) => { const p = props(code); return `<b>${esc(p.district)} ${esc(p.name)}</b><span class="k">${line2}</span>`; };

  setLines(true);
  return { feats, byCode, props, codeAt, setLines, paintFill, clearFill, setHover, setSelected, tipHtml, state, get selected() { return selCode; } };
}
