"""``config.json``: the record kept on the ``config`` branch, validated against ``schema/config.schema.json``.

The JSON Schema is generated from the LinkML schema beside it (``schema/config.yaml``), which is the source of truth;
validating against the export keeps LinkML out of the scan's own dependencies.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jsonschema

SCHEMA_RELATIVE_PATH = Path("schema") / "config.schema.json"
INDENT = 4


class ConfigError(Exception):
    """``config.json`` cannot be read, is not valid against the schema, or is not formatted as required."""

    def __init__(self, message: str, problems: Sequence[str] = ()) -> None:
        super().__init__(message)
        self.message = message
        self.problems = tuple(problems)

    def __str__(self) -> str:
        return "\n".join([self.message, *(f"  - {problem}" for problem in self.problems)])


@dataclass(frozen=True, kw_only=True)
class ScanConfig:
    """A validated ``config.json`` with its defaults applied."""

    organizations: tuple[str, ...]
    repositories: tuple[str, ...]
    main: str
    """The repository every other one is compared against: ``main`` if given, else the first of ``repositories``."""
    include_forks: bool = False
    include_archived: bool = False

    def to_dict(self) -> dict[str, Any]:
        """The configuration as it was applied, defaults included."""
        return {
            "organizations": list(self.organizations),
            "repositories": list(self.repositories),
            "main": self.main,
            "include_forks": self.include_forks,
            "include_archived": self.include_archived,
        }


def default_schema_path(start: Path | None = None) -> Path:
    """``schema/config.schema.json`` of the checkout this package runs from, else of the working directory."""
    here = (start or Path(__file__)).resolve()
    for directory in here.parents:
        candidate = directory / SCHEMA_RELATIVE_PATH
        if candidate.is_file():
            return candidate
    return Path.cwd() / SCHEMA_RELATIVE_PATH


def load_schema(path: Path | None = None) -> dict[str, Any]:
    """Read the JSON Schema export of the configuration schema."""
    path = path or default_schema_path()
    try:
        schema: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ConfigError(f"cannot read the configuration schema {path}: {exc.strerror or exc}") from None
    return schema


def validation_errors(instance: Any, schema: dict[str, Any]) -> list[str]:
    """Every way ``instance`` violates ``schema``, as ``<json pointer>: <message>`` lines in document order."""
    validator_cls = jsonschema.validators.validator_for(schema)
    validator = validator_cls(schema)
    errors = sorted(validator.iter_errors(instance), key=lambda error: [str(p) for p in error.absolute_path])
    return [f"/{'/'.join(str(p) for p in error.absolute_path)}: {error.message}" for error in errors]


def formatting_errors(text: str) -> list[str]:
    """Whether ``text`` is pretty-printed with an indent of four spaces and ends in a single newline."""
    try:
        expected = json.dumps(json.loads(text), indent=INDENT, ensure_ascii=False) + "\n"
    except json.JSONDecodeError:
        return []  # reported as a parse error instead
    if text == expected:
        return []
    return [f"not pretty-printed with an indent of {INDENT} (expected the output of json.dumps(..., indent={INDENT}))"]


def parse_config(data: dict[str, Any]) -> ScanConfig:
    """Apply the defaults to an already validated configuration."""
    repositories = tuple(data["repositories"])
    return ScanConfig(
        organizations=tuple(data["organizations"]),
        repositories=repositories,
        main=data.get("main") or repositories[0],
        include_forks=bool(data.get("include_forks") or False),
        include_archived=bool(data.get("include_archived") or False),
    )


def loads_config(
    text: str, *, schema: dict[str, Any], check_format: bool = False, source: str = "config.json"
) -> ScanConfig:
    """Parse, validate and resolve the configuration ``text``; ``source`` names it in error messages."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{source} is not valid JSON: {exc}") from None
    problems = validation_errors(data, schema)
    if check_format:
        problems.extend(formatting_errors(text))
    if problems:
        raise ConfigError(f"{source} is not a valid configuration:", problems)
    return parse_config(data)


def load_config(path: Path, *, schema_path: Path | None = None, check_format: bool = False) -> ScanConfig:
    """Read, validate and resolve the configuration file at ``path``."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError(f"cannot read {path}: {exc.strerror or exc}") from None
    return loads_config(text, schema=load_schema(schema_path), check_format=check_format, source=str(path))
