"""The ``data`` branch: one JSON Lines report file per day, plus an index of every run.

Reports live at ``data/%Y/%m/%Y%m%d_report.json``; each scan appends one line (one record) to the file of the day it
ran. ``data/index.json`` lists every run with its per-check counts, so that the dashboard can chart the history
without fetching every report file; it is rebuilt from the report files after each scan.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from sistence_scanner.record import META_KEY, RECORD_SCHEMA_VERSION, summarize

DATA_DIR = PurePosixPath("data")
INDEX_PATH = DATA_DIR / "index.json"
REPORT_PATTERN = "%Y/%m/%Y%m%d_report.json"


def parse_timestamp(timestamp: str) -> datetime:
    """An ISO 8601 timestamp (``Z`` suffix allowed) as an aware UTC datetime."""
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def report_path(timestamp: str) -> PurePosixPath:
    """``data/%Y/%m/%Y%m%d_report.json`` for the UTC day of ``timestamp``."""
    return DATA_DIR / parse_timestamp(timestamp).strftime(REPORT_PATTERN)


def append_record(root: Path, record: dict[str, Any]) -> PurePosixPath:
    """Append ``record`` as one line to its day's report file under ``root``; returns that file's relative path."""
    relative = report_path(record[META_KEY]["timestamp"])
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    return relative


def iter_records(root: Path) -> Iterator[tuple[PurePosixPath, int, dict[str, Any]]]:
    """Every record under ``root/data`` as ``(file, line number from 1, record)``, oldest file first."""
    base = root / DATA_DIR
    for path in sorted(base.glob("[0-9][0-9][0-9][0-9]/[0-9][0-9]/*_report.json")):
        relative = PurePosixPath(path.relative_to(root).as_posix())
        with path.open(encoding="utf-8") as stream:
            for number, line in enumerate(stream, start=1):
                if line.strip():
                    yield relative, number, json.loads(line)


def build_index(root: Path) -> dict[str, Any]:
    """The index of every run under ``root``, in chronological order."""
    runs = [
        {"file": str(file), "line": line, **summarize(record)}
        for file, line, record in iter_records(root)
        if record.get(META_KEY, {}).get("schema_version") == RECORD_SCHEMA_VERSION
    ]
    runs.sort(key=lambda run: parse_timestamp(run["timestamp"]))
    return {"schema_version": RECORD_SCHEMA_VERSION, "runs": runs}


def write_index(root: Path) -> PurePosixPath:
    """Rebuild ``data/index.json`` under ``root``."""
    target = root / INDEX_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(build_index(root), indent=4, ensure_ascii=False) + "\n", encoding="utf-8")
    return INDEX_PATH
