# Cached singleton with rotating credentials — anti-pattern

**Date:** 2026-05-11
**Discovered via:** Discord 401 incident, dream-pass + vision pre-pass + summarize-with-haiku all failing simultaneously
**Fix commit:** `bcc26d9` — `fix(haiku-direct): rebuild Anthropic client on OAuth token rotation`
**Related learning:** `2026-05-08-latent-bugs-surface-in-pairs-during-incidents.md`

---

## The pattern

A module caches a long-lived API client as a process-wide singleton:

```ts
let cachedClient: Anthropic | null = null;

async function getClient(): Promise<Anthropic> {
  if (cachedClient) return cachedClient;
  const token = await loadOAuthToken();           // ← read from file
  cachedClient = new Anthropic({ authToken: token });  // ← baked at construction
  return cachedClient;
}
```

The token is loaded **once** at first call and **baked into the SDK client's
constructor**. The cache lives for the daemon's entire lifetime.

Meanwhile, the credentials file behind `loadOAuthToken()` is rotated by an
out-of-process actor — a spawned `claude` subprocess refreshing OAuth, a
manual `claude login`, an Anthropic-side security event. The file changes;
the in-memory singleton does not. When Anthropic invalidates the old token
on rotation, **every call from this daemon hits HTTP 401 forever, until the
process restarts**.

The failure mode is delayed: the daemon boots fine, runs fine for hours,
then everything that touches the API silently breaks at rotation time. The
broken state survives until manual intervention.

## Why it's seductive

1. **The cache feels obviously correct.** "Don't read the file every call —
   that's wasteful." This intuition is wrong: the file is 471 bytes,
   page-cached, and ~1µs to read.
2. **Tests pass.** Single-process unit tests never trigger rotation.
3. **The boot path looks right.** First call works. Token is valid. SDK
   client constructs cleanly. Nothing in the code reveals the temporal
   coupling between file mtime and constructor state.
4. **Diagnostic noise.** When 401s start, the operator's first instinct is
   "the credentials must be expired/wrong." But the credentials in the
   file are *fine* — the bug is the daemon ignoring them.

## How to detect it during code review

When you see this shape:

- A module-level `let cached* : T | null = null` holding an authed client
- The cache is populated lazily on first call
- The credential value is read **outside** the cached object's lifecycle

…ask: **what rotates the credential, and what tells the cache to invalidate?**

If the answer is "nothing tells the cache to invalidate," the bug is present
and you are one credential rotation away from a production outage.

## The fix shape

Two complementary mechanisms:

### 1. Token-identity cache (primary)

Read the credential **every call** (it's cheap) and compare to the cached
identity. Rebuild only when the value differs:

```ts
let cachedClient: Anthropic | null = null;
let cachedToken: string | null = null;

async function getClient(): Promise<Anthropic> {
  const token = await loadOAuthToken();
  if (cachedClient && cachedToken === token) return cachedClient;
  cachedClient = new Anthropic({ authToken: token });
  cachedToken = token;
  return cachedClient;
}
```

Reasoning:
- Handles auto-refresh, manual relogin, and out-of-band rotation in one path.
- Doesn't require knowing the rotation mechanism (file watcher, expiry
  field, signal handler — all moot).
- File read is page-cached for sub-microsecond cost on hot paths.
- Cheaper than chokidar/fs.watch (no watcher lifecycle to manage).
- More robust than caching by `expiresAt` — out-of-cycle invalidation
  rewrites the token without advancing the expiry field.

### 2. 401-retry-once (defense-in-depth)

Even with identity comparison, a race exists: token rotates **between**
`loadOAuthToken()` and the SDK's HTTP send. Wrap each request:

```ts
async function createWithAuthRetry<T>(
  attempt: (client: Anthropic) => Promise<T>,
): Promise<T> {
  const client = await getClient();
  try {
    return await attempt(client);
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status !== 401) throw err;
    cachedClient = null;
    cachedToken = null;
    const retryClient = await getClient();
    return await attempt(retryClient);
  }
}
```

Retry exactly once on 401. Non-401 errors propagate unchanged. This catches
the race at rotation boundaries (~every 8h) without masking real auth
failures (which fail on both attempts).

### 3. Tests pin the contract

Add regression tests that mock the credential reader returning different
values across calls and assert:
- Client constructed once when token unchanged.
- Client rebuilt when token rotates.
- 401 triggers cache invalidation + retry; retry uses the fresh token.
- Non-401 errors propagate without retry.

Without these pins, the next refactor that "optimizes away the unnecessary
file read" reintroduces the bug.

## Generalization

This is one instance of a broader pattern:

> **Any cache whose key derives from external mutable state must be
> invalidated by that state's mutation — or by reading the key fresh on
> every access.**

The OAuth token is the external mutable state. The cached client is the
derived cache. Without an invalidation path, the cache holds a fossilized
view of state that has moved on.

Similar instances in this codebase to audit:

- **Config-derived clients** — does `cachedConfig` reload on `clawcode.yaml`
  edits? (Yes, via `config-reloader.ts` chokidar watch.) ✓
- **Discord bridge token** — baked into `Client.login()`. Operator must
  restart on token rotation. Acceptable because tokens are stable for years.
- **MCP server connection pools** — do they refresh when MCP env changes?
  Audit before assuming yes.
- **Embedding model handles** — model files are immutable; cache-forever
  is fine here.

## The investigation pattern that caught it

1. **Confirm the diagnosis empirically before forming the fix.** Direct
   curl test of the file's accessToken → HTTP 200. This single test ruled
   out the obvious hypothesis (expired credentials) and pointed at the
   actual culprit (consumer code).
2. **Map the failure scope.** All three Haiku-direct callers (dream-pass,
   vision pre-pass, summarize-with-haiku) failed simultaneously → shared
   code path → `haiku-direct.ts`. Scope informs root cause.
3. **Match the timing.** Credentials file mtime advanced 9 min before
   first 401. That's the auto-refresh propagation window. Temporal
   correlation between file write and failure onset = strong evidence
   that the consumer didn't pick up the new value.
4. **Search for siblings before fixing.** `grep -rn "new Anthropic(" src/`
   — only one instance. If two, fix both in one commit.
5. **Verify the refresh path is healthy** — could a "fix the cache" patch
   leave us one expiry away from a "the file is stale too" outage? The
   daemon spawns `claude` subprocesses (orphan-claude-reaper alerts confirm),
   which refresh `.credentials.json`. File mtime advanced organically from
   May 7 → May 11 06:43 → refresh works.

Three signals (curl-proof token + simultaneous failure + mtime correlation)
make a 100% confidence diagnosis. Don't ship a fix on one signal.

## Rule additions

To the existing investigation rules in
`2026-05-08-latent-bugs-surface-in-pairs-during-incidents.md`:

- **R6**: When you see a module-level `cachedClient: T | null = null` that's
  populated lazily, ask "what rotates the credential and what invalidates
  this cache?" If no answer exists, the bug is present.
- **R7**: For credentials that rotate, the test suite must include a
  rotation scenario — single-token tests do not cover the failure mode that
  matters in production.
- **R8**: Curl-proof the credential before forming a hypothesis. The
  cheapest test that distinguishes "creds are bad" from "consumer is bad."
