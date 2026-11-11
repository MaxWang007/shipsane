import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitLines } from "./paths.js";

function read(cwd: string, rel: string): string | undefined {
  const full = join(cwd, rel);
  if (!existsSync(full)) return undefined;
  try {
    return readFileSync(full, "utf8");
  } catch {
    return undefined;
  }
}

function detectNodeRunner(cwd: string): { bin: string; run: (script: string) => string } {
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) {
    return { bin: "bun", run: (s) => (s === "test" ? "bun test" : `bun run ${s}`) };
  }
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
    return { bin: "pnpm", run: (s) => (s === "test" ? "pnpm test" : `pnpm run ${s}`) };
  }
  if (existsSync(join(cwd, "yarn.lock"))) {
    return { bin: "yarn", run: (s) => (s === "test" ? "yarn test" : `yarn ${s}`) };
  }
  return { bin: "npm", run: (s) => (s === "test" ? "npm test" : `npm run ${s}`) };
}

const NPM_PLACEHOLDER = /no test specified/;

function isRealScript(value: string | undefined): value is string {
  if (!value || !value.trim()) return false;
  if (NPM_PLACEHOLDER.test(value)) return false;
  return true;
}

function hasMakefileTarget(content: string, target: string): boolean {
  const re = new RegExp(`^${target}\\s*:`, "m");
  return re.test(content);
}

function hasJustRecipe(content: string, target: string): boolean {
  const re = new RegExp(`^${target}(?:\\s+[^:]*)?:`, "m");
  return re.test(content) || new RegExp(`^${target}\\s`, "m").test(content);
}

function looksLikePythonTests(cwd: string): boolean {
  if (read(cwd, "pytest.ini") != null || read(cwd, "conftest.py") != null || read(cwd, "tox.ini") != null) {
    return true;
  }
  const pyproject = read(cwd, "pyproject.toml");
  if (pyproject && /\[tool\.pytest|pytest/.test(pyproject)) return true;
  return hasPythonTestFile(cwd, 2);
}

function hasPythonTestFile(dir: string, depth: number): boolean {
  if (depth < 0 || !existsSync(dir)) return false;
  try {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "node_modules" || name.name === ".git" || name.name === "dist" || name.name === "target") {
        continue;
      }
      const full = join(dir, name.name);
      if (name.isFile() && (/^test_.*\.py$/.test(name.name) || /_test\.py$/.test(name.name))) return true;
      if (name.isDirectory() && hasPythonTestFile(full, depth - 1)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function detectFromWorkflows(cwd: string): string[] {
  const dir = join(cwd, ".github", "workflows");
  if (!existsSync(dir)) return [];
  const commands: string[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    return [];
  }
  const interesting = /\b(npm test|npm run (?:test|typecheck|lint)|pnpm test|yarn test|pytest|cargo test|go test|make test)\b/;
  for (const file of files) {
    const text = read(cwd, join(".github/workflows", file));
    if (!text) continue;
    for (const line of splitLines(text)) {
      const m = line.match(/^\s*(?:-\s+)?run:\s*(?:\|\s*)?(.+)$/);
      const cmd = (m?.[1] ?? "").trim();
      if (cmd && interesting.test(cmd) && !commands.includes(cmd)) commands.push(cmd);
    }
  }
  return commands.slice(0, 5);
}

export function detectCommands(cwd: string): string[] {
  const commands: string[] = [];

  const pkgText = read(cwd, "package.json");
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      const runner = detectNodeRunner(cwd);
      if (isRealScript(scripts.test)) commands.push(runner.run("test"));
      const typeNames = ["typecheck", "type-check", "check-types", "check:types", "tsc"];
      for (const name of typeNames) {
        if (isRealScript(scripts[name])) {
          commands.push(runner.run(name));
          break;
        }
      }
      if (isRealScript(scripts.lint)) commands.push(runner.run("lint"));
    } catch {
      // ignore malformed package.json; other detectors may still flag it
    }
  }

  if (existsSync(join(cwd, "Cargo.toml"))) commands.push("cargo test");
  if (existsSync(join(cwd, "go.mod"))) commands.push("go test ./...");

  if (looksLikePythonTests(cwd)) {
    if (existsSync(join(cwd, "tox.ini"))) commands.push("tox");
    else commands.push("pytest");
  }

  if (commands.length === 0) {
    const makefile = read(cwd, "Makefile") ?? read(cwd, "makefile") ?? read(cwd, "GNUmakefile");
    if (makefile) {
      if (hasMakefileTarget(makefile, "test")) commands.push("make test");
      else if (hasMakefileTarget(makefile, "check")) commands.push("make check");
    }
  }

  if (commands.length === 0) {
    const justfile = read(cwd, "justfile") ?? read(cwd, "Justfile");
    if (justfile) {
      if (hasJustRecipe(justfile, "test")) commands.push("just test");
      else if (hasJustRecipe(justfile, "check")) commands.push("just check");
    }
  }

  if (commands.length === 0) {
    commands.push(...detectFromWorkflows(cwd));
  }

  return commands;
}
