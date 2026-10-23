"""合併三份已轉座標的餐飲清單 → raw/food/food_merged.csv
去重鍵：統一編號+門牌，或 正規化店名+門牌。
用法: python3 -I scripts/merge_food.py raw/food
"""
import sys, csv, re, importlib.util, collections, os
d = sys.argv[1] if len(sys.argv) > 1 else 'raw/food'
spec = importlib.util.spec_from_file_location('g', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'geocode.py'))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

def addr_key(a):
    p = g.parse(a); return None if not p else (p[1], p[2], p[3], p[4], p[5])
def name_key(n): return re.sub(r'[\s\(\)（）\-－_「」]|股份有限公司|有限公司|企業社|商行|工作室', '', n or '')

rec = {}
def add(src, name, uid, addr, x, y, lvl, cat='', grade=''):
    ak = addr_key(addr); keys = []
    if uid and uid.strip(): keys.append(('uid', uid.strip(), ak))
    if ak: keys.append(('na', name_key(name), ak))
    hit = next((rec[k] for k in keys if k in rec), None)
    if hit is None: hit = {'name': name, 'uid': uid, 'addr': addr, 'x': x, 'y': y, 'lvl': lvl, 'src': set(), 'cat': cat, 'grade': grade, 'names': {}}
    hit['src'].add(src); hit['names'][src] = name
    hit['name'] = hit['names'].get('hyg') or hit['names'].get('fia') or hit['names'].get('fda') or hit['name']   # 招牌名優先
    if cat and not hit['cat']: hit['cat'] = cat
    if grade: hit['grade'] = grade
    for k in keys: rec[k] = hit

rd = lambda f: csv.DictReader(open(os.path.join(d, f), encoding='utf-8-sig', newline=''))
for r in rd('fda_geo.csv'): add('fda', r['公司或商業登記名稱'], r['公司統一編號'], r['業者地址'], r['X'], r['Y'], r['geo_level'])
for r in rd('fia_geo.csv'):
    cat = next((r['名稱' + i] for i in ('', '1', '2', '3') if (r['行業代號' + i] or '').startswith('56')), '')
    add('fia', r['營業人名稱'], r['統一編號'], r['營業地址'], r['X'], r['Y'], r['geo_level'], cat)
for r in rd('hygiene_geo.csv'): add('hyg', r['業者名稱店名'], '', r['地址'], r['X'], r['Y'], r['geo_level'], '', r['評核結果'])

uniq = list({id(v): v for v in rec.values()}.values())
with open(os.path.join(d, 'food_merged.csv'), 'w', encoding='utf-8', newline='') as fo:
    w = csv.writer(fo); w.writerow(['name', 'uid', 'addr', 'X', 'Y', 'geo_level', 'sources', 'category', 'hygiene_grade'])
    for r in uniq: w.writerow([r['name'], r['uid'], r['addr'], r['x'], r['y'], r['lvl'], '+'.join(sorted(r['src'])), r['cat'], r['grade']])
print('merged', len(uniq), dict(collections.Counter(tuple(sorted(r['src'])) for r in uniq)))
