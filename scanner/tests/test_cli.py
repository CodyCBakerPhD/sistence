from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

from sistence_scanner.cli import main, markdown_summary, run_url_from_env
from sistence_scanner.config import ScanConfig
from sistence_scanner.discover import Resolved
from sistence_scanner.record import build_record
from tests.conftest import FIXTURES, FakeGitHub, api_repo


def write_config(path: Path, data: dict[str, Any], *, indent: int = 4) -> Path:
    path.write_text(json.dumps(data, indent=indent) + "\n")
    return path


def test_validate_ok(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = write_config(tmp_path / "config.json", {"organizations": ["o"], "repositories": ["o/a"]})
    assert main(["validate", str(path), "--check-format"]) == 0
    assert "is valid: main o/a" in capsys.readouterr().out


def test_validate_reports_every_problem(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = write_config(tmp_path / "config.json", {"organizations": ["-x"], "repository": ["o/a"]}, indent=2)
    assert main(["validate", str(path), "--check-format"]) == 1
    err = capsys.readouterr().err
    assert "'repository' was unexpected" in err
    assert "/organizations/0" in err
    assert "indent of 4" in err


def test_resolve(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = write_config(tmp_path / "config.json", {"organizations": ["o"], "repositories": ["o/main"]})
    github = FakeGitHub(orgs={"o": [api_repo("o/a"), api_repo("o/f", fork=True)]})
    assert main(["resolve", str(path)], fetch=github) == 0
    assert json.loads(capsys.readouterr().out) == {
        "main": "o/main",
        "repositories": ["o/main", "o/a"],
        "skipped": {"o/f": "fork"},
    }


def test_resolve_unknown_owner(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = write_config(tmp_path / "config.json", {"organizations": ["ghost"], "repositories": ["o/main"]})
    assert main(["resolve", str(path)], fetch=FakeGitHub()) == 1
    assert "'ghost' is neither" in capsys.readouterr().err


def fake_sistent(tmp_path: Path) -> list[str]:
    """Copies the real fixture report to ``--output``, as ``sistent check --format json -o`` would."""
    script = tmp_path / "fake_sistent.py"
    script.write_text(
        "import shutil, sys\n"
        "args = sys.argv[1:]\n"
        f"shutil.copy({str(FIXTURES / 'sistent_report.json')!r}, args[args.index('--output') + 1])\n"
    )
    return [sys.executable, str(script)]


def test_scan_appends_a_record_and_rebuilds_the_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_SERVER_URL", "https://github.com")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/sistence")
    monkeypatch.setenv("GITHUB_RUN_ID", "42")
    config = write_config(tmp_path / "config.json", {"organizations": [], "repositories": ["CodyCBakerPhD/sistent"]})
    data, work, summary = tmp_path / "data-branch", tmp_path / "work", tmp_path / "summary.md"
    args = ["scan", str(config), "--data-dir", str(data), "--work-dir", str(work), "--summary", str(summary)]
    assert main([*args, "--sistent", *fake_sistent(tmp_path)], fetch=FakeGitHub()) == 0
    assert main([*args, "--sistent", *fake_sistent(tmp_path)], fetch=FakeGitHub()) == 0

    lines = (data / "data" / "2026" / "10" / "20261017_report.json").read_text().splitlines()
    assert len(lines) == 2
    record = json.loads(lines[0])
    assert record["_meta"]["run_url"] == "https://github.com/o/sistence/actions/runs/42"
    assert record["_meta"]["main"] == "CodyCBakerPhD/sistent"
    assert 'url = "CodyCBakerPhD/sistent"' in (work / "sistent.toml").read_text()
    index = json.loads((data / "data" / "index.json").read_text())
    assert [run["line"] for run in index["runs"]] == [1, 2]
    assert summary.read_text().count("### Consistency scan") == 2


def test_scan_failure(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    config = write_config(tmp_path / "config.json", {"organizations": [], "repositories": ["o/a"]})
    failing = tmp_path / "fail.py"
    failing.write_text("import sys\nprint('cannot clone main', file=sys.stderr)\nsys.exit(2)\n")
    args = ["scan", str(config), "--data-dir", str(tmp_path / "d"), "--sistent", sys.executable, str(failing)]
    assert main(args, fetch=FakeGitHub()) == 1
    assert "cannot clone main" in capsys.readouterr().err
    assert not (tmp_path / "d" / "data").exists()


def test_index_command(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["index", "--data-dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "data/index.json"
    assert json.loads((tmp_path / "data" / "index.json").read_text()) == {"schema_version": 1, "runs": []}


def test_run_url_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"):
        monkeypatch.delenv(key, raising=False)
    assert run_url_from_env() is None


def test_markdown_summary(sistent_report: dict[str, Any]) -> None:
    config = ScanConfig(organizations=(), repositories=("CodyCBakerPhD/sistent",), main="CodyCBakerPhD/sistent")
    resolved = Resolved(main=config.main, repositories=config.repositories)
    text = markdown_summary(build_record(sistent_report, config=config, resolved=resolved), "data/x.json")
    assert text.startswith("### Consistency scan of 4 repositories against `CodyCBakerPhD/sistent`")
    assert "| `readme` | 0 | 3 | 1 |" in text


def test_module_entry_point(tmp_path: Path) -> None:
    import subprocess

    path = write_config(tmp_path / "config.json", {"organizations": [], "repositories": ["o/a"]})
    result = subprocess.run([sys.executable, "-m", "sistence_scanner", "validate", str(path)], capture_output=True)
    assert result.returncode == 0
