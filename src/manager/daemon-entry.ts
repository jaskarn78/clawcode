/**
 * Daemon entry point script.
 * Used by the start-all command for background daemon spawning.
 *
 * Parses --config argument and calls startDaemon().
 */
import { startDaemon } from "./daemon.js";

function parseArgs(args: readonly string[]): string {
  const configIndex = args.indexOf("--config");
  if (configIndex !== -1 && configIndex + 1 < args.length) {
    return args[configIndex + 1] ?? "clawcode.yaml";
  }
  return "clawcode.yaml";
}

const configPath = parseArgs(process.argv);

startDaemon(configPath).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Daemon failed to start: ${message}`);
  process.exit(1);
});
