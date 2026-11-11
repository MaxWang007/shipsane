import type { DiffFile, Finding } from "../types.js";
import { isTestFile } from "../paths.js";
import { evidenceFor, extractTests } from "../tests.js";

export function detectDeletions(files: DiffFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const pathForType = file.oldPath ?? file.path;
    const wasTest = isTestFile(pathForType) || isTestFile(file.path);

    if (file.status === "deleted" && wasTest) {
      const tests = extractTests(file.oldContent, pathForType);
      const count = tests.length;
      findings.push({
        rule: "test_deleted",
        severity: "error",
        path: pathForType,
        line: 1,
        message:
          count > 0
            ? `Deleted test file (${count} test${count === 1 ? "" : "s"})`
            : "Deleted test file",
        evidence: evidenceFor(
          tests.map((t) => `- ${t.raw || t.name}`),
          8,
        ),
      });
      continue;
    }

    if (!wasTest) continue;
    if (file.status === "added") continue;

    const oldTests = extractTests(file.oldContent, pathForType);
    const newTests = extractTests(file.newContent, file.path);
    const newNames = new Set(newTests.map((t) => t.name));
    const removed = oldTests.filter((t) => t.name && !newNames.has(t.name));
    if (removed.length === 0) continue;

    findings.push({
      rule: "test_deleted",
      severity: "error",
      path: file.path,
      line: removed[0]?.line,
      message:
        removed.length === 1
          ? `Deleted test '${removed[0]!.name}'`
          : `Deleted ${removed.length} tests`,
      evidence: evidenceFor(
        removed.map((t) => `- ${t.raw || t.name}`),
        8,
      ),
    });
  }
  return findings;
}
