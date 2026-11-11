import type { DiffFile, Finding } from "../types.js";
import { isTestFile, splitLines } from "../paths.js";

interface SkipKind {
  re: RegExp;
  label: string;
}

const SKIP_KINDS: SkipKind[] = [
  { re: /\bit\.skip\b/, label: "it.skip" },
  { re: /\btest\.skip\b/, label: "test.skip" },
  { re: /\bdescribe\.skip\b/, label: "describe.skip" },
  { re: /\bxtest\b/, label: "xtest" },
  { re: /\bxit\b/, label: "xit" },
  { re: /\bxdescribe\b/, label: "xdescribe" },
  { re: /\bit\.todo\b/, label: "it.todo" },
  { re: /\btest\.todo\b/, label: "test.todo" },
  { re: /@pytest\.mark\.skip(?:if)?\b/, label: "pytest.mark.skip" },
  { re: /@unittest\.skip(?:If|Unless)?\b/, label: "unittest.skip" },
  { re: /#\[ignore(?:\s*\(.*\))?\]/, label: "#[ignore]" },
  { re: /\bt\.Skip(?:f|Now)?\s*\(/, label: "t.Skip" },
  { re: /@Disabled\b/, label: "@Disabled" },
  { re: /\bself\.skipTest\s*\(/, label: "skipTest" },
  { re: /\bpytest\.importorskip\s*\(/, label: "pytest.importorskip" },
  { re: /^\s*pending\s*\(/, label: "pending" },
];

function alreadyPresent(oldContent: string, added: string): boolean {
  const needle = added.trim();
  if (!needle) return false;
  return splitLines(oldContent).some((l) => l.trim() === needle);
}

function goBuildTags(content: string): string[] {
  const tags: string[] = [];
  for (const line of splitLines(content).slice(0, 16)) {
    const go = line.match(/^\/\/go:build\s+(.+)$/);
    const plus = line.match(/^\/\/\s+\+build\s+(.+)$/);
    if (go) tags.push(go[1]!.trim());
    if (plus) tags.push(plus[1]!.trim());
  }
  return tags;
}

export function detectSkips(files: DiffFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.status === "deleted") continue;
    const looksLikeTest = isTestFile(file.path);

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== "add") continue;
        if (alreadyPresent(file.oldContent, line.content)) continue;
        if (!looksLikeTest && !isTestFile(file.path)) continue;
        for (const kind of SKIP_KINDS) {
          if (kind.re.test(line.content)) {
            findings.push({
              rule: "skip_added",
              severity: "error",
              path: file.path,
              line: line.newLine,
              message: `Added skip (${kind.label})`,
              evidence: `+ ${line.content}`,
            });
            break;
          }
        }
      }
    }

    // Also compare full files in case a skip was added without a parseable hunk
    // (e.g. untracked files we synthesized).
    if (file.status === "added" && looksLikeTest) {
      for (const [i, line] of splitLines(file.newContent).entries()) {
        for (const kind of SKIP_KINDS) {
          if (kind.re.test(line)) {
            if (findings.some((f) => f.path === file.path && f.line === i + 1 && f.rule === "skip_added")) {
              continue;
            }
            findings.push({
              rule: "skip_added",
              severity: "error",
              path: file.path,
              line: i + 1,
              message: `Added skip (${kind.label})`,
              evidence: `+ ${line}`,
            });
            break;
          }
        }
      }
    }

    if (looksLikeTest || file.path.endsWith("_test.go")) {
      const oldTags = goBuildTags(file.oldContent);
      const newTags = goBuildTags(file.newContent);
      if (newTags.length > 0 && newTags.join("\n") !== oldTags.join("\n")) {
        // Adding a first tag, or changing the expression, narrows where the file builds.
        const addedNew = oldTags.length === 0 || newTags.some((t) => !oldTags.includes(t));
        if (addedNew) {
          const line =
            splitLines(file.newContent).findIndex((l) => /\/\/go:build|\/\/\s+\+build/.test(l)) + 1;
          findings.push({
            rule: "skip_added",
            severity: "error",
            path: file.path,
            line: line > 0 ? line : 1,
            message: `//go:build constraint narrowed (${oldTags.join(", ") || "none"} → ${newTags.join(", ")})`,
            evidence: newTags.map((t) => `+ //go:build ${t}`).join("\n"),
          });
        }
      }
    }
  }
  return findings;
}
