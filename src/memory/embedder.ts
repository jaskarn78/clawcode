import { EmbeddingError } from "./errors.js";

/**
 * The FeatureExtractionPipeline type from @huggingface/transformers.
 * Defined locally to avoid importing the full package at module level.
 */
type FeatureExtractionPipeline = (
  text: string,
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ tolist(): number[][] }>;

/** Maximum word count before truncation (model handles ~256 tokens). */
const MAX_WORDS = 200;

/**
 * EmbeddingService wraps @huggingface/transformers for local text embeddings.
 *
 * Uses the all-MiniLM-L6-v2 model (384 dimensions) via ONNX runtime.
 * The model is downloaded on first warmup (~23MB) and cached in
 * ~/.cache/huggingface.
 */
export class EmbeddingService {
  private pipeline: FeatureExtractionPipeline | null = null;
  private warmPromise: Promise<void> | null = null;

  /**
   * Pre-warm the embedding model. Idempotent — only downloads once.
   * Call at daemon startup to avoid cold-start latency on first embed.
   */
  async warmup(): Promise<void> {
    if (this.pipeline) return;
    if (this.warmPromise) return this.warmPromise;
    this.warmPromise = this.doWarmup();
    return this.warmPromise;
  }

  /**
   * Embed text into a 384-dimensional Float32Array.
   * Automatically warms up the model if not already ready.
   * Truncates long text to MAX_WORDS before embedding.
   */
  async embed(text: string): Promise<Float32Array> {
    try {
      if (!this.pipeline) {
        await this.warmup();
      }

      const truncated = truncateText(text);
      const output = await this.pipeline!(truncated, {
        pooling: "mean",
        normalize: "true" as unknown as boolean,
      });
      const data = output.tolist()[0] as number[];
      return new Float32Array(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new EmbeddingError(`Failed to embed text: ${message}`);
    }
  }

  /** Returns whether the embedding pipeline is ready. */
  isReady(): boolean {
    return this.pipeline !== null;
  }

  private async doWarmup(): Promise<void> {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      this.pipeline = (await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      )) as unknown as FeatureExtractionPipeline;
    } catch (error) {
      this.warmPromise = null;
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new EmbeddingError(`Failed to warm up embedding model: ${message}`);
    }
  }
}

/** Truncate text to MAX_WORDS words to stay within model token limits. */
function truncateText(text: string): string {
  const words = text.split(/\s+/);
  if (words.length <= MAX_WORDS) return text;
  return words.slice(0, MAX_WORDS).join(" ");
}
