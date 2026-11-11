import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { detectCommands, loadConfig } from "../src/index.js";
import { FIXTURES } from "./helpers.js";

test("detects npm test, typecheck, and lint", () => {
  const cmds = detectCommands(join(FIXTURES, "detect-npm"));
  assert.deepEqual(cmds, ["npm test", "npm run typecheck", "npm run lint"]);
});

test("detects pytest", () => {
  const cmds = detectCommands(join(FIXTURES, "detect-pytest"));
  assert.deepEqual(cmds, ["pytest"]);
});

test("detects cargo test", () => {
  const cmds = detectCommands(join(FIXTURES, "detect-cargo"));
  assert.deepEqual(cmds, ["cargo test"]);
});

test("detects go test", () => {
  const cmds = detectCommands(join(FIXTURES, "detect-go"));
  assert.deepEqual(cmds, ["go test ./..."]);
});

test("detects make test when nothing else is present", () => {
  const cmds = detectCommands(join(FIXTURES, "detect-make"));
  assert.deepEqual(cmds, ["make test"]);
});

test(".shipsane.yml commands override auto-detection", () => {
  const dir = join(FIXTURES, "detect-override");
  const { config } = loadConfig(dir);
  const cmds = config.commands && config.commands.length > 0 ? config.commands : detectCommands(dir);
  assert.deepEqual(cmds, ["python -m pytest", "make lint"]);
});
