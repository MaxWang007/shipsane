import assert from "node:assert/strict";
import { after, test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { shipsaneCheck, type Finding } from "../src/index.js";
import {
  cleanupTemps,
  loadFixtureRepo,
  readExpected,
  trackTemp,
} from "./helpers.js";

after(() => cleanupTemps());

async function findingsOf(name: string, extra?: { configPath?: string; failOnWarning?: boolean }): Promise<{
  findings: Finding[];
  exitCode: number;
  dir: string;
}> {
  const dir = trackTemp(loadFixtureRepo(name));
  const report = await shipsaneCheck({
    cwd: dir,
    base: "HEAD",
    only: "tamper",
    configPath: extra?.configPath,
    failOnWarning: extra?.failOnWarning,
    writeLog: false,
  });
  return { findings: report.findings, exitCode: report.exitCode, dir };
}

function assertGolden(
  name: string,
  actual: Finding[],
  expected: { rule: string; path?: string; severity?: string }[],
): void {
  const got = actual
    .filter((f) => !f.allowed)
    .map((f) => ({ rule: f.rule, path: f.path, severity: f.severity }));
  assert.equal(
    got.length,
    expected.length,
    `${name}: expected ${expected.length} findings, got ${got.length}: ${JSON.stringify(got, null, 2)}`,
  );
  for (const exp of expected) {
    const match = actual.find(
      (f) =>
        f.rule === exp.rule &&
        (exp.path == null || f.path === exp.path) &&
        (exp.severity == null || f.severity === exp.severity),
    );
    assert.ok(
      match,
      `${name}: missing ${JSON.stringify(exp)}; actual=${JSON.stringify(got, null, 2)}`,
    );
    if (match.path) {
      assert.ok(
        match.line == null || match.line >= 1,
        `${name}: ${match.rule} should include a 1-based line when a path is present`,
      );
    }
  }
}

const DETECTOR_FIXTURES = [
  "clean-pass",
  "skip-added",
  "assertion-weakened",
  "test-deleted",
  "coverage-dropped",
  "command-narrowed",
  "exit-masked",
] as const;

for (const name of DETECTOR_FIXTURES) {
  test(`detector fixture: ${name}`, async () => {
    const expected = readExpected(name);
    const { findings, exitCode } = await findingsOf(name);
    assertGolden(name, findings, expected.findings);
    if (expected.findings.length === 0) assert.equal(exitCode, 0);
    else assert.equal(exitCode, 1);
  });
}

test("honest-test-fix without allow is a warning and does not fail", async () => {
  const { findings, exitCode } = await findingsOf("honest-test-fix");
  const hit = findings.find((f) => f.rule === "assertion_weakened");
  assert.ok(hit, "expected an assertion_weakened warning");
  assert.equal(hit!.severity, "warning");
  assert.equal(hit!.allowed, undefined);
  assert.equal(exitCode, 0);
});

test("honest-test-fix with an allow reason is listed, not silent, and does not fail", async () => {
  const dir = trackTemp(loadFixtureRepo("honest-test-fix"));
  const configPath = join(dir, ".shipsane.yml");
  writeFileSync(
    configPath,
    `allow:\n  - path: test/spec.test.js\n    rule: assertion_weakened\n    reason: "Spec change in #42: default timeout is now 60 seconds"\n`,
  );
  const report = await shipsaneCheck({
    cwd: dir,
    base: "HEAD",
    only: "tamper",
    configPath,
    writeLog: false,
  });
  const hit = report.findings.find((f) => f.rule === "assertion_weakened");
  assert.ok(hit, "allowed finding must still appear in the report");
  assert.equal(hit!.allowed, true);
  assert.match(hit!.allowReason ?? "", /#42/);
  assert.equal(report.exitCode, 0);
});

test("honest-test-fix with --fail-on-warning fails even when allowlisted", async () => {
  const dir = trackTemp(loadFixtureRepo("honest-test-fix"));
  const configPath = join(dir, ".shipsane.yml");
  writeFileSync(
    configPath,
    `allow:\n  - path: test/spec.test.js\n    rule: assertion_weakened\n    reason: "Spec change in #42: default timeout is now 60 seconds"\n`,
  );
  const report = await shipsaneCheck({
    cwd: dir,
    base: "HEAD",
    only: "tamper",
    configPath,
    failOnWarning: true,
    writeLog: false,
  });
  assert.equal(report.exitCode, 1);
});
