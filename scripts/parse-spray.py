"""臺北市戶外環境噴藥日程表（環保局，各區清潔隊月曆 PDF）→ 每里每次噴藥日期

用法：python3 -I scripts/parse-spray.py raw/spray dist/data/villages.geojson dist/data/spray_schedule.json
需要 poppler 的 pdftotext（brew install poppler）。

PDF 版面：每頁上下兩個月曆；格子內是日期數字與里名，里名可能排在數字同一行或上下一行。
做法：用 pdftotext -bbox 取每個字的座標，依「戶外環境噴藥日程表」標題切成各月，
以表頭各欄左緣的「日」字定出 7 欄，把每個里名歸到同一欄、垂直距離最近的日期。
"""
import collections
import glob
import html
import json
import os
import re
import subprocess
import sys

src_dir, vill_path, out_path = sys.argv[1:4]
vill = json.load(open(vill_path, encoding='utf-8'))
CODE = {(f['properties']['district'], f['properties']['name']): f['properties']['code'] for f in vill['features']}
# 日程表與里界資料的用字差異（異體字、錯字）
ALIAS = {('士林區', '富州里'): '富洲里', ('萬華區', '糖廍里'): '糖蔀里', ('文山區', '興褔里'): '興福里', ('中正區', '營圃里'): '螢圃里',
         ('北投區', '建明里'): '建民里',   # 原 PDF 錯字：北投區沒有建明里（大同區才有）
         ('文山區', '行里'): '景行里'}     # 原 PDF 漏字
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')

entries, unmatched, months = [], collections.Counter(), set()
for fn in sorted(glob.glob(os.path.join(src_dir, '*.pdf'))):
    period, dname = os.path.basename(fn)[:-4].split('_')
    district = dname + '區'
    bbox = subprocess.run(['pdftotext', '-bbox', fn, '-'], capture_output=True, text=True, check=True).stdout
    for page in bbox.split('<page ')[1:]:
        words = [(float(a), float(b), float(c), float(d), html.unescape(w)) for a, b, c, d, w in WORD.findall(page)]
        titles = sorted(w[1] for w in words if '噴藥日程表' in w[4])
        for si, ty in enumerate(titles):
            yend = titles[si + 1] if si + 1 < len(titles) else 1e9
            sec = [w for w in words if ty - 1 <= w[1] < yend - 1]
            text = ' '.join(w[4] for w in sorted(sec, key=lambda w: (round(w[1]), w[0])))
            m = re.search(r'(\d{3})\s*年\s*(\d{1,2})\s*月', text)
            if not m:
                print('找不到月份', fn, si, file=sys.stderr)
                continue
            year, month = int(m.group(1)) + 1911, int(m.group(2))
            months.add((district, f'{year}-{month:02d}'))
            head = [w for w in sec if w[4].startswith('星期')]
            ytop = max(w[3] for w in head)
            # 每欄左緣：表頭列「日／期」直書標籤的「日」字（格子內的日期數字靠左，用左緣分欄才不會分錯）
            hy = min(w[1] for w in head)
            lefts = sorted(w[0] for w in sec if w[4] == '日' and hy - 20 < w[1] < ytop + 5)
            if len(lefts) != 7:
                print('表頭欄數不是 7', fn, si, len(lefts), file=sys.stderr)
                continue
            notes = [w[1] for w in sec if w[4].startswith('一、')]
            ybot = min(notes) if notes else yend
            cal = [w for w in sec if ytop < w[1] < ybot]
            col = lambda x: max([i for i in range(7) if lefts[i] - 3 <= x] or [0])
            days = [(col(w[0]), (w[1] + w[3]) / 2, int(w[4])) for w in cal if re.fullmatch(r'\d{1,2}', w[4]) and 1 <= int(w[4]) <= 31]
            for w in cal:
                raw = w[4]
                name = re.sub(r'[(（].*?[)）]', '', raw)            # 學府里(一)、龍圖里(直屬) → 學府里、龍圖里
                if not name.endswith('里') or len(name) < 2:
                    continue
                c, yc = col(w[0]), (w[1] + w[3]) / 2
                cand = [d for d in days if d[0] == c]
                if not cand:
                    continue
                day = min(cand, key=lambda d: abs(d[1] - yc))[2]
                name = ALIAS.get((district, name), name)
                code = CODE.get((district, name))
                if not code:
                    unmatched[(district, raw)] += 1
                    continue
                entries.append({'date': f'{year}-{month:02d}-{day:02d}', 'district': district, 'village': name, 'code': code, 'label': raw, 'source': f'{period}戶外環境噴藥日程表-{dname}'})

# 同里同日去重（例如「學府里(一)」「學府里(二)」分兩天各算一次，同一天只留一筆）
seen, uniq = set(), []
for e in sorted(entries, key=lambda e: (e['date'], e['code'])):
    k = (e['date'], e['code'])
    if k not in seen:
        seen.add(k)
        uniq.append(e)

out = {
    'source': '臺北市政府環境保護局 戶外環境噴藥日程表（各區清潔隊）',
    'url': 'https://www.dep.gov.taipei/News_Content.aspx?n=C9DDE466083DD04F&sms=0643EAEB0A6AB30F&s=1136ABBCE065A121',
    'note': '全面戶外環境消毒，原則上每 2～3 個月巡迴各里一次；機動勤務、假日不列入。',
    'parsedAt': __import__('datetime').date.today().isoformat(),
    'range': [uniq[0]['date'], uniq[-1]['date']] if uniq else None,
    'unmatched': [f'{d} {n}×{k}' for (d, n), k in unmatched.most_common()],
    'entries': uniq,
}
json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
covered = {e['code'] for e in uniq}
print(f'{len(uniq)} 筆（{len(covered)}/{len(CODE)} 里，{len(months)} 個區月），{out["range"]}')
print('未對應：', out['unmatched'][:10])
missing = sorted(k for k, v in CODE.items() if v not in covered)
print('沒有排程的里：', len(missing), missing[:15])
