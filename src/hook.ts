import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findGitRoot } from "./git.js";
import { ShipsaneError } from "./types.js";

export const HOOK_MARKER = "# shipsane-hook-v1 -- do not edit; installed by `shipsane hook install`";

export type HookName = "pre-commit" | "pre-push";

function hookBody(kind: HookName): string {
  return `#!/bin/sh
${HOOK_MARKER}
# hook-type: ${kind}
set -e
here=$(git rev-parse --show-toplevel)
if command -v shipsane >/dev/null 2>&1; then
  exec shipsane check --base HEAD
elif [ -x "$here/node_modules/.bin/shipsane" ]; then
  exec "$here/node_modules/.bin/shipsane" check --base HEAD
else
  exec npx --yes shipsane check --base HEAD
fi
`;
}

function hooksDir(gitRoot: string): string {
  return join(gitRoot, ".git", "hooks");
}

function hookPath(gitRoot: string, name: HookName): string {
  return join(hooksDir(gitRoot), name);
}

export function isShipsaneHook(contents: string): boolean {
  return contents.includes("shipsane-hook-v1");
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
