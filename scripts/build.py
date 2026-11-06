"""Build identical, self-contained Galvoro and local entry points from source."""
from pathlib import Path
import base64

project = Path(__file__).resolve().parent.parent
capsule = project
html = (project / "source" / "index.template.html").read_text()
for reference in ['<link rel="stylesheet" href="style.css">', '<script defer src="model.js"></script>', '<script defer src="game.js"></script>']:
    assert html.count(reference) == 1, f"Missing or duplicated template reference: {reference}"
css = (capsule / "style.css").read_text().removeprefix('@charset "UTF-8";\n')
model = (capsule / "model.js").read_text()
game = (capsule / "game.js").read_text()
assert "</style" not in css.lower()
assert "</script" not in (model + game).lower()
icon = base64.b64encode((capsule / "assets" / "favicon.svg").read_bytes()).decode("ascii")
html = html.replace('href="assets/favicon.svg"', f'href="data:image/svg+xml;base64,{icon}"')
html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>\n{css}\n</style>')
html = html.replace('  <script defer src="model.js"></script>\n', '')
html = html.replace('  <script defer src="game.js"></script>\n', '')
html = html.replace('href="index.html"', 'href="#page-title"')
html = html.replace('</body>', f'<script>\n{model}\n</script>\n<script>\n{game}\n</script>\n</body>')
outputs = [project / "index.html"]
for output in outputs:
    output.write_text(html, encoding="utf-8")
print(f"Self-contained game rebuilt ({outputs[0].stat().st_size:,} bytes each).")
