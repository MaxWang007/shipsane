export const RULE_IDS = [
  "skip_added",
  "assertion_weakened",
  "test_deleted",
  "command_narrowed",
  "coverage_dropped",
  "exit_masking",
  "false_success",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export type Severity = "error" | "warning";

export type VerdictName = "sane" | "not_sane" | "error";

export interface Finding {
  rule: RuleId;
  severity: Severity;
  path: string;
  line?: number;
  message: string;
  evidence?: string;
  allowed?: boolean;
  allowReason?: string;
}

export interface CheckResult {
  command: string;
  exitCode: number;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

export interface AllowRule {
  path: string;
  rule: RuleId | string;
  reason: string;
}

export interface ShipsaneConfig {
  commands?: string[];
  base?: string;
  allow?: AllowRule[];
  timeout?: number;
}

export interface CheckOptions {
  cwd?: string;
  base?: string;
  configPath?: string;
  only?: "tamper" | "checks";
  fromLog?: string;
  assumeRan?: boolean;
  transcript?: string;
  failOnWarning?: boolean;
  timeout?: number;
  writeLog?: boolean;
}

export interface ShipsaneReport {
  verdict: VerdictName;
  sane: boolean;
  exitCode: 0 | 1 | 2;
  base: string;
  cwd: string;
  commands: string[];
  checks: CheckResult[];
  findings: Finding[];
  error?: string;
}

export interface DiffLine {
  type: "context" | "add" | "del";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
}

export class ShipsaneError extends Error {
  readonly exitCode = 2 as const;
  constructor(message: string) {
    super(message);
    this.name = "ShipsaneError";
  }
}

export interface TestDef {
  name: string;
  line: number;
  raw: string;
}
