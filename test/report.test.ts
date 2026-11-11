import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReport, toJson } from "../src/report.js";
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
