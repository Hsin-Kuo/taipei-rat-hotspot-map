// 3D 場景：地形實體模型、衛星貼圖、地點標樁、行政區外框、相機控制
// 由 model.html 的內嵌程式搬出；熱區圖層改由 app.js 以 setHeat() 提供（族群模型結果）
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { esc } from './util.js';
const $ = (id) => document.getElementById(id);
const P = new URLSearchParams(location.search);
const STEP = Math.max(1, +P.get('step') || 1);     // 網格取樣步距（高度圖像素），1 ≈ 30 m
const BASE_D = 0.22;                               // 底座厚度（km）
const PROXY_STEP = 8;                              // 滑鼠拾取用低解析代理網格


export async function createScene() {
  // ---------- 載入資料 ----------
  const J = (f) => fetch('data/' + f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
  const IMG = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(src)); im.src = src; });
  const [terrain, tex, city, districts, sewer, markets, tmarkets, recycle, fw] = await Promise.all([
    J('terrain.json'), J('model_texture.json'), J('city.geojson'), J('districts.geojson'), J('sewer_lines.json'),
    J('markets.json'), J('markets_trad.json'), J('recycle_points.json'), J('food_waste_nodes.json')]);
  const [terrImg, satImg, sewerImg] = await Promise.all([IMG(terrain.image), IMG(tex.image), IMG(sewer.image)]);
  const EX = terrain.exaggeration ?? 1.6;
  $('credit').textContent = tex.attribution;

  // ---------- 座標：經緯度 → 本地 km（x 東、y 上、z 南） ----------
  const LON0 = 121.56, LAT0 = 25.09;
  const KX = 111.32 * Math.cos(LAT0 * Math.PI / 180), KY = 110.574;
  const X = (lon) => (lon - LON0) * KX, Z = (lat) => -(lat - LAT0) * KY;

  // ---------- 高度圖解碼（Terrarium） ----------
  const [W, S, E, N] = terrain.bounds, tw = terrImg.width, th = terrImg.height, R = (E - W) / tw;
  const H = new Float32Array(tw * th);
  { const c = document.createElement('canvas'); c.width = tw; c.height = th; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(terrImg, 0, 0);
    const d = g.getImageData(0, 0, tw, th).data;
    for (let i = 0; i < tw * th; i++) { const h = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768; H[i] = Math.max(0, h) * EX / 1000; } }
  const hPix = (i, j) => H[Math.min(th - 1, Math.max(0, j)) * tw + Math.min(tw - 1, Math.max(0, i))];
  const hAt = (lon, lat) => { const fx = (lon - W) / R - .5, fy = (N - lat) / R - .5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    return (hPix(i, j) * (1 - u) + hPix(i + 1, j) * u) * (1 - v) + (hPix(i, j + 1) * (1 - u) + hPix(i + 1, j + 1) * u) * v; };

  // ---------- 市界遮罩與行政區 id 圖（與高度圖同解析度） ----------
  const polysOf = (g) => g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  const cityGeom = city.geometry ?? city;
  const pathPolys = (ctx, polys, px) => { ctx.beginPath(); for (const rings of polys) for (const ring of rings) { ring.forEach(([lon, lat], k) => { const [x, y] = px(lon, lat); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); } };
  const pxTerr = (lon, lat) => [(lon - W) / R, (N - lat) / R];
  const mask = new Uint8Array(tw * th), did = new Uint8Array(tw * th);
  { const c = document.createElement('canvas'); c.width = tw; c.height = th; const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; pathPolys(g, polysOf(cityGeom), pxTerr); g.fill('evenodd');
    let d = g.getImageData(0, 0, tw, th).data; for (let i = 0; i < tw * th; i++) mask[i] = d[i * 4] > 127 ? 1 : 0;
    g.clearRect(0, 0, tw, th);
    districts.features.forEach((f, k) => { g.fillStyle = `rgb(${k + 1},0,0)`; pathPolys(g, polysOf(f.geometry), pxTerr); g.fill('evenodd'); });
    d = g.getImageData(0, 0, tw, th).data; for (let i = 0; i < tw * th; i++) did[i] = d[i * 4]; }

  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const rings of polysOf(cityGeom)) for (const [lon, lat] of rings[0]) { minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
  const i0 = Math.max(0, Math.floor((minLon - W) / R) - 2), i1 = Math.min(tw - 1, Math.ceil((maxLon - W) / R) + 2);
  const j0 = Math.max(0, Math.floor((N - maxLat) / R) - 2), j1 = Math.min(th - 1, Math.ceil((N - minLat) / R) + 2);

  // ---------- 建網格：頂面（有高度）＋泥土剖面牆＋底面，一體成型 ----------
  const [TW0, TS0, TE0, TN0] = tex.bounds;   // 衛星貼圖的經緯度範圍（uv 以此為準）
  const SOIL_TOP = new THREE.Color('#7a5638'), SOIL_MID = new THREE.Color('#9b7650'), SOIL_BOT = new THREE.Color('#5a4030');
  function buildSolid(step, withSolid) {
    const nx = Math.floor((i1 - i0) / step) + 1, ny = Math.floor((j1 - j0) / step) + 1;
    const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
    const pi = (gi) => i0 + gi * step, pj = (gj) => j0 + gj * step;
    for (let gj = 0; gj < ny; gj++) for (let gi = 0; gi < nx; gi++) {
      const i = pi(gi), j = pj(gj), v = gj * nx + gi, lon = W + (i + .5) * R, lat = N - (j + .5) * R;
      pos[v * 3] = X(lon); pos[v * 3 + 1] = hPix(i, j); pos[v * 3 + 2] = Z(lat);
      uv[v * 2] = (lon - TW0) / (TE0 - TW0); uv[v * 2 + 1] = (lat - TS0) / (TN0 - TS0);
    }
    const keep = new Uint8Array((nx - 1) * (ny - 1));
    const m = (i, j) => mask[j * tw + i];
    for (let gj = 0; gj < ny - 1; gj++) for (let gi = 0; gi < nx - 1; gi++) {
      const a = pi(gi), b = pi(gi + 1), c = pj(gj), d = pj(gj + 1);
      keep[gj * (nx - 1) + gi] = (m(a, c) + m(b, c) + m(a, d) + m(b, d) + m((a + b) >> 1, (c + d) >> 1)) >= 3 ? 1 : 0;
    }
    const K = (gi, gj) => gi >= 0 && gj >= 0 && gi < nx - 1 && gj < ny - 1 && keep[gj * (nx - 1) + gi];
    const idx = [], wall = [], wallCol = [], bottom = [];
    const V = (gi, gj) => gj * nx + gi;
    const P3 = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    const y0 = -BASE_D;
    // 剖面色：表土（上）→ 黏土（中）→ 岩層（下），依高度內插
    const soil = (y, top) => { const t = (top - y) / Math.max(.05, top - y0); const c = t < .25 ? SOIL_TOP.clone().lerp(SOIL_MID, t / .25) : SOIL_MID.clone().lerp(SOIL_BOT, (t - .25) / .75); return [c.r, c.g, c.b]; };
    const addWall = (va, vb) => {
      const [ax, ay, az] = P3(va), [bx, by, bz] = P3(vb);
      const verts = [[ax, ay, az, ay], [bx, by, bz, by], [bx, y0, bz, by], [ax, ay, az, ay], [bx, y0, bz, by], [ax, y0, az, ay]];
      for (const [x, y, z, top] of verts) { wall.push(x, y, z); wallCol.push(...soil(y, top)); }
    };
    for (let gj = 0; gj < ny - 1; gj++) for (let gi = 0; gi < nx - 1; gi++) {
      if (!K(gi, gj)) continue;
      const a = V(gi, gj), b = V(gi + 1, gj), c = V(gi, gj + 1), d = V(gi + 1, gj + 1);
      idx.push(a, c, b, b, c, d);
      if (!withSolid) continue;
      if (!K(gi, gj - 1)) addWall(b, a);
      if (!K(gi, gj + 1)) addWall(c, d);
      if (!K(gi - 1, gj)) addWall(a, c);
      if (!K(gi + 1, gj)) addWall(d, b);
      const [ax, , az] = P3(a), [bx, , bz] = P3(b), [cx, , cz] = P3(c), [dx, , dz] = P3(d);
      bottom.push(ax, y0, az, bx, y0, bz, cx, y0, cz, bx, y0, bz, dx, y0, dz, cx, y0, cz);
    }
    const top = new THREE.BufferGeometry();
    top.setAttribute('position', new THREE.BufferAttribute(pos, 3)); top.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    top.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1)); top.computeVertexNormals();
    let walls = null, base = null;
    if (withSolid) {
      walls = new THREE.BufferGeometry(); walls.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3)); walls.setAttribute('color', new THREE.Float32BufferAttribute(wallCol, 3)); walls.computeVertexNormals();
      base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(bottom, 3)); base.computeVertexNormals();
    }
    return { top, walls, base, tris: idx.length / 3 + (wall.length + bottom.length) / 9 };
  }
  const t0 = performance.now();
  const model = buildSolid(STEP, true);
  const proxy = buildSolid(PROXY_STEP, false);
  const buildMs = Math.round(performance.now() - t0);

  // ---------- 頂面貼圖：衛星（已分類調色）＋熱區（族群模型，由 setHeat 提供）＋管線 ----------
  const cw = satImg.width, ch = satImg.height;
  const pxTex = (lon, lat) => [(lon - TW0) / (TE0 - TW0) * cw, (TN0 - lat) / (TN0 - TS0) * ch];
  const drawQuad = (ctx, img, bounds, alpha, op = 'source-over') => { const [bl, tl, tr] = bounds.map(([x, y]) => pxTex(x, y)), w = img.width, h = img.height;
    ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op; ctx.setTransform((tr[0] - tl[0]) / w, (tr[1] - tl[1]) / w, (bl[0] - tl[0]) / h, (bl[1] - tl[1]) / h, tl[0], tl[1]); ctx.drawImage(img, 0, 0); ctx.restore(); };
  const topCv = document.createElement('canvas'); topCv.width = cw; topCv.height = ch;
  const show = { heat: true, sewer: false, heatAlpha: .65 };
  const topTex = new THREE.CanvasTexture(topCv); topTex.colorSpace = THREE.SRGBColorSpace; topTex.anisotropy = 8;
  function paintTop() {
    const g = topCv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.drawImage(satImg, 0, 0);
    if (show.sewer) drawQuad(g, sewerImg, sewer.bounds, .55, 'multiply');
    if (show.heat && heatLayer) drawQuad(g, heatLayer.canvas, heatLayer.bounds, show.heatAlpha);
    for (const ov of [...overlays.values()].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) drawQuad(g, ov.canvas, ov.bounds, ov.alpha ?? 1);
    topTex.needsUpdate = true;
  }
  // 熱區圖層：canvas 每像素一格，bounds = 四角經緯度（左下、左上、右上、右下）
  let heatLayer = null, paintQueued = false;
  const overlays = new Map();       // 其他貼在地表的圖層（例如里界線）
  const repaint = () => { if (paintQueued) return; paintQueued = true; requestAnimationFrame(() => { paintQueued = false; paintTop(); }); };
  const setHeat = (canvas, bounds) => { heatLayer = canvas ? { canvas, bounds } : null; repaint(); };
  const setOverlay = (key, layer) => { layer ? overlays.set(key, layer) : overlays.delete(key); repaint(); };
  paintTop();

  // ---------- 場景與自然光 ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;   // 地形陰影已移除（使用者決定）；山影保留在衛星影像本身
  topTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  $('stage').appendChild(renderer.domElement);
  const labelR = new CSS2DRenderer({ element: $('labels') }); labelR.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xe4eef2, 45, 140);
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 400);
  scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x6b6a52, 1.15));
  // 太陽方向對齊衛星拍攝時間（1 月上午約 10:30，方位東南偏南、仰角約 38°），即時陰影與影像中的山影一致
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
  { const az = THREE.MathUtils.degToRad(150), el = THREE.MathUtils.degToRad(38), r = 30; sun.position.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, -Math.cos(az) * Math.cos(el) * r); }
  scene.add(sun, sun.target);

  const topMesh = new THREE.Mesh(model.top, new THREE.MeshStandardMaterial({ map: topTex, roughness: .95, metalness: 0 }));
  topMesh.castShadow = topMesh.receiveShadow = true; scene.add(topMesh);
  const wallMesh = new THREE.Mesh(model.walls, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
  wallMesh.castShadow = wallMesh.receiveShadow = true; scene.add(wallMesh);
  const baseMesh = new THREE.Mesh(model.base, new THREE.MeshStandardMaterial({ color: 0x4a3628, roughness: 1, side: THREE.DoubleSide })); scene.add(baseMesh);
  // 地面接觸陰影：模型下方一片柔和的影子，讓模型「放在」桌面上
  { const sh = document.createElement('canvas'); sh.width = sh.height = 256; const g = sh.getContext('2d'); const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, 'rgba(40,50,60,.35)'); gr.addColorStop(1, 'rgba(40,50,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(40, 44).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
    plane.position.set(1, -BASE_D - .02, .5); scene.add(plane); }
  const proxyMesh = new THREE.Mesh(proxy.top, new THREE.MeshBasicMaterial()); proxyMesh.visible = false; scene.add(proxyMesh);

  // ---------- 地點：地圖標樁與環 ----------
  const surf = (lon, lat) => new THREE.Vector3(X(lon), hAt(lon, lat), Z(lat));
  const pinGeo = mergeGeometries([new THREE.CylinderGeometry(.006, .006, .24, 6).translate(0, .12, 0), new THREE.SphereGeometry(.042, 16, 12).translate(0, .27, 0)]);
  const groups = {};
  function pins(key, items, lonlat, color, info) {
    const mesh = new THREE.InstancedMesh(pinGeo, new THREE.MeshStandardMaterial({ color, roughness: .45, metalness: 0, emissive: color, emissiveIntensity: .25 }), items.length);
    const M = new THREE.Matrix4();
    items.forEach((d, k) => { const [lon, lat] = lonlat(d); M.makeTranslation(surf(lon, lat)); mesh.setMatrixAt(k, M); });
    mesh.userData = { key, items, info }; mesh.castShadow = true; scene.add(mesh); groups[key] = [mesh];
    if ($('c-' + key)) $('c-' + key).textContent = items.length;
  }
  pins('market', markets, d => [d.lon, d.lat], 0xf2b705, d => [d.name, `攤販集中場 · ${d.district} · ${d.range}`, `營業 ${d.days} ${d.hours}`]);
  pins('tmarket', tmarkets, d => [d.lon, d.lat], 0xf08a24, d => [d.name, `傳統市場 · ${d.addr}`]);
  pins('recycle', recycle, d => [d.lon, d.lat], 0xe5559a, d => [`${d.team} 限時收受點`, d.addr, d.hours]);
  // 小圓點圖層（數量多：餐飲業者 2.5 萬、垃圾車停靠點 3.9 千）；第一次打開時才下載與建立
  const dotGeo = new THREE.OctahedronGeometry(.008, 0);   // 半徑約 8 m、8 面，2.5 萬個也只有 20 萬三角形
  function dots(key, items, lonlat, color, info, scale = () => 1) {
    const mesh = new THREE.InstancedMesh(dotGeo, new THREE.MeshStandardMaterial({ color, roughness: .6, emissive: color, emissiveIntensity: .2 }), items.length);
    const M = new THREE.Matrix4();
    items.forEach((d, k) => { const [lon, lat] = lonlat(d), s = scale(d), p = surf(lon, lat); p.y += .012 * s; M.makeScale(s, s, s).setPosition(p); mesh.setMatrixAt(k, M); });
    mesh.computeBoundingSphere();
    mesh.userData = { key, items, info }; scene.add(mesh); groups[key] = [mesh];
    if ($('c-' + key)) $('c-' + key).textContent = items.length.toLocaleString();
  }
  const DOT_LAYERS = {
    food: () => J('food.json').then(rows => dots('food', rows, d => [d[0], d[1]], 0xc2662d,
      // [lon, lat, 店數, 代表店名, 行業類別, 評核等級, 地址]
      d => [d[3] || '餐飲業者', `${d[4] || '餐飲業'} · 此門牌 ${d[2]} 家`, ...(d[5] ? [`衛生評核 ${d[5]}`] : []), d[6]], d => Math.min(1.8, Math.sqrt(d[2])))),
    garbage: () => J('garbage_stops.json').then(rows => dots('garbage', rows, d => [d[0], d[1]], 0x4f7a3a,
      // [lon, lat, 車次, 地點, 行政區]
      d => [d[3] || '垃圾車停靠點', `垃圾車停靠點 · ${d[4]}`, `${d[2]} 車次`])),
  };
  async function showDots(key, on) {
    if (!groups[key]) { if (!on) return; await DOT_LAYERS[key](); }
    groups[key].forEach(o => o.visible = on);
  }
  for (const k of Object.keys(DOT_LAYERS)) $('t-' + k).addEventListener('change', e => showDots(k, e.target.checked).catch(err => { e.target.checked = false; console.error(err); }));

  groups.foodwaste = fw.nodes.map(n => {
    const col = n.status === '嚴重' ? 0xd7263d : n.status === '已改善' ? 0x3a9d5d : 0xe57a1f;
    const r = .12 + .012 * Math.sqrt(n.tons);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, .016, 8, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col, roughness: .5, emissive: col, emissiveIntensity: .2 }));
    ring.position.copy(surf(n.lon, n.lat)).add(new THREE.Vector3(0, .03, 0)); ring.castShadow = true;
    ring.userData = { key: 'foodwaste', info: () => [`${n.name} · ${n.status}`, `${n.claimed} · ${n.note}`, `${n.accuracy} · EcoSentinel 推估，未證實`] };
    scene.add(ring); return ring;
  });

  // ---------- 行政區名稱與 hover 外框 ----------
  const distInfo = districts.features.map((f, k) => {
    const [lon, lat] = f.properties.centroid; const el = document.createElement('div'); el.className = 'dlabel'; el.textContent = f.properties.name;
    const lab = new CSS2DObject(el); lab.position.copy(surf(lon, lat)).add(new THREE.Vector3(0, .35, 0)); scene.add(lab);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const rings of polysOf(f.geometry)) for (const [lo, la] of rings[0]) { const x = X(lo), z = Z(la); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { k, f, lab, box: [x0, x1, z0, z1], outline: null };
  });
  const hoverMat = new LineMaterial({ color: 0xffffff, linewidth: 3 });
  const lineMats = [hoverMat];
  const lineMat = (color, linewidth) => { const m = new LineMaterial({ color, linewidth }); m.resolution.set(innerWidth, innerHeight); lineMats.push(m); return m; };
  // 沿地表的外框線（每個外環一條 Line2，貼地形取樣約 30 m）
  function geoOutline(geometry, mat) {
    const grp = new THREE.Group();
    for (const rings of polysOf(geometry)) { const ring = rings[0], pts = [];
      for (let q = 0; q < ring.length - 1; q++) { const [ax, ay] = ring[q], [bx, by] = ring[q + 1]; const n = Math.max(1, Math.ceil(Math.hypot((bx - ax) * KX, (by - ay) * KY) / .03));
        for (let s = 0; s < n; s++) { const t = s / n, p = surf(ax + (bx - ax) * t, ay + (by - ay) * t); pts.push(p.x, p.y + .01, p.z); } }
      pts.push(pts[0], pts[1], pts[2]);
      const g = new LineGeometry(); g.setPositions(pts); grp.add(new Line2(g, mat)); }
    scene.add(grp); return grp;
  }
  function outlineOf(di) {
    if (!di.outline) { di.outline = geoOutline(di.f.geometry, hoverMat); di.outline.visible = false; }
    return di.outline;
  }

  // ---------- 相機與控制 ----------
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .08; controls.maxPolarAngle = 1.36; controls.minDistance = .8; controls.maxDistance = 90; controls.zoomToCursor = true;
  const HOME = { target: new THREE.Vector3(-0.4, 0, 1.4), pos: new THREE.Vector3(-6, 19, 29) };
  camera.position.copy(HOME.pos); controls.target.copy(HOME.target); controls.update();
  const setAlt = (on) => { controls.mouseButtons.LEFT = on ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN; };
  addEventListener('keydown', e => { if (e.key === 'Alt') setAlt(true); }); addEventListener('keyup', e => { if (e.key === 'Alt') setAlt(false); }); addEventListener('blur', () => setAlt(false));
  renderer.domElement.addEventListener('pointerdown', e => setAlt(e.altKey), true);

  let fly = null;
  function flyTo(target, pos, ms = 1000) { fly = { t0: performance.now(), ms, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target, toP: pos }; }
  function flyToDistrict(di) {
    const [x0, x1, z0, z1] = di.box, tgt = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), size = Math.max(x1 - x0, z1 - z0);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = Math.max(3, size * 1.15 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * .62);
    flyTo(tgt, tgt.clone().add(dir.multiplyScalar(dist)));
  }
  $('btn-reset').addEventListener('click', () => flyTo(HOME.target.clone(), HOME.pos.clone()));

  // ---------- 拾取：地點優先，否則代理網格 → 行政區 ----------
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $('tip');
  const hooks = {};      // app.js 掛入：hover(lonlat, r) → 提示 HTML 或 null；click(lonlat, r) → true 表示已處理
  let hoverDi = null;
  function pick(cx, cy) {
    mouse.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(Object.values(groups).flat().filter(o => o.visible), false)[0];
    if (hit) { const o = hit.object; return { kind: 'pt', lines: o.isInstancedMesh ? o.userData.info(o.userData.items[hit.instanceId]) : o.userData.info() }; }
    const g = ray.intersectObject(proxyMesh, false)[0];
    if (g) { const [i, j] = pxTerr(LON0 + g.point.x / KX, LAT0 - g.point.z / KY); const k = did[Math.floor(j) * tw + Math.floor(i)] - 1; if (k >= 0 && distInfo[k]) return { kind: 'dist', di: distInfo[k] }; }
    return null;
  }
  function setHover(di) { if (hoverDi === di) return; if (hoverDi?.outline) hoverDi.outline.visible = false; hoverDi = di; if (di) outlineOf(di).visible = true; }
  let lastMove = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons) { tip.style.display = 'none'; return; }
    const now = performance.now(); if (now - lastMove < 40) return; lastMove = now;
    const r = pick(e.clientX, e.clientY);
    // 打在地表時先問 app（近距離改顯示里）；回傳 null 則用行政區提示
    const custom = r?.kind === 'dist' && hooks.hover ? hooks.hover(lonLatAt(e.clientX, e.clientY), r) : null;
    if (!custom) hooks.hover?.(null);
    if (!r) { setHover(null); tip.style.display = 'none'; renderer.domElement.style.cursor = ''; return; }
    if (custom) { setHover(null); tip.innerHTML = custom; }
    else if (r.kind === 'dist') { setHover(r.di); const p = r.di.f.properties; tip.innerHTML = `<b>${p.name}</b><span class="k">${p.li} 里 · ${p.areaKm2} km²</span>`; }
    // 地點資訊來自外部資料，一律跳脫
    else { setHover(null); tip.innerHTML = `<b>${esc(r.lines[0])}</b>` + r.lines.slice(1).map(s => `<span class="k">${esc(s)}</span>`).join('<br>'); }
    renderer.domElement.style.cursor = 'pointer'; tip.style.display = 'block';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - w - 8) + 'px'; tip.style.top = (e.clientY + 14 + h > innerHeight ? e.clientY - h - 14 : e.clientY + 14) + 'px';
  });
  // 滑鼠移到面板、資訊卡等疊在地圖上的元素時，canvas 收不到 pointermove：離開就收起提示與 hover 外框
  renderer.domElement.addEventListener('pointerleave', () => {
    tip.style.display = 'none'; setHover(null); hooks.hover?.(null); renderer.domElement.style.cursor = '';
  });
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || performance.now() - down.t > 450) return;
    const r = pick(e.clientX, e.clientY);
    if (hooks.click?.(lonLatAt(e.clientX, e.clientY), r)) return;
    if (r?.kind === 'dist') flyToDistrict(r.di);
  });

  // ---------- 開關 ----------
  const bind = (id, fn) => $(id).addEventListener('change', e => fn(e.target.checked));
  bind('t-heat', v => { show.heat = v; paintTop(); });
  bind('t-sewer', v => { show.sewer = v; paintTop(); });
  $('heat-alpha').addEventListener('input', e => { show.heatAlpha = +e.target.value; $('heat-alpha-v').textContent = Math.round(show.heatAlpha * 100) + '%'; paintTop(); });
  for (const k of ['market', 'tmarket', 'recycle', 'foodwaste']) bind('t-' + k, v => groups[k].forEach(o => o.visible = v));
  bind('t-labels', v => distInfo.forEach(d => d.lab.visible = v));

  // ---------- 尺寸與迴圈 ----------
  function resize() {
    renderer.setSize(innerWidth, innerHeight); labelR.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); lineMats.forEach(m => m.resolution.set(innerWidth, innerHeight));
  }
  addEventListener('resize', resize); resize();

  const ease = t => 1 - Math.pow(1 - t, 3);
  let frames = 0, fpsT = performance.now(), fps = 0;
  function loop(now) {
    if (fly) { const t = Math.min(1, (now - fly.t0) / fly.ms), k = ease(t); controls.target.lerpVectors(fly.fromT, fly.toT, k); camera.position.lerpVectors(fly.fromP, fly.toP, k); if (t >= 1) fly = null; }
    controls.update(); renderer.render(scene, camera); labelR.render(scene, camera);
    frames++; if (now - fpsT > 1000) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; $('stats').textContent = `${fps.toFixed(0)} fps · ${(model.tris / 1e6).toFixed(2)} M 三角形`; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // 畫面座標 → 經緯度（打在地表上；沒打到回傳 null）
  function lonLatAt(cx, cy) {
    mouse.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera);
    const g = ray.intersectObject(proxyMesh, false)[0];
    return g ? [LON0 + g.point.x / KX, LAT0 - g.point.z / KY] : null;
  }
  const api = { THREE, scene, camera, controls, renderer, labelR, flyTo, flyToDistrict, distInfo, districts, groups, pick, lonLatAt, surf, X, Z, KX, KY, hAt, polysOf,
    setHeat, setOverlay, repaint, show, hooks, geoOutline, lineMat, camDist: () => camera.position.distanceTo(controls.target), texBounds: tex.bounds, texSize: [cw, ch], get fps() { return fps; }, tris: model.tris, buildMs, sun };
  window.__m = api;
  return api;
}
