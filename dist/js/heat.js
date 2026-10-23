// 族群估計值 → 熱區貼圖（每格一像素，貼到地表時由 canvas 雙線性放大）
// mode 'index'：族群指數，低值透明 → 橘 → 深紅
// mode 'change'：與環境基準 K 相比，藍 = 被壓低、紅 = 升高（回報或外溢）

const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export const CHANGE_SCALE = 30;          // 差值 ±30 指數即飽和色

export function renderHeat(G, values, K, mode = 'index', canvas = document.createElement('canvas')) {
  const { nx, ny } = G;
  if (canvas.width !== nx || canvas.height !== ny) { canvas.width = nx; canvas.height = ny; }
  const g = canvas.getContext('2d'), img = g.createImageData(nx, ny), d = img.data;
  for (let m = 0; m < G.M; m++) {
    const c = G.cells[m], i = c % nx, j = (c / nx) | 0, o = ((ny - 1 - j) * nx + i) * 4;   // 第 0 列 = 北
    if (mode === 'change') {
      const t = Math.max(-1, Math.min(1, (values[m] - K[m]) / CHANGE_SCALE)), a = Math.abs(t);
      if (t < 0) { d[o] = 40 + 30 * (1 - a); d[o + 1] = 110 + 40 * (1 - a); d[o + 2] = 210; }
      else { d[o] = 215; d[o + 1] = 60 + 60 * (1 - a); d[o + 2] = 40; }
      d[o + 3] = Math.round(255 * ss(0.04, 0.6, a) * 0.9);
    } else {
      const t = Math.min(1.2, values[m] / 100);
      const u = Math.min(1, t);
      d[o] = 245 - 55 * u; d[o + 1] = 150 - 128 * u; d[o + 2] = 70 - 30 * u;
      d[o + 3] = Math.round(255 * ss(0.38, 1.0, t));
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}
