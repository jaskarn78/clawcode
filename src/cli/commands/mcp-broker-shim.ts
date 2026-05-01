import type { Command } from "commander";
import * as net from "node:net";
import * as crypto from "node:crypto";
import { homedir } from "node:os";
import pino, { type Logger } from "pino";
import { cliError } from "../output.js";

/**
 * Phase 108 — `clawcode mcp-broker-shim --pool 1password` command.
 *
 * Per-agent stdio bridge that the SDK spawns instead of `npx 1password-mcp`.
 * The shim:
 *
 *   1. Connects to the daemon's broker unix socket.
 *   2. Writes a single handshake JSON line { agent, tokenHash } as the first
 *      thing on the socket. The token literal is hashed in-shim (sha256,
 *      first 8 hex chars) so it never crosses the wire.
 *   3. Switches into transparent byte-pipe mode:
 *        agent stdin → broker socket
 *        broker socket → agent stdout
 *      No JSON re-parsing. The broker's id-rewriter relies on byte identity.
 *   4. On socket close (daemon restart / broker shutdown) resolves with a
 *      non-zero exit code (75 / EX_TEMPFAIL) so the SDK detects MCP child
 *      exit and reconnects on the agent's next tool need (Pitfall 5).
 *
 * Token redaction is mandatory (Phase 104 SEC-07): the literal
 * OP_SERVICE_ACCOUNT_TOKEN value MUST NEVER appear in shim logs nor in any
 * error written to agent stdout.
 */

/** Exit code constants. */
export const SHIM_EXIT_OK = 0;
export const SHIM_EXIT_USAGE = 64; // EX_USAGE — missing required env
export const SHIM_EXIT_TEMPFAIL = 75; // EX_TEMPFAIL — socket closed; SDK should retry

/** Subset of net.Socket the shim depends on. */
export type ShimSocket = NodeJS.ReadWriteStream & NodeJS.EventEmitter;

export type ShimDeps = {
  /** Agent-side stdin (defaults to process.stdin). */
  stdin: NodeJS.ReadableStream;
  /** Agent-side stdout (defaults to process.stdout). */
  stdout: NodeJS.WritableStream;
  /**
   * Test injection point: yields the duplex socket the shim will use.
   * Defaults to `net.createConnection({ path: env.CLAWCODE_BROKER_SOCKET })`.
   */
  connectSocket: () => Promise<ShimSocket>;
  /** Environment map. Defaults to process.env. */
  env: Record<string, string | undefined>;
  /** Optional pino logger. Defaults to a stderr-bound logger with redaction. */
  log?: Logger;
};

export type RunShimOptions = ShimDeps & {
  /** Pool name. Currently only "1password" is supported. */
  pool: "1password";
};

// Default to the daemon's MANAGER_DIR-based socket path (matches
// MCP_BROKER_SOCKET_PATH in src/manager/daemon.ts). Both daemon and shim
// run as the same user (clawcode), so homedir() resolves identically.
const DEFAULT_BROKER_SOCKET = `${homedir()}/.clawcode/manager/mcp-broker.sock`;

/** Compute the 8-char tokenHash used by both shim and broker. */
function computeTokenHash(tokenLiteral: string): string {
  return crypto
    .createHash("sha256")
    .update(tokenLiteral)
    .digest("hex")
    .slice(0, 8);
}

function makeDefaultLogger(stderr: NodeJS.WritableStream): Logger {
  return pino(
    {
      level: process.env.CLAWCODE_LOG_LEVEL ?? "info",
      // SEC-07: belt-and-suspenders redaction. Even if the shim accidentally
      // logs an object containing the token literal, pino strips it.
      redact: {
        paths: [
          "tokenLiteral",
          "*.tokenLiteral",
          "OP_SERVICE_ACCOUNT_TOKEN",
          "*.OP_SERVICE_ACCOUNT_TOKEN",
          "env.OP_SERVICE_ACCOUNT_TOKEN",
        ],
        remove: true,
      },
    },
    stderr,
  );
}

/**
 * Run the shim until the socket closes or stdin ends.
 * Returns the numeric exit code the CLI process should use.
 */
export async function runShim(opts: RunShimOptions): Promise<number> {
  const env = opts.env;
  const agent = env.CLAWCODE_AGENT ?? "";
  const tokenLiteral = env.OP_SERVICE_ACCOUNT_TOKEN ?? "";
  const log =
    opts.log ?? makeDefaultLogger(process.stderr);

  if (!agent) {
    log.error(
      { component: "mcp-broker-shim" },
      "CLAWCODE_AGENT is required",
    );
    return SHIM_EXIT_USAGE;
  }
  if (!tokenLiteral) {
    log.error(
      { component: "mcp-broker-shim", agent },
      "OP_SERVICE_ACCOUNT_TOKEN is required",
    );
    return SHIM_EXIT_USAGE;
  }

  const tokenHash = computeTokenHash(tokenLiteral);
  const childLog = log.child({
    component: "mcp-broker-shim",
    agent,
    tokenHash,
    pool: opts.pool,
  });

  let socket: ShimSocket;
  try {
    socket = await opts.connectSocket();
  } catch (err) {
    childLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      "failed to connect to broker socket",
    );
    return SHIM_EXIT_TEMPFAIL;
  }

  return new Promise<number>((resolve) => {
    let resolved = false;
    const finish = (code: number): void => {
      if (resolved) return;
      resolved = true;
      // Best-effort: stop forwarding stdin to a closed socket.
      opts.stdin.unpipe?.(socket as NodeJS.WritableStream);
      resolve(code);
    };

    socket.on("error", (err: Error) => {
      // Log with tokenHash only — never tokenLiteral.
      childLog.warn(
        { err: err.message },
        "broker socket error",
      );
      finish(SHIM_EXIT_TEMPFAIL);
    });

    socket.on("close", () => {
      childLog.info("broker socket closed; exiting for SDK to reconnect");
      finish(SHIM_EXIT_TEMPFAIL);
    });

    // Real net.Socket emits 'end' on FIN; PassThrough-based fake emits 'end'
    // when peer ends. Treat both as the same broker-gone signal.
    socket.on("end", () => {
      childLog.info("broker socket ended; exiting for SDK to reconnect");
      finish(SHIM_EXIT_TEMPFAIL);
    });

    opts.stdin.on("end", () => {
      // Agent closed stdio cleanly — normal exit. Half-close the socket so
      // the broker can drain inflight, then resolve 0.
      try {
        (socket as { end?: () => void }).end?.();
      } catch {
        /* ignore */
      }
      finish(SHIM_EXIT_OK);
    });

    opts.stdin.on("error", (err: Error) => {
      childLog.warn({ err: err.message }, "agent stdin error");
      finish(SHIM_EXIT_TEMPFAIL);
    });

    // Step 1: handshake. NEVER include the token literal — only its hash.
    const handshake = JSON.stringify({ agent, tokenHash }) + "\n";
    try {
      (socket as NodeJS.WritableStream).write(handshake);
    } catch (err) {
      childLog.error(
        { err: err instanceof Error ? err.message : String(err) },
        "failed to write handshake",
      );
      finish(SHIM_EXIT_TEMPFAIL);
      return;
    }

    // Step 2: byte-transparent pipe. Don't end either side on source end —
    // we manage shutdown via the explicit handlers above.
    opts.stdin.pipe(socket as NodeJS.WritableStream, { end: false });
    (socket as NodeJS.ReadableStream).pipe(opts.stdout, { end: false });

    // SIGTERM (daemon-managed restart, operator kill) → graceful shutdown.
    const onSigterm = (): void => {
      childLog.info("SIGTERM received; ending broker socket");
      try {
        (socket as { end?: () => void }).end?.();
      } catch {
        /* ignore */
      }
      finish(SHIM_EXIT_OK);
    };
    process.once("SIGTERM", onSigterm);
  });
}

/**
 * Register the `mcp-broker-shim` subcommand with the commander program.
 *
 * Mirrors the existing `browser-mcp` / `search-mcp` / `image-mcp` shape so
 * the SDK can spawn `clawcode mcp-broker-shim --pool 1password` as a stdio
 * MCP child per agent.
 */
export function registerMcpBrokerShimCommand(program: Command): void {
  program
    .command("mcp-broker-shim")
    .description(
      "Per-agent stdio bridge to the daemon's mcp-broker unix socket (Phase 108)",
    )
    .option("--pool <name>", "Pool name (currently only '1password')", "1password")
    .option(
      "--socket <path>",
      "Override broker socket path (defaults to CLAWCODE_BROKER_SOCKET env or /var/run/clawcode/mcp-broker.sock)",
    )
    .action(async (options: { pool: string; socket?: string }) => {
      try {
        const pool = options.pool;
        if (pool !== "1password") {
          cliError(`Unsupported pool: ${pool} (only '1password' is supported)`);
          process.exit(SHIM_EXIT_USAGE);
        }
        const socketPath =
          options.socket ??
          process.env.CLAWCODE_BROKER_SOCKET ??
          DEFAULT_BROKER_SOCKET;

        const code = await runShim({
          pool: "1password",
          stdin: process.stdin,
          stdout: process.stdout,
          env: process.env,
          connectSocket: async () => net.createConnection({ path: socketPath }),
        });
        process.exit(code);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        cliError(`Error in mcp-broker-shim: ${msg}`);
        process.exit(SHIM_EXIT_TEMPFAIL);
      }
    });
}
