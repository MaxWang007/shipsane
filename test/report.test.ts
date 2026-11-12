import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatGitHubAnnotations, formatReport, toJson, writeGitHubOutputs } from "../src/report.js";
import type { ShipsaneReport } from "../src/types.js";

function sample(): ShipsaneReport {
  return {
    verdict: "not_sane",
    sane: false,
    exitCode: 1,
    base: "HEAD",
    cwd: "/tmp/demo",
    commands: ["npm test"],
    checks: [
      {
        command: "npm test",
        exitCode: 0,
        output: "ok",
        timedOut: false,
        durationMs: 1200,
      },
    ],
    findings: [
      {
        rule: "test_deleted",
        severity: "error",
        path: "tests/ripple.spec.ts",
        line: 12,
        message: "Deleted 6 tests",
        evidence: "- it('handles empty input')",
      },
    ],
  };
}

test("JSON report includes the documented schema fields", () => {
  const json = toJson(sample());
  assert.equal(json.verdict, "not_sane");
  assert.equal(json.exitCode, 1);
  assert.equal(json.base, "HEAD");
  assert.ok(Array.isArray(json.findings));
  const finding = (json.findings as Record<string, unknown>[])[0];
  assert.equal(finding?.rule, "test_deleted");
  assert.equal(finding?.path, "tests/ripple.spec.ts");
  assert.equal(finding?.line, 12);
  assert.equal(finding?.severity, "error");
});

test("markdown report includes rule ids and file:line", () => {
  const md = formatReport(sample(), "markdown");
  assert.match(md, /test_deleted/);
  assert.match(md, /tests\/ripple\.spec\.ts:12/);
  assert.match(md, /Verdict: not sane/);
  assert.match(md, /exit 1/);
});

test("pretty report includes a copyable verdict line", () => {
  const text = formatReport(sample(), "pretty", false);
  assert.match(text, /Verdict: not sane\s+\(exit 1\)/);
  assert.match(text, /test_deleted/);
  assert.match(text, /tests\/ripple\.spec\.ts:12/);
});

test("GitHub annotations include file, line, and rule for each finding", () => {
  const out = formatGitHubAnnotations(sample());
  assert.match(out, /::error /);
  assert.match(out, /file=tests\/ripple\.spec\.ts/);
  assert.match(out, /line=12/);
  assert.match(out, /title=shipsane%3A test_deleted/);
  assert.match(out, /Deleted 6 tests/);
  assert.doesNotMatch(out, /\n(?!$)/); // a single trailing newline is ok; raw newlines are escaped
});

test("writeGitHubOutputs is a no-op outside GitHub Actions", () => {
  const chunks: string[] = [];
  writeGitHubOutputs(sample(), { GITHUB_ACTIONS: "false" }, (c) => chunks.push(c));
  assert.deepEqual(chunks, []);
});

test("writeGitHubOutputs emits annotations and a step summary in Actions", () => {
  const dir = mkdtempSync(join(tmpdir(), "shipsane-gha-"));
  const summary = join(dir, "summary.md");
  const chunks: string[] = [];
  writeGitHubOutputs(
    sample(),
    { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summary },
    (c) => chunks.push(c),
  );
  try {
    assert.match(chunks.join(""), /::error /);
    assert.match(chunks.join(""), /file=tests\/ripple\.spec\.ts/);
    const md = readFileSync(summary, "utf8");
    assert.match(md, /shipsane report/);
    assert.match(md, /tests\/ripple\.spec\.ts:12/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
