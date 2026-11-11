import type { RuleId } from "./types.js";

export interface RuleDoc {
  id: RuleId;
  title: string;
  summary: string;
  examples: string[];
}

export const RULES: Record<RuleId, RuleDoc> = {
  skip_added: {
    id: "skip_added",
    title: "A test was skipped",
    summary:
      "Flags newly introduced test skips such as it.skip, test.skip, xtest, xit, xdescribe, pytest.mark.skip, unittest.skip, #[ignore], t.Skip, @Disabled, or a new //go:build tag on a test file. Agents skip the failing case instead of fixing the code.",
    examples: ["it('works') → it.skip('works')", "@pytest.mark.skip on a previously active test"],
  },
  assertion_weakened: {
    id: "assertion_weakened",
    title: "An assertion was weakened or removed",
    summary:
      "Flags deleted assertions, replacements with a tautology (assert True, expect(true).toBe(true)), or an empty try/catch that swallows a failure. An honest expected-value change (the spec actually changed) is reported as a warning so a human can glance at it, and can be allowlisted with a reason.",
    examples: ["expect(add(-1, 1)).toBe(0) → expect(true).toBe(true)", "assert result == 4  deleted"],
  },
  test_deleted: {
    id: "test_deleted",
    title: "A test was deleted",
    summary:
      "Flags deleted test files and removed test definitions: it(), test(), def test_*, #[test], func Test*. Deleting a truly obsolete test is allowed when .shipsane.yml records a reason.",
    examples: ["tests/ripple.spec.ts loses six it(...) blocks", "tests/test_parser.py removed"],
  },
  command_narrowed: {
    id: "command_narrowed",
    title: "The test command was narrowed",
    summary:
      "Flags changes that shrink what the official test entrypoint actually runs: package.json scripts, Makefile / justfile targets, CI workflow steps, pytest.ini / addopts, or Jest / Vitest testPathIgnorePatterns and testNamePattern. Classic cheat: make test now only runs a 'safe-tests' target.",
    examples: ["Makefile test: cargo test → $(MAKE) safe-tests", "jest --testPathPattern=safe"],
  },
  coverage_dropped: {
    id: "coverage_dropped",
    title: "A coverage threshold was dropped",
    summary:
      "Flags lowered or removed coverage gates in jest.config, vitest.config, .coveragerc, pyproject.toml, codecov.yml, and similar files. A documented 80% floor silently becoming 60/45/60/60 is a frequent agent cheat.",
    examples: ["coverageThreshold.global.lines: 80 → 60", "fail_under = 80 → 40"],
  },
  exit_masking: {
    id: "exit_masking",
    title: "The test script masks a failing exit code",
    summary:
      "Flags newly added cmd || true, || :, set +e, or exit 0 after a test command in package.json scripts, Makefiles, shell runners, or CI steps. The suite can fail and still look green to the parent process.",
    examples: ['"test": "jest || true"', "set +e in a CI run step"],
  },
  false_success: {
    id: "false_success",
    title: "The transcript claimed a passing suite that did not pass",
    summary:
      "When --transcript is given, shipsane looks for success claims such as 'all tests passed' or 'the suite still passes' and flags them if the real checks failed or the diff was tampered with. The process exit code, not the agent's narration, is the source of truth.",
    examples: ['ctest exits 1, then the agent says the suite "still passes"'],
  },
};

export function formatRuleDoc(id: RuleId): string {
  const rule = RULES[id];
  const lines = [
    `${rule.id} — ${rule.title}`,
    "",
    rule.summary,
    "",
    "Examples:",
    ...rule.examples.map((e) => `  - ${e}`),
  ];
  return lines.join("\n");
}
