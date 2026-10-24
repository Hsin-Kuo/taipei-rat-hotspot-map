// 溝鼠族群模型（100 m 網格、逐日）— 純函式，不碰 DOM；瀏覽器與 node --test 共用
// 承載量 K ← 環境因子；族群 N 以 logistic 朝 K 回升；任務扣 N / 降 K 並把部分族群外溢到環帶；
// 回報不改動族群動態，而是在估計值上疊加「觀測加成」（依距離遞減、依半衰期消退）。
// 數值單位：族群指數，全市 K 的第 99 百分位 = 100。

export const DAY_MS = 864e5;
// 日期一律以臺北日界：'YYYY-MM-DD' 視為臺北當日；含時間者先轉臺北時間再取日
const TPE = 8 * 3600e3;
const tpeDay = (iso) => Math.floor((Date.parse(iso) + (iso.length > 10 ? TPE : 0)) / DAY_MS);
export const dayOf = (iso, todayIso) => tpeDay(iso) - tpeDay(todayIso);
export const isoOf = (day, todayIso) => new Date(Date.parse(todayIso) + day * DAY_MS).toISOString().slice(0, 10);

// ---------- 網格 ----------
// meta = grid.json，buf = grid.bin（ArrayBuffer）
export function makeGrid(meta, buf) {
  const { nx, ny, cell } = meta, N = nx * ny;
  const vid = new Uint16Array(buf, 0, N);
  const raw = {};
  meta.layout.order.forEach((k, fi) => { raw[k] = new Float32Array(buf, meta.layout.factorsOffset + N * 4 * fi, N); });
  const cells = [];                                   // 市內格的全域索引
  for (let i = 0; i < N; i++) if (vid[i]) cells.push(i);
  const M = cells.length, cellIdx = new Int32Array(N).fill(-1);
  cells.forEach((g, m) => { cellIdx[g] = m; });
  // 經緯度 ↔ 格：以四角做仿射（台北市範圍內與 TM2 誤差 < 數公尺）
  const [bl, tl, , br] = meta.bounds;
  const ex = [(br[0] - bl[0]) / nx, (br[1] - bl[1]) / nx], ey = [(tl[0] - bl[0]) / ny, (tl[1] - bl[1]) / ny];
  const det = ex[0] * ey[1] - ex[1] * ey[0];
  const fij = (lon, lat) => { const dx = lon - bl[0], dy = lat - bl[1]; return [(dx * ey[1] - dy * ey[0]) / det, (ex[0] * dy - ex[1] * dx) / det]; };
  const lonlatOf = (fi, fj) => [bl[0] + ex[0] * fi + ey[0] * fj, bl[1] + ex[1] * fi + ey[1] * fj];
  const cellOf = (lon, lat) => { const [fi, fj] = fij(lon, lat), i = Math.floor(fi), j = Math.floor(fj); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
  const villages = meta.villages;                     // vid k → villages[k-1]
  const vIndex = new Map(villages.map((c, k) => [c, k + 1]));
  const vCells = villages.map(() => []);
  for (let m = 0; m < M; m++) vCells[vid[cells[m]] - 1].push(m);
  return { nx, ny, cell, N, M, vid, raw, cells: Int32Array.from(cells), cellIdx, cellOf, fij, lonlatOf, villages, vIndex, vCells, factorKeys: meta.layout.order };
}

// ---------- 影像工具 ----------
function gaussBlur(src, nx, ny, sigmaCells) {
  if (sigmaCells <= 0) return Float32Array.from(src);
  const r = Math.ceil(3 * sigmaCells), k = new Float32Array(2 * r + 1);
  let s = 0; for (let i = -r; i <= r; i++) s += (k[i + r] = Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells)));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(nx * ny), out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let a = 0; for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < nx) a += src[j * nx + ii] * k[d + r]; }
    tmp[j * nx + i] = a;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let a = 0; for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < ny) a += tmp[jj * nx + i] * k[d + r]; }
    out[j * nx + i] = a;
  }
  return out;
}
const quantile = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
// 飽和：s=0 為線性；s 越大越早飽和（邊際效益遞減），輸出仍在 0–1
const saturate = (x, s) => s <= 1e-6 ? x : (1 - Math.exp(-s * x)) / (1 - Math.exp(-s));

// ---------- 承載量 K 與每格成長率 r ----------
// P.factors[k] = { sigma (m), weight, growth (倍率), sat }；P.base = { r, kFloor }
export function computeEnv(G, P) {
  const M = G.M, acc = new Float32Array(M), wsum = new Float32Array(M), gsum = new Float32Array(M);
  let wTot = 0;
  for (const k of G.factorKeys) {
    const f = P.factors[k]; if (!f || f.weight <= 0) continue;
    const d = gaussBlur(G.raw[k], G.nx, G.ny, f.sigma / G.cell);
    const inCity = new Float32Array(M); for (let m = 0; m < M; m++) inCity[m] = d[G.cells[m]];
    const p99 = quantile(inCity.filter(v => v > 0), 0.99) || 1;
    for (let m = 0; m < M; m++) {
      const v = f.weight * saturate(Math.min(1, inCity[m] / p99), f.sat);
      acc[m] += v; wsum[m] += v; gsum[m] += v * f.growth;
    }
    wTot += f.weight;
  }
  const { kFloor, r } = P.base;
  const Kraw = new Float32Array(M), R = new Float32Array(M);
  for (let m = 0; m < M; m++) {
    Kraw[m] = kFloor + (1 - kFloor) * (wTot ? acc[m] / wTot : 0);
    R[m] = r * (kFloor + gsum[m]) / (kFloor + wsum[m]);
  }
  const scale = 100 / (quantile(Kraw, 0.99) || 1);
  const K = Kraw.map(v => v * scale);
  return { K, R };
}

// ---------- 任務範圍與外溢環帶 ----------
// 回傳 { scope: Int32Array (市內格 m), ring: Int32Array, ringW: Float32Array（依 K 權重，總和 1） }
export function taskGeometry(G, env, villages, ringMeters) {
  const inScope = new Uint8Array(G.N);
  const scope = [];
  for (const code of villages) { const k = G.vIndex.get(code); if (!k) continue; for (const m of G.vCells[k - 1]) { inScope[G.cells[m]] = 1; scope.push(m); } }
  if (!(ringMeters > 0)) return { scope: Int32Array.from(scope), ring: new Int32Array(0), ringW: new Float32Array(0) };   // 不外溢的任務不需要環帶
  // chamfer 距離（3-4，單位 = 格 × 3）
  const { nx, ny } = G, D = new Float32Array(G.N).fill(1e9);
  for (let i = 0; i < G.N; i++) if (inScope[i]) D[i] = 0;
  const relax = (i, j, di, dj, c) => { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) { const v = D[jj * nx + ii] + c; if (v < D[j * nx + i]) D[j * nx + i] = v; } };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { relax(i, j, -1, 0, 3); relax(i, j, 0, -1, 3); relax(i, j, -1, -1, 4); relax(i, j, 1, -1, 4); }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { relax(i, j, 1, 0, 3); relax(i, j, 0, 1, 3); relax(i, j, 1, 1, 4); relax(i, j, -1, 1, 4); }
  const lim = ringMeters / G.cell * 3, ring = [];
  for (let m = 0; m < G.M; m++) { const d = D[G.cells[m]]; if (d > 0 && d <= lim) ring.push(m); }
  const ringW = new Float32Array(ring.length);
  let s = 0; ring.forEach((m, q) => { s += (ringW[q] = env.K[m]); });
  if (s > 0) for (let q = 0; q < ringW.length; q++) ringW[q] /= s;
  return { scope: Int32Array.from(scope), ring: Int32Array.from(ring), ringW };
}

// ---------- 逐日模擬 ----------
// tasks：任務物件（取 type / scope.villages / start / end / status）；P.tasks[type] = { kill, killPer: 'task'|'day', kDrop, kHalf, spill, ring }
// 回傳 { d0, nd, N: Float32Array[nd*M], Kmul: 最後一日 K 倍率 }
export function simulate(G, env, P, tasks, todayIso, range = [-90, 30], geoCache = new Map()) {
  const [d0, d1] = range, nd = d1 - d0 + 1, M = G.M, { K, R } = env;
  const LN2 = Math.LN2;
  const active = tasks.filter(t => t.status !== 'cancelled' && t.scope?.villages?.length && P.tasks[t.type]).map(t => {
    const tp = P.tasks[t.type], s = dayOf(t.start, todayIso), e = Math.max(s, dayOf(t.end || t.start, todayIso));
    const ring = tp.spill > 0 ? tp.ring : 0;
    const key = t.scope.villages.join(',') + '|' + ring;
    if (!geoCache.has(key)) geoCache.set(key, taskGeometry(G, env, t.scope.villages, ring));
    const kill = tp.baitKill?.[t.bait?.kind] ?? tp.kill;    // 投藥依藥劑種類
    const daily = tp.killPer === 'day' ? kill : 1 - Math.pow(1 - kill, 1 / (e - s + 1));
    // 承載量效果衰減到 0.1% 以下的日子（之後不再計算）
    const kEnd = tp.kDrop ? e + Math.ceil(Math.max(1, tp.kHalf) * Math.log2(1000)) : e;
    return { t, tp, s, e, kEnd, daily, geo: geoCache.get(key) };
  }).filter(a => a.kEnd >= d0 && a.s <= d1 && (a.daily > 0 || a.tp.kDrop > 0));
  const N = new Float32Array(nd * M);
  const n = Float32Array.from(K);                     // 起點：90 天前處於平衡（N = K）
  const kmul = new Float32Array(M), keff = new Float32Array(M);
  for (let di = 0; di < nd; di++) {
    const day = d0 + di;
    // 1) K 倍率：降承載量的任務（執行期間全額，結束後依半衰期恢復）
    kmul.fill(1);
    for (const a of active) {
      if (!a.tp.kDrop || day < a.s || day > a.kEnd) continue;
      const f = day <= a.e ? 1 : Math.exp(-LN2 * (day - a.e) / Math.max(1, a.tp.kHalf));
      for (const m of a.geo.scope) kmul[m] *= 1 - a.tp.kDrop * f;
    }
    for (let m = 0; m < M; m++) keff[m] = K[m] * kmul[m];
    // 2) 任務當日扣除：被移除的族群中 spill 比例外溢到環帶（依 K 分配），其餘死亡
    for (const a of active) {
      if (day < a.s || day > a.e) continue;
      let moved = 0;
      if (a.daily > 0) for (const m of a.geo.scope) { const cut = n[m] * a.daily; n[m] -= cut; moved += cut * a.tp.spill; }
      // 降 K 的任務在開工當天：超出新承載量的族群中 spill 比例被趕出去
      if (a.tp.kDrop && day === a.s) for (const m of a.geo.scope) { const ex = n[m] - keff[m]; if (ex > 0) { n[m] -= ex * a.tp.spill; moved += ex * a.tp.spill; } }
      const { ring, ringW } = a.geo;
      for (let q = 0; q < ring.length; q++) n[ring[q]] += moved * ringW[q];
    }
    // 3) logistic 回升（dt = 1 天）；保留 1% K 的底數代表周邊移入，避免局部滅絕後永不回升
    for (let m = 0; m < M; m++) {
      const k = Math.max(1e-3, keff[m]);
      n[m] = Math.max(0.01 * k, n[m] + R[m] * n[m] * (1 - n[m] / k));
    }
    N.set(n, di * M);
  }
  return { d0, nd, N, active: active.length };
}

// ---------- 回報加成 ----------
// P.reports = { base, half, radius, evidence: {live, dead, droppings, gnaw, burrow}, species: ['norway'] }
// 單筆回報：振幅（不含時間衰減；非模型鼠種回傳 0）與影響的格子 [[m, 距離權重], …]
export function reportAmp(P, rp) {
  const pr = P.reports;
  return pr.species.includes(rp.species) ? pr.base * (rp.confidence ?? 1) * (pr.evidence[rp.evidence] ?? 1) : 0;
}
export const reportDecay = (P, age) => age < 0 ? 0 : Math.exp(-Math.LN2 * age / Math.max(1, P.reports.half));
export function reportCells(G, P, rp) {
  const rc = P.reports.radius / G.cell, rr = Math.ceil(rc), out = [];
  const [fi, fj] = G.fij(rp.lon, rp.lat);
  const ci = Math.floor(fi), cj = Math.floor(fj);
  for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
    const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue;
    const m = G.cellIdx[j * G.nx + i]; if (m < 0) continue;
    const dist = Math.hypot(i + .5 - fi, j + .5 - fj);
    if (dist <= rc + .5) out.push([m, Math.max(0, 1 - dist / (rc + .5))]);
  }
  return out;
}

export function reportBoost(G, P, reports, day, todayIso) {
  const out = new Float32Array(G.M);
  for (const rp of reports) {
    const amp = reportAmp(P, rp) * reportDecay(P, day - dayOf(rp.time, todayIso));
    if (amp < 0.05) continue;
    for (const [m, w] of reportCells(G, P, rp)) out[m] += amp * w;
  }
  return out;
}

// 某日估計值 = 族群 N + 回報加成
export function estimate(G, sim, boost, day) {
  const di = Math.min(sim.nd - 1, Math.max(0, day - sim.d0));
  const out = sim.N.slice(di * G.M, (di + 1) * G.M);
  if (boost) for (let m = 0; m < G.M; m++) out[m] += boost[m];
  return out;
}

// 依里彙總（平均值）
export function byVillage(G, values) {
  return G.vCells.map(ms => { let s = 0; for (const m of ms) s += values[m]; return ms.length ? s / ms.length : 0; });
}

// 範圍外擴 bufferMeters 內是否有點（猛禽二次中毒提示用）；points = [[lon, lat, …], …]
export function pointsNear(G, villages, points, bufferMeters) {
  const inScope = new Uint8Array(G.N);
  for (const code of villages) { const k = G.vIndex.get(code); if (k) for (const m of G.vCells[k - 1]) inScope[G.cells[m]] = 1; }
  const r = Math.ceil(bufferMeters / G.cell), hits = [];
  for (const p of points) {
    const [fi, fj] = G.fij(p[0], p[1]), ci = Math.floor(fi), cj = Math.floor(fj);
    let found = false;
    for (let dj = -r; dj <= r && !found; dj++) for (let di = -r; di <= r && !found; di++) {
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < G.nx && j < G.ny && inScope[j * G.nx + i] && Math.hypot(di, dj) <= r) found = true;
    }
    if (found) hits.push(p);
  }
  return hits;
}
