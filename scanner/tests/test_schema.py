"""The LinkML schema is the source of truth: its JSON Schema export must be current, and LinkML must agree with it."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.conftest import SCHEMA_DIR

pytestmark = pytest.mark.linkml

linkml_generators = pytest.importorskip("linkml.generators.jsonschemagen")
linkml_validator = pytest.importorskip("linkml.validator")


def test_json_schema_export_is_current() -> None:
    generated = linkml_generators.JsonSchemaGenerator(str(SCHEMA_DIR / "config.yaml")).serialize()
    committed = (SCHEMA_DIR / "config.schema.json").read_text(encoding="utf-8")
    assert json.loads(generated) == json.loads(committed), (
        "schema/config.schema.json is out of date; regenerate it with "
        "`gen-json-schema schema/config.yaml > schema/config.schema.json`"
    )


@pytest.mark.parametrize("path", sorted((SCHEMA_DIR / "examples" / "valid").glob("*.json")), ids=lambda p: p.stem)
def test_linkml_accepts_valid_examples(path: Path) -> None:
    report = linkml_validator.validate(json.loads(path.read_text()), str(SCHEMA_DIR / "config.yaml"), "Config")
    assert report.results == []


@pytest.mark.parametrize("path", sorted((SCHEMA_DIR / "examples" / "invalid").glob("*.json")), ids=lambda p: p.stem)
def test_linkml_rejects_invalid_examples(path: Path) -> None:
    report = linkml_validator.validate(json.loads(path.read_text()), str(SCHEMA_DIR / "config.yaml"), "Config")
    assert report.results != []
