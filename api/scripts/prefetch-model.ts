import { loadConfig } from "../src/config.js";
import { TransformersEmbedder } from "../src/rag/embeddings.js";

const cfg = loadConfig();
const [v] = await new TransformersEmbedder(cfg).embed(["warm up"]);
console.log(`Model ${cfg.EMBEDDING_MODEL} ready, ${v?.length} dimensions`);
