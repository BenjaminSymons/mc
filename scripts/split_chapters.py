"""Split source/pg1184.txt into source/chapters/NNN.txt (one file per chapter).

The Gutenberg file lists all chapter titles in a contents section first, so the
body starts at the second "Chapter 1." heading. Everything after the
"*** END OF THE PROJECT GUTENBERG EBOOK" marker is dropped.
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "pg1184.txt"
OUT = ROOT / "source" / "chapters"
HEADING = re.compile(r"^\s*Chapter (\d+)\.\s+(.*\S)\s*$")

lines = SRC.read_text(encoding="utf-8-sig").splitlines()
end = next(i for i, l in enumerate(lines) if l.startswith("*** END OF THE PROJECT GUTENBERG"))
starts = [i for i, l in enumerate(lines[:end]) if HEADING.match(l)]
body = starts[len(starts) // 2:]          # second half = actual chapter headings
assert len(body) == 117, f"expected 117 chapter headings, found {len(body)}"

OUT.mkdir(parents=True, exist_ok=True)
index = []
for n, start in enumerate(body, 1):
    stop = body[n] if n < len(body) else end
    num, title = HEADING.match(lines[start]).groups()
    assert int(num) == n, f"chapter order broken at {n}"
    text = "\n".join(lines[start:stop]).strip() + "\n"
    (OUT / f"{n:03d}.txt").write_text(text, encoding="utf-8")
    index.append({"ch": n, "title": title, "words": len(text.split())})

(OUT / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {len(index)} chapters, {sum(c['words'] for c in index):,} words")
