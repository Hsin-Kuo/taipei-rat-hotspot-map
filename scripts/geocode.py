"""本機地址比對：臺北市門牌位置數值資料 → 餐飲業者地址 → TWD97 座標
用法: python3 -I geocode.py <housenum.csv> <in.csv> <addr_col_index> <out.csv>
比對層級：門牌號精確 → 同街路段+巷+弄的最近門牌號 → 同街路段中位數（標記精度）
"""
import sys, csv, re, statistics, collections

FULL = str.maketrans('０１２３４５６７８９－', '0123456789-')
CN = '〇一二三四五六七八九'
def cn_num(n):
    n = int(n)
    if n < 10: return CN[n]
    if n < 20: return '十' + (CN[n % 10] if n % 10 else '')
    return CN[n // 10] + '十' + (CN[n % 10] if n % 10 else '')
def norm(s):
    s = s.translate(FULL).replace('台北市', '臺北市').replace('臺灣省', '')
    s = re.sub(r'\s+', '', s)
    s = s.replace('之', '-')
    s = re.sub(r'(\d+)段', lambda m: cn_num(m.group(1)) + '段', s)   # 3段 → 三段，與門牌檔一致
    return s
def digits(s):
    m = re.search(r'\d+', (s or '').translate(FULL)); return m.group(0) if m else ''

DIST = ['中正區','大同區','中山區','松山區','大安區','萬華區','信義區','士林區','北投區','內湖區','南港區','文山區']
ADDR_RE = re.compile(r'^臺北市(?P<dist>' + '|'.join(DIST) + r')?(?:[^\d巷弄號]{0,12}?里)?(?:\d+鄰)?(?P<road>[^\d巷弄號]+?(?:[一二三四五六七八九十\d]+段)?)(?:(?P<lane>\d+)巷)?(?:(?P<alley>\d+)弄)?(?P<no>\d+)(?:-(?P<sub>\d+))?號')

def parse(addr):
    a = norm(addr)
    m = ADDR_RE.match(a)
    if not m: return None
    d = m.groupdict()
    return (d['dist'] or '', d['road'], d['lane'] or '', d['alley'] or '', int(d['no']), d['sub'] or '')

def load_housenum(path):
    exact = {}; by_lane = collections.defaultdict(list); by_road = collections.defaultdict(list)
    with open(path, encoding='utf-8-sig', newline='') as f:
        r = csv.DictReader(f)
        for row in r:
            try: x, y = float(row['橫座標']), float(row['縱座標'])
            except: continue
            road = norm(row['街路段'] or row['地區'] or '')
            lane = digits(row['巷']); alley = digits(row['弄'])
            no = (row['號'] or '').translate(FULL)
            m = re.match(r'(\d+)(?:-(\d+))?', no)
            if not m or not road: continue
            n, sub = int(m.group(1)), m.group(2) or ''
            key = (road, lane, alley, n, sub)
            exact.setdefault(key, (x, y))
            exact.setdefault((road, lane, alley, n, ''), (x, y))
            by_lane[(road, lane, alley)].append((n, x, y))
            by_road[road].append((x, y))
    return exact, by_lane, by_road

def main():
    hn, inp, col, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    exact, by_lane, by_road = load_housenum(hn)
    sys.stderr.write(f'housenum keys {len(exact)}\n')
    stats = collections.Counter()
    with open(inp, encoding='utf-8-sig', newline='') as fi, open(out, 'w', encoding='utf-8', newline='') as fo:
        r = csv.reader(fi); hdr = next(r)
        w = csv.writer(fo); w.writerow(hdr + ['X', 'Y', 'geo_level'])
        for row in r:
            if len(row) <= col: continue
            p = parse(row[col])
            res = None
            if p:
                dist, road, lane, alley, n, sub = p
                res = exact.get((road, lane, alley, n, sub)) or exact.get((road, lane, alley, n, ''))
                level = 'exact' if res else None
                if not res and (road, lane, alley) in by_lane:
                    cand = min(by_lane[(road, lane, alley)], key=lambda t: abs(t[0] - n))
                    if abs(cand[0] - n) <= 20: res, level = (cand[1], cand[2]), 'nearest'
                if not res and road in by_road and len(by_road[road]) >= 3:
                    pts = by_road[road]; res, level = (statistics.median(p[0] for p in pts), statistics.median(p[1] for p in pts)), 'road'
            if res: w.writerow(row + [f'{res[0]:.3f}', f'{res[1]:.3f}', level]); stats[level] += 1
            else: stats['unparsed' if not p else 'nomatch'] += 1
    sys.stderr.write(f'{dict(stats)}\n')

if __name__ == '__main__': main()
