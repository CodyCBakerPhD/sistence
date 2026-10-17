from __future__ import annotations

import json
import sys
import tomllib
from pathlib import Path

import pytest

from sistence_scanner.sistent import ScanError, run_sistent, sistent_toml


def test_sistent_toml_names_each_repository_by_owner_and_name(tmp_path: Path) -> None:
    text = sistent_toml("org/main", ["org/main", "other/tool"], cache_dir=tmp_path / "cache", jobs=3)
    doc = tomllib.loads(text)
    assert doc["sistent"] == {"main": "org/main", "fail_on": "never", "jobs": 3, "cache_dir": str(tmp_path / "cache")}
    assert doc["repos"] == {"org/main": {"url": "org/main"}, "other/tool": {"url": "other/tool"}}


def test_sistent_toml_without_cache_dir() -> None:
    assert "cache_dir" not in tomllib.loads(sistent_toml("a/b", ["a/b"]))["sistent"]


def fake_sistent(tmp_path: Path, *, code: int, report: dict[str, object] | None) -> list[str]:
    """A stand-in for ``python -m sistent`` that writes ``report`` to ``--output`` and exits with ``code``."""
    script = tmp_path / "fake_sistent.py"
    script.write_text(
        "import json, sys\n"
        "args = sys.argv[1:]\n"
        f"report = {report!r}\n"
        "if report is not None:\n"
        "    open(args[args.index('--output') + 1], 'w').write(json.dumps(report))\n"
        "print('main unavailable', file=sys.stderr)\n"
        f"sys.exit({code})\n"
    )
    return [sys.executable, str(script)]


@pytest.mark.parametrize("code", [0, 1])
def test_run_sistent_returns_the_report(tmp_path: Path, code: int) -> None:
    command = fake_sistent(tmp_path, code=code, report={"schema_version": 1})
    assert run_sistent(tmp_path / "sistent.toml", tmp_path / "report.json", command=command) == {"schema_version": 1}


def test_run_sistent_without_a_report_fails(tmp_path: Path) -> None:
    command = fake_sistent(tmp_path, code=2, report=None)
    with pytest.raises(ScanError, match="exited with 2 without a report: main unavailable"):
        run_sistent(tmp_path / "sistent.toml", tmp_path / "report.json", command=command)


def test_run_sistent_passes_the_report_options(tmp_path: Path) -> None:
    script = tmp_path / "echo.py"
    script.write_text(
        "import json, sys\nargs = sys.argv[1:]\nopen(args[args.index('--output') + 1], 'w').write(json.dumps(args))\n"
    )
    args = run_sistent(tmp_path / "s.toml", tmp_path / "r.json", command=[sys.executable, str(script)])
    assert args[:3] == ["check", "--config", str(tmp_path / "s.toml")]
    assert {"--fail-on", "never", "--allow-unavailable", "--format", "json"} <= set(args)
    assert json.loads((tmp_path / "r.json").read_text()) == args
