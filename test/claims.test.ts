import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFalseSuccess, findSuccessClaims } from "../src/claims.js";
import { FIXTURES } from "./helpers.js";

const TRANSCRIPT = readFileSync(join(FIXTURES, "false-success-transcript", "transcript.txt"), "utf8");

test("finds the Codex #6887 success claim wording", () => {
  const claims = findSuccessClaims(TRANSCRIPT);
  assert.ok(claims.length >= 1, "expected at least one success claim");
  assert.match(claims.map((c) => c.text).join("\n"), /still passes/i);
});

test("flags false_success when ctest exited non-zero", () => {
  const findings = detectFalseSuccess(
    TRANSCRIPT,
    "transcript.txt",
    [
      {
        command: "ctest --output-on-failure",
        exitCode: 8,
        output: "The following tests FAILED",
        timedOut: false,
        durationMs: 400,
      },
    ],
    [],
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, "false_success");
  assert.equal(findings[0]?.severity, "error");
  assert.match(findings[0]?.message ?? "", /exited 8/);
});

test("does not flag a success claim when checks actually passed and the diff is clean", () => {
  const findings = detectFalseSuccess(
    "All 42 tests passed. Ready to merge.\n",
    "transcript.txt",
    [{ command: "npm test", exitCode: 0, output: "ok", timedOut: false, durationMs: 10 }],
    [],
  );
  assert.equal(findings.length, 0);
});
