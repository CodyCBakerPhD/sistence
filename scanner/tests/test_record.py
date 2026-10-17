from __future__ import annotations

from typing import Any

import pytest

from sistence_scanner.config import ScanConfig
from sistence_scanner.discover import Resolved
from sistence_scanner.record import DETAIL_LINES, META_KEY, build_record, checks, summarize, worst_severity

CONFIG = ScanConfig(organizations=("o",), repositories=("o/main",), main="o/main")
RESOLVED = Resolved(main="o/main", repositories=("o/main", "o/a", "o/b"), skipped={"o/fork": "fork"})


def status(name: str, *, ok: bool = True) -> dict[str, Any]:
    return {
        "name": name,
        "status": "ok" if ok else "unavailable",
        "head": "abc" if ok else None,
        "error": None if ok else "clone failed",
    }


def finding(repo: str, aspect: str = "readme", **changes: Any) -> dict[str, Any]:
    values = {
        "id": f"{repo}-{aspect}",
        "aspect": aspect,
        "repo": repo,
        "kind": "missing",
        "subject": "section",
        "severity": "warning",
        "direction": "downstream",
        "locator": "README.md#Usage",
        "message": "section missing: Usage",
        "detail": None,
        "option": None,
        "suppressed": False,
        "baselined": False,
    }
    values.update(changes)
    return values


def report(**changes: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "generated_at": "2026-10-17T12:00:00Z",
        "sistent_version": "0.1.0",
        "main": status("o/main"),
        "repos": [status("o/a"), status("o/b")],
        "aspects": [{"name": "readme", "targets": ["o/a", "o/b"]}, {"name": "layout", "targets": ["o/a", "o/b"]}],
        "findings": [],
        "candidates": [],
        "errors": [],
    }
    values.update(changes)
    return values


def test_outer_keys_are_meta_then_checks_in_sistent_order() -> None:
    record = build_record(report(), config=CONFIG, resolved=RESOLVED, run_url="https://example.org/run")
    assert list(record) == [META_KEY, "readme", "layout"]
    meta = record[META_KEY]
    assert meta["timestamp"] == "2026-10-17T12:00:00Z"
    assert meta["main"] == "o/main"
    assert meta["skipped"] == {"o/fork": "fork"}
    assert meta["run_url"] == "https://example.org/run"
    assert meta["config"] == CONFIG.to_dict()
    assert list(meta["repositories"]) == ["o/main", "o/a", "o/b"]


def test_clean_run_is_consistent_everywhere() -> None:
    record = build_record(report(), config=CONFIG, resolved=RESOLVED)
    assert record["readme"] == {
        "consistent": ["o/main", "o/a", "o/b"],
        "inconsistent": {},
        "unchecked": {},
        "candidates": [],
    }


def test_findings_make_a_repository_inconsistent() -> None:
    findings = [
        finding("o/a", detail="line\n" * (DETAIL_LINES + 5), option="aspects.readme.x=1"),
        finding("o/a", severity="error", locator="README.md#License"),
        finding("o/b", aspect="layout"),
    ]
    record = build_record(report(findings=findings), config=CONFIG, resolved=RESOLVED)
    readme = record["readme"]
    assert readme["consistent"] == ["o/main", "o/b"]
    assert list(readme["inconsistent"]) == ["o/a"]
    first, second = readme["inconsistent"]["o/a"]
    assert set(first) == {"id", "severity", "kind", "subject", "direction", "locator", "message", "detail", "option"}
    assert first["option"] == "aspects.readme.x=1"
    assert first["detail"].splitlines()[-1] == "... (5 more lines)"
    assert len(first["detail"].splitlines()) == DETAIL_LINES + 1
    assert second["severity"] == "error"
    assert record["layout"]["consistent"] == ["o/main", "o/a"]


def test_upstream_suppressed_and_baselined_findings_are_not_drift() -> None:
    findings = [
        finding("o/a", direction="upstream"),
        finding("o/a", suppressed=True),
        finding("o/b", baselined=True),
    ]
    candidates = [
        {
            "aspect": "readme",
            "kind": "extra",
            "subject": "section",
            "locator": "README.md#Extra",
            "message": "section only in repo: Extra",
            "repos": ["o/a"],
            "support": 1,
            "total": 2,
        },
        {
            "aspect": "layout",
            "kind": "extra",
            "subject": "path",
            "locator": "x",
            "message": "m",
            "repos": ["o/b"],
            "support": 1,
            "total": 2,
        },
    ]
    record = build_record(report(findings=findings, candidates=candidates), config=CONFIG, resolved=RESOLVED)
    assert record["readme"]["consistent"] == ["o/main", "o/a", "o/b"]
    assert record["readme"]["candidates"] == [
        {
            "kind": "extra",
            "subject": "section",
            "locator": "README.md#Extra",
            "message": "section only in repo: Extra",
            "repositories": ["o/a"],
            "support": 1,
            "total": 2,
        }
    ]
    assert len(record["layout"]["candidates"]) == 1


def test_unavailable_repository_is_unchecked_everywhere() -> None:
    record = build_record(report(repos=[status("o/a"), status("o/b", ok=False)]), config=CONFIG, resolved=RESOLVED)
    for check in checks(record).values():
        assert check["unchecked"] == {"o/b": "unavailable: clone failed"}
    assert record[META_KEY]["repositories"]["o/b"]["status"] == "unavailable"


def test_unreadable_main_skips_the_check_for_everyone() -> None:
    errors = [{"stage": "extract", "repo": "o/main", "aspect": "readme", "message": "ValueError: boom"}]
    record = build_record(report(errors=errors), config=CONFIG, resolved=RESOLVED)
    assert record["readme"]["consistent"] == []
    assert set(record["readme"]["unchecked"].values()) == {"main could not be checked: ValueError: boom"}
    assert record["layout"]["consistent"] == ["o/main", "o/a", "o/b"]


def test_errors_of_one_repository() -> None:
    errors = [
        {"stage": "compare", "repo": "o/a", "aspect": "readme", "message": "snapshot mismatch"},
        {"stage": "resolve", "repo": "o/b", "aspect": None, "message": "unavailable"},
    ]
    record = build_record(report(errors=errors), config=CONFIG, resolved=RESOLVED)
    assert record["readme"]["unchecked"] == {"o/a": "snapshot mismatch"}
    assert record[META_KEY]["errors"] == [{"stage": "resolve", "repository": "o/b", "message": "unavailable"}]


def test_untargeted_repository_is_unchecked() -> None:
    aspects = [{"name": "readme", "targets": ["o/a"]}]
    record = build_record(report(aspects=aspects), config=CONFIG, resolved=RESOLVED)
    assert record["readme"]["unchecked"] == {"o/b": "not targeted by this check"}


@pytest.mark.parametrize(
    ("severities", "worst"),
    [(["info", "error", "warning"], "error"), (["info", "warning"], "warning"), (["info"], "info"), ([], "info")],
)
def test_worst_severity(severities: list[str], worst: str) -> None:
    assert worst_severity([{"severity": s} for s in severities]) == worst


def test_summarize_counts_repositories_by_worst_severity() -> None:
    findings = [finding("o/a", severity="error"), finding("o/a"), finding("o/b", severity="info")]
    record = build_record(
        report(findings=findings, repos=[status("o/a"), status("o/b"), status("o/c", ok=False)]),
        config=CONFIG,
        resolved=RESOLVED,
    )
    summary = summarize(record)
    assert summary["repositories"] == 4
    assert summary["unavailable"] == 1
    assert summary["checks"]["readme"] == {
        "consistent": 1,
        "inconsistent": 2,
        "unchecked": 1,
        "error": 1,
        "warning": 0,
        "info": 1,
        "findings": 3,
        "candidates": 0,
    }


def test_real_report(sistent_report: dict[str, Any]) -> None:
    record = build_record(sistent_report, config=CONFIG, resolved=RESOLVED)
    names = [aspect["name"] for aspect in sistent_report["aspects"]]
    assert list(record) == [META_KEY, *names]
    every = set(record[META_KEY]["repositories"])
    for check in checks(record).values():
        # every repository lands in exactly one of the three groups
        groups = [set(check["consistent"]), set(check["inconsistent"]), set(check["unchecked"])]
        assert set().union(*groups) == every
        assert sum(len(g) for g in groups) == len(every)
        assert list(check["unchecked"]) == ["CodyCBakerPhD/does-not-exist-xyz"]
        assert check["unchecked"]["CodyCBakerPhD/does-not-exist-xyz"].startswith("unavailable: ")
    assert summarize(record)["unavailable"] == 1
