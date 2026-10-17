from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

import pytest

from sistence_scanner.config import ConfigError, ScanConfig
from sistence_scanner.discover import (
    NotFound,
    RemoteRepository,
    github_fetch,
    list_owner_repositories,
    resolve_repositories,
)
from tests.conftest import FakeGitHub, api_repo


def config(**changes: Any) -> ScanConfig:
    values: dict[str, Any] = {"organizations": (), "repositories": ("main/repo",), "main": "main/repo"}
    values.update(changes)
    return ScanConfig(**values)


def test_lists_every_page_of_an_organization(fake_github: Callable[..., FakeGitHub]) -> None:
    github = fake_github(orgs={"org": [api_repo(f"org/r{i}") for i in range(5)]}, page_size=2)
    repos = list_owner_repositories("org", github)
    assert [r.full_name for r in repos] == [f"org/r{i}" for i in range(5)]
    assert len(github.requested) == 3
    assert "type=public" in github.requested[0]


def test_falls_back_to_a_user(fake_github: Callable[..., FakeGitHub]) -> None:
    github = fake_github(users={"someone": [api_repo("someone/tool")]})
    assert list_owner_repositories("someone", github) == [RemoteRepository(full_name="someone/tool")]
    assert "/orgs/someone/" in github.requested[0]
    assert "/users/someone/" in github.requested[1]


def test_unknown_owner_is_a_config_error(fake_github: Callable[..., FakeGitHub]) -> None:
    with pytest.raises(ConfigError, match="'ghost' is neither"):
        list_owner_repositories("ghost", fake_github())


def test_resolution_order_and_filters(fake_github: Callable[..., FakeGitHub]) -> None:
    github = fake_github(
        orgs={
            "org": [
                api_repo("org/zeta"),
                api_repo("org/alpha"),
                api_repo("org/fork", fork=True),
                api_repo("org/old", archived=True),
                api_repo("org/secret", private=True),
                api_repo("org/Listed"),
            ]
        }
    )
    resolved = resolve_repositories(config(organizations=("org",), repositories=("main/repo", "org/listed")), github)
    assert resolved.main == "main/repo"
    assert resolved.repositories == ("main/repo", "org/listed", "org/alpha", "org/zeta")
    assert resolved.skipped == {"org/fork": "fork", "org/old": "archived"}


def test_include_forks_and_archived(fake_github: Callable[..., FakeGitHub]) -> None:
    github = fake_github(orgs={"org": [api_repo("org/fork", fork=True), api_repo("org/old", archived=True)]})
    resolved = resolve_repositories(config(organizations=("org",), include_forks=True, include_archived=True), github)
    assert resolved.repositories == ("main/repo", "org/fork", "org/old")
    assert resolved.skipped == {}


def test_listed_repository_is_never_skipped(fake_github: Callable[..., FakeGitHub]) -> None:
    github = fake_github(orgs={"org": [api_repo("org/fork", fork=True)]})
    resolved = resolve_repositories(config(organizations=("org",), repositories=("main/repo", "org/fork")), github)
    assert resolved.repositories == ("main/repo", "org/fork")
    assert resolved.skipped == {}


def test_main_need_not_be_listed() -> None:
    resolved = resolve_repositories(config(repositories=("a/b",), main="x/main"), FakeGitHub())
    assert resolved.repositories == ("x/main", "a/b")


class _Response(io.BytesIO):
    def __init__(self, body: Any, headers: dict[str, str]) -> None:
        super().__init__(json.dumps(body).encode())
        self.headers = headers


def test_github_fetch_sends_token_and_returns_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[urllib.request.Request] = []

    def urlopen(request: urllib.request.Request, timeout: float) -> _Response:
        seen.append(request)
        return _Response([{"full_name": "a/b"}], {"Link": "x"})

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    body, headers = github_fetch("secret")("https://api.github.com/orgs/a/repos")
    assert body == [{"full_name": "a/b"}]
    assert headers == {"Link": "x"}
    assert seen[0].get_header("Authorization") == "Bearer secret"


def test_github_fetch_without_token(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[urllib.request.Request] = []

    def urlopen(request: urllib.request.Request, timeout: float) -> _Response:
        seen.append(request)
        return _Response([], {})

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    github_fetch(None)("https://api.github.com/orgs/a/repos")
    assert seen[0].get_header("Authorization") is None


@pytest.mark.parametrize(("code", "raised"), [(404, NotFound), (500, urllib.error.HTTPError)])
def test_github_fetch_errors(monkeypatch: pytest.MonkeyPatch, code: int, raised: type[Exception]) -> None:
    def urlopen(request: urllib.request.Request, timeout: float) -> _Response:
        raise urllib.error.HTTPError(request.full_url, code, "error", {}, None)  # type: ignore[arg-type]

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    with pytest.raises(raised):
        github_fetch()("https://api.github.com/orgs/a/repos")
