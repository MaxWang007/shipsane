import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AllowRule, RuleId, ShipsaneConfig } from "./types.js";
import { RULE_IDS, ShipsaneError } from "./types.js";

function readYamlFile(path: string): ShipsaneConfig {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ShipsaneError(`Failed to parse ${path}: ${message}`);
  }
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ShipsaneError(`Invalid config in ${path}: expected a mapping`);
  }
  const obj = raw as Record<string, unknown>;
  const config: ShipsaneConfig = {};
  if (obj.commands !== undefined) {
    if (!Array.isArray(obj.commands) || obj.commands.some((c) => typeof c !== "string")) {
      throw new ShipsaneError(`Invalid config in ${path}: commands must be a list of strings`);
    }
    config.commands = obj.commands as string[];
  }
  if (obj.base !== undefined) {
    if (typeof obj.base !== "string") {
      throw new ShipsaneError(`Invalid config in ${path}: base must be a string`);
    }
    config.base = obj.base;
  }
  if (obj.timeout !== undefined) {
    const n = Number(obj.timeout);
    if (!Number.isFinite(n) || n <= 0) {
      throw new ShipsaneError(`Invalid config in ${path}: timeout must be a positive number`);
    }
    config.timeout = n;
  }
  if (obj.allow !== undefined) {
    if (!Array.isArray(obj.allow)) {
      throw new ShipsaneError(`Invalid config in ${path}: allow must be a list`);
    }
    config.allow = obj.allow.map((entry, i) => parseAllow(entry, path, i));
  }
  return config;
}

function parseAllow(entry: unknown, path: string, index: number): AllowRule {
  if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
    throw new ShipsaneError(`Invalid allow entry in ${path}[${index}]`);
  }
  const obj = entry as Record<string, unknown>;
  if (typeof obj.path !== "string" || typeof obj.rule !== "string") {
    throw new ShipsaneError(`Invalid allow entry in ${path}[${index}]: path and rule are required`);
  }
  if (typeof obj.reason !== "string" || !obj.reason.trim()) {
    throw new ShipsaneError(
      `Invalid allow entry in ${path}[${index}]: a non-empty reason is required`,
    );
  }
  const rule = obj.rule;
  if (!(RULE_IDS as readonly string[]).includes(rule)) {
    throw new ShipsaneError(`Invalid allow entry in ${path}[${index}]: unknown rule '${rule}'`);
  }
  return { path: obj.path, rule: rule as RuleId, reason: obj.reason.trim() };
}

function merge(base: ShipsaneConfig, overlay: ShipsaneConfig): ShipsaneConfig {
  return {
    commands: overlay.commands ?? base.commands,
    base: overlay.base ?? base.base,
    timeout: overlay.timeout ?? base.timeout,
    allow: overlay.allow ?? base.allow,
  };
}

export function loadConfig(cwd: string, configPath?: string): { config: ShipsaneConfig; sources: string[] } {
  if (configPath) {
    const resolved = isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
    if (!existsSync(resolved)) {
      throw new ShipsaneError(`Config file not found: ${resolved}`);
    }
    return { config: readYamlFile(resolved), sources: [resolved] };
  }

  const candidates = [
    join(homedir(), ".shipsane.yml"),
    join(homedir(), ".shipsane.yaml"),
    join(cwd, ".shipsane.yml"),
    join(cwd, ".shipsane.yaml"),
  ];
  let config: ShipsaneConfig = {};
  const sources: string[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    config = merge(config, readYamlFile(path));
    sources.push(path);
  }
  return { config, sources };
}
