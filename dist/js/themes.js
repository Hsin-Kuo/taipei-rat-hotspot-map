// 環衛主題清單：目前只有鼠類可用，其餘為規劃中的主題（下拉選單顯示「待整合」）
// kind：A 族群型（環境因子→承載量＋任務＋回報）｜B 熱點型（陳情／稽查→熱點＋清潔任務）｜C 監測型（測站→空間內插）｜D 事件型（病例／事件→群聚與擴散）
export const THEME_KINDS = { A: '族群型', B: '熱點型', C: '監測型', D: '事件型' };

export const THEMES = [
  { group: '病媒', items: [
    { id: 'rat', name: '鼠類（溝鼠）', kind: 'A', ready: true },
    { id: 'dengue', name: '登革熱病媒蚊', kind: 'A', note: '布氏指數、誘卵桶、積水容器；孳生源清除與化學防治；可疊加病例（事件型）。戶外環境噴藥日程主要屬於此主題' },
    { id: 'roach', name: '蟑螂／蒼蠅', kind: 'A', note: '環境因子與鼠類高度重疊（餐飲、市場、垃圾）' },
    { id: 'stray', name: '遊蕩犬貓', kind: 'B', note: '通報與餵食點、排泄物陳情' },
    { id: 'pigeon', name: '鴿群聚集', kind: 'B', note: '餵食點、排泄物與建物污損陳情' },
  ] },
  { group: '廢棄物與市容', items: [
    { id: 'litter', name: '髒亂點／違規棄置', kind: 'B', note: '1999 陳情與稽查，清除後複查' },
    { id: 'dogpoop', name: '狗便與菸蒂', kind: 'B', note: '陳情熱點與取締' },
    { id: 'garbage', name: '垃圾落地／收運點周邊', kind: 'B', note: '可沿用垃圾車停靠點資料' },
    { id: 'kitchen', name: '廚餘與資源回收', kind: 'B', note: '可沿用廚餘收受點與疑似暫置點' },
    { id: 'toilet', name: '公廁清潔', kind: 'B', note: '公廁位置與評等、定期稽查' },
    { id: 'ads', name: '違規小廣告', kind: 'B', note: '稽查與清除' },
  ] },
  { group: '水環境', items: [
    { id: 'gutter', name: '側溝淤積／異味', kind: 'B', note: '可沿用雨水與污水下水道資料；清疏同時是滅蚊、滅鼠任務' },
    { id: 'ponding', name: '積水與淹水點', kind: 'C', note: '豪雨後積水，與病媒蚊孳生連動' },
    { id: 'river', name: '河川水質', kind: 'C', note: '測站 RPI，沿河段呈現' },
    { id: 'wastewater', name: '污水病原監測', kind: 'D', note: '以污水下水道網推估上游集水範圍' },
  ] },
  { group: '空氣、噪音、異味', items: [
    { id: 'air', name: '空氣品質（PM2.5）', kind: 'C', note: '國家測站＋微型感測器' },
    { id: 'noise', name: '噪音', kind: 'C', note: '監測站＋陳情（工地、娛樂場所）' },
    { id: 'odor', name: '異味陳情', kind: 'B', note: '餐飲油煙、工廠、溝渠' },
    { id: 'heat', name: '都市熱島／熱傷害', kind: 'C', note: '地表溫度、綠覆率' },
  ] },
  { group: '公共衛生', items: [
    { id: 'foodgrade', name: '餐飲衛生評核', kind: 'B', note: '可沿用衛生局評核等級資料' },
    { id: 'foodpoison', name: '食品中毒事件', kind: 'D', note: '事件點與追蹤' },
    { id: 'cluster', name: '腸病毒／流感群聚', kind: 'D', note: '學校、托育機構群聚' },
  ] },
];

export function themeSelect(el, onChange) {
  el.innerHTML = THEMES.map(g => `<optgroup label="${g.group}">${g.items.map(t =>
    `<option value="${t.id}" ${t.ready ? '' : 'disabled'} title="${THEME_KINDS[t.kind]}${t.note ? '：' + t.note : ''}">${t.name}${t.ready ? '' : '（待整合）'}</option>`).join('')}</optgroup>`).join('');
  el.value = 'rat';
  el.addEventListener('change', () => onChange?.(el.value));
}

// 主題總覽浮層（demo 收尾用；原生下拉選單無法用程式展開）
export function themeOverviewHtml() {
  return `<h3>台北環衛模型 · 主題</h3><div class="to-groups">${THEMES.map(g => `<section><h4>${g.group}</h4><ul>${g.items.map(t =>
    `<li class="${t.ready ? 'ready' : ''}">${t.name}<span>${t.ready ? '已上線' : '待整合'}</span></li>`).join('')}</ul></section>`).join('')}</div>`;
}
