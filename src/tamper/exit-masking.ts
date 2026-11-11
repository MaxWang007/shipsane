import type { DiffFile, Finding } from "../types.js";
import { basename, isTestConfigFile, isTestFile, splitLines } from "../paths.js";

const MASK_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\|\|\s*true\b/, label: "|| true" },
  { re: /\|\|\s*:\s*(?:#.*)?$/, label: "|| :" },
  { re: /\|\|\s*exit\s+0\b/, label: "|| exit 0" },
  { re: /\bset\s+\+e\b/, label: "set +e" },
  { re: /\bset\s+\+euo\b/, label: "set +e" },
];

function relevant(file: DiffFile): boolean {
  if (isTestConfigFile(file.path) || isTestConfigFile(file.oldPath ?? file.path)) return true;
  if (isTestFile(file.path)) return false;
  const base = basename(file.path);
  if (/\.(sh|bash|zsh)$/.test(base)) return true;
  if (base === "Makefile" || base === "makefile" || base === "justfile") return true;
  if (base === "package.json") return true;
  if (file.path.includes(".github/workflows/")) return true;
  return false;
}

function alreadyIn(oldContent: string, added: string, label: string): boolean {
  const needle = added.trim();
  if (needle && splitLines(oldContent).some((l) => l.trim() === needle)) return true;
  // For || true appearing in a slightly reformatted script, also compare the pattern presence in the old script value.
  if (label && oldContent.includes(label)) return true;
  return false;
}

export function detectExitMasking(files: DiffFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!relevant(file)) continue;
    if (file.status === "deleted") continue;

    const seen = new Set<string>();
    const inspect = (content: string, lineNo: number, prefix: "+" | "") => {
      for (const kind of MASK_PATTERNS) {
        if (!kind.re.test(content)) continue;
        if (alreadyIn(file.oldContent, content, kind.label)) continue;
        const key = `${kind.label}:${lineNo}:${content.trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          rule: "exit_masking",
          severity: "error",
          path: file.path,
          line: lineNo,
          message: `Test command masks a failing exit code (${kind.label})`,
          evidence: `${prefix} ${content}`.trim(),
        });
      }
    };

    if (file.hunks.length > 0) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.type !== "add") continue;
          inspect(line.content, line.newLine ?? 1, "+");
        }
      }
    } else if (file.status === "added" || file.status === "modified") {
      // Compare whole files for synthetic diffs.
      const oldLines = new Set(splitLines(file.oldContent).map((l) => l.trim()));
      for (const [i, line] of splitLines(file.newContent).entries()) {
        if (oldLines.has(line.trim())) continue;
        inspect(line, i + 1, "+");
      }
    }
  }
  return findings;
}
