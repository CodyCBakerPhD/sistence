"""Turning a con/sistent JSON report into one ``data`` branch record, and summarizing records for the index.

A record is one JSON object (one line of a report file). Its outer keys are the consistency checks (con/sistent's
aspects), each holding which repositories are consistent, which are not and why, and which could not be checked;
the reserved ``_meta`` key describes the run itself.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from sistence_scanner.config import ScanConfig
from sistence_scanner.discover import Resolved

RECORD_SCHEMA_VERSION = 1
META_KEY = "_meta"
DETAIL_LINES = 40
"""Longest finding detail (a diff, a list) kept in a record, in lines."""

SEVERITIES = ("error", "warning", "info")


def _detail(text: str | None) -> str | None:
    if not text:
        return None
    lines = text.splitlines()
    if len(lines) <= DETAIL_LINES:
        return text
    return "\n".join([*lines[:DETAIL_LINES], f"... ({len(lines) - DETAIL_LINES} more lines)"])


def _finding(finding: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": finding["id"],
        "severity": finding["severity"],
        "kind": finding["kind"],
        "subject": finding["subject"],
        "direction": finding["direction"],
        "locator": finding["locator"],
        "message": finding["message"],
        "detail": _detail(finding.get("detail")),
        "option": finding.get("option"),
    }


def _candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": candidate["kind"],
        "subject": candidate["subject"],
        "locator": candidate["locator"],
        "message": candidate["message"],
        "repositories": list(candidate["repos"]),
        "support": candidate["support"],
        "total": candidate["total"],
    }


def _check(
    aspect: dict[str, Any],
    report: dict[str, Any],
    order: list[str],
    unavailable: dict[str, str],
) -> dict[str, Any]:
    name = aspect["name"]
    main = report["main"]["name"]
    targets = {main, *aspect["targets"]}
    errors: dict[str, list[str]] = defaultdict(list)
    main_unreadable: list[str] = []
    for error in report["errors"]:
        if error.get("aspect") != name or not error.get("repo"):
            continue
        errors[error["repo"]].append(error["message"])
        if error["repo"] == main and error["stage"] == "extract":
            main_unreadable.append(error["message"])
    # con/sistent skips a check for everyone when it cannot read main for it: there is nothing to compare against.
    skipped_reason = "; ".join(main_unreadable) or None

    findings: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for finding in report["findings"]:
        if finding["aspect"] != name or finding["suppressed"] or finding["baselined"]:
            continue
        if finding["direction"] == "upstream":
            continue  # a candidate for main, aggregated below, rather than drift of this repository
        findings[finding["repo"]].append(_finding(finding))

    consistent: list[str] = []
    inconsistent: dict[str, list[dict[str, Any]]] = {}
    unchecked: dict[str, str] = {}
    for repo in order:
        if repo in unavailable:
            unchecked[repo] = f"unavailable: {unavailable[repo]}"
        elif skipped_reason is not None:
            unchecked[repo] = f"main could not be checked: {skipped_reason}"
        elif repo not in targets:
            unchecked[repo] = "not targeted by this check"
        elif errors.get(repo):
            unchecked[repo] = "; ".join(errors[repo])
        elif findings.get(repo):
            inconsistent[repo] = findings[repo]
        else:
            consistent.append(repo)

    return {
        "consistent": consistent,
        "inconsistent": inconsistent,
        "unchecked": unchecked,
        "candidates": [_candidate(c) for c in report["candidates"] if c["aspect"] == name],
    }


def build_record(
    report: dict[str, Any],
    *,
    config: ScanConfig,
    resolved: Resolved,
    run_url: str | None = None,
) -> dict[str, Any]:
    """The record of one scan: ``_meta``, then one entry per check in con/sistent's order."""
    statuses = [report["main"], *report["repos"]]
    order = [status["name"] for status in statuses]
    unavailable = {s["name"]: s.get("error") or "unavailable" for s in statuses if s["status"] != "ok"}
    record: dict[str, Any] = {
        META_KEY: {
            "schema_version": RECORD_SCHEMA_VERSION,
            "timestamp": report["generated_at"],
            "sistent_version": report["sistent_version"],
            "main": report["main"]["name"],
            "config": config.to_dict(),
            "repositories": {
                status["name"]: {
                    "status": status["status"],
                    "head": status.get("head"),
                    "error": status.get("error"),
                }
                for status in statuses
            },
            "skipped": dict(resolved.skipped),
            "errors": [
                {"stage": e["stage"], "repository": e.get("repo"), "message": e["message"]}
                for e in report["errors"]
                if not e.get("aspect")
            ],
            "run_url": run_url,
        }
    }
    for aspect in report["aspects"]:
        record[aspect["name"]] = _check(aspect, report, order, unavailable)
    return record


def checks(record: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The consistency checks of a record, without ``_meta``."""
    return {name: value for name, value in record.items() if name != META_KEY}


def worst_severity(findings: list[dict[str, Any]]) -> str:
    """The most severe of ``findings``' severities."""
    present = {f["severity"] for f in findings}
    return next((severity for severity in SEVERITIES if severity in present), "info")


def summarize(record: dict[str, Any]) -> dict[str, Any]:
    """Per-check counts of a record, as kept in the index: enough to chart a run without fetching it."""
    meta = record[META_KEY]
    summary: dict[str, Any] = {}
    for name, check in checks(record).items():
        by_severity = dict.fromkeys(SEVERITIES, 0)
        for findings in check["inconsistent"].values():
            by_severity[worst_severity(findings)] += 1
        summary[name] = {
            "consistent": len(check["consistent"]),
            "inconsistent": len(check["inconsistent"]),
            "unchecked": len(check["unchecked"]),
            **by_severity,
            "findings": sum(len(findings) for findings in check["inconsistent"].values()),
            "candidates": len(check["candidates"]),
        }
    repositories = meta["repositories"]
    return {
        "timestamp": meta["timestamp"],
        "main": meta["main"],
        "sistent_version": meta["sistent_version"],
        "repositories": len(repositories),
        "unavailable": sum(1 for status in repositories.values() if status["status"] != "ok"),
        "checks": summary,
    }
