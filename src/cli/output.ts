/**
 * CLI output helpers. Replaces direct console.log/console.error calls
 * in CLI commands with explicit stdout/stderr writes.
 */

/** Write a line to stdout (user-facing output). */
export function cliLog(message: string): void {
  process.stdout.write(message + "\n");
}

/** Write a line to stderr (error output). */
export function cliError(message: string): void {
  process.stderr.write(message + "\n");
}
