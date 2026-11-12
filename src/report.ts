import { appendFileSync } from "node:fs";
import pc from "picocolors";
import type { CheckResult, Finding, ShipsaneReport, VerdictName } from "./types.js";

export type ReportFormat = "pretty" | "json" | "markdown";

function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return Boolean(process.stdout.isTTY);
}

function paint(enabled: boolean, color: "red" | "green" | "yellow" | "dim" | "bold" | "cyan", text: string): string {
  if (!enabled) return text;
  switch (color) {
    case "red":
      return pc.red(text);
    case "green":
      return pc.green(text);
    case "yellow":
      return pc.yellow(text);
    case "dim":
      return pc.dim(text);
    case "bold":
      return pc.bold(text);
    case "cyan":
      return pc.cyan(text);
    default:
      return text;
  }
}

export function formatReport(report: ShipsaneReport, format: ReportFormat, color?: boolean): string {
  if (format === "json") return `${JSON.stringify(toJson(report), null, 2)}\n`;
  if (format === "markdown") return formatMarkdown(report);
  return formatPretty(report, color ?? supportsColor());
}

export function toJson(report: ShipsaneReport): Record<string, unknown> {
  return {
    verdict: report.verdict,
    exitCode: report.exitCode,
    base: report.base,
    cwd: report.cwd,
    commands: report.commands,
    checks: report.checks.map((c) => ({
      command: c.command,
      exitCode: c.exitCode,
      timedOut: c.timedOut,
      durationMs: c.durationMs,
      output: c.output,
    })),
    findings: report.findings.map((f) => ({
      rule: f.rule,
      severity: f.severity,
      path: f.path,
      line: f.line,
      message: f.message,
      evidence: f.evidence,
      allowed: Boolean(f.allowed),
      allowReason: f.allowReason,
    })),
    error: report.error,
  };
}

function loc(f: Finding): string {
  return f.line != null ? `${f.path}:${f.line}` : f.path;
}

function formatPretty(report: ShipsaneReport, color: boolean): string {
  const c = (col: "red" | "green" | "yellow" | "dim" | "bold" | "cyan", t: string) => paint(color, col, t);
  const lines: string[] = [];
  lines.push(c("bold", "shipsane") + c("dim", "  v0.1.0"));
  lines.push(c("dim", "Don't ship a green that isn't sane."));
  lines.push("");
  lines.push(`${c("dim", "Repo")}   ${report.cwd}`);
  lines.push(`${c("dim", "Base")}   ${report.base || "(none)"}`);
  if (report.error) {
    lines.push("");
    lines.push(c("red", `Error: ${report.error}`));
    lines.push("");
    lines.push(c("red", "Verdict: error") + c("dim", "  (exit 2)"));
    lines.push("");
    return lines.join("\n");
  }

  if (report.checks.length > 0) {
    lines.push("");
    lines.push(c("bold", "Checks"));
    for (const check of report.checks) {
      lines.push(formatCheckLine(check, c));
    }
  } else if (report.commands.length > 0) {
    lines.push("");
    lines.push(c("dim", "Checks  (skipped)"));
    for (const cmd of report.commands) lines.push(`  ${c("dim", "·")}  ${cmd}`);
  }

  const errors = report.findings.filter((f) => !f.allowed && f.severity === "error");
  const warnings = report.findings.filter((f) => !f.allowed && f.severity === "warning");
  const allowed = report.findings.filter((f) => f.allowed);

  lines.push("");
  if (report.findings.length === 0) {
    lines.push(c("bold", "Findings") + c("dim", "  none"));
  } else {
    const bits: string[] = [];
    if (errors.length) bits.push(`${errors.length} error${errors.length === 1 ? "" : "s"}`);
    if (warnings.length) bits.push(`${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
    if (allowed.length) bits.push(`${allowed.length} allowed`);
    lines.push(c("bold", "Findings") + "  " + bits.join(", "));
    lines.push("");
    for (const finding of report.findings) {
      lines.push(...formatFindingPretty(finding, c));
      lines.push("");
    }
  }

  const verdict = report.verdict === "sane" ? c("green", "Verdict: sane") : c("red", "Verdict: not sane");
  lines.push(`${verdict}  ${c("dim", `(exit ${report.exitCode})`)}`);
  lines.push("");
  return lines.join("\n");
}

function formatCheckLine(
  check: CheckResult,
  c: (col: "red" | "green" | "yellow" | "dim" | "bold" | "cyan", t: string) => string,
): string {
  const ok = check.exitCode === 0 && !check.timedOut;
  const tag = ok ? c("green", "OK  ") : c("red", "FAIL");
  const secs = (check.durationMs / 1000).toFixed(2).padStart(6, " ");
  const status = check.timedOut ? "timeout" : `exit ${check.exitCode}`;
  return `  ${tag}  ${check.command.padEnd(32, " ")}  ${c("dim", `${status}  ${secs}s`)}`;
}

function formatFindingPretty(
  finding: Finding,
  c: (col: "red" | "green" | "yellow" | "dim" | "bold" | "cyan", t: string) => string,
): string[] {
  const mark = finding.allowed
    ? c("dim", "allow")
    : finding.severity === "warning"
      ? c("yellow", "warn ")
      : c("red", "fail ");
  const out = [
    `  ${mark}  ${c("bold", finding.rule.padEnd(20, " "))}  ${loc(finding)}`,
    `        ${finding.message}`,
  ];
  if (finding.allowReason) out.push(`        ${c("dim", `allowed: ${finding.allowReason}`)}`);
  if (finding.evidence) {
    for (const ev of finding.evidence.split("\n")) {
      out.push(c("dim", `        ${ev.replace(/\t/g, "  ")}`));
    }
  }
  return out;
}

export function formatMarkdown(report: ShipsaneReport): string {
  const lines: string[] = [];
  lines.push("## shipsane report");
  lines.push("");
  if (report.error) {
    lines.push(`**Verdict: error** (exit 2)`);
    lines.push("");
    lines.push(report.error);
    lines.push("");
    return lines.join("\n");
  }
  const label = report.verdict === "sane" ? "sane" : "not sane";
  lines.push(`**Verdict: ${label}** (exit ${report.exitCode})`);
  lines.push("");
  lines.push(`- Repo: \`${report.cwd}\``);
  lines.push(`- Base: \`${report.base}\``);
  lines.push("");
  if (report.checks.length > 0) {
    lines.push("### Checks");
    lines.push("");
    for (const check of report.checks) {
      const ok = check.exitCode === 0 && !check.timedOut ? "ok" : "FAIL";
      const status = check.timedOut ? "timeout" : `exit ${check.exitCode}`;
      lines.push(`- **${ok}** \`${check.command}\` (${status}, ${(check.durationMs / 1000).toFixed(2)}s)`);
    }
    lines.push("");
  }
  lines.push("### Findings");
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("_None._");
    lines.push("");
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    const locRef = loc(finding);
    const tag = finding.allowed ? "allowed" : finding.severity;
    lines.push(`- \`${finding.rule}\` (${tag}) — ${locRef}`);
    lines.push(`  - ${finding.message}`);
    if (finding.allowReason) lines.push(`  - allowed: ${finding.allowReason}`);
    if (finding.evidence) {
      lines.push("    ```");
      for (const ev of finding.evidence.split("\n")) lines.push(`    ${ev.replace(/\t/g, "  ")}`);
      lines.push("    ```");
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function verdictOf(sane: boolean, error?: string): VerdictName {
  if (error) return "error";
  return sane ? "sane" : "not_sane";
}

/** Escape a value for a GitHub Actions workflow command (%, newlines, : ,). */
export function escapeGitHubAnnotation(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

/**
 * Workflow-command annotations so findings show up on the PR Files tab
 * with a file and line, not only in the raw job log.
 */
export function formatGitHubAnnotations(report: ShipsaneReport, tool = "shipsane"): string {
  const lines: string[] = [];
  if (report.error) {
    lines.push(`::error title=${escapeGitHubAnnotation(tool)}::${escapeGitHubAnnotation(report.error)}`);
  }
  for (const check of report.checks) {
    if (check.exitCode === 0 && !check.timedOut) continue;
    const msg = check.timedOut
      ? `Command timed out: ${check.command}`
      : `Command failed (exit ${check.exitCode}): ${check.command}`;
    lines.push(
      `::error title=${escapeGitHubAnnotation(`${tool}: check failed`)}::${escapeGitHubAnnotation(msg)}`,
    );
  }
  for (const finding of report.findings) {
    if (finding.allowed) continue;
    const level = finding.severity === "warning" ? "warning" : "error";
    const props: string[] = [];
    if (finding.path) props.push(`file=${escapeGitHubAnnotation(finding.path)}`);
    if (finding.line != null) props.push(`line=${finding.line}`);
    props.push(`title=${escapeGitHubAnnotation(`${tool}: ${finding.rule}`)}`);
    const text = finding.evidence ? `${finding.message}\n${finding.evidence}` : finding.message;
    lines.push(`::${level} ${props.join(",")}::${escapeGitHubAnnotation(text)}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function writeGitHubOutputs(
  report: ShipsaneReport,
  env: NodeJS.ProcessEnv = process.env,
  writeErr: (chunk: string) => void = (chunk) => {
    process.stderr.write(chunk);
  },
): void {
  if (env.GITHUB_ACTIONS !== "true") return;
  const annotations = formatGitHubAnnotations(report);
  if (annotations) writeErr(annotations);
  const summary = env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(summary, formatMarkdown(report));
  }
}
