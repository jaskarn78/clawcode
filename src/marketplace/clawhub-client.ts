/**
 * Phase 90 Plan 04 HUB-01/HUB-03/HUB-06 — pure-function HTTP client for the
 * clawhub.ai skill registry. Uses Node 22's native `globalThis.fetch` (no new
 * npm dep); injectable via a `ClawhubClientDeps` struct for hermetic tests.
 *
 * Two operations:
 *   - fetchClawhubSkills({baseUrl, query?, cursor?, authToken?}) — lists
 *     skills, cursor-paginated (D-03). Returns `{items, nextCursor}` matching
 *     the shape probed from https://clawhub.ai/api/v1/skills on 2026-04-24.
 *   - downloadClawhubSkill({downloadUrl, stagingDir, authToken?}) — streams
 *     the tar.gz to `<stagingDir>/skill.tar.gz`, extracts via `tar -xzf` into
 *     `<stagingDir>/extracted/`, returns the file list.
 *
 * Error classes (discriminated so the installer can map to outcome variants):
 *   - ClawhubRateLimitedError  (429 with Retry-After)
 *   - ClawhubAuthRequiredError (401/403)
 *   - ClawhubManifestInvalidError (malformed response body)
 *
 * Canary blueprint (Phase 85 performMcpReadinessHandshake pattern): zero
 * module-level state, all I/O DI'd through `deps.fetch`, static User-Agent
 * reads package.json at import time once. No logger — caller logs after
 * catching the typed errors.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir as mkdirP, writeFile as writeFileP } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// User-Agent: read package.json once at import time so every request attributes
// rate-limit quotas back to a specific ClawCode release (D-02).
// ---------------------------------------------------------------------------

const PKG_VERSION: string = (() => {
  try {
    const pkgJson = readFileSync(
      new URL("../../package.json", import.meta.url),
      "utf8",
    );
    const parsed = JSON.parse(pkgJson) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const USER_AGENT = `ClawCode/${PKG_VERSION} (clawcode-marketplace)`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One skill item in the ClawHub `/api/v1/skills` list response.
 *
 * Required fields (always present per D-01 probe): id, name, description,
 * version, author, downloadUrl. Optional fields vary by backend version —
 * consumers must defensively handle undefined on non-core fields.
 */
export type ClawhubSkillListItem = Readonly<{
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloadUrl: string;
  manifestUrl?: string;
  rating?: number;
  downloadCount?: number;
  category?: string;
  tags?: readonly string[];
  createdAt?: string;
  updatedAt?: string;
}>;

/**
 * Response body shape of `GET /api/v1/skills?q=...&cursor=...`.
 * Verified via live probe 2026-04-24: empty registry returns
 * `{"items":[],"nextCursor":null}` — exact field names preserved.
 */
export type ClawhubSkillsResponse = Readonly<{
  items: readonly ClawhubSkillListItem[];
  nextCursor: string | null;
}>;

/**
 * DI struct. Absent → production globals. Present → test overrides. Never
 * store these on a module singleton — pass through every call site.
 */
export type ClawhubClientDeps = Readonly<{
  fetch: typeof globalThis.fetch;
}>;

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * 429 from the registry with a Retry-After window. `retryAfterMs` is the
 * parsed header value in milliseconds — caller should stash it in the cache
 * negative entry so subsequent picks within the window fail fast without a
 * round-trip.
 */
export class ClawhubRateLimitedError extends Error {
  public readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message: string) {
    super(message);
    this.name = "ClawhubRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * 401/403 from the registry — either the token is absent (public endpoint
 * returned unauth despite being unauthenticated — unusual but possible under
 * heavy load) or the supplied token is rejected. Plan 90-06 adds the
 * interactive re-auth flow; for Plan 04 the installer surfaces this as the
 * `auth-required` outcome variant and lets the operator handle it.
 */
export class ClawhubAuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClawhubAuthRequiredError";
  }
}

/**
 * Response body did not match the expected shape — malformed JSON, missing
 * `items[]`, corrupt tarball, missing SKILL.md. Distinguished from a plain
 * HTTP error so the installer returns the `manifest-invalid` outcome.
 */
export class ClawhubManifestInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClawhubManifestInvalidError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse Retry-After header (seconds) into ms, fallback 60s. */
function parseRetryAfter(res: Response): number {
  const raw = res.headers.get("Retry-After");
  if (raw !== null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n * 1000;
  }
  return 60_000;
}

function buildHeaders(authToken: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (authToken !== undefined && authToken.length > 0) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  return headers;
}

/**
 * Walk a directory recursively, returning absolute file paths (files only,
 * no directories). Used by downloadClawhubSkill to enumerate the extracted
 * tarball contents for the caller's audit.
 */
async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await recurse(p);
      } else if (e.isFile()) {
        out.push(p);
      }
    }
  }
  await recurse(root);
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * GET <baseUrl>/api/v1/skills?q=<query>&cursor=<cursor>
 *
 * Query semantics (D-04): ClawHub backend handles vector search; we just
 * URL-encode and forward.
 *
 * Cursor semantics (D-03): opaque string from a prior response's
 * `nextCursor`. Null → no more pages.
 *
 * Error-mapping (HUB-06 install-outcome fuel):
 *   - 429 → ClawhubRateLimitedError (+ Retry-After in ms)
 *   - 401|403 → ClawhubAuthRequiredError
 *   - other !ok → generic Error with status text
 *   - body missing items[] → ClawhubManifestInvalidError
 */
export async function fetchClawhubSkills(
  args: Readonly<{
    baseUrl: string;
    query?: string;
    cursor?: string;
    authToken?: string;
    deps?: ClawhubClientDeps;
  }>,
): Promise<ClawhubSkillsResponse> {
  const fetchFn = args.deps?.fetch ?? globalThis.fetch;
  // Append "/api/v1/skills" to whatever path baseUrl already has (so a
  // baseUrl of "http://localhost/mock" yields "/mock/api/v1/skills", and
  // the canonical "https://clawhub.ai" yields "/api/v1/skills"). Trailing
  // slash handled either way.
  const trimmedBase = args.baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (args.query !== undefined && args.query.length > 0) {
    params.set("q", args.query);
  }
  if (args.cursor !== undefined && args.cursor.length > 0) {
    params.set("cursor", args.cursor);
  }
  const qs = params.toString();
  const urlStr = `${trimmedBase}/api/v1/skills${qs.length > 0 ? `?${qs}` : ""}`;

  const res = await fetchFn(urlStr, {
    headers: buildHeaders(args.authToken),
  });

  if (res.status === 429) {
    const retryAfterMs = parseRetryAfter(res);
    throw new ClawhubRateLimitedError(
      retryAfterMs,
      `clawhub: rate-limited (retry in ${retryAfterMs}ms)`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ClawhubAuthRequiredError(
      `clawhub: auth required (status ${res.status})`,
    );
  }
  if (!res.ok) {
    throw new Error(`clawhub: ${res.status} ${res.statusText}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new ClawhubManifestInvalidError(
      `clawhub: response is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (
    body === null ||
    typeof body !== "object" ||
    !Array.isArray((body as { items?: unknown }).items)
  ) {
    throw new ClawhubManifestInvalidError(
      "clawhub: malformed response (no items[])",
    );
  }
  const parsed = body as ClawhubSkillsResponse;
  return Object.freeze({
    items: Object.freeze(parsed.items.map((i) => Object.freeze(i))),
    nextCursor: parsed.nextCursor ?? null,
  });
}

/**
 * Download + extract one ClawHub skill package.
 *
 * Contract:
 *   1. `<stagingDir>` is created recursively.
 *   2. Response body (assumed tar.gz) is written to
 *      `<stagingDir>/skill.tar.gz`.
 *   3. `<stagingDir>/extracted/` is created and populated via
 *      `tar -xzf <tar> -C <extracted>`.
 *   4. Returns the full list of extracted file paths (audit trail for
 *      the caller's secret-scan pipeline).
 *
 * Caller MUST own cleanup of `stagingDir` in a try/finally (D-07).
 *
 * Extraction uses the host `tar` via execa (Node 22 LTS ships with tar on
 * every supported platform). Keeps this module dependency-free against the
 * Node ecosystem's tar packages (pure-JS tar is slow + binary-corruption-
 * prone vs the battle-tested system tar).
 */
export async function downloadClawhubSkill(
  args: Readonly<{
    downloadUrl: string;
    stagingDir: string;
    authToken?: string;
    deps?: ClawhubClientDeps;
  }>,
): Promise<{ extractedDir: string; files: readonly string[] }> {
  const fetchFn = args.deps?.fetch ?? globalThis.fetch;

  const res = await fetchFn(args.downloadUrl, {
    headers: buildHeaders(args.authToken),
  });

  if (res.status === 429) {
    throw new ClawhubRateLimitedError(
      parseRetryAfter(res),
      `clawhub download: rate-limited`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ClawhubAuthRequiredError(
      `clawhub download: auth required (${res.status})`,
    );
  }
  if (!res.ok) {
    throw new Error(`clawhub download: ${res.status} ${res.statusText}`);
  }

  await mkdirP(args.stagingDir, { recursive: true });
  const tarPath = join(args.stagingDir, "skill.tar.gz");
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFileP(tarPath, bytes);

  const extractedDir = join(args.stagingDir, "extracted");
  await mkdirP(extractedDir, { recursive: true });

  try {
    await execFileP("tar", ["-xzf", tarPath, "-C", extractedDir]);
  } catch (err) {
    throw new ClawhubManifestInvalidError(
      `clawhub download: tar extraction failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const files = await walkFiles(extractedDir);
  return { extractedDir, files: Object.freeze(files) };
}
