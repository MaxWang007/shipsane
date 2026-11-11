/** Shared path and language helpers used by detectors. */

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function basename(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

export function isTestFile(path: string): boolean {
  const p = normalizePath(path);
  const base = basename(p);
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true;
  if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base)) return true;
  if (/_test\.go$/.test(base)) return true;
  if (/_test\.rs$/.test(base)) return true;
  if (base.endsWith("Test.java") || base.endsWith("Tests.java") || base.endsWith("Test.kt")) {
    return true;
  }
  if (p.includes("/__tests__/") || p.includes("/__test__/")) return true;
  if (/(^|\/)tests?\//.test(p) && /\.(py|js|ts|tsx|jsx|mjs|cjs|rb|java|kt|rs)$/.test(base)) {
    return true;
  }
  if (/(^|\/)tests?\/.*\.rs$/.test(p)) return true;
  return false;
}

export function isTestConfigFile(path: string): boolean {
  const p = normalizePath(path);
  const base = basename(p);
  if (
    base === "package.json" ||
    base === "Makefile" ||
    base === "makefile" ||
    base === "GNUmakefile" ||
    base === "justfile" ||
    base === "Justfile"
  ) {
    return true;
  }
  if (
    base === "pytest.ini" ||
    base === "tox.ini" ||
    base === "setup.cfg" ||
    base === "pyproject.toml" ||
    base === "conftest.py" ||
    base === "Cargo.toml"
  ) {
    return true;
  }
  if (/^jest\.config\./.test(base) || /^vitest\.config\./.test(base)) return true;
  if (base === "karma.conf.js" || base === "karma.conf.ts") return true;
  if (
    base === ".coveragerc" ||
    base === "codecov.yml" ||
    base === "codecov.yaml" ||
    base === ".codecov.yml" ||
    base === "lcovrc"
  ) {
    return true;
  }
  if (base === ".nycrc" || base === ".nycrc.json" || base === ".nycrc.yml") return true;
  if (p.includes(".github/workflows/") && /\.ya?ml$/.test(base)) return true;
  if (p.includes(".circleci/") && /\.ya?ml$/.test(base)) return true;
  if (base === ".gitlab-ci.yml") return true;
  return false;
}

export function isShellish(path: string): boolean {
  const base = basename(path);
  return /\.(sh|bash|zsh)$/.test(base) || base === "Makefile" || base === "makefile";
}

export function globToRegExp(pattern: string): RegExp {
  const n = normalizePath(pattern);
  let re = "^";
  for (let i = 0; i < n.length; i++) {
    const c = n[i]!;
    if (c === "*" && n[i + 1] === "*") {
      const next = n[i + 2];
      if (next === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if ("+.|()[]{}^$\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

export function matchPath(pattern: string, path: string): boolean {
  const n = normalizePath(path);
  const p = normalizePath(pattern);
  if (p === n) return true;
  if (n.endsWith(`/${p}`)) return true;
  return globToRegExp(p).test(n);
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/\r?\n/);
}
