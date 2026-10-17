# Changelog

## Upcoming

#### 🚀 Enhancement

- Added the dashboard of con/sistent reports over time, published to GitHub Pages: headline numbers, consistency per run and per check, a repository × check matrix, findings and candidates for main. ([#1](https://github.com/CodyCBakerPhD/sistence/pull/1))
- Added the `config` branch's schema, written in LinkML with its JSON Schema export, and a workflow validating `config.json` against it, including on every pull request into `config`. ([#1](https://github.com/CodyCBakerPhD/sistence/pull/1))
- Added the Scan workflow, which runs con/sistent over the configured organizations and repositories and appends one record per scan to `data/%Y/%m/%Y%m%d_report.json` on the `data` branch. ([#1](https://github.com/CodyCBakerPhD/sistence/pull/1))

#### 🏠 Internal

- Added unit, integration, screenshot and Chromatic test suites for the page, a test suite for the scanner, and the deploy, preview and scheduled workflows, following dandi/usage-page. ([#1](https://github.com/CodyCBakerPhD/sistence/pull/1))
