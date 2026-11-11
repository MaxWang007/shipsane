import type { DiffFile, Finding } from "../types.js";
import { basename, isTestConfigFile, splitLines } from "../paths.js";

const NARROW_FLAGS = [
  "--testPathPattern",
  "--testNamePattern",
  "--testPathIgnorePatterns",
  "--runTestsByPath",
  "--runInBand",
  "-t ",
  " --grep",
  "--grep=",
  "-k ",
  " -k ",
  "--ignore=",
  "--ignore ",
  "--deselect",
  "testPathIgnorePatterns",
  "testNamePattern",
  "testMatch",
];

const NARROW_TARGET_RE = /\b(safe[-_]?tests?|quick[-_]?tests?|passing[-_]?tests?|known[-_]?good|smoke[-_]?tests?|skip[-_]?failing)\b/i;

function parseScripts(jsonText: string): Record<string, string> {
  try {
    const pkg = JSON.parse(jsonText) as { scripts?: Record<string, unknown> };
    const scripts = pkg.scripts ?? {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(scripts)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function isTestScriptName(name: string): boolean {
  return (
    name === "test" ||
    name === "check" ||
    name === "lint" ||
    name === "typecheck" ||
    name === "type-check" ||
    name.startsWith("test:") ||
    name.startsWith("check:")
  );
}

function looksNarrower(oldCmd: string, newCmd: string): string | undefined {
  if (oldCmd.trim() === newCmd.trim()) return undefined;
  if (NARROW_TARGET_RE.test(newCmd) && !NARROW_TARGET_RE.test(oldCmd)) {
    const target = newCmd.match(NARROW_TARGET_RE)?.[0] ?? "safe-tests";
    return `command now points at a narrowed target (${target})`;
  }
  for (const flag of NARROW_FLAGS) {
    if (newCmd.includes(flag) && !oldCmd.includes(flag)) {
      return `added filter '${flag.trim()}'`;
    }
  }
  // Replacing a broad tool invocation with a list of explicit files/paths
  const oldFiles = (oldCmd.match(/\S+\.(?:test|spec)\.\w+/g) ?? []).length;
  const newFiles = (newCmd.match(/\S+\.(?:test|spec)\.\w+/g) ?? []).length;
  if (newFiles > oldFiles && !oldCmd.includes("testPathPattern")) {
    return "test script now lists a subset of test files";
  }
  // go test ./... or cargo test --workspace shrunk to a package
  if (/\.\/\.\.\.|--workspace|--all/.test(oldCmd) && !/\.\/\.\.\.|--workspace|--all/.test(newCmd)) {
    return "broad package selector removed from the test command";
  }
  return undefined;
}

function makeTargetRecipe(content: string, target: string): { recipe: string; line: number } | undefined {
  const lines = splitLines(content);
  const header = new RegExp(`^${target}\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (!header.test(lines[i] ?? "")) continue;
    const body: string[] = [lines[i] ?? ""];
    let j = i + 1;
    while (j < lines.length && /^(?:\t|[ ]{4})/.test(lines[j] ?? "")) {
      body.push(lines[j] ?? "");
      j++;
    }
    return { recipe: body.join("\n"), line: i + 1 };
  }
  return undefined;
}

function jsonPathLine(content: string, needle: string): number | undefined {
  const idx = content.indexOf(needle);
  if (idx < 0) return undefined;
  return content.slice(0, idx).split(/\r?\n/).length;
}

function parseIgnoreList(text: string, key: string): string[] {
  const re = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`, "s");
  const m = text.match(re);
  if (!m) return [];
  return (m[1] ?? "")
    .split(",")
    .map((s) => s.replace(/['"`]/g, "").trim())
    .filter(Boolean);
}

function patternValue(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`));
  return m?.[1];
}

export function detectConfigNarrowing(files: DiffFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const base = basename(file.path);
    if (base === "package.json") {
      const oldScripts = parseScripts(file.oldContent);
      const newScripts = parseScripts(file.newContent);
      for (const name of new Set([...Object.keys(oldScripts), ...Object.keys(newScripts)])) {
        if (!isTestScriptName(name)) continue;
        const oldCmd = oldScripts[name];
        const newCmd = newScripts[name];
        if (oldCmd == null && newCmd != null) continue;
        if (oldCmd != null && newCmd == null) {
          findings.push({
            rule: "command_narrowed",
            severity: "error",
            path: file.path,
            line: 1,
            message: `package.json script '${name}' was removed`,
            evidence: `- "${name}": "${oldCmd}"`,
          });
          continue;
        }
        if (oldCmd == null || newCmd == null) continue;
        const why = looksNarrower(oldCmd, newCmd);
        if (why) {
          findings.push({
            rule: "command_narrowed",
            severity: "error",
            path: file.path,
            line: jsonPathLine(file.newContent, `"${name}"`) ?? 1,
            message: `package.json script '${name}' narrowed: ${why}`,
            evidence: `- "${name}": "${oldCmd}"\n+ "${name}": "${newCmd}"`,
          });
        }
      }
    }

    if (base === "Makefile" || base === "makefile" || base === "GNUmakefile" || base === "justfile" || base === "Justfile") {
      for (const target of ["test", "check", "tests"]) {
        const oldT = makeTargetRecipe(file.oldContent, target);
        const newT = makeTargetRecipe(file.newContent, target);
        if (!oldT || !newT) continue;
        const why = looksNarrower(oldT.recipe, newT.recipe);
        if (why || (NARROW_TARGET_RE.test(newT.recipe) && !NARROW_TARGET_RE.test(oldT.recipe))) {
          findings.push({
            rule: "command_narrowed",
            severity: "error",
            path: file.path,
            line: newT.line,
            message: `${base} target '${target}' narrowed${why ? `: ${why}` : ""}`,
            evidence: `- ${oldT.recipe.split("\n").join("\n- ")}\n+ ${newT.recipe.split("\n").join("\n+ ")}`,
          });
        }
      }
    }

    if (
      /^jest\.config\./.test(base) ||
      /^vitest\.config\./.test(base) ||
      base === "package.json" ||
      base === "vite.config.ts" ||
      base === "vite.config.js"
    ) {
      const oldIgnore = parseIgnoreList(file.oldContent, "testPathIgnorePatterns");
      const newIgnore = parseIgnoreList(file.newContent, "testPathIgnorePatterns");
      if (newIgnore.length > oldIgnore.length) {
        const added = newIgnore.filter((x) => !oldIgnore.includes(x));
        findings.push({
          rule: "command_narrowed",
          severity: "error",
          path: file.path,
          line: jsonPathLine(file.newContent, "testPathIgnorePatterns"),
          message: `testPathIgnorePatterns grew (${added.join(", ") || "additional patterns"})`,
          evidence: `+ ${added.join(", ")}`,
        });
      }
      const oldPat = patternValue(file.oldContent, "testNamePattern");
      const newPat = patternValue(file.newContent, "testNamePattern");
      if (newPat && newPat !== oldPat) {
        findings.push({
          rule: "command_narrowed",
          severity: "error",
          path: file.path,
          line: jsonPathLine(file.newContent, "testNamePattern"),
          message: `testNamePattern set to ${JSON.stringify(newPat)}`,
          evidence: `${oldPat ? `- ${oldPat}\n` : ""}+ ${newPat}`,
        });
      }
    }

    if (base === "pytest.ini" || base === "setup.cfg" || base === "tox.ini" || base === "pyproject.toml") {
      const why = looksNarrower(file.oldContent, file.newContent);
      const addoptsNew = /addopts\s*[=:]\s*(.+)/.exec(file.newContent);
      const addoptsOld = /addopts\s*[=:]\s*(.+)/.exec(file.oldContent);
      if (
        (addoptsNew && looksNarrower(addoptsOld?.[1] ?? "", addoptsNew[1] ?? "")) ||
        why
      ) {
        const reason = addoptsNew
          ? looksNarrower(addoptsOld?.[1] ?? "", addoptsNew[1] ?? "") ?? why
          : why;
        if (reason) {
          findings.push({
            rule: "command_narrowed",
            severity: "error",
            path: file.path,
            line: jsonPathLine(file.newContent, "addopts") ?? 1,
            message: `${base} test selection narrowed: ${reason}`,
            evidence: `${addoptsOld ? `- addopts = ${addoptsOld[1]}\n` : ""}+ addopts = ${addoptsNew?.[1] ?? ""}`,
          });
        }
      }
    }

    // CI workflow run steps that used a broad test command and now a narrower one
    if (isTestConfigFile(file.path) && (file.path.includes(".github/workflows/") || file.path.includes(".gitlab-ci"))) {
      const why = looksNarrower(file.oldContent, file.newContent);
      if (why) {
        findings.push({
          rule: "command_narrowed",
          severity: "error",
          path: file.path,
          line: 1,
          message: `CI test step narrowed: ${why}`,
        });
      }
    }
  }
  return findings;
}
