import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { shipsaneCheck } from "./index.js";
import { formatReport } from "./report.js";
import type { CheckOptions } from "./types.js";
import { ShipsaneError } from "./types.js";

export const SHIPSANE_CHECK_TOOL = {
  name: "shipsane_check",
  description:
    "Independently verify that the current git changes are safe to ship: re-run the project's real test/lint/typecheck commands and scan the diff for skipped, deleted, or weakened tests, narrowed test commands, coverage-threshold drops, and masked exit codes. Do not decide 'done' from your own prior test run; call this tool and trust its verdict.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cwd: { type: "string", description: "Path to the git repository (defaults to the current working directory)." },
      base: { type: "string", description: "Git ref to diff against." },
      only: { type: "string", enum: ["tamper", "checks"], description: "Run only the diff detectors, or only the verification commands." },
    },
  },
};

export function createMcpServer(): Server {
  const server = new Server(
    { name: "shipsane", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [SHIPSANE_CHECK_TOOL],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (name !== "shipsane_check") {
      throw new Error(`Unknown tool: ${name}`);
    }
    const args = (request.params.arguments ?? {}) as {
      cwd?: unknown;
      base?: unknown;
      only?: unknown;
    };
    const options: CheckOptions = {};
    if (typeof args.cwd === "string") options.cwd = args.cwd;
    if (typeof args.base === "string") options.base = args.base;
    if (args.only === "tamper" || args.only === "checks") options.only = args.only;

    try {
      const report = await shipsaneCheck(options);
      const pretty = formatReport(report, "pretty", false);
      return {
        content: [
          { type: "text" as const, text: pretty },
          { type: "text" as const, text: JSON.stringify(report, null, 2) },
        ],
        structuredContent: {
          verdict: report.verdict,
          exitCode: report.exitCode,
          findings: report.findings,
          checks: report.checks.map((c) => ({
            command: c.command,
            exitCode: c.exitCode,
            timedOut: c.timedOut,
            durationMs: c.durationMs,
          })),
          base: report.base,
          cwd: report.cwd,
        },
        isError: !report.sane,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTool = err instanceof ShipsaneError;
      return {
        content: [{ type: "text" as const, text: isTool ? message : `shipsane error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // connect() resolves once the transport is up; stay alive until stdin closes
  // so the CLI entrypoint does not process.exit while a client is attached.
  await new Promise<void>((resolve) => {
    const done = () => {
      void server.close().finally(resolve);
    };
    if (process.stdin.readableEnded) {
      done();
      return;
    }
    process.stdin.once("end", done);
    process.stdin.once("close", done);
  });
}
