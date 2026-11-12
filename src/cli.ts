#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { shipsaneCheck } from "./index.js";
import { formatReport, writeGitHubOutputs } from "./report.js";
import { detectCommands } from "./detect-commands.js";
import { findGitRoot } from "./git.js";
import { formatRuleDoc, RULES } from "./rules.js";
import { RULE_IDS, ShipsaneError, type RuleId } from "./types.js";
import { installHooks, uninstallHooks, resolveHookBase, type HookName } from "./hook.js";
import { startMcpServer } from "./mcp.js";

function rewriteArgv(argv: string[]): string[] {
  const args = argv.slice(2);
  const subcommands = new Set(["check", "hook", "mcp", "detect-commands", "explain", "help"]);
  if (args.length === 0 || args[0]?.startsWith("-") || !subcommands.has(args[0] ?? "")) {
    return ["check", ...args];
  }
  return args;
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name("shipsane")
    .description(
      "Don't ship a green that isn't sane — re-run real checks and scan the diff for test tampering.",
    )
    .version("0.1.0");

  program
    .command("check")
    .description("Run verification commands and scan the worktree diff for test tampering")
    .argument("[dir]", "git repository", ".")
    .option("--base <ref>", "git ref to diff against (default: upstream default branch, else HEAD)")
    .option("--config <path>", "path to .shipsane.yml")
    .option("--only <mode>", "run just 'tamper' or just 'checks'")
    .option("--from-log <file>", "skip re-running; trust this log and its exit record")
    .option("--assume-ran", "skip re-running; require a fresh last-run log or fail")
    .option("--transcript <file>", "parse a session transcript for a false success claim")
    .option("--json", "print a JSON report")
    .option("--markdown", "print a Markdown report")
    .option("--fail-on-warning", "treat warnings (including allowlisted findings) as failures")
    .option("--timeout <seconds>", "per-command timeout in seconds (default 600)")
    .action(async (dir: string, opts: Record<string, unknown>) => {
      const only = opts.only;
      if (only != null && only !== "tamper" && only !== "checks") {
        throw new ShipsaneError("--only must be 'tamper' or 'checks'");
      }
      if (opts.json && opts.markdown) {
        throw new ShipsaneError("Choose at most one of --json or --markdown");
      }
      const timeout = opts.timeout != null ? Number(opts.timeout) : undefined;
      if (timeout != null && (!Number.isFinite(timeout) || timeout <= 0)) {
        throw new ShipsaneError("--timeout must be a positive number of seconds");
      }
      const format = opts.json ? "json" : opts.markdown ? "markdown" : "pretty";
      const report = await shipsaneCheck({
        cwd: resolve(dir),
        base: typeof opts.base === "string" ? opts.base : undefined,
        configPath: typeof opts.config === "string" ? opts.config : undefined,
        only: only as "tamper" | "checks" | undefined,
        fromLog: typeof opts.fromLog === "string" ? opts.fromLog : undefined,
        assumeRan: Boolean(opts.assumeRan),
        transcript: typeof opts.transcript === "string" ? opts.transcript : undefined,
        failOnWarning: Boolean(opts.failOnWarning),
        timeout,
      });
      const color = format === "pretty" && !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
      process.stdout.write(formatReport(report, format, color));
      writeGitHubOutputs(report);
      process.exitCode = report.exitCode;
    });

  program
    .command("detect-commands")
    .description("Print the verification commands shipsane would run")
    .argument("[dir]", "git repository or project root", ".")
    .action((dir: string) => {
      const cwd = resolve(dir);
      let root = cwd;
      try {
        root = findGitRoot(cwd);
      } catch {
        // still useful on a bare fixture directory
      }
      const { config } = loadConfig(root);
      const commands =
        config.commands && config.commands.length > 0 ? config.commands : detectCommands(root);
      if (commands.length === 0) {
        throw new ShipsaneError("No verification commands found.");
      }
      process.stdout.write(commands.map((c) => `${c}\n`).join(""));
    });

  program
    .command("explain")
    .description("Print a one-pager for a detector id")
    .argument("<rule>", `one of: ${RULE_IDS.join(", ")}`)
    .action((rule: string) => {
      if (!(rule in RULES)) {
        throw new ShipsaneError(`Unknown rule '${rule}'. Known: ${RULE_IDS.join(", ")}`);
      }
      process.stdout.write(`${formatRuleDoc(rule as RuleId)}\n`);
    });

  const hook = program.command("hook").description("Install or remove repo-local git hooks");
  hook
    .command("install")
    .description("Install a pre-commit and/or pre-push hook that runs `shipsane hook run`")
    .option("--pre-commit", "install the pre-commit hook")
    .option("--pre-push", "install the pre-push hook")
    .action((opts: { preCommit?: boolean; prePush?: boolean }) => {
      const names: HookName[] = [];
      if (opts.preCommit) names.push("pre-commit");
      if (opts.prePush) names.push("pre-push");
      const selected: HookName[] = names.length > 0 ? names : ["pre-commit", "pre-push"];
      const result = installHooks(process.cwd(), selected);
      process.stdout.write(`Installed ${result.installed.join(", ")} hook(s):\n`);
      for (const p of result.paths) process.stdout.write(`  ${p}\n`);
    });
  hook
    .command("run")
    .description("Run the check the way an installed hook would (pre-push reads refs from stdin)")
    .argument("<hook>", "pre-commit or pre-push")
    .action(async (name: string) => {
      if (name !== "pre-commit" && name !== "pre-push") {
        throw new ShipsaneError("hook run expects pre-commit or pre-push");
      }
      let stdin = "";
      if (name === "pre-push" && !process.stdin.isTTY) {
        stdin = readFileSync(0, "utf8");
      }
      const resolved = resolveHookBase(name, stdin);
      const report = await shipsaneCheck({
        cwd: process.cwd(),
        base: resolved.base,
      });
      const color = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
      process.stdout.write(formatReport(report, "pretty", color));
      writeGitHubOutputs(report);
      process.exitCode = report.exitCode;
    });
  hook
    .command("uninstall")
    .description("Remove hooks previously installed by shipsane")
    .action(() => {
      const result = uninstallHooks(process.cwd());
      if (result.removed.length === 0 && result.skipped.length === 0) {
        process.stdout.write("No shipsane hooks found.\n");
        return;
      }
      if (result.removed.length > 0) {
        process.stdout.write(`Removed ${result.removed.join(", ")}\n`);
      }
      for (const p of result.skipped) {
        process.stderr.write(`Left ${p} in place (not installed by shipsane).\n`);
      }
    });

  program
    .command("mcp")
    .description("Start the stdio MCP server (tool: shipsane_check)")
    .action(async () => {
      await startMcpServer();
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(["node", "shipsane", ...rewriteArgv(argv)]);
    return (process.exitCode as number | undefined) ?? 0;
  } catch (err) {
    if (err instanceof ShipsaneError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : String(err);
      if (code === "commander.helpDisplayed" || code === "commander.version") {
        process.stdout.write(message.endsWith("\n") ? message : `${message}\n`);
        return 0;
      }
      if (typeof code === "string" && code.startsWith("commander.")) {
        process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
        return 2;
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return 2;
  }
}

// This file is the bin entry (library consumers import `./index.js`). Always start.
main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(2);
  });
