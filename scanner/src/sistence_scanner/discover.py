"""Which repositories a configuration names: its listed ones, and the public ones of each organization."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from typing import Any

from sistence_scanner.config import ConfigError, ScanConfig

API_URL = "https://api.github.com"
PER_PAGE = 100

_NEXT_LINK = re.compile(r'<([^>]+)>;\s*rel="next"')


class NotFound(Exception):
    """The GitHub API answered 404."""


Fetch = Callable[[str], tuple[Any, dict[str, str]]]
"""Fetches a GitHub API URL, returning its decoded JSON body and its headers; raises :class:`NotFound` on a 404."""


@dataclass(frozen=True, kw_only=True)
class RemoteRepository:
    """What the scan needs to know about one repository of an organization."""

    full_name: str
    fork: bool = False
    archived: bool = False
    private: bool = False

    @classmethod
    def from_api(cls, item: dict[str, Any]) -> RemoteRepository:
        return cls(
            full_name=str(item["full_name"]),
            fork=bool(item.get("fork")),
            archived=bool(item.get("archived")),
            private=bool(item.get("private")),
        )


@dataclass(frozen=True, kw_only=True)
class Resolved:
    """The repositories one scan covers."""

    main: str
    repositories: tuple[str, ...]
    """Every repository to scan, ``main`` first, each once (compared case-insensitively, as GitHub does)."""
    skipped: dict[str, str] = field(default_factory=dict)
    """Repositories of an organization left out, and why (``fork``, ``archived``)."""


def github_fetch(token: str | None = None, *, timeout: float = 30) -> Fetch:
    """A :data:`Fetch` over the GitHub REST API, authenticated when ``token`` is given."""

    def fetch(url: str) -> tuple[Any, dict[str, str]]:
        request = urllib.request.Request(url)
        request.add_header("Accept", "application/vnd.github+json")
        request.add_header("X-GitHub-Api-Version", "2022-11-28")
        request.add_header("User-Agent", "sistence-scanner")
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
                return body, dict(response.headers.items())
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise NotFound(url) from None
            raise

    return fetch


def _pages(url: str, fetch: Fetch) -> Iterator[dict[str, Any]]:
    next_url: str | None = url
    while next_url:
        body, headers = fetch(next_url)
        yield from body
        links = {key.lower(): value for key, value in headers.items()}.get("link", "")
        match = _NEXT_LINK.search(links)
        next_url = match.group(1) if match else None


def list_owner_repositories(owner: str, fetch: Fetch) -> list[RemoteRepository]:
    """Every public repository of ``owner``, an organization or (failing that) a user."""
    try:
        items = list(_pages(f"{API_URL}/orgs/{owner}/repos?type=public&per_page={PER_PAGE}", fetch))
    except NotFound:
        try:
            items = list(_pages(f"{API_URL}/users/{owner}/repos?type=owner&per_page={PER_PAGE}", fetch))
        except NotFound:
            raise ConfigError(f"organizations: {owner!r} is neither a GitHub organization nor a user") from None
    return [RemoteRepository.from_api(item) for item in items]


def _unique(names: Iterable[str]) -> tuple[str, ...]:
    seen: dict[str, str] = {}
    for name in names:
        seen.setdefault(name.casefold(), name)
    return tuple(seen.values())


def resolve_repositories(config: ScanConfig, fetch: Fetch) -> Resolved:
    """``main``, then the listed repositories, then each organization's (sorted), minus skipped forks and archives."""
    discovered: list[str] = []
    skipped: dict[str, str] = {}
    for owner in config.organizations:
        for repo in sorted(list_owner_repositories(owner, fetch), key=lambda r: r.full_name.casefold()):
            if repo.private:
                continue
            if repo.fork and not config.include_forks:
                skipped[repo.full_name] = "fork"
            elif repo.archived and not config.include_archived:
                skipped[repo.full_name] = "archived"
            else:
                discovered.append(repo.full_name)
    repositories = _unique([config.main, *config.repositories, *discovered])
    listed = {name.casefold() for name in repositories}
    skipped = {name: why for name, why in skipped.items() if name.casefold() not in listed}
    return Resolved(main=repositories[0], repositories=repositories, skipped=skipped)
