import proj4 from 'proj4';

// TWD97 / TM2 zone 121 (EPSG:3826)
export const TWD97_TM2 = '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const toWgs = proj4(TWD97_TM2, 'EPSG:4326');

/** TWD97 TM2 (x, y) → [lon, lat]，取 5 位小數（約 1 m）。 */
export function tm2ToLonLat(x, y) {
  const [lon, lat] = toWgs.forward([x, y]);
  return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
}

/** 台北市 TM2 合理範圍檢查 */
export function inTaipeiTM2(x, y) {
  return x > 290000 && x < 320000 && y > 2750000 && y < 2790000;
}

/** 解析 `121°29'29.7` 或 `25°01'37.7"` 這類 DMS 字串 → 十進位度 */
export function parseDMS(s) {
  if (s == null) return NaN;
  const m = String(s).trim().match(/^(-?\d+)[°\s]+(\d+)['′\s]+([\d.]+)/);
  if (!m) return NaN;
  const sign = m[1].startsWith('-') ? -1 : 1;
  return sign * (Math.abs(+m[1]) + (+m[2]) / 60 + (+m[3]) / 3600);
}
