import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReports } from '../dist/js/reports.js';

test('回報匯入驗證：合法資料補預設值、不合法資料列出原因', () => {
  const { ok, bad } = validateReports([
    { lon: 121.5, lat: 25.04, time: '2026-10-01T21:00:00+08:00', species: 'norway' },
    { lon: 120.0, lat: 25.04, time: '2026-10-01', species: 'norway' },
    { lon: 121.5, lat: 25.04, time: 'yesterday', species: 'cat', confidence: 2, evidence: 'smell' },
  ]);
  assert.equal(ok.length, 1);
  assert.deepEqual([ok[0].confidence, ok[0].count, ok[0].evidence, ok[0].simulated], [1, 1, 'live', false]);
  assert.equal(bad.length, 2);
  assert.match(bad[0][1], /座標/);
  assert.match(bad[1][1], /時間.*鼠種.*信心.*跡證/);
});
