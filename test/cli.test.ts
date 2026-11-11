import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupTemps,
  FIXTURES,
  git,
  loadFixtureRepo,
  runCli,
  trackTemp,
} from "./helpers.js";

after(() => cleanupTemps());

test("CLI --only tamper --json exits 1 and reports skip_added", () => {
  const dir = trackTemp(loadFixtureRepo("skip-added"));
  const result = runCli(["check", dir, "--base", "HEAD", "--only", "tamper", "--json"]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const json = JSON.parse(result.stdout) as { verdict: string; exitCode: number; findings: { rule: string; path: string; line?: number }[] };
  assert.equal(json.verdict, "not_sane");
  assert.equal(json.exitCode, 1);
  const hit = json.findings.find((f) => f.rule === "skip_added");
  assert.ok(hit);
  assert.equal(hit?.path, "test/ripple.test.js");
  assert.ok((hit?.line ?? 0) >= 1);
});

test("CLI --markdown includes rule ids and file:line", () => {
  const dir = trackTemp(loadFixtureRepo("test-deleted"));
  const result = runCli(["check", dir, "--base", "HEAD", "--only", "tamper", "--markdown"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /test_deleted/);
  assert.match(result.stdout, /tests\/ripple\.spec\.ts:\d+/);
  assert.match(result.stdout, /not sane/);
});

test("CLI exits 0 on a clean production fix plus a new real test", () => {
  const dir = trackTemp(loadFixtureRepo("clean-pass"));
  const result = runCli(["check", dir, "--base", "HEAD", "--only", "tamper"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Verdict: sane/);
});

test("CLI --only checks exits 1 even when stdout says all tests passed", () => {
  const dir = trackTemp(loadFixtureRepo("failing-checks"));
  const result = runCli(["check", dir, "--only", "checks"]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /not sane/);
  assert.match(result.stdout, /exit 1/);
});

test("CLI --from-log plus --transcript flags false_success", () => {
  const dir = trackTemp(loadFixtureRepo("false-success-transcript"));
  const log = join(FIXTURES, "false-success-transcript", "log.json");
  const transcript = join(FIXTURES, "false-success-transcript", "transcript.txt");
  const result = runCli([
    "check",
    dir,
    "--base",
    "HEAD",
    "--from-log",
    log,
    "--transcript",
    transcript,
    "--json",
  ]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const json = JSON.parse(result.stdout) as { findings: { rule: string }[] };
  assert.ok(json.findings.some((f) => f.rule === "false_success"));
});

test("CLI exits 2 when the path is not a git repository", () => {
  const dir = trackTemp(mkdtempSync(join(tmpdir(), "shipsane-nogit-")));
  const result = runCli(["check", dir, "--only", "tamper"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Not a git repository/i);
});

test("CLI exits 2 when --assume-ran has no log", () => {
  const dir = trackTemp(loadFixtureRepo("clean-pass"));
  const result = runCli(["check", dir, "--assume-ran", "--only", "checks"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /assume-ran|fresh log/i);
});

test("detect-commands prints auto-detected commands", () => {
  const result = runCli(["detect-commands", join(FIXTURES, "detect-npm")]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "npm test\nnpm run typecheck\nnpm run lint");
});

test("explain prints a one-pager for skip_added", () => {
  const result = runCli(["explain", "skip_added"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skip_added/);
  assert.match(result.stdout, /it\.skip/);
});

test("explain unknown rule exits 2", () => {
  const result = runCli(["explain", "not_a_rule"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown rule/);
});

test("hook install writes a hook that invokes shipsane check --base HEAD", () => {
  const dir = trackTemp(loadFixtureRepo("clean-pass"));
  const result = runCli(["hook", "install", "--pre-commit"], dir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const hook = join(dir, ".git", "hooks", "pre-commit");
  assert.ok(existsSync(hook));
  const body = readFileSync(hook, "utf8");
  assert.match(body, /shipsane-hook-v1/);
  assert.match(body, /shipsane check --base HEAD/);
});

test("hook uninstall removes only shipsane hooks", () => {
  const dir = trackTemp(loadFixtureRepo("clean-pass"));
  runCli(["hook", "install", "--pre-commit"], dir);
  const other = join(dir, ".git", "hooks", "pre-push");
  writeFileSync(other, "#!/bin/sh\necho leftover\n");
  const result = runCli(["hook", "uninstall"], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(join(dir, ".git", "hooks", "pre-commit")));
  assert.ok(existsSync(other));
});

test("end-to-end CLI: a fixture with three cheats is not sane", () => {
  // Compose a small repo that combines deletion, makefile narrowing, and a coverage drop —
  // the README / demo case. Start from the *before* tree so all three cheats are in the diff.
  const dir = trackTemp(loadFixtureRepo("test-deleted"));
  // loadFixtureRepo already applied the after/ deletions. Reset the test file to the
  // committed (before) contents, then recommit a full baseline and re-apply all cheats.
  git(dir, ["checkout", "HEAD", "--", "tests/ripple.spec.ts"]);
  writeFileSync(
    join(dir, "Makefile"),
    ".PHONY: test\ntest:\n\tcargo test --workspace\n",
  );
  writeFileSync(
    join(dir, "jest.config.js"),
    "module.exports = { coverageThreshold: { global: { lines: 80, branches: 80, functions: 80, statements: 80 } } };\n",
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "baseline with checks"]);
  writeFileSync(
    join(dir, "tests/ripple.spec.ts"),
    readFileSync(join(FIXTURES, "test-deleted", "after", "tests", "ripple.spec.ts"), "utf8"),
  );
  writeFileSync(
    join(dir, "Makefile"),
    ".PHONY: test safe-tests\ntest:\n\t$(MAKE) safe-tests\nsafe-tests:\n\tcargo test --lib\n",
  );
  writeFileSync(
    join(dir, "jest.config.js"),
    "module.exports = { coverageThreshold: { global: { lines: 60, branches: 45, functions: 60, statements: 60 } } };\n",
  );
  const result = runCli(["check", dir, "--base", "HEAD", "--only", "tamper"]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /test_deleted/);
  assert.match(result.stdout, /command_narrowed/);
  assert.match(result.stdout, /coverage_dropped/);
  assert.match(result.stdout, /Verdict: not sane\s+\(exit 1\)/);
});

test("MCP stdio server lists shipsane_check and returns a structured verdict", async () => {
  const dir = trackTemp(loadFixtureRepo("skip-added"));
  const { CLI, TSX_LOADER } = await import("./helpers.js");
  const proc = spawn(process.execPath, ["--import", TSX_LOADER, CLI, "mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });

  const chunks: Buffer[] = [];
  proc.stdout.on("data", (b: Buffer) => chunks.push(b));
  const errChunks: Buffer[] = [];
  proc.stderr.on("data", (b: Buffer) => errChunks.push(b));

  const send = (msg: unknown) => {
    proc.stdin.write(`${JSON.stringify(msg)}\n`);
  };

  const readMessages = async (minCount: number, timeoutMs = 8000): Promise<unknown[]> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const buf = Buffer.concat(chunks).toString("utf8");
      const messages = buf
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as unknown];
          } catch {
            return [];
          }
        });
      if (messages.length >= minCount) return messages;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `timed out waiting for MCP messages; stdout=${Buffer.concat(chunks).toString("utf8")} stderr=${Buffer.concat(errChunks).toString("utf8")}`,
    );
  };

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "shipsane-test", version: "0.0.0" },
    },
  });

  const first = await readMessages(1);
  const init = first[0] as { id: number; result?: { serverInfo?: { name: string } } };
  assert.equal(init.id, 1);
  assert.equal(init.result?.serverInfo?.name, "shipsane");

  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  const listed = (await readMessages(2)).find((m) => (m as { id?: number }).id === 2) as {
    result?: { tools?: { name: string }[] };
  };
  assert.ok(listed?.result?.tools?.some((t) => t.name === "shipsane_check"));

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "shipsane_check",
      arguments: { cwd: dir, base: "HEAD", only: "tamper" },
    },
  });

  const called = (await readMessages(3)).find((m) => (m as { id?: number }).id === 3) as {
    result?: {
      isError?: boolean;
      structuredContent?: { verdict?: string; exitCode?: number; findings?: { rule: string }[] };
      content?: { type: string; text: string }[];
    };
  };
  const payload = called?.result;
  assert.ok(payload, `missing tools/call result: ${JSON.stringify(called)}`);
  const structured = payload.structuredContent;
  const fromText = payload.content?.find((c) => c.text.startsWith("{"));
  const body = structured ?? (fromText ? (JSON.parse(fromText.text) as { verdict: string; findings: { rule: string }[] }) : undefined);
  assert.ok(body, `no structured verdict: ${JSON.stringify(payload)}`);
  assert.equal(body.verdict, "not_sane");
  const findings = (body as { findings?: { rule: string }[] }).findings ?? [];
  assert.ok(findings.some((f) => f.rule === "skip_added"));

  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => proc.once("close", () => resolve()));
});
