import re, base64, sys, glob, os

d = os.path.dirname(os.path.abspath(__file__))
files = [f for f in glob.glob(os.path.join(d, 'mcp-cloudcli-browser-*.txt'))]
src = max(files, key=os.path.getmtime)
out = os.path.join(d, sys.argv[1] if len(sys.argv) > 1 else 'shot.jpeg')
s = open(src, encoding='utf-8').read()
m = re.search(r'data:image/(\w+);base64,([A-Za-z0-9+/=]+)', s)
open(out, 'wb').write(base64.b64decode(m.group(2)))
print('source:', os.path.basename(src))
print('image:', out)
for line in s.splitlines():
    if 'screenshotDataUrl' not in line:
        print(line[:3000])
