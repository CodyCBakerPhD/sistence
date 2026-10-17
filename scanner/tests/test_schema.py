"""The LinkML schema is the source of truth: its JSON Schema export must be current, and LinkML must agree with it."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.conftest import SCHEMA_DIR

pytestmark = pytest.mark.linkml

linkml_generators = pytest.importorskip("linkml.generators.jsonschemagen")
linkml_validator = pytest.importorskip("linkml.validator")
linkml_cli = pytest.importorskip("linkml.validator.cli")
click_testing = pytest.importorskip("click.testing")

VALID = sorted((SCHEMA_DIR / "examples" / "valid").glob("*.json"))
INVALID = sorted((SCHEMA_DIR / "examples" / "invalid").glob("*.json"))


def run_cli(path: Path) -> int:
    """``linkml-validate``, as the Validate config workflow runs it; its loader reads files differently from the API."""
    args = ["--schema", str(SCHEMA_DIR / "config.yaml"), "--target-class", "Config", str(path)]
    exit_code: int = click_testing.CliRunner().invoke(linkml_cli.cli, args).exit_code
    return exit_code


def test_json_schema_export_is_current() -> None:
    generated = linkml_generators.JsonSchemaGenerator(str(SCHEMA_DIR / "config.yaml")).serialize()
    committed = (SCHEMA_DIR / "config.schema.json").read_text(encoding="utf-8")
    assert json.loads(generated) == json.loads(committed), (
        "schema/config.schema.json is out of date; regenerate it with "
        "`gen-json-schema schema/config.yaml > schema/config.schema.json`"
    )


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.stem)
def test_linkml_accepts_valid_examples(path: Path) -> None:
    report = linkml_validator.validate(json.loads(path.read_text()), str(SCHEMA_DIR / "config.yaml"), "Config")
    assert report.results == []


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.stem)
def test_linkml_rejects_invalid_examples(path: Path) -> None:
    report = linkml_validator.validate(json.loads(path.read_text()), str(SCHEMA_DIR / "config.yaml"), "Config")
    assert report.results != []


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.stem)
def test_linkml_cli_accepts_valid_examples(path: Path) -> None:
    assert run_cli(path) == 0


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.stem)
def test_linkml_cli_rejects_invalid_examples(path: Path) -> None:
    assert run_cli(path) != 0
