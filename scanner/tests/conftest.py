from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from sistence_scanner.discover import API_URL, NotFound

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_ROOT / "schema"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def schema() -> dict[str, Any]:
    return json.loads((SCHEMA_DIR / "config.schema.json").read_text(encoding="utf-8"))


@pytest.fixture
def sistent_report() -> dict[str, Any]:
    """A real ``sistent check --format json`` report: main CodyCBakerPhD/sistent, one satellite unavailable."""
    return json.loads((FIXTURES / "sistent_report.json").read_text(encoding="utf-8"))


def api_repo(full_name: str, *, fork: bool = False, archived: bool = False, private: bool = False) -> dict[str, Any]:
    return {"full_name": full_name, "fork": fork, "archived": archived, "private": private}


class FakeGitHub:
    """Serves ``/orgs/<owner>/repos`` or ``/users/<owner>/repos`` from memory, paginated by ``page_size``."""

    def __init__(
        self,
        orgs: dict[str, list[dict[str, Any]]] | None = None,
        users: dict[str, list[dict[str, Any]]] | None = None,
        page_size: int = 2,
    ) -> None:
        self.orgs = orgs or {}
        self.users = users or {}
        self.page_size = page_size
        self.requested: list[str] = []

    def __call__(self, url: str) -> tuple[Any, dict[str, str]]:
        self.requested.append(url)
        path, _, query = url.removeprefix(API_URL).partition("?")
        _, kind, owner, _ = path.split("/")
        params = dict(item.split("=") for item in query.split("&"))
        source = self.orgs if kind == "orgs" else self.users
        if owner not in source:
            raise NotFound(url)
        page = int(params.get("page", "1"))
        items = source[owner][(page - 1) * self.page_size : page * self.page_size]
        headers: dict[str, str] = {}
        if page * self.page_size < len(source[owner]):
            next_url = f"{API_URL}{path}?{query.split('&page=')[0]}&page={page + 1}"
            headers["Link"] = f'<{next_url}>; rel="next", <{API_URL}{path}?page=99>; rel="last"'
        return items, headers


@pytest.fixture
def fake_github() -> Callable[..., FakeGitHub]:
    return FakeGitHub
