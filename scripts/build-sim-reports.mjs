// demo 用模擬回報：以承載量 K 為機率分布，產生過去 90 天的回報（固定亂數種子，可重現）
// 輸出 dist/data/reports_sim.json（與匯入格式相同，每筆 simulated: true）
// 規模參考：環保局 2026-02 鼠患通報 258 件/月 → 90 天約 750 件；demo 取 600 件。
import { writeFile } from 'node:fs/promises';
import { loadGridEnv, generateBackground } from './lib/sim-reports.mjs';

const END = process.argv[2] || '2026-10-23';       // 最後一天（含）
const SEED = 20261024;

const { G, env } = await loadGridEnv();
const reports = generateBackground({ G, env, end: END, seed: SEED });
await writeFile('dist/data/reports_sim.json', JSON.stringify({ note: '模擬資料：依環境因子推估的承載量產生，非真實通報', seed: SEED, end: END, reports }));
const bySp = reports.reduce((o, r) => (o[r.species] = (o[r.species] || 0) + 1, o), {});
console.log(`reports_sim.json：${reports.length} 筆（${reports[0].time.slice(0, 10)} ~ ${reports.at(-1).time.slice(0, 10)}）`, bySp);
