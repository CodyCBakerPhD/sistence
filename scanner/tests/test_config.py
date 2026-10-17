from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from sistence_scanner.config import (
    ConfigError,
    ScanConfig,
    default_schema_path,
    formatting_errors,
    load_config,
    loads_config,
    validation_errors,
)
from tests.conftest import SCHEMA_DIR

VALID = sorted((SCHEMA_DIR / "examples" / "valid").glob("*.json"))
INVALID = sorted((SCHEMA_DIR / "examples" / "invalid").glob("*.json"))


def pretty(data: Any) -> str:
    return json.dumps(data, indent=4) + "\n"


def test_examples_exist() -> None:
    assert VALID
    assert INVALID


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.stem)
def test_valid_examples(path: Path, schema: dict[str, Any]) -> None:
    assert validation_errors(json.loads(path.read_text()), schema) == []
    assert formatting_errors(path.read_text()) == []


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.stem)
def test_invalid_examples(path: Path, schema: dict[str, Any]) -> None:
    assert validation_errors(json.loads(path.read_text()), schema) != []


def test_defaults(schema: dict[str, Any]) -> None:
    config = loads_config(pretty({"organizations": ["dandi"], "repositories": ["a/b", "c/d"]}), schema=schema)
    assert config == ScanConfig(
        organizations=("dandi",), repositories=("a/b", "c/d"), main="a/b", include_forks=False, include_archived=False
    )


def test_explicit_main_and_options(schema: dict[str, Any]) -> None:
    text = pretty(
        {
            "organizations": [],
            "repositories": ["a/b"],
            "main": "x/y",
            "include_forks": True,
            "include_archived": True,
        }
    )
    config = loads_config(text, schema=schema)
    assert config.main == "x/y"
    assert config.include_forks
    assert config.include_archived
    assert config.to_dict() == json.loads(text)


def test_misspelled_key_is_reported(schema: dict[str, Any]) -> None:
    with pytest.raises(ConfigError) as info:
        loads_config(pretty({"organizations": [], "repository": ["a/b"]}), schema=schema)
    message = str(info.value)
    assert "'repository' was unexpected" in message
    assert "'repositories' is a required property" in message


def test_error_paths_point_at_the_entry(schema: dict[str, Any]) -> None:
    errors = validation_errors({"organizations": ["ok", "-bad"], "repositories": ["a/b", "nope"]}, schema)
    assert [error.split(":")[0] for error in errors] == ["/organizations/1", "/repositories/1"]


def test_empty_repositories_rejected(schema: dict[str, Any]) -> None:
    errors = validation_errors({"organizations": ["dandi"], "repositories": []}, schema)
    assert errors == ["/repositories: [] should be non-empty"]


def test_invalid_json() -> None:
    with pytest.raises(ConfigError, match="not valid JSON"):
        loads_config("{", schema={})


@pytest.mark.parametrize(
    "text",
    [
        json.dumps({"organizations": [], "repositories": ["a/b"]}),
        json.dumps({"organizations": [], "repositories": ["a/b"]}, indent=2) + "\n",
        json.dumps({"organizations": [], "repositories": ["a/b"]}, indent=4),
    ],
    ids=["compact", "indent-2", "no-final-newline"],
)
def test_formatting_required_when_asked(text: str, schema: dict[str, Any]) -> None:
    assert loads_config(text, schema=schema).main == "a/b"
    with pytest.raises(ConfigError, match="indent of 4"):
        loads_config(text, schema=schema, check_format=True)


def test_formatting_of_invalid_json_is_left_to_the_parser() -> None:
    assert formatting_errors("{") == []


def test_load_config_reads_file(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(pretty({"organizations": [], "repositories": ["a/b"]}))
    assert load_config(path, check_format=True).repositories == ("a/b",)


def test_load_config_missing_file(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="cannot read"):
        load_config(tmp_path / "nope.json")


def test_load_config_missing_schema(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(pretty({"organizations": [], "repositories": ["a/b"]}))
    with pytest.raises(ConfigError, match="configuration schema"):
        load_config(path, schema_path=tmp_path / "missing.schema.json")


def test_default_schema_path_finds_the_checkout() -> None:
    assert default_schema_path() == SCHEMA_DIR / "config.schema.json"


def test_default_schema_path_falls_back_to_cwd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert default_schema_path(Path("/")) == tmp_path / "schema" / "config.schema.json"
