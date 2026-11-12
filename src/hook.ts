import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findGitRoot } from "./git.js";
import { ShipsaneError } from "./types.js";

/** Written into installed hooks. Older v1 hooks are still recognized and replaced. */
export const HOOK_MARKER = "# shipsane-hook-v2 -- do not edit; installed by `shipsane hook install`";

export type HookName = "pre-commit" | "pre-push";

const ZERO_SHA = /^0+$/;

export function isShipsaneHook(contents: string): boolean {
  return /shipsane-hook-v\d+/.test(contents);
}

/**
 * Decide the git base an installed hook should pass to `shipsane check`.
 *
 * pre-commit compares the worktree to HEAD (uncommitted changes).
 * pre-push compares the commits being pushed to the remote tip supplied on
 * stdin. An all-zero remote SHA means a new branch: leave `base` unset so
 * shipsane auto-detects the upstream default branch, instead of diffing
 * against HEAD (which is a no-op once the worktree is clean).
 */
export function resolveHookBase(kind: HookName, stdin = ""): { base?: string } {
  if (kind === "pre-commit") return { base: "HEAD" };
  for (const raw of stdin.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[ \t]+/);
    const remoteSha = parts[3] ?? "";
    if (remoteSha && !ZERO_SHA.test(remoteSha)) return { base: remoteSha };
  }
  return {};
}

function hookBody(kind: HookName): string {
  return `#!/bin/sh
${HOOK_MARKER}
# hook-type: ${kind}
set -e
here=$(git rev-parse --show-toplevel)
if command -v shipsane >/dev/null 2>&1; then
  exec shipsane hook run ${kind}
elif [ -x "$here/node_modules/.bin/shipsane" ]; then
  exec "$here/node_modules/.bin/shipsane" hook run ${kind}
else
  exec npx --yes shipsane hook run ${kind}
fi
`;
}

function hooksDir(gitRoot: string): string {
  return join(gitRoot, ".git", "hooks");
}

function hookPath(gitRoot: string, name: HookName): string {
  return join(hooksDir(gitRoot), name);
}

export function installHooks(cwd: string, names: HookName[]): { installed: HookName[]; paths: string[] } {
  const gitRoot = findGitRoot(cwd);
  const dir = hooksDir(gitRoot);
  mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const name of names) {
    const path = hookPath(gitRoot, name);
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf8");
      if (!isShipsaneHook(existing)) {
        throw new ShipsaneError(
          `${path} already exists and was not installed by shipsane. Remove it or rename it first.`,
        );
      }
    }
    writeFileSync(path, hookBody(name), { encoding: "utf8" });
    chmodSync(path, 0o755);
    paths.push(path);
  }
  return { installed: names, paths };
}

export function uninstallHooks(cwd: string): { removed: HookName[]; skipped: string[] } {
  const gitRoot = findGitRoot(cwd);
  const removed: HookName[] = [];
  const skipped: string[] = [];
  for (const name of ["pre-commit", "pre-push"] as HookName[]) {
    const path = hookPath(gitRoot, name);
    if (!existsSync(path)) continue;
    const existing = readFileSync(path, "utf8");
    if (!isShipsaneHook(existing)) {
      skipped.push(path);
      continue;
    }
    unlinkSync(path);
    removed.push(name);
  }
  return { removed, skipped };
}
