# Agent instructions

- Read `README.md` first: it describes the three branches (`main`, `config`, `data`), the configuration schema, the shape of a scan record, and how the page reads them
- Always run `pre-commit` before committing and pushing changes
- Before pushing, run the checks CI runs: `npm run typecheck`, `npm run format:check`, `npm test`, `npm run test:e2e` and `npm run test:visual` for the page; `ruff check .`, `ruff format --check .`, `mypy` and `pytest` from `scanner/` for the scanner
- Always bump the version in `package.json` appropriately when any file under `src/`, or `package.json` itself, is changed
- `schema/config.yaml` (LinkML) is the source of truth for `config.json`; after changing it, regenerate the export with `gen-json-schema schema/config.yaml > schema/config.schema.json`, and keep `schema/examples/` covering what it accepts and rejects
- The shape of a scan record is produced by `scanner/src/sistence_scanner/record.py` and read by `src/data.ts`; change both together, and regenerate `tests/fixtures/mock-data.js` with `python tests/fixtures/generate_mock_data.py`
- Regenerate the screenshot baselines only for an intended change to the page's look, with the "Update visual baselines" workflow (label a pull request `update-visual-baselines`), which runs on the same image as CI
- Leave a short description of the change or addition in the top `# Upcoming` section of the `CHANGELOG.md`; include the GitHub PR link at the end of each entry in the format `([#N](https://github.com/CodyCBakerPhD/sistence/pull/N))`
- Keep changelog entries concise: one sentence each, two at the very most. Say what changed and, where it is not obvious, why; leave implementation details, reasoning, and exhaustive lists of options or labels to the PR description
- PR titles should be human-readable and in the past tense; they should NOT use conventional commit style
- Use American English spelling everywhere (code, comments, UI text, changelog entries, and PR descriptions): "normalize" not "normalise", "color" not "colour", "behavior" not "behaviour"
