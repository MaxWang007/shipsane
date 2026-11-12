import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const require = createRequire(join(REPO_ROOT, "package.json"));
export const TSX_LOADER = pathToFileURL(require.resolve("tsx")).href;


export interface SpawnResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function git(cwd: string, args: string[]): SpawnResult {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=shipsane-test",
      "-c",
      "user.email=shipsane@test.local",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function runCli(args: string[], cwd?: string, env?: NodeJS.ProcessEnv, input?: string): SpawnResult {
  const result = spawnSync(process.execPath, ["--import", TSX_LOADER, CLI, ...args], {
    cwd: cwd ?? REPO_ROOT,
    encoding: "utf8",
    input,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...(env ?? {}) },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function listFiles(root: string, dir = root, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(root, full, acc);
    else acc.push(full.slice(root.length + 1).replace(/\\/g, "/"));
  }
  return acc;
}

/** Copy `after/` over a tree that already has `before/`, deleting files that disappeared. */
export function applyAfterTree(repo: string, afterDir: string): void {
  const beforeFiles = listFiles(repo);
  const afterFiles = listFiles(afterDir);
  const afterSet = new Set(afterFiles);
  for (const rel of beforeFiles) {
    if (!afterSet.has(rel)) rmSync(join(repo, rel), { force: true });
  }
  for (const rel of afterFiles) {
    const dest = join(repo, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(afterDir, rel), dest);
  }
}

/**
 * Build a throwaway git repo from a named fixture:
 * commit the `before/` tree, then apply `after/` as an uncommitted worktree.
 */
export function loadFixtureRepo(name: string): string {
  const src = join(FIXTURES, name);
  const before = join(src, "before");
  const after = join(src, "after");
  if (!existsSync(before)) {
    throw new Error(`fixture '${name}' is missing a before/ directory`);
  }
  const dir = mkdtempSync(join(tmpdir(), `shipsane-${name}-`));
  cpSync(before, dir, { recursive: true });
  const init = git(dir, ["init", "-b", "main"]);
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  git(dir, ["add", "-A"]);
  const commit = git(dir, ["commit", "-m", "before", "--allow-empty"]);
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}\n${commit.stdout}`);
  if (existsSync(after)) applyAfterTree(dir, after);
  return dir;
}

export function readExpected(name: string): { findings: { rule: string; path?: string; severity?: string }[] } {
  const path = join(FIXTURES, name, "expected.json");
  return JSON.parse(readFileSync(path, "utf8")) as {
    findings: { rule: string; path?: string; severity?: string }[];
  };
}

const TEMPS: string[] = [];

export function trackTemp(dir: string): string {
  TEMPS.push(dir);
  return dir;
}

export function cleanupTemps(): void {
  for (const dir of TEMPS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export { join, FIXTURES as fixturesDir };
