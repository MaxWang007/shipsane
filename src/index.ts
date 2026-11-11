import { resolve } from "node:path";
import type { CheckOptions, CheckResult, Finding, ShipsaneReport } from "./types.js";
import { ShipsaneError } from "./types.js";
import { loadConfig } from "./config.js";
import { detectCommands } from "./detect-commands.js";
import { findGitRoot, getWorktreeDiffs, resolveBase } from "./git.js";
import { applyAllowlist, detectTamper } from "./tamper/index.js";
import { loadCheckLog, runChecks, writeLastRun } from "./run-checks.js";
import { detectFalseSuccess, readTranscript } from "./claims.js";
import { verdictOf } from "./report.js";

export { loadConfig } from "./config.js";
export { detectCommands } from "./detect-commands.js";
export { detectTamper, applyAllowlist } from "./tamper/index.js";
export { formatReport, toJson, formatMarkdown } from "./report.js";
export { findSuccessClaims, detectFalseSuccess } from "./claims.js";
export { getWorktreeDiffs, findGitRoot, detectDefaultBase, resolveBase, parseUnifiedDiff } from "./git.js";
export { RULES, formatRuleDoc } from "./rules.js";
export { RULE_IDS, ShipsaneError } from "./types.js";
export type {
  AllowRule,
  CheckOptions,
  CheckResult,
  DiffFile,
  Finding,
  RuleId,
  ShipsaneConfig,
  ShipsaneReport,
} from "./types.js";

export async function shipsaneCheck(options: CheckOptions = {}): Promise<ShipsaneReport> {
  const startedIn = resolve(options.cwd ?? process.cwd());
  const gitRoot = findGitRoot(startedIn);
  const { config } = loadConfig(gitRoot, options.configPath);
  const base = resolveBase(gitRoot, options.base ?? config.base);
  const commands =
    config.commands && config.commands.length > 0 ? config.commands : detectCommands(gitRoot);
  const timeoutSec = options.timeout ?? config.timeout;

  const onlyTamper = options.only === "tamper";
  const onlyChecks = options.only === "checks";

  let findings: Finding[] = [];
  if (!onlyChecks) {
    const diffs = getWorktreeDiffs(gitRoot, base);
    findings = applyAllowlist(detectTamper(diffs), config.allow);
  }

  let checks: CheckResult[] = [];
  if (!onlyTamper) {
    if (options.fromLog || options.assumeRan) {
      checks = loadCheckLog(gitRoot, options.fromLog, options.assumeRan);
    } else {
      if (commands.length === 0) {
        throw new ShipsaneError(
          "No verification commands found. Add a test script, or set commands in .shipsane.yml.",
        );
      }
      checks = await runChecks(commands, { cwd: gitRoot, timeoutSec });
      if (options.writeLog !== false) writeLastRun(gitRoot, checks);
    }
  }

  if (options.transcript) {
    const t = readTranscript(gitRoot, options.transcript);
    findings = [...findings, ...detectFalseSuccess(t.text, options.transcript, checks, findings)];
  }

  const checksFailed = checks.some((c) => c.exitCode !== 0 || c.timedOut);
  const blocking = findings.filter((f) => {
    if (f.allowed && !options.failOnWarning) return false;
    if (f.severity === "error") return true;
    if (f.severity === "warning" && options.failOnWarning) return true;
    return false;
  });
  const sane = !checksFailed && blocking.length === 0;
  return {
    verdict: verdictOf(sane),
    sane,
    exitCode: sane ? 0 : 1,
    base,
    cwd: gitRoot,
    commands: checks.length > 0 ? checks.map((c) => c.command) : commands,
    checks,
    findings,
  };
}
