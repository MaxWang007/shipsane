// Node 22's test runner expands globs. Node 20 does not, and `npm test`
// runs under a shell that does not expand `**`, so
// `tsx --test test/**/*.test.ts` looks for a literal path and exits
// with "Could not find .../test/**/*.test.ts". Hand tsx real files.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function collectTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectTests(full));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

const files = collectTests(join(root, "test")).sort();
if (files.length === 0) {
  console.error("No *.test.ts files found under test/");
  process.exit(1);
}

const result = spawnSync("tsx", ["--test", ...files], { cwd: root, stdio: "inherit" });
if (result.error) {
  console.error(`failed to start tsx: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
