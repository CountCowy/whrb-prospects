"""Row-level checkpointing for pipeline phases.

Each phase of the pipeline mutates a `rows: list[dict]` in place. We dump
that list to cache/checkpoints/NN_<name>.json after each phase. On restart,
load_latest() returns the highest-numbered checkpoint (if <24h old) so the
pipeline can skip already-completed phases.

A second layer in cache/sources/<name>.json snapshots each source's output
individually so collect() can resume partial source runs.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from config import CHECKPOINT_TTL_SECONDS

CHECKPOINT_DIR = Path("cache/checkpoints")
SOURCES_DIR = Path("cache/sources")
# Re-exported for backwards compatibility with scripts that imported it directly.
TTL_SECONDS = CHECKPOINT_TTL_SECONDS


def _ensure_dirs() -> None:
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    SOURCES_DIR.mkdir(parents=True, exist_ok=True)


def _atomic_write_json(path: Path, payload: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, default=str))
    tmp.replace(path)


# ---- phase-level checkpoints ---- #

def save_phase(name: str, rows: list[dict]) -> None:
    """Save `rows` as cache/checkpoints/<name>.json. `name` should be
    prefixed with a two-digit ordinal, e.g. "03_contact_scraped"."""
    _ensure_dirs()
    _atomic_write_json(CHECKPOINT_DIR / f"{name}.json", rows)
    print(f"[checkpoint] saved {name} ({len(rows)} rows)")


def load_latest(phase_order: list[str]) -> tuple[str | None, list[dict] | None]:
    """Return (name, rows) for the highest-numbered fresh checkpoint found
    in cache/checkpoints/, or (None, None) if none is usable. Phase names
    not in `phase_order` are ignored (guards against stale schemas)."""
    _ensure_dirs()
    candidates: list[tuple[int, str, Path]] = []
    for path in CHECKPOINT_DIR.glob("*.json"):
        name = path.stem
        if name not in phase_order:
            continue
        if time.time() - path.stat().st_mtime > TTL_SECONDS:
            continue
        candidates.append((phase_order.index(name), name, path))
    if not candidates:
        return None, None
    candidates.sort()
    _, name, path = candidates[-1]
    try:
        rows = json.loads(path.read_text())
    except Exception as e:
        print(f"[checkpoint] failed to load {name}: {e}")
        return None, None
    return name, rows


def clear_all() -> None:
    """Delete every checkpoint + per-source cache. Triggered by --fresh."""
    _ensure_dirs()
    for d in (CHECKPOINT_DIR, SOURCES_DIR):
        for p in d.glob("*.json"):
            p.unlink()
        for p in d.glob("*.json.tmp"):
            p.unlink()
    print("[checkpoint] cleared all checkpoints and source caches")


# ---- source-level cache (used inside pipeline.collect) ---- #

def load_source(name: str) -> list[dict] | None:
    """Return cached rows for a source, or None if missing/stale."""
    path = SOURCES_DIR / f"{name}.json"
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > TTL_SECONDS:
        return None
    try:
        data: list[dict] = json.loads(path.read_text())
        return data
    except Exception:
        return None


def save_source(name: str, rows: list[dict]) -> None:
    _ensure_dirs()
    _atomic_write_json(SOURCES_DIR / f"{name}.json", rows)
