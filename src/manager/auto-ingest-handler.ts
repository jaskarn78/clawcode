/**
 * Phase 999.43 Plan 02 T03 — `auto-ingest-attachment` IPC handler body,
 * extracted from the daemon's switch for direct testability.
 *
 * Single source of truth for the auto-ingest dispatcher; the daemon
 * switch case delegates here via injected dependencies. Tests in
 * `src/discord/__tests__/auto-ingest-dispatcher.test.ts` exercise this
 * handler with a `:memory:` DocumentStore (Plan 01 T02) + stub engine +
 * stub embedder to assert the four behaviors locked in Plan 02:
 *
 *   1. Agent flag OFF → returns { skipped: true }, no documents row.
 *   2. Classifier reject (video/audio/archive per D-06) → { skipped: true },
 *      no documents row.
 *   3. Happy path (HIGH content + HIGH agent) → engine + docStore.ingest +
 *      upsertDocumentRow with full D-04 provenance + D-01 axis weights
 *      (1.5 × 1.5).
 *   4. Telemetry — phase999.43-autoingest log shape matches the
 *      Phase 101 / Phase 127 / Phase 136 JSON-tag pattern.
 *
 * The daemon case becomes a thin DI wrapper (see
 * src/manager/daemon.ts `case "auto-ingest-attachment"`); this lets the
 * test mock all I/O surfaces without spinning a real daemon.
 *
 * Hot-reload semantics (Plan 01 SUMMARY): `getAgentConfig` MUST be a
 * live read at receive time, not a session-boot snapshot. The daemon
 * passes the live `configs` array reference via `getAgentConfig`.
 */

import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import {
  classifyAttachment,
  type ContentClass,
} from "../documents/auto-ingest-classifier.js";
import type {
  DocumentStore,
  DocumentRowInput,
} from "../documents/store.js";
import type { MemoryStore } from "../memory/store.js";
import type { EmbeddingService } from "../memory/embedder.js";
import { chunkText, chunkPdf } from "../documents/chunker.js";
import type { ChunkInput } from "../documents/chunker.js";
import {
  type ingest as IngestEngineFn,
  computeDocSlug,
} from "../document-ingest/index.js";
import {
  crossIngestToMemory,
  MigrationPhaseStore,
} from "../document-ingest/cross-ingest.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import { ManagerError } from "../shared/errors.js";

/**
 * D-01 Axis 1 multipliers — per-agent base priority (LOCKED VERBATIM).
 * Snapshotted into `agent_priority_weight_at_ingest`; live weight at
 * query time is read fresh per RELOADABLE semantics (Plan 03).
 */
export const AGENT_PRIORITY_WEIGHTS: Readonly<
  Record<"high" | "medium" | "low", number>
> = Object.freeze({ high: 1.5, medium: 1.0, low: 0.7 });

/**
 * D-01 Axis 2 multipliers — per-document content priority (LOCKED VERBATIM).
 * Same numbers as `CONTENT_PRIORITY_WEIGHTS` in `src/documents/store.ts`;
 * duplicated here so the daemon case body has the literal in source for
 * operator grep + acceptance-gate assertions.
 */
export const CONTENT_PRIORITY_WEIGHTS: Readonly<
  Record<"high" | "medium" | "low", number>
> = Object.freeze({ high: 1.5, medium: 1.0, low: 0.5 });

/** IPC request payload (matches `auto-ingest-attachment` in protocol.ts). */
export type AutoIngestAttachmentParams = {
  readonly agent: string;
  readonly file_path: string;
  readonly filename: string;
  readonly mime_type: string | null;
  readonly size: number;
  readonly vision_analysis: string | null;
  readonly channel_id: string;
  readonly message_id: string;
  readonly user_id: string;
  readonly user_name: string;
};

/** DI deps — the daemon wires concrete impls; tests pass stubs. */
export type AutoIngestHandlerDeps = {
  readonly getDocumentStore: (agent: string) => DocumentStore | undefined;
  readonly getMemoryStore: (agent: string) => MemoryStore | undefined;
  readonly getEmbedder: () => EmbeddingService;
  readonly getAgentConfig: (agent: string) => ResolvedAgentConfig | undefined;
  readonly logger: Logger;
  /**
   * Phase 101 engine. Daemon passes the real `ingestDocumentEngine`;
   * tests pass a stub that returns canned text + telemetry.
   */
  readonly engine: typeof IngestEngineFn;
  /** Optional: override readFile for tests. Defaults to node:fs/promises.readFile. */
  readonly readFileFn?: (path: string) => Promise<Buffer>;
  /** Optional: override clock for deterministic ingestedAt in tests. */
  readonly nowIso?: () => string;
};

export type AutoIngestSkipResult = {
  readonly ok: true;
  readonly skipped: true;
  readonly reason: string;
};

export type AutoIngestSuccessResult = {
  readonly ok: true;
  readonly skipped: false;
  readonly source: string;
  readonly chunks_created: number;
  readonly content_class: ContentClass;
  readonly agent_weight: number;
  readonly content_weight: number;
};

export type AutoIngestErrorResult = {
  readonly ok: false;
  readonly skipped: false;
  readonly error: string;
};

export type AutoIngestResult =
  | AutoIngestSkipResult
  | AutoIngestSuccessResult
  | AutoIngestErrorResult;

/**
 * Auto-ingest handler. Returns one of three result shapes:
 *   - { ok: true, skipped: true, reason }: flag off OR classifier reject
 *     OR no chunks produced
 *   - { ok: true, skipped: false, ...stats }: dispatched + row written
 *   - { ok: false, skipped: false, error }: engine/embedder/store failure
 *     — NEVER thrown; fire-and-forget caller (bridge.ts) keeps running
 *
 * Throws ManagerError ONLY for missing agent config (unrecoverable —
 * agent name should always resolve to a config row).
 */
export async function handleAutoIngestAttachment(
  params: AutoIngestAttachmentParams,
  deps: AutoIngestHandlerDeps,
): Promise<AutoIngestResult> {
  const {
    agent: agentName,
    file_path: filePath,
    filename,
    mime_type: mimeType,
    size,
    vision_analysis: visionAnalysis,
    channel_id: channelId,
    message_id: messageId,
    user_id: userId,
    user_name: userName,
  } = params;

  const logger = deps.logger;
  const readFileFn = deps.readFileFn ?? readFile;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  const agentConfig = deps.getAgentConfig(agentName);
  if (!agentConfig) {
    throw new ManagerError(
      `Agent config not found for '${agentName}' (auto-ingest)`,
    );
  }

  // D-09 default: agents WITHOUT the flag set preserve current behavior.
  if (agentConfig.autoIngestAttachments !== true) {
    logger.info(
      {
        tag: "phase999.43-autoingest",
        agent: agentName,
        channelId,
        messageId,
        userId,
        userName,
        filename,
        mimeType,
        size,
        eligible: false,
        reason: "autoIngestAttachments disabled for agent",
      },
      "phase999.43-autoingest skipped — agent flag off",
    );
    return {
      ok: true,
      skipped: true,
      reason: "autoIngestAttachments disabled for agent",
    };
  }

  // D-01 Axis 1 — agent base priority. Read LIVE; defaults to "medium".
  const agentPriority = agentConfig.ingestionPriority ?? "medium";
  const agentWeight = AGENT_PRIORITY_WEIGHTS[agentPriority];

  // D-01 Axis 2 + D-06 reject — pure-function classifier.
  const classifierOutput = classifyAttachment({
    filename,
    mimeType,
    size,
    visionAnalysis: visionAnalysis ?? undefined,
    clientNamePatterns: undefined,
  });

  if (classifierOutput.eligible === false) {
    logger.info(
      {
        tag: "phase999.43-autoingest",
        agent: agentName,
        channelId,
        messageId,
        userId,
        userName,
        filename,
        mimeType,
        size,
        eligible: false,
        contentClass: classifierOutput.contentClass,
        reason: classifierOutput.reason,
      },
      "phase999.43-autoingest skipped — classifier rejected",
    );
    return {
      ok: true,
      skipped: true,
      reason: classifierOutput.reason,
    };
  }

  const contentClass: ContentClass = classifierOutput.contentClass;
  const contentWeight = CONTENT_PRIORITY_WEIGHTS[contentClass];

  const docStore = deps.getDocumentStore(agentName);
  if (!docStore) {
    const msg = `DocumentStore not found for agent '${agentName}' (auto-ingest)`;
    logger.warn(
      {
        tag: "phase999.43-autoingest",
        agent: agentName,
        messageId,
        eligible: true,
        contentClass,
        error: msg,
      },
      "phase999.43-autoingest dispatch failed",
    );
    return { ok: false, skipped: false, error: msg };
  }

  const source = filePath;

  try {
    const fileBuffer = await readFileFn(filePath);

    // Phase 101 engine — text-only auto-ingest at v1 (no structured branch).
    const ingestResult = await deps.engine(fileBuffer, filePath, {
      taskHint: undefined,
      backend: undefined,
    });

    // Match manual-path chunker cascade.
    const chunks: readonly ChunkInput[] =
      ingestResult.text.length > 0
        ? chunkText(ingestResult.text)
        : filePath.endsWith(".pdf")
          ? await chunkPdf(fileBuffer)
          : chunkText(fileBuffer.toString("utf-8"));

    if (chunks.length === 0) {
      // Nothing to embed → no retrievable doc → no provenance row.
      logger.info(
        {
          tag: "phase999.43-autoingest",
          agent: agentName,
          channelId,
          messageId,
          userId,
          userName,
          filename,
          mimeType,
          size,
          eligible: true,
          contentClass,
          agentWeight,
          contentWeight,
          reason: "no chunks produced (empty text)",
          chunksCreated: 0,
          docSource: source,
        },
        "phase999.43-autoingest skipped — no chunks",
      );
      return {
        ok: true,
        skipped: true,
        reason: "no chunks produced (empty text)",
      };
    }

    const embedder = deps.getEmbedder();
    const embeddings: Int8Array[] = [];
    for (const chunk of chunks) {
      embeddings.push(await embedder.embedV2(chunk.content));
    }

    const result = docStore.ingest(source, chunks, embeddings);

    // Best-effort cross-ingest into memory_chunks (matches manual path).
    try {
      const memoryStore = deps.getMemoryStore(agentName);
      if (memoryStore) {
        await crossIngestToMemory({
          agent: agentName,
          docSlug: computeDocSlug(filePath),
          chunks: chunks.map((c, i) => ({ index: i, content: c.content })),
          embedderV1: embedder,
          embedderV2: embedder,
          memoryStore,
          migrationPhaseStore: new MigrationPhaseStore(memoryStore, agentName),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          tag: "phase999.43-autoingest",
          agent: agentName,
          messageId,
          docSource: source,
          err: msg,
        },
        "phase999.43-autoingest cross-ingest failed (non-fatal)",
      );
    }

    // D-04 provenance write — full field set.
    const row: DocumentRowInput = {
      source,
      agentName,
      channelId,
      messageId,
      userId,
      ingestedAt: nowIso(),
      sourceKind: "discord_attachment",
      autoClassifiedClass: contentClass,
      overrideClass: null,
      contentWeight,
      agentWeightAtIngest: agentWeight,
    };
    docStore.upsertDocumentRow(row);

    logger.info(
      {
        tag: "phase999.43-autoingest",
        agent: agentName,
        channelId,
        messageId,
        userId,
        userName,
        filename,
        mimeType,
        size,
        eligible: true,
        contentClass,
        agentWeight,
        contentWeight,
        reason: classifierOutput.reason,
        chunksCreated: result.chunksCreated,
        docSource: source,
      },
      "phase999.43-autoingest dispatched",
    );

    return {
      ok: true,
      skipped: false,
      source,
      chunks_created: result.chunksCreated,
      content_class: contentClass,
      agent_weight: agentWeight,
      content_weight: contentWeight,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      {
        tag: "phase999.43-autoingest",
        agent: agentName,
        channelId,
        messageId,
        userId,
        userName,
        filename,
        mimeType,
        size,
        eligible: true,
        contentClass,
        agentWeight,
        contentWeight,
        error: msg,
      },
      "phase999.43-autoingest dispatch failed",
    );
    return { ok: false, skipped: false, error: msg };
  }
}
