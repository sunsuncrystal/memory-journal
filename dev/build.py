# Builds index.html (the phone app) from dev/head.html + dev/ui.js,
# plus the strings and SafeSleep agent shared with demo.html (the desktop demo).
# Run from anywhere: python3 dev/build.py
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root/'demo.html').read_text()
start = src.index('var T={')
mid = src.index('/* ================= Rendering')
core = src[start:mid]
out = (root/'dev/head.html').read_text() + core + (root/'dev/ui.js').read_text() + '</script>\n</body>\n</html>\n'
(root/'index.html').write_text(out)
print('index.html', len(out), 'bytes')
