# 台北鼠跡圖 — 台北市鼠類活動熱區推估地圖

以**污水下水道**、**雨水下水道**、**攤販集中場（夜市）**與**餐飲業者**分佈，疊在微 3D 的台北市行政區底圖上，
用發光熱力層呈現「環境條件最適合老鼠」的區域。熱力在建置階段烤成貼圖，權重在 `scripts/build.mjs` 設定。

> 這是依環境條件推估的相對熱度，不是實際捕鼠數或通報數。

## 快速開始

```bash
npm install
npm run fetch    # 從 data.taipei 下載 6 份原始資料到 raw/
npm run prep:food  # （選用）餐飲業者：下載食藥署/財政部/衛生局/門牌四份資料、本機地址轉座標、去重合併 → raw/food/food_merged.csv
npm run build    # 清洗、轉座標、合併 → dist/data/*.json
npm run serve    # http://localhost:3000
npm run route:trucks  # （選用）垃圾車沿路路徑：以新工處 8 m 道路面＋門牌分布做 20 m 成本格網，A* 連接停靠點 → raw/truck_routes.json（約 10 秒）
npm run build:satellite  # （選用）遊戲衛星底圖：從 AWS 公開鏡像讀 Sentinel-2 真彩色 10 m 影像的台北範圍，對齊遊戲座標、調暗去飽和 → dist/data/satellite.jpg（約 10 秒；需先 build:game）
npm run build:title  # （選用）遊戲入口畫面背景 1920×1080：壓暗的 Sentinel-2 衛星圖＋鼠患熱力光暈＋垃圾車路徑與捷運細光 → dist/data/title.jpg（約 20 秒；需先 build:satellite、route:trucks）
npm run build:game  # （選用）匯出遊戲用的 12 區屬性、擴散邊層、垃圾車路徑與 SVG 多邊形 → dist/data/districts_game.json（供 taipei_pleague 使用）
```

`dist/` 是完整的靜態成品（`index.html` + `data/`），可直接放到任何靜態空間。
外部依賴只有 jsDelivr 上固定版號的 deck.gl 9.1.14 與 Google Fonts。

## 資料來源

| 資料集 | 提供機關 | 用途 | 備註 |
|---|---|---|---|
| [臺北市污水下水道管線](https://data.taipei/dataset/detail?id=af1e6e42-5ffc-4be0-983f-51c03d5d1b17) | 工務局衛工處 | 管線圖層 | 原始檔無座標，以上下游人孔編號對應人孔資料集補回 |
| [臺北市污水下水道人孔](https://data.gov.tw/dataset/136379) | 工務局衛工處 | 人孔圖層、熱力 | TWD97 TM2 (EPSG:3826)；1 筆座標為 0 已剔除 |
| [臺北市污水下水道陰井](https://data.gov.tw/dataset/136377) | 工務局衛工處 | 只用來補管線端點座標 | 184,266 筆；編號格式與人孔相同。不計入熱力，因為幾乎每棟建物都有陰井，納入會變成建物密度 |
| [臺北市水利處雨水下水道人孔資料](https://data.taipei/dataset/detail?id=3e62c860-0753-4c79-8fe1-bcb3e0243534) | 工務局水利處 | 人孔圖層、熱力 | TWD97 TM2 |
| [臺北市攤販集中場](https://data.gov.tw/dataset/121594) | 市場處 | 夜市圖層、熱力 | Big5 編碼；座標為度分秒字串；同座標重複列已合併 |
| [臺北市里界圖](https://data.taipei/dataset/detail?id=6b17b31d-4e16-495e-95b1-9fd1f47c80d8) | 民政局 | 行政區底圖 | 456 里依 `TNAME` 合併為 12 區 |
| [臺北市垃圾車點位路線資訊](https://data.gov.tw/dataset/136515) | 環境保護局 | 食源因子、圖層 | 4,012 車次 → 3,870 個停靠點（WGS84）；σ 200 m |
| [臺北市傳統市(商)場](https://data.gov.tw/dataset/121593) | 市場處 | 食源因子、圖層 | 47 處公有市場（WGS84）；σ 350 m |
| [臺北市垃圾資源回收、廚餘回收限時收受點](https://data.gov.tw/dataset/132357) | 環境保護局 | 圖層，不進熱力 | 30 處，排除備註「不含廚餘」或「僅收受一般垃圾」的 5 處 → 25 處；Big5 |
| 疑似廚餘暫置點（[EcoSentinel](https://www.ecosentinel.tw/) 整理） | 民間，未證實 | 圖層，不進熱力 | 8 處，`raw/food_waste_nodes.json` 手動轉錄；5 處僅有路名，以街道門牌中位點定位 |
| [全臺灣 20 公尺網格 DTM（2025 臺北市分幅）](https://data.gov.tw/dataset/175239) | 內政部地政司 | 「地形」底圖 | 65 幅 1/5000 圖幅、122 萬格點（TWD97 / TWVD2001）→ 經緯度對齊 867×967 px Terrarium PNG，前端高度 ×1.6 |
| [食品業者登錄資料集](https://data.gov.tw/dataset/8938) | 衛福部食藥署 | 餐飲業者（主體） | 全國 83 萬列，取「餐飲場所」且地址臺北市：36,587 |
| [全國營業(稅籍)登記資料集](https://data.gov.tw/dataset/9400) | 財政部財政資訊中心 | 餐飲業者（補充、行業細類） | 322 MB 串流過濾，行業代號 56 且臺北市：25,815 |
| [臺北市通過餐飲衛生管理分級評核業者](https://data.gov.tw/dataset/145738) | 衛生局 | 餐飲業者（評核等級） | 1,687 |
| [GBIF 鳳頭蒼鷹出現紀錄](https://www.gbif.org/species/2480593) | 中華鳥會紀錄資料庫、繁殖鳥大調查等（CC0 / CC BY） | 疊加對照層，不進熱力 | `npm run fetch:raptor`；≤ 500 m 畫點、1 km 網格畫 500 m 圈、10 km 網格與標本/路殺排除 |
| [iNaturalist 鳳頭蒼鷹觀察](https://www.inaturalist.org/taxa/5231) | 社群（僅取 CC0 / CC BY、研究等級、未模糊化） | 疊加對照層，不進熱力 | 同上 |
| [臺北市陳情系統類別資料](https://data.taipei/dataset/detail?id=cb423c17-88eb-4231-a725-f1b93247d1bf) | 研考會 | 方法面板時間序列，不進熱力 | 119 個月（2016-11 起）；環保局「水質病媒管制科」受理件數 = 鼠類＋蚊蟲通報，受理科室欄位自 2022-03 才有；`npm run fetch:petition`（約 450 MB） |
| [Copernicus Sentinel-2 L2A](https://registry.opendata.aws/sentinel-2-l2a-cogs/)（經 AWS Open Data／Element 84 Earth Search） | 歐盟 Copernicus | 遊戲衛星底圖（只給遊戲用） | 自動挑雲量 < 0.1% 中最新的一景（目前 2025-01-14，圖幅 51RUH）；[Copernicus Sentinel data licence](https://ecds.ecmwf.int/licences/ec-sentinel)，須標示「Contains modified Copernicus Sentinel data 年份」 |
| [臺北都會區大眾捷運系統路網圖](https://data.gov.tw/dataset/121208)、[車站點位圖](https://data.gov.tw/dataset/121140) | 捷運工程局 | 遊戲地圖的捷運底圖（只給遊戲用，不進熱力） | EPSG:3826；路網用工程名稱（淡水線、板橋線…），匯出時歸類為營運路線 |
| [臺北市寬度超過8公尺道路GIS圖資](https://data.taipei/dataset/detail?id=ee2e4015-8844-48fb-aa57-31209909b0fc) | 工務局新工處 | 垃圾車沿路路徑的成本格網（只給遊戲用，不進熱力） | 13,419 個路面多邊形，2014–2016 測繪；8 m 以下巷弄不在內，以門牌點補 |
| [臺北市門牌位置數值資料](https://data.taipei/dataset/detail?id=b7c8e724-1e98-45ee-a0bd-f3840623ed97) | 民政局 | 地址 → TWD97 座標 | 116 萬筆門牌；`scripts/geocode.py` 本機比對，不用 Google |

授權：政府資料開放授權條款－第 1 版。

## 推估方法

- `build.mjs` 第 6 步在 TWD97 公尺座標上以 30 m 像素格化，三組點位（污水人孔、雨水人孔、攤販集中場）各自以高斯核平滑
  （人孔 σ = 250 m、攤販集中場 σ = 450 m），再以該組第 99 百分位正規化到 0–1。
- 餐飲業者：三份清單以統編或「店名+門牌」去重 → 47,031 家（`scripts/merge_food.py`），98% 精確到門牌。
  同一門牌 n 家店的貢獻取 √n（`FOOD_STACK.mode = 'sqrt'`，另有 `log` / `cap` / `none` 可選），避免士林市場、京站等美食街被過度放大。σ = 200 m。
- 垃圾車停靠點（同一地點多車次合併）與傳統市場為第五、六個因子；分區比對表（`dist/data/district_stats.json`）把熱力均值與 EcoSentinel 整理的分區指標並列，見鼠地圖通報僅 2026-05 一個月、上線熱度期，只做方向性對照。
- 每個像素的熱度 = 六個密度的加權平均，套 γ = 1.25 對比後映射到紅光色階，直接烤成帶透明度的 `dist/data/heat.png`
  （634×778 px，約 230 KB），四角座標寫在 `dist/data/heat.json`。
- 前端用 deck.gl `BitmapLayer` 以加法混合貼這張圖，GPU 每幀只畫一張貼圖；縮放、旋轉時沒有任何重算。
- 污水管線同樣在第 7 步以 10 m/px 反鋸齒光柵化成 `dist/data/sewer_lines.png`（約 830 KB），參數在 `LINE` 常數。
  另輸出 `dist/data/sewer_lines.bin`（1.3 MB 二進位：uint32 筆數 + float32 相對座標 + uint8 類別）；
  前端在 zoom ≥ 13（`VECTOR_ZOOM`）時改用三個 `PathLayer` 畫 GPU 向量線，任何倍率都清晰，zoom < 13 回到貼圖。向量檔於首屏後背景載入，失敗時維持貼圖。
- **權重、解析度、σ、γ、色階都在 `scripts/build.mjs` 的 `HEAT` 常數**，改完重跑 `npm run build` 即可，前端不需改動。
- 鳳頭蒼鷹紀錄只做疊加對照（`dist/data/raptor.json`），不進權重：猛禽會出現在獵物多的地方，且都市鳳頭蒼鷹主食為鳥類與松鼠，不能假設「有鷹處老鼠少」；觀察紀錄亦有賞鳥熱點的觀察者偏差。
- 底圖可切換「塊體」（行政區擠壓 220 m）與「地形」（TerrainLayer + TerrainExtension 貼地；參數在 `scripts/build.mjs` 的 `TERRAIN`）。
- 行政區由里界合併（turf union），座標截到 7 位小數避免拓樸錯誤。

### 效能
- 畫布解析度上限 1.5x（手機 1x），hover 拾取每 50 ms 最多一次。
- 實測（Chrome、Apple M5、1440×900）：連續 zoom + 旋轉 180 幀，每幀中位數 16.7 ms，最慢 20.3 ms。

## 已知限制

- **污水管線端點約半數是陰井**：管線資料集引用 80,928 個端點，其中 45,988 個在人孔資料集、其餘幾乎都在陰井資料集。
  兩者合併後 77,509 / 77,603 段（99.9%）可畫出，分為主幹管（人孔對人孔）30,092 段、支管 9,337 段、接戶管（陰井對陰井）38,080 段，
  貼圖以亮度 1 / 0.55 / 0.3 區分（`LINE.classWeight`）。
  另有少數管線的端點編號打錯，會接出橫跨全市的直線；build 以資料集的「管線長度」欄位檢核，幾何長度 > 300 m 且 > 2.5×申報長度 + 50 m 者剔除（筆數見 `meta.counts.sewerLinesBadGeometry`）。
- 未納入餐飲業者、市場、垃圾清運點、建物屋齡等因子，也沒有用實際捕鼠或通報數校正。
- 環保局 2026 年公布的通報熱區為大安、中山、中正、大同、萬華五區，可作方向性對照；本圖未用它校正權重。
- OpenStreetMap 餐飲點（13,830）經比對 96% 已被政府資料涵蓋，為避免 ODbL 衍生授權與重複計數而未納入。
- 使用者原本提供的「臺北市食品業者登錄數」只有全市總數一列、「食材登錄平台日夜市專區」無座標，故未使用。

## 專案結構

```
scripts/fetch.mjs      下載原始資料、寫 raw/manifest.json
scripts/build.mjs      清洗 → dist/data/{districts.geojson, garbage_stops.json, markets_trad.json, recycle_points.json, food_waste_nodes.json, district_stats.json, sewer_lines.json, sewer_manholes.json, storm_manholes.json, markets.json, food.json, raptor.json, petition.json, terrain.png, terrain.json, heat.png, heat.json, sewer_lines.png, sewer_lines.bin, sewer_lines.json, meta.json}
scripts/lib/twd97.mjs  TWD97 TM2 → WGS84、度分秒解析
scripts/fetch-food.mjs 餐飲四份來源下載與過濾
scripts/fetch-raptor.mjs 鳳頭蒼鷹紀錄（GBIF + iNaturalist）
scripts/fetch-petition.mjs 陳情系統 119 個月下載與每月彙整
scripts/geocode.py     地址 → 座標（門牌位置資料比對）
scripts/merge_food.py  三份餐飲清單去重合併
dist/index.html        單頁應用（deck.gl，無 bundler）
```

## 立體模型頁（three.js，`dist/model.html`）

以 three.js 建成的一體成型台北市模型：頂面為地形、四周為泥土剖面、底部為底座。和資料地圖分開，`index.html` 不受影響。

```bash
npm run build:model-texture   # Sentinel-2 + 都市計畫使用分區 → dist/data/model_texture.jpg
npm run serve                 # http://localhost:3000/model.html
```

- **頂面貼圖**：Copernicus Sentinel-2 L2A 真彩色（10 m，與遊戲衛星底圖同一景）重投影到經緯度格網；以臺北市都市計畫使用分區圖（細部計畫 SHP，`raw/city3d/zoning_detail.zip`，屬性 Big5、座標 TWD97）分成山林、公園綠地、水域、機場、市區，街廓之間未覆蓋的空隙視為道路；各類以「亮度 → 色階」重新著色，保留衛星明暗細節。
- **地形**：沿用 `terrain.png`（內政部 20 m DEM，高度 ×1.6）。
- **光線**：太陽方位對齊衛星拍攝時間（1 月上午，東南偏南、仰角約 38°），即時陰影與影像中的山影一致。
- **熱區**：低熱度完全透明，中高熱度以橘到深紅覆蓋，透明度可調。
- 標示：Contains modified Copernicus Sentinel data 2025；臺北市都市計畫使用分區圖（都市發展局，政府資料開放授權條款第 1 版）。
- 已知限制：臺北市建物 SHP（建管處）只有近年建照約 1 萬筆，不足以還原全市建物量體，目前未擠出建物；國土測繪中心三維建物模型的臺北市部分需向市府申請。
