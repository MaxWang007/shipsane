import type { AllowRule, DiffFile, Finding } from "../types.js";
import { matchPath } from "../paths.js";
import { detectSkips } from "./skips.js";
import { detectDeletions } from "./deletions.js";
import { detectAssertions } from "./assertions.js";
import { detectConfigNarrowing } from "./config-narrowing.js";
import { detectCoverage } from "./coverage.js";
import { detectExitMasking } from "./exit-masking.js";

export function detectTamper(files: DiffFile[]): Finding[] {
  return [
    ...detectDeletions(files),
    ...detectSkips(files),
    ...detectAssertions(files),
    ...detectConfigNarrowing(files),
    ...detectCoverage(files),
    ...detectExitMasking(files),
  ];
}

export function applyAllowlist(findings: Finding[], allow: AllowRule[] | undefined): Finding[] {
  if (!allow || allow.length === 0) return findings;
  return findings.map((finding) => {
    const rule = allow.find((a) => a.rule === finding.rule && matchPath(a.path, finding.path) && a.reason.trim());
    if (!rule) return finding;
    return {
      ...finding,
      severity: "warning" as const,
      allowed: true,
      allowReason: rule.reason,
    };
  });
}

export {
  detectSkips,
  detectDeletions,
  detectAssertions,
  detectConfigNarrowing,
  detectCoverage,
  detectExitMasking,
};
