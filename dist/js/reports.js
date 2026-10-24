// 回報：鼠種篩選、3D 回報點、清單、JSON 匯入（含欄位驗證）
// 只有溝鼠回報進模型（升溫）；屋頂鼠、小家鼠、不確定只顯示點位
import { SPECIES, EVIDENCE } from './params.js';
import { store, download } from './store.js';
import { $, esc } from './util.js';

export const SPECIES_COLORS = { norway: 0xc0392b, roof: 0x8e6bbf, house: 0x2f86c4, unknown: 0x8a939b };
const WINDOW = 30;     // 顯示目前檢視日前 30 天內的回報

// 匯入驗證：回傳 { ok: [...], bad: [[列號, 原因], ...] }
export function validateReports(list) {
  const ok = [], bad = [];
  list.forEach((r, i) => {
    const why = [];
    const lon = +r.lon, lat = +r.lat;
    if (!(lon >= 121.40 && lon <= 121.70 && lat >= 24.90 && lat <= 25.30)) why.push('座標不在臺北市範圍');
    if (!r.time || Number.isNaN(Date.parse(r.time))) why.push('時間格式錯誤');
    if (!(r.species in SPECIES)) why.push('鼠種須為 ' + Object.keys(SPECIES).join('/'));
    const conf = r.confidence == null ? 1 : +r.confidence;
    if (!(conf >= 0 && conf <= 1)) why.push('辨識信心須在 0–1');
    const count = r.count == null ? 1 : Math.round(+r.count);
    if (!(count >= 1)) why.push('數量須 ≥ 1');
    const ev = r.evidence ?? 'live';
    if (!(ev in EVIDENCE)) why.push('跡證須為 ' + Object.keys(EVIDENCE).join('/'));
    if (why.length) { bad.push([i + 1, why.join('、')]); return; }
    ok.push({ id: String(r.id || `imp-${Date.parse(r.time).toString(36)}-${lon.toFixed(5)}-${lat.toFixed(5)}`).slice(0, 80), lon, lat, time: String(r.time), species: r.species, confidence: conf, count, evidence: ev, simulated: false, source: String(r.source || '匯入').slice(0, 60) });
  });
  return { ok, bad };
}

export function createReports(app) {
  const { scene, E } = app, T = scene.THREE;
  const show = new Set(['norway']);
  let markers = null;
  const geo = new T.SphereGeometry(.03, 12, 8);

  function visible() {
    return app.reports.filter(r => show.has(r.species)).filter(r => { const age = app.day - E.dayOf(r.time, app.today); return age >= 0 && age < WINDOW; });
  }
  // 3D 回報點：依鼠種著色，越新越大
  function paint() {
    if (markers) { scene.scene.remove(markers); markers.material.dispose(); markers.dispose(); }
    const rs = $('t-reports').checked ? visible() : [];
    markers = new T.InstancedMesh(geo, new T.MeshStandardMaterial({ roughness: .5, emissiveIntensity: .25 }), Math.max(1, rs.length));
    markers.count = rs.length;
    const M = new T.Matrix4(), col = new T.Color();
    rs.forEach((r, k) => {
      const age = app.day - E.dayOf(r.time, app.today), s = 1.25 - age / WINDOW * .6;
      const p = scene.surf(r.lon, r.lat); p.y += .03;
      M.makeScale(s, s, s).setPosition(p); markers.setMatrixAt(k, M);
      markers.setColorAt(k, col.setHex(SPECIES_COLORS[r.species]));
    });
    markers.userData = { key: 'reports', items: rs, info: (r) => [`${SPECIES[r.species]}回報 · ${EVIDENCE[r.evidence]}`, `${r.time.replace('T', ' ').slice(0, 16)} · ${r.count} 隻 · 信心 ${Math.round(r.confidence * 100)}%`, r.simulated ? '模擬資料' : `匯入：${r.source}`] };
    scene.scene.add(markers); scene.groups.reports = [markers];
    renderSummary(rs);
  }

  function renderSummary(rs) {
    const all = app.reports.filter(r => { const age = app.day - E.dayOf(r.time, app.today); return age >= 0 && age < WINDOW; });
    document.querySelectorAll('[data-sp-count]').forEach(el => { el.textContent = all.filter(r => r.species === el.dataset.spCount).length; });
    const recent = rs.slice().sort((a, b) => b.time.localeCompare(a.time)).slice(0, 30);
    $('report-list').innerHTML = recent.length ? recent.map(r => `<li><span class="tdot" style="background:#${SPECIES_COLORS[r.species].toString(16).padStart(6, '0')}"></span>
      <span><b>${SPECIES[r.species]}</b> · ${EVIDENCE[r.evidence]} · ${r.count} 隻 <span class="k">${esc(r.time.slice(5, 16).replace('T', ' '))} · 信心 ${Math.round(r.confidence * 100)}%${r.simulated ? ' · 模擬' : ''}</span></span></li>`).join('')
      : '<li class="muted">此期間沒有符合篩選的回報。</li>';
    $('report-window').textContent = `${E.isoOf(app.day - WINDOW + 1, app.today).slice(5)}～${E.isoOf(app.day, app.today).slice(5)}`;
    $('report-imported').textContent = store.reports.length;
  }

  document.querySelectorAll('[data-sp]').forEach(cb => cb.addEventListener('change', () => { cb.checked ? show.add(cb.dataset.sp) : show.delete(cb.dataset.sp); paint(); }));
  $('t-reports').addEventListener('change', paint);
  $('report-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const msg = $('report-msg');
    try {
      const j = JSON.parse(await f.text());
      const list = Array.isArray(j) ? j : j.reports;
      if (!Array.isArray(list)) throw new Error('找不到 reports 陣列');
      const { ok, bad } = validateReports(list);
      store.addReports(ok);
      msg.textContent = `匯入 ${ok.length} 筆${bad.length ? `；略過 ${bad.length} 筆（${bad.slice(0, 3).map(([i, w]) => `第 ${i} 筆：${w}`).join('；')}${bad.length > 3 ? '…' : ''}）` : ''}`;
      app.recomputeSim();
    } catch (err) { msg.textContent = '匯入失敗：' + err.message; }
  });
  $('btn-report-sample').addEventListener('click', () => download('回報匯入範例.json', { reports: [
    { lon: 121.4997, lat: 25.0375, time: `${app.today}T21:30:00+08:00`, species: 'norway', confidence: 0.9, count: 2, evidence: 'live', source: '1999 通報' },
    { lon: 121.5180, lat: 25.0470, time: `${app.today}T07:10:00+08:00`, species: 'roof', confidence: 0.6, count: 1, evidence: 'droppings', source: '里辦公處' },
  ], fields: { lon: '經度', lat: '緯度', time: 'ISO 8601，含時區', species: Object.entries(SPECIES).map(([k, v]) => `${k}=${v}`).join(', '), confidence: '辨識信心 0–1', count: '目擊數量', evidence: Object.entries(EVIDENCE).map(([k, v]) => `${k}=${v}`).join(', ') } }));
  $('btn-report-clear').addEventListener('click', () => {
    if (!store.reports.length || !confirm(`移除 ${store.reports.length} 筆匯入的回報？（模擬資料不受影響）`)) return;
    store.clearReports(); app.recomputeSim();
  });

  return { paint };
}
