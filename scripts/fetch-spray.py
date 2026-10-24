"""下載環保局「戶外環境噴藥日程表」各區 PDF → raw/spray/<期間>_<區>.pdf

用法：python3 -I scripts/fetch-spray.py raw/spray
新一期日程公布後重跑本腳本，再跑 parse-spray.py。
"""
import html
import os
import re
import sys
import urllib.request

PAGE = 'https://www.dep.gov.taipei/News_Content.aspx?n=C9DDE466083DD04F&sms=0643EAEB0A6AB30F&s=1136ABBCE065A121'
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
get = lambda url: urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read()

page = get(PAGE).decode('utf-8')
open(os.path.join(out_dir, 'page.html'), 'w', encoding='utf-8').write(page)
items = re.findall(r'href="(https://www-ws\.gov\.taipei/Download\.ashx\?u=[^"]+)"[^>]*?data-title="(\d{5}-\d{5})戶外環境噴藥日程表-([^"]+)"', page)
done = set()
for href, period, district in items:
    name = f'{period}_{district}.pdf'
    if name in done:
        continue
    data = get(html.unescape(href))
    if not data.startswith(b'%PDF'):
        sys.exit(f'{name} 不是 PDF')
    open(os.path.join(out_dir, name), 'wb').write(data)
    done.add(name)
print(f'{len(done)} 份 PDF → {out_dir}')
