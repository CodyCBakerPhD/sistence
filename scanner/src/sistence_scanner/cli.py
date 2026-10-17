"""``sistence-scan``: validate the configuration, resolve its repositories, scan them and record the result."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from sistence_scanner.config import ConfigError, load_config
from sistence_scanner.discover import Fetch, github_fetch, resolve_repositories
from sistence_scanner.record import build_record, summarize
from sistence_scanner.sistent import DEFAULT_COMMAND, ScanError, run_sistent, sistent_toml
from sistence_scanner.store import append_record, write_index


def run_url_from_env() -> str | None:
    """The URL of the GitHub Actions run this is part of, if any."""
    server, repository, run_id = (
        os.environ.get(k) for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID")
    )
    if server and repository and run_id:
        return f"{server}/{repository}/actions/runs/{run_id}"
    return None


def markdown_summary(record: dict[str, Any], appended: str) -> str:
    """A step summary of one scan: the run, then a table of per-check counts."""
    summary = summarize(record)
    lines = [
        f"### Consistency scan of {summary['repositories']} repositories against `{summary['main']}`",
        "",
        f"Appended to `{appended}` (sistent {summary['sistent_version']}, {summary['timestamp']}); "
        f"{summary['unavailable']} unavailable.",
        "",
        "| Check | Consistent | Inconsistent | Unchecked | Findings | Candidates for main |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for name, counts in summary["checks"].items():
        lines.append(
            f"| `{name}` | {counts['consistent']} | {counts['inconsistent']} | {counts['unchecked']} "
            f"| {counts['findings']} | {counts['candidates']} |"
        )
    return "\n".join(lines) + "\n"


def _cmd_validate(args: argparse.Namespace) -> int:
    config = load_config(args.config, schema_path=args.schema, check_format=args.check_format)
    print(
        f"{args.config} is valid: main {config.main}, {len(config.repositories)} repositories, "
        f"{len(config.organizations)} organizations"
    )
    return 0


def _cmd_resolve(args: argparse.Namespace, fetch: Fetch) -> int:
    config = load_config(args.config, schema_path=args.schema)
    resolved = resolve_repositories(config, fetch)
    print(
        json.dumps(
            {"main": resolved.main, "repositories": list(resolved.repositories), "skipped": resolved.skipped}, indent=4
        )
    )
    return 0


def _cmd_scan(args: argparse.Namespace, fetch: Fetch) -> int:
    config = load_config(args.config, schema_path=args.schema)
    resolved = resolve_repositories(config, fetch)
    print(f"scanning {len(resolved.repositories)} repositories against {resolved.main}", file=sys.stderr)
    work = Path(args.work_dir) if args.work_dir else Path(tempfile.mkdtemp(prefix="sistence-"))
    work.mkdir(parents=True, exist_ok=True)
    toml_path = work / "sistent.toml"
    toml_path.write_text(sistent_toml(resolved.main, resolved.repositories, cache_dir=work / "cache"), encoding="utf-8")
    report = run_sistent(toml_path, work / "report.json", command=args.sistent or DEFAULT_COMMAND)
    record = build_record(report, config=config, resolved=resolved, run_url=run_url_from_env())
    appended = append_record(args.data_dir, record)
    write_index(args.data_dir)
    print(f"appended to {appended}", file=sys.stderr)
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as stream:
            stream.write(markdown_summary(record, str(appended)))
    return 0


def _cmd_index(args: argparse.Namespace) -> int:
    print(write_index(args.data_dir))
    return 0


def build_parser() -> argparse.ArgumentParser:
    """The argument parser of ``sistence-scan``."""
    parser = argparse.ArgumentParser(prog="sistence-scan", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    def add_config(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("config", type=Path, nargs="?", default=Path("config.json"), help="config.json to read")
        sub.add_argument("--schema", type=Path, default=None, help="JSON Schema to validate against")

    validate = commands.add_parser("validate", help="validate config.json against the schema")
    add_config(validate)
    validate.add_argument(
        "--check-format", action="store_true", help="also require pretty-printing with an indent of 4"
    )

    resolve = commands.add_parser("resolve", help="print the repositories a scan would cover")
    add_config(resolve)

    scan = commands.add_parser("scan", help="scan the repositories and append the result to the data branch")
    add_config(scan)
    scan.add_argument("--data-dir", type=Path, required=True, help="checkout of the data branch")
    scan.add_argument("--work-dir", type=Path, default=None, help="where to keep sistent.toml, report and clones")
    scan.add_argument("--summary", type=Path, default=None, help="append a markdown summary to this file")
    scan.add_argument(
        "--sistent", nargs="+", default=None, help="command that runs sistent (default: python -m sistent)"
    )

    index = commands.add_parser("index", help="rebuild data/index.json from the report files")
    index.add_argument("--data-dir", type=Path, required=True, help="checkout of the data branch")
    return parser


def main(argv: Sequence[str] | None = None, *, fetch: Fetch | None = None) -> int:
    """Entry point; returns the exit code (1 for an invalid configuration or a failed scan)."""
    args = build_parser().parse_args(argv)
    fetch = fetch or github_fetch(os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"))
    try:
        if args.command == "validate":
            return _cmd_validate(args)
        if args.command == "resolve":
            return _cmd_resolve(args, fetch)
        if args.command == "scan":
            return _cmd_scan(args, fetch)
        return _cmd_index(args)
    except (ConfigError, ScanError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
