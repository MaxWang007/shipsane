# Changelog

All notable changes to this project are documented here.

## 0.1.0 — 2026-11-12

Initial release.

- `shipsane check` auto-detects a repo's test / lint / typecheck commands, re-runs them, and believes the process exit code.
- Deterministic tamper detectors for skipped tests, deleted tests, weakened assertions, narrowed test commands, dropped coverage thresholds, and masked exit codes (`cmd || true`, `set +e`).
- Optional `--transcript` parser that flags a false "all tests passed" claim when the checks failed or the diff was tampered with.
- `--json` and `--markdown` reports, `shipsane hook install`, a stdio MCP server (`shipsane_check`), and a GitHub Action.
- Allowlist in `.shipsane.yml` with a required reason; allowed hunks are listed in the report, not dropped on the floor.
