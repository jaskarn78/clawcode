import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { CheckModule } from "./types.js";

/**
 * Discover health check modules from a directory.
 *
 * Scans the given directory for .ts and .js files (excluding .test.ts and .d.ts),
 * dynamically imports each, and validates the default export has a name (string)
 * and execute (function). Invalid modules are silently skipped.
 *
 * @param checksDir - Absolute path to the checks directory
 * @returns Array of valid CheckModule instances
 */
export async function discoverChecks(
  checksDir: string,
): Promise<readonly CheckModule[]> {
  let files: string[];
  try {
    files = readdirSync(checksDir);
  } catch {
    return [];
  }

  const checkFiles = files.filter((file) => {
    if (file.endsWith(".test.ts") || file.endsWith(".d.ts")) {
      return false;
    }
    return file.endsWith(".ts") || file.endsWith(".js");
  });

  const modules: CheckModule[] = [];

  for (const file of checkFiles) {
    try {
      const mod = await import(join(checksDir, file));
      const exported = mod.default;

      if (
        exported &&
        typeof exported.name === "string" &&
        typeof exported.execute === "function"
      ) {
        modules.push(exported as CheckModule);
      }
    } catch {
      // Skip modules that fail to import
    }
  }

  return modules;
}
