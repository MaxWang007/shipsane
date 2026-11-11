import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CheckResult } from "./types.js";
import { ShipsaneError } from "./types.js";

const DEFAULT_TIMEOUT_SEC = 600;
const FRESH_MS = 60 * 60 * 1000;

export const LAST_RUN_REL = ".shipsane/last-run.json";

export interface RunChecksOptions {
  cwd: string;
  timeoutSec?: number;
}

export function lastRunPath(cwd: string): string {
  return join(cwd, LAST_RUN_REL);
}

export function writeLastRun(cwd: string, checks: CheckResult[]): void {
  const path = lastRunPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ version: 1, recordedAt: new Date().toISOString(), commands: checks }, null, 2),
  );
}

export interface CheckLog {
  commands: CheckResult[];
  recordedAt?: string;
}

export function parseCheckLog(text: string, source: string): CheckLog {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ShipsaneError(`Log file is empty: ${source}`);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const raw = JSON.parse(trimmed) as unknown;
      if (Array.isArray(raw)) return { commands: raw.map(coerceCheck) };
      if (raw && typeof raw === "object") {
        const obj = raw as { commands?: unknown; recordedAt?: unknown };
        if (Array.isArray(obj.commands)) {
          return {
            commands: obj.commands.map(coerceCheck),
            recordedAt: typeof obj.recordedAt === "string" ? obj.recordedAt : undefined,
          };
        }
        return { commands: [coerceCheck(raw)] };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ShipsaneError(`Failed to parse log ${source}: ${message}`);
    }
  }
  // Text format:
  // # shipsane-log v1
  // # exit: 1
  // # command: npm test
  // ...output...
  const header: Record<string, string> = {};
  const body: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const m = line.match(/^#\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m && body.length === 0) {
      header[(m[1] ?? "").toLowerCase()] = (m[2] ?? "").trim();
    } else if (!line.startsWith("# shipsane-log") && !line.startsWith("#shipsane-log")) {
      body.push(line);
    }
  }
  if (header.exit == null && header.exitcode == null) {
    throw new ShipsaneError(
      `Log ${source} is missing an exit code (use JSON or a '# exit: N' header)`,
    );
  }
  const exitCode = Number(header.exit ?? header.exitcode);
  if (!Number.isFinite(exitCode)) {
    throw new ShipsaneError(`Log ${source} has a non-numeric exit code`);
  }
  return {
    commands: [
      {
        command: header.command ?? "(from log)",
        exitCode,
        output: body.join("\n"),
        timedOut: header.timedout === "true" || header.timedout === "1",
        durationMs: header.durationms ? Number(header.durationms) : 0,
      },
    ],
  };
}

function coerceCheck(raw: unknown): CheckResult {
  if (!raw || typeof raw !== "object") {
    throw new ShipsaneError("Invalid check log entry");
  }
  const obj = raw as Record<string, unknown>;
  const exit = Number(obj.exitCode ?? obj.exit ?? obj.status);
  if (!Number.isFinite(exit)) {
    throw new ShipsaneError("Log entry is missing a numeric exitCode");
  }
  const output =
    typeof obj.output === "string"
      ? obj.output
      : `${obj.stdout ?? ""}${obj.stderr ? `\n${obj.stderr}` : ""}`;
  return {
    command: typeof obj.command === "string" ? obj.command : "(from log)",
    exitCode: exit,
    output,
    timedOut: Boolean(obj.timedOut),
    durationMs: typeof obj.durationMs === "number" ? obj.durationMs : 0,
  };
}

export function loadCheckLog(cwd: string, fromLog?: string, assumeRan?: boolean): CheckResult[] {
  let path: string | undefined;
  if (fromLog) {
    path = isAbsolute(fromLog) ? fromLog : resolve(cwd, fromLog);
    if (!existsSync(path)) throw new ShipsaneError(`Log file not found: ${path}`);
  } else if (assumeRan) {
    path = lastRunPath(cwd);
    if (!existsSync(path)) {
      throw new ShipsaneError(
        `--assume-ran requires a fresh log (pass --from-log <file> or run shipsane once to write ${LAST_RUN_REL})`,
      );
    }
    const age = Date.now() - statSync(path).mtimeMs;
    if (age > FRESH_MS) {
      throw new ShipsaneError(
        `Last-run log is stale (${Math.round(age / 60000)} minutes old). Re-run the checks or pass --from-log.`,
      );
    }
  } else {
    throw new ShipsaneError("No log specified");
  }
  const parsed = parseCheckLog(readFileSync(path, "utf8"), path);
  if (parsed.commands.length === 0) {
    throw new ShipsaneError(`Log file has no commands: ${path}`);
  }
  return parsed.commands;
}

export async function runChecks(
  commands: string[],
  options: RunChecksOptions,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const timeoutMs = (options.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  for (const command of commands) {
    results.push(await runOne(command, options.cwd, timeoutMs));
  }
  return results;
}

function runOne(command: string, cwd: string, timeoutMs: number): Promise<CheckResult> {
  return new Promise((resolvePromise) => {
    const start = Date.now();
    const chunks: Buffer[] = [];
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);

    const onData = (buf: Buffer) => chunks.push(buf);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const finish = (exitCode: number) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf8");
      resolvePromise({
        command,
        exitCode: timedOut ? 124 : exitCode,
        output,
        timedOut,
        durationMs: Date.now() - start,
      });
    };

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        command,
        exitCode: 127,
        output: err.message,
        timedOut: false,
        durationMs: Date.now() - start,
      });
    });
    child.on("close", (code, signal) => {
      if (timedOut) finish(124);
      else finish(code ?? (signal ? 1 : 0));
    });
  });
}
