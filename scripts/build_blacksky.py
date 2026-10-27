"""Assemble the shared files of BLACKSKY COMMAND (blacksky/site) from the single sources of truth in app/.

BLACKSKY COMMAND is a separate website with its own entry point (blacksky/site/index.html) and deployment directory. It reuses the
parity-tested simulation and data modules of the workbench instead of re-implementing them; this script copies them byte-for-byte so the
site directory is self-contained (deployable as a static site with no build step), and --check fails if any copy has drifted.

  PYTHONPATH=. python scripts/build_blacksky.py          # copy / refresh
  PYTHONPATH=. python scripts/build_blacksky.py --check  # exit 1 if blacksky/site is out of sync with app/
"""
from __future__ import annotations
import hashlib, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP, SITE = ROOT / "app", ROOT / "blacksky" / "site"
JS = ["core/cascade.js", "core/model.js", "core/events.js", "core/encoding.js", "core/scenario.js", "three/layout.js", "three/camera.js", "three/loader.js"]
DATA_PATTERNS = ["grid_*.json", "cascade_model_*.json", "dist_*.json", "top_cascades_*.json", "examples_*.json", "index.json", "headline.json", "evidence.json"]


def pairs():
    out = [(APP / "js" / p, SITE / "shared" / p) for p in JS]
    out += [(APP / "vendor" / n, SITE / "vendor" / n) for n in ("three.module.min.js", "THREE_LICENSE")]
    for pat in DATA_PATTERNS:
        out += [(src, SITE / "data" / src.name) for src in sorted((APP / "data").glob(pat))]
    return out


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main(check: bool) -> int:
    bad = []
    for src, dst in pairs():
        if check:
            if not dst.exists() or sha(src) != sha(dst): bad.append(str(dst.relative_to(ROOT)))
        else:
            dst.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(src, dst)
    if check:
        print("blacksky shared files in sync" if not bad else "OUT OF SYNC:\n  " + "\n  ".join(bad)); return 1 if bad else 0
    lines = ["# Files copied from app/ by scripts/build_blacksky.py (do not edit here; edit the source and re-run the script)", ""]
    lines += [f"{sha(dst)}  {dst.relative_to(SITE)}  <- {src.relative_to(ROOT)}" for src, dst in pairs()]
    (SITE / "SHARED_SOURCES.txt").write_text("\n".join(lines) + "\n"); print(f"copied {len(pairs())} shared files into {SITE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main("--check" in sys.argv))
