from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
from typing import Any

import pytest

from sistence_scanner.record import META_KEY
from sistence_scanner.store import (
    INDEX_PATH,
    append_record,
    build_index,
    iter_records,
    parse_timestamp,
    report_path,
    write_index,
)


def record(timestamp: str, *, consistent: int = 1, schema_version: int = 1) -> dict[str, Any]:
    return {
        META_KEY: {
            "schema_version": schema_version,
            "timestamp": timestamp,
            "sistent_version": "0.1.0",
            "main": "o/main",
            "repositories": {"o/main": {"status": "ok"}},
        },
        "readme": {
            "consistent": ["o/main"] * consistent,
            "inconsistent": {},
            "unchecked": {},
            "candidates": [],
        },
    }


@pytest.mark.parametrize(
    ("timestamp", "path"),
    [
        ("2026-10-17T12:00:00Z", "data/2026/10/20261017_report.json"),
        ("2026-01-05T23:59:59+00:00", "data/2026/01/20260105_report.json"),
        ("2026-01-05T23:30:00-02:00", "data/2026/01/20260106_report.json"),
        ("2026-03-01T00:00:00", "data/2026/03/20260301_report.json"),
    ],
)
def test_report_path_is_the_utc_day(timestamp: str, path: str) -> None:
    assert report_path(timestamp) == PurePosixPath(path)


def test_parse_timestamp_is_utc() -> None:
    assert parse_timestamp("2026-10-17T12:00:00Z").utcoffset() is not None


def test_runs_on_one_day_share_a_file(tmp_path: Path) -> None:
    first = append_record(tmp_path, record("2026-10-17T01:00:00Z"))
    second = append_record(tmp_path, record("2026-10-17T13:00:00Z"))
    third = append_record(tmp_path, record("2026-11-01T13:00:00Z"))
    assert first == second == PurePosixPath("data/2026/10/20261017_report.json")
    assert third == PurePosixPath("data/2026/11/20261101_report.json")
    lines = (tmp_path / first).read_text().splitlines()
    assert [json.loads(line)[META_KEY]["timestamp"] for line in lines] == [
        "2026-10-17T01:00:00Z",
        "2026-10-17T13:00:00Z",
    ]


def test_iter_records_skips_blank_lines_and_other_files(tmp_path: Path) -> None:
    path = append_record(tmp_path, record("2026-10-17T01:00:00Z"))
    with (tmp_path / path).open("a") as stream:
        stream.write("\n")
    (tmp_path / "data" / "2026" / "10" / "notes.json").write_text("{}")
    (tmp_path / "data" / "README.md").write_text("x")
    assert [(str(f), n) for f, n, _ in iter_records(tmp_path)] == [("data/2026/10/20261017_report.json", 1)]


def test_index_is_chronological_and_skips_other_versions(tmp_path: Path) -> None:
    append_record(tmp_path, record("2026-11-01T00:00:00Z", consistent=3))
    append_record(tmp_path, record("2026-10-17T13:00:00Z", consistent=2))
    append_record(tmp_path, record("2026-10-17T01:00:00Z", consistent=1))
    append_record(tmp_path, record("2026-10-18T01:00:00Z", schema_version=99))
    index = build_index(tmp_path)
    assert index["schema_version"] == 1
    assert [(run["file"], run["line"], run["checks"]["readme"]["consistent"]) for run in index["runs"]] == [
        ("data/2026/10/20261017_report.json", 2, 1),
        ("data/2026/10/20261017_report.json", 1, 2),
        ("data/2026/11/20261101_report.json", 1, 3),
    ]


def test_write_index(tmp_path: Path) -> None:
    append_record(tmp_path, record("2026-10-17T01:00:00Z"))
    assert write_index(tmp_path) == INDEX_PATH
    text = (tmp_path / INDEX_PATH).read_text()
    assert text.startswith('{\n    "schema_version": 1,')
    assert json.loads(text) == build_index(tmp_path)


def test_empty_data_branch(tmp_path: Path) -> None:
    assert build_index(tmp_path) == {"schema_version": 1, "runs": []}
