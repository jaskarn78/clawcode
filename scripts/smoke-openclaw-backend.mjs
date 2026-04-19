#!/usr/bin/env node
/**
 * Phase 74 Plan 02 — zero-dep E2E smoke for the OpenClaw backend path.
 *
 * Exercises the openclaw:<slug>:<tier> model-id route against a live daemon
 * running this ClawCode build. Proves three things:
 *
 *   1. The scope='all' bearer key + namespace-prefixed model id returns a
 *      200 streaming response with SSE data frames (Phase 74 BACKEND-02).
 *   2. A second turn with the SAME (bearer, slug, SOUL, tier) tuple reuses
 *      the transient persistent handle — measured via lower TTFB on turn 2
 *      (CACHE-HIT signal; soft signal, not strict — Plan 01 Task 1 Test 2b
 *      provides the strict cache-reuse unit test).
 *   3. The /v1/models probe is reachable on the configured port (smoke
 *      distinguishes daemon-not-running infra-skip from assertion failure).
 *
 * Cost attribution (BACKEND-03) is NOT asserted here — it requires a live
 * `clawcode costs` query post-smoke. The assertion is that the tests under
 * src/openai/__tests__/template-driver-cost-attribution.test.ts pin the
 * record-call contract; this smoke only walks the HTTP surface.
 *
 * Exit codes:
 *   0 — both turns succeeded + summary JSON printed.
 *   1 — assertion failure (4xx/5xx response, turn yielded no content delta).
 *   2 — infra skip: daemon unreachable, missing bearer key, /v1/models 4xx.
 *
 * Usage:
 *   CLAWCODE_OPENAI_SMOKE_KEY=ck_all_xxx node scripts/smoke-openclaw-backend.mjs
 *
 *   # Optional:
 *   CLAWCODE_OPENAI_HOST=http://127.0.0.1:3100 \
 *   CLAWCODE_OPENCLAW_SMOKE_SLUG=my-test-caller \
 *   CLAWCODE_OPENCLAW_SMOKE_TIER=sonnet \
 *     node scripts/smoke-openclaw-backend.mjs
 *
 * Zero npm deps — Node 22 native fetch + ReadableStream reader only.
 * Meant for manual post-deploy validation on clawdy.
 */

const KEY = process.env.CLAWCODE_OPENAI_SMOKE_KEY ?? "";
const HOST = (process.env.CLAWCODE_OPENAI_HOST ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const SLUG = process.env.CLAWCODE_OPENCLAW_SMOKE_SLUG ?? "smoke-test";
const TIER = process.env.CLAWCODE_OPENCLAW_SMOKE_TIER ?? "sonnet";
const MODEL = `openclaw:${SLUG}:${TIER}`;
const INTER_TURN_DELAY_MS = 500;

function exit(code, msg) {
  process.stdout.write(msg + "\n");
  process.exit(code);
}

if (!KEY) {
  exit(
    2,
    "SKIP: Set CLAWCODE_OPENAI_SMOKE_KEY to a scope='all' bearer key (ck_all_...) on the target daemon.",
  );
}

// Probe /v1/models to distinguish daemon-not-running from assertion failure.
try {
  const probe = await fetch(`${HOST}/v1/models`);
  if (!probe.ok) {
    exit(2, `SKIP: /v1/models probe returned HTTP ${probe.status}. Daemon up but endpoint unhealthy?`);
  }
} catch (err) {
  const code = err?.cause?.code ?? err?.code;
  if (code === "ECONNREFUSED") {
    exit(2, `SKIP: daemon not reachable at ${HOST} (ECONNREFUSED). Is clawcoded running?`);
  }
  if (code === "ENOTFOUND") {
    exit(2, `SKIP: host not resolvable (${HOST}): ${err.message}`);
  }
  exit(2, `SKIP: /v1/models probe failed — ${err.message}`);
}

/**
 * Stream a single chat completion and return TTFB + total ms + accumulated
 * text. On any HTTP error / transport failure, exits the process with the
 * appropriate code — the caller does not need to handle failures.
 */
async function oneTurn(label) {
  const url = `${HOST}/v1/chat/completions`;
  const body = JSON.stringify({
    model: MODEL,
    stream: true,
    messages: [
      {
        role: "system",
        content:
          "You are a terse responder. When asked anything, reply with exactly the single word: PING",
      },
      { role: "user", content: "say hi" },
    ],
  });
  const start = Date.now();
  let firstDeltaAt = null;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body,
    });
  } catch (err) {
    const code = err?.cause?.code ?? err?.code;
    if (code === "ECONNREFUSED") {
      exit(2, `SKIP: daemon dropped connection mid-smoke (ECONNREFUSED).`);
    }
    exit(1, `FAIL ${label}: fetch transport error — ${err.message}`);
  }
  if (res.status === 401) {
    exit(2, `SKIP: 401 on ${label} — CLAWCODE_OPENAI_SMOKE_KEY rejected. Verify scope='all'.`);
  }
  if (res.status === 403) {
    exit(
      2,
      `SKIP: 403 on ${label} — bearer is valid but lacks scope='all' (openclaw: prefix requires scope='all').`,
    );
  }
  if (res.status === 501) {
    exit(2, `SKIP: 501 template_driver_disabled — SDK not available to this daemon build.`);
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => "<unreadable>");
    exit(1, `FAIL ${label}: HTTP ${res.status} ${res.statusText}\n${errBody}`);
  }
  if (!res.body) {
    exit(1, `FAIL ${label}: response body missing (streaming expected).`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let dataFrameCount = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      dataFrameCount += 1;
      try {
        const obj = JSON.parse(data);
        const delta = obj.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          if (firstDeltaAt === null) firstDeltaAt = Date.now();
          fullText += delta;
        }
      } catch {
        // Ignore malformed frames (keepalive comments etc.)
      }
    }
  }
  const end = Date.now();
  const ttfb = firstDeltaAt !== null ? firstDeltaAt - start : null;
  return { label, ttfb, total: end - start, text: fullText, dataFrameCount };
}

process.stdout.write(
  `[smoke-openclaw-backend] host=${HOST} model=${MODEL} slug=${SLUG} tier=${TIER}\n`,
);

// Run two sequential turns — turn 2 should hit the cached transient handle.
const t1 = await oneTurn("turn 1");
if (t1.dataFrameCount === 0) {
  exit(1, `FAIL: turn 1 produced zero SSE data frames.`);
}
if (t1.ttfb === null) {
  exit(1, `FAIL: turn 1 emitted no content delta.`);
}

await new Promise((r) => setTimeout(r, INTER_TURN_DELAY_MS));

const t2 = await oneTurn("turn 2");
if (t2.dataFrameCount === 0) {
  exit(1, `FAIL: turn 2 produced zero SSE data frames.`);
}
if (t2.ttfb === null) {
  exit(1, `FAIL: turn 2 emitted no content delta.`);
}

const turn2WasFaster = t2.ttfb < t1.ttfb;
const summary = {
  turn1_ttfb_ms: t1.ttfb,
  turn1_total_ms: t1.total,
  turn1_frames: t1.dataFrameCount,
  turn2_ttfb_ms: t2.ttfb,
  turn2_total_ms: t2.total,
  turn2_frames: t2.dataFrameCount,
  turn2_was_faster: turn2WasFaster,
  status: "ok",
};

process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
if (!turn2WasFaster) {
  process.stdout.write(
    "WARN: turn 2 was NOT faster than turn 1. Cache hit is a soft signal; " +
      "inspect /v1/chat/completions trace to rule out cold-handle respawn.\n",
  );
}
exit(0, `OK: two sequential turns completed against ${MODEL}.`);
