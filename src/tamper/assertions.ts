import type { DiffFile, Finding } from "../types.js";
import { isTestFile, splitLines } from "../paths.js";
import {
  countAssertions,
  evidenceFor,
  extractTests,
  isAssertLine,
  isEmptyCatch,
  isTrivialAssert,
} from "../tests.js";

export function detectAssertions(files: DiffFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const pathForType = file.oldPath ?? file.path;
    if (!isTestFile(pathForType) && !isTestFile(file.path)) continue;
    if (file.status === "added") continue;

    if (file.status === "deleted") {
      const n = countAssertions(file.oldContent);
      if (n > 0) {
        findings.push({
          rule: "assertion_weakened",
          severity: "error",
          path: pathForType,
          line: 1,
          message: `Removed ${n} assertion${n === 1 ? "" : "s"} with the test file`,
        });
      }
      continue;
    }

    const oldCount = countAssertions(file.oldContent);
    const newCount = countAssertions(file.newContent);

    const deletedAsserts: { line?: number; text: string }[] = [];
    const addedTrivial: { line?: number; text: string }[] = [];
    const addedAsserts: { line?: number; text: string }[] = [];
    const addedCatches: { line?: number; text: string }[] = [];

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "del" && isAssertLine(line.content) && !isTrivialAssert(line.content)) {
          deletedAsserts.push({ line: line.oldLine, text: line.content });
        }
        if (line.type === "add" && isTrivialAssert(line.content)) {
          addedTrivial.push({ line: line.newLine, text: line.content });
        }
        if (line.type === "add" && isAssertLine(line.content)) {
          addedAsserts.push({ line: line.newLine, text: line.content });
        }
        if (line.type === "add" && isEmptyCatch(line.content)) {
          addedCatches.push({ line: line.newLine, text: line.content });
        }
      }
    }

    // Fallback when we have full files but no hunks (e.g. some untracked flows)
    if (file.hunks.length === 0 && oldCount !== newCount) {
      const oldLines = splitLines(file.oldContent);
      const newLines = splitLines(file.newContent);
      for (const [i, line] of oldLines.entries()) {
        if (isAssertLine(line) && !newLines.includes(line)) {
          deletedAsserts.push({ line: i + 1, text: line });
        }
      }
      for (const [i, line] of newLines.entries()) {
        if (isTrivialAssert(line) && !oldLines.includes(line)) {
          addedTrivial.push({ line: i + 1, text: line });
        }
      }
    }

    // If the lost assertions lived inside tests that were themselves deleted,
    // test_deleted already covers the cheat — don't double-report a weakening.
    const oldTests = extractTests(file.oldContent, pathForType);
    const newNames = new Set(extractTests(file.newContent, file.path).map((t) => t.name));
    const deletedTestNames = new Set(oldTests.filter((t) => t.name && !newNames.has(t.name)).map((t) => t.name));
    const explainedByDeletedTests = (() => {
      if (addedTrivial.length > 0 || addedCatches.length > 0) return false;
      if (deletedTestNames.size === 0) return false;
      if (oldCount <= newCount) return false;
      const remainingOld = assertionCountOutside(file.oldContent, oldTests, deletedTestNames);
      return remainingOld <= newCount;
    })();
    if (explainedByDeletedTests) continue;

    const weakened = addedTrivial.length > 0 || (oldCount > newCount && deletedAsserts.length > 0);
    if (addedCatches.length > 0 && (deletedAsserts.length > 0 || oldCount > newCount)) {
      findings.push({
        rule: "assertion_weakened",
        severity: "error",
        path: file.path,
        line: addedCatches[0]?.line ?? deletedAsserts[0]?.line,
        message: "Empty try/catch (or except: pass) added around a failing assertion",
        evidence: evidenceFor([
          ...deletedAsserts.map((d) => `- ${d.text.trim()}`),
          ...addedCatches.map((a) => `+ ${a.text.trim()}`),
        ]),
      });
      continue;
    }

    if (weakened || (oldCount > newCount && oldCount - newCount >= 1)) {
      const lost = Math.max(oldCount - newCount, deletedAsserts.length, addedTrivial.length);
      const message =
        addedTrivial.length > 0
          ? "Assertion replaced with a tautology"
          : `Removed ${lost} assertion${lost === 1 ? "" : "s"}`;
      findings.push({
        rule: "assertion_weakened",
        severity: "error",
        path: file.path,
        line: addedTrivial[0]?.line ?? deletedAsserts[0]?.line,
        message,
        evidence: evidenceFor([
          ...deletedAsserts.slice(0, 5).map((d) => `- ${d.text.trim()}`),
          ...addedTrivial.slice(0, 5).map((a) => `+ ${a.text.trim()}`),
        ]),
      });
      continue;
    }

    // Honest-looking assertion edit: a real assertion was changed, not dropped or trivialized.
    if (deletedAsserts.length > 0 && addedAsserts.length > 0 && newCount >= oldCount) {
      findings.push({
        rule: "assertion_weakened",
        severity: "warning",
        path: file.path,
        line: addedAsserts[0]?.line ?? deletedAsserts[0]?.line,
        message: "Assertion changed; confirm this matches a real spec change",
        evidence: evidenceFor([
          ...deletedAsserts.slice(0, 4).map((d) => `- ${d.text.trim()}`),
          ...addedAsserts.slice(0, 4).map((a) => `+ ${a.text.trim()}`),
        ]),
      });
    }
  }
  return findings;
}

function assertionCountOutside(
  content: string,
  tests: ReturnType<typeof extractTests>,
  deletedNames: Set<string>,
): number {
  // Count assertions that are not inside a deleted test's line range.
  const ranges = tests
    .map((t, i) => ({ name: t.name, start: t.line, end: tests[i + 1]?.line ?? Number.POSITIVE_INFINITY }))
    .filter((t) => deletedNames.has(t.name));
  const lines = splitLines(content);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const inDeleted = ranges.some((r) => lineNo >= r.start && lineNo < r.end);
    if (!inDeleted) count += countAssertions(lines[i] ?? "");
  }
  return count;
}
