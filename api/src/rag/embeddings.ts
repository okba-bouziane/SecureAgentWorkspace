import type { Config } from "../config.js";
import { EMBEDDING_DIM } from "../db/schema.js";

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

type Extractor = (
  input: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/** Local sentence embeddings (ONNX, runs in-process, no API key). */
export class TransformersEmbedder implements Embedder {
  private extractor: Promise<Extractor> | null = null;

  constructor(private readonly cfg: Pick<Config, "EMBEDDING_MODEL" | "HF_CACHE_DIR">) {}

  private load(): Promise<Extractor> {
    this.extractor ??= (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      if (this.cfg.HF_CACHE_DIR) env.cacheDir = this.cfg.HF_CACHE_DIR;
      const p = await pipeline("feature-extraction", this.cfg.EMBEDDING_MODEL, { dtype: "fp32" });
      return p as unknown as Extractor;
    })();
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16);
      const tensor = await extractor(batch, { pooling: "mean", normalize: true });
      out.push(...tensor.tolist());
    }
    if (out[0] && out[0].length !== EMBEDDING_DIM) {
      throw new Error(`Embedding model returns ${out[0].length} dimensions, schema expects ${EMBEDDING_DIM}`);
    }
    return out;
  }
}
