<div align="center">
  <picture>
    <img alt="sistence logo" src="src/assets/sistence-logo.svg" width="96">
  </picture>

  <h1 align="center">sistence</h1>

  <p align="center">
    <a href="https://github.com/CodyCBakerPhD/sistence/actions/workflows/daily-tests.yml"><img src="https://github.com/CodyCBakerPhD/sistence/actions/workflows/daily-tests.yml/badge.svg" alt="Daily tests"></a>
    <a href="https://github.com/CodyCBakerPhD/sistence/actions/workflows/validate-config.yml"><img src="https://github.com/CodyCBakerPhD/sistence/actions/workflows/validate-config.yml/badge.svg" alt="Validate config"></a>
    <a href="https://codecov.io/github/CodyCBakerPhD/sistence"><img src="https://codecov.io/github/CodyCBakerPhD/sistence/coverage.svg?branch=main" alt="codecov"></a>
    <a href="https://github.com/CodyCBakerPhD/sistence/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-BSD--3--Clause-blue.svg" alt="License: BSD-3-Clause"></a>
  </p>
  <p align="center">
    <a href="https://www.chromatic.com"><img src="https://img.shields.io/badge/Chromatic-FC521F?logo=chromatic&logoColor=white" alt="Chromatic"></a>
    <a href="https://storybook.js.org"><img src="https://img.shields.io/badge/Storybook-FF4785?logo=storybook&logoColor=white" alt="Storybook"></a>
    <a href="https://playwright.dev"><img src="https://img.shields.io/badge/Playwright-2d2d2d?style=flat&logo=playwright&logoColor=2EAD33" alt="Playwright"></a>
    <a href="https://linkml.io"><img src="https://img.shields.io/badge/schema-LinkML-1f6feb.svg" alt="LinkML"></a>
  </p>
  <p align="center">
    <a href="https://github.com/prettier/prettier"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat" alt="code style: prettier"></a>
    <a href="https://github.com/astral-sh/ruff"><img src="https://img.shields.io/badge/code_style-ruff-261230.svg?style=flat" alt="code style: ruff"></a>
  </p>
</div>

The dashboard summarizing our [con/sistent](https://github.com/CodyCBakerPhD/sistent) reports over time: how
consistent a fleet of repositories is with one main repository, check by check, scan after scan.

Main webpage: https://codycbakerphd.github.io/sistence/

## How it fits together

The repository keeps three branches that share no history:

| Branch   | Holds                                                                               | Written by                                      |
| -------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| `main`   | The page, the configuration schema, the scanner and every workflow                  | Pull requests                                   |
| `config` | `config.json`, and nothing else: which repositories to scan                         | Pull requests, validated against the schema     |
| `data`   | `data/%Y/%m/%Y%m%d_report.json`, one line per scan, and the index `data/index.json` | The [Scan](.github/workflows/scan.yml) workflow |

A scan (run by hand from the Actions tab) reads `config.json`, lists the repositories it names, runs `sistent check`
over all of them against the main one, and appends the result to the `data` branch. The page, published from `main`
to GitHub Pages, reads the `data` branch straight from `raw.githubusercontent.com`, so a new scan shows up without
a redeploy.

## Configuration: the `config` branch

`config.json` is a single JSON object, pretty-printed with an indent of four spaces:

```json
{
    "organizations": ["catalystneuro"],
    "repositories": ["catalystneuro/neuroconv", "SpikeInterface/spikeinterface"],
    "include_forks": false
}
```

| Key                | Required | Meaning                                                                                                                                                                               |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`    | no       | GitHub organizations (or users) whose public repositories are all scanned. Empty or absent means none.                                                                                |
| `repositories`     | yes      | Individual repositories, each as `owner/name` so that it is never ambiguous which one is meant. At least one. A repository listed here is scanned even when it is a fork or archived. |
| `main`             | no       | The repository (`owner/name`) every other one is compared against. Defaults to the first entry of `repositories`. It is scanned whether or not it is listed anywhere else.            |
| `include_forks`    | no       | Also scan the forks an organization owns. Default `false`.                                                                                                                            |
| `include_archived` | no       | Also scan an organization's archived repositories. Default `false`.                                                                                                                   |

Any other key is an error, so a misspelling (`"repository"`) is caught rather than ignored.

The schema is written in [LinkML](https://linkml.io) at [`schema/config.yaml`](schema/config.yaml), with its JSON
Schema export beside it at [`schema/config.schema.json`](schema/config.schema.json) (regenerate it with
`gen-json-schema schema/config.yaml > schema/config.schema.json`; CI fails when it is out of date).
[`schema/examples/`](schema/examples) holds instances it accepts and rejects.

To change what is scanned, open a pull request against `config`. The
[Validate config](.github/workflows/validate-config.yml) workflow checks that the branch holds `config.json` alone,
that it is valid against both the LinkML schema and its export, and that it is formatted as above. It also
re-validates the current `config.json` whenever a pull request changes the schema, weekly, and on demand.

## Scan results: the `data` branch

Each scan appends one line to the report file of the day it ran, `data/%Y/%m/%Y%m%d_report.json` (so a file holds
[JSON Lines](https://jsonlines.org), one record per scan of that day). The outer keys of a record are the
consistency checks — con/sistent's aspects — plus one reserved `_meta` key describing the run:

```json
{
    "_meta": {
        "schema_version": 1,
        "timestamp": "2026-10-17T02:13:45Z",
        "sistent_version": "0.1.0",
        "main": "CodyCBakerPhD/sistent",
        "config": {
            "organizations": [],
            "repositories": ["..."],
            "main": "CodyCBakerPhD/sistent",
            "include_forks": false,
            "include_archived": false
        },
        "repositories": { "dandi/usage-page": { "status": "ok", "head": "7035628...", "error": null } },
        "skipped": { "someorg/a-fork": "fork" },
        "errors": [],
        "run_url": "https://github.com/CodyCBakerPhD/sistence/actions/runs/..."
    },
    "readme": {
        "consistent": ["CodyCBakerPhD/sistent"],
        "inconsistent": {
            "dandi/usage-page": [
                {
                    "id": "3f1c2a9b0d4e",
                    "severity": "warning",
                    "kind": "missing",
                    "subject": "section",
                    "direction": "downstream",
                    "locator": "README.md#Installation",
                    "message": "section missing: Installation",
                    "detail": null,
                    "option": null
                }
            ]
        },
        "unchecked": { "someorg/gone": "unavailable: git fetch of HEAD failed" },
        "candidates": [
            {
                "kind": "extra",
                "subject": "section",
                "locator": "README.md#Development",
                "message": "section only in repo: Development",
                "repositories": ["dandi/usage-page"],
                "support": 1,
                "total": 2
            }
        ]
    }
}
```

In every check, each scanned repository is in exactly one of `consistent`, `inconsistent` (with its findings: the
reasons and values of the inconsistency) or `unchecked` (with why: unavailable, or main could not be read for that
check). `candidates` are things some repositories have that main lacks — improvements that may percolate back into
main, which never count as inconsistencies. A finding's `id` is stable across scans.

`data/index.json` lists every run with its per-check counts, so the page can draw the history without fetching every
report file; the scan rebuilds it from the report files each time.

## Running a scan

From the Actions tab, run the **Scan** workflow. Its one input is the pip requirement con/sistent is installed from
(by default its `main` branch). The first scan creates the `data` branch.

Locally, with checkouts of the `config` and `data` branches beside this one:

```bash
pip install -e scanner "sistent @ git+https://github.com/CodyCBakerPhD/sistent@main"
sistence-scan validate ../config/config.json --check-format
sistence-scan resolve ../config/config.json   # the repositories a scan would cover
GITHUB_TOKEN=... sistence-scan scan ../config/config.json --data-dir ../data
```

## The page

The page shows, for the run selected at the top (the latest by default):

- the headline numbers — the share of repository checks consistent with main, how many repositories pass every
  check, the findings by severity — and their change since the previous run;
- **Consistency over time**: every run as a stacked bar of consistent, inconsistent (by worst severity) and
  unchecked repository checks, as counts or shares;
- **Checks in this run**: the same breakdown per check;
- **Repositories**: a repository × check matrix, where selecting a cell lists its findings;
- **Findings** and **Candidates for main**.

The check selector scopes everything to one check. Every chart has a table view, and every view is reflected in the
URL, so it can be linked to.

When published on `<owner>.github.io/<repo>/`, the page reads the `data` branch of `<owner>/<repo>`; anywhere else it
reads the `DEFAULT_BASE_URL` constant at the top of [`src/data.ts`](src/data.ts).

## Development

```bash
npm install
npm run dev
```

### Tests

```bash
npm test                   # unit tests (Vitest, in jsdom)
npm run test:coverage      # the same, with a coverage report
npm run test:e2e           # integration tests (Playwright, in Chromium)
npm run test:visual        # screenshot comparison of the page's sections against committed baselines
npm run test:chromatic     # the snapshots archived for Chromatic
npm run storybook          # the page's sections in Storybook
```

The unit tests cover the page's entry module (`src/main.ts`) as well as its helpers: `tests/unit/main-harness.ts`
loads the page's markup into jsdom, stands in for Plotly and for the network, and drives the page through its
controls. Every suite reads the same fixture `data` branch, `tests/fixtures/mock-data.js`, generated from a real
`sistent check` report by the scanner's own code (`python tests/fixtures/generate_mock_data.py`). Coverage from both
the unit and the integration tests is reported to Codecov; to see what the integration tests exercise in the
browser, run `npm run test:e2e:coverage` and then `npm run coverage:integration`.

The scanner has its own suite:

```bash
cd scanner
pip install -e ".[dev,schema]"
ruff check . && ruff format --check . && mypy && pytest
```

## Setting up a copy of this repository

- **Pages**: after the first push to `main` has created the `gh-pages` branch, set _Settings → Pages_ to deploy from
  the `gh-pages` branch. Pull requests get a preview under `pr-preview/`.
- **The `config` branch**: create it with only `config.json` on it, and protect it so that changes go through a pull
  request with the _Validate config.json_ check.
- **Secrets** (all optional): `CODECOV_TOKEN`; `CHROMATIC_STORYBOOK_PROJECT_TOKEN` and
  `CHROMATIC_PLAYWRIGHT_PROJECT_TOKEN` for the Chromatic uploads; `MAIL_USERNAME` and `MAIL_PASSWORD` (and the
  `NOTIFY_EMAIL` variable) for the failure emails of the daily and weekly runs.
- **Labels**: `update-visual-baselines`, which regenerates the screenshot baselines of a pull request.

## License

BSD-3-Clause.
