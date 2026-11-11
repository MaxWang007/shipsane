import type { DiffFile, Finding } from "../types.js";
import { basename, isTestConfigFile } from "../paths.js";

const KEYS = ["statements", "branches", "functions", "lines", "fail_under", "target"];

function isCoverageFile(path: string): boolean {
  const base = basename(path);
  if (isTestConfigFile(path)) return true;
  if (/coverage|codecov|nyc|c8|istanbul|vitest|jest/.test(base)) return true;
  return false;
}

function extract(text: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!text) return map;
  const fail = [...text.matchAll(/fail_under\s*[=:]\s*(\d+(?:\.\d+)?)/g)];
  for (const m of fail) map.set("fail_under", Number(m[1]));
  for (const key of KEYS) {
    if (key === "fail_under") continue;
    const re = new RegExp(`(?:coverage(?:Threshold)?[^\\n]{0,80})?\\b${key}\\s*[:=]\\s*['"]?(\\d+(?:\\.\\d+)?)%?`, "gi");
    let n = 0;
    for (const m of text.matchAll(re)) {
      map.set(n === 0 ? key : `${key}#${n}`, Number(m[1]));
      n++;
    }
  }
  // codecov-style: target: 80%  (often under coverage / status)
  for (const m of text.matchAll(/\btarget\s*:\s*['"]?(\d+(?:\.\d+)?)%['"]?/g)) {
    if (!map.has("target")) map.set("target", Number(m[1]));
  }
  return map;
}

function lineOfKey(content: string, key: string): number | undefined {
  const bare = key.replace(/#\d+$/, "");
  const re = new RegExp(`\\b${bare}\\s*[:=]`);
  const m = re.exec(content);
  if (!m) return undefined;
  return content.slice(0, m.index).split(/\r?\n/).length;
}

export function detectCoverage(files: DiffFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.status === "added") continue;
    if (!isCoverageFile(file.path) && !isCoverageFile(file.oldPath ?? file.path)) continue;

    const oldMap = extract(file.oldContent);
    const newMap = extract(file.newContent);
    if (oldMap.size === 0) continue;

    const drops: string[] = [];
    let line: number | undefined;
    for (const [key, oldVal] of oldMap) {
      const newVal = newMap.get(key);
      if (newVal == null) {
        drops.push(`${key} ${oldVal} removed`);
        line ??= lineOfKey(file.oldContent, key);
        continue;
      }
      if (newVal < oldVal) {
        drops.push(`${key} ${oldVal} → ${newVal}`);
        line ??= lineOfKey(file.newContent, key);
      }
    }
    if (drops.length === 0) continue;
    findings.push({
      rule: "coverage_dropped",
      severity: "error",
      path: file.path,
      line,
      message: `Coverage threshold dropped: ${drops.join(", ")}`,
      evidence: drops.map((d) => `  ${d}`).join("\n"),
    });
  }
  return findings;
}
