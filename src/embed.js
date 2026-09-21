// Local sentence embeddings (all-MiniLM-L6-v2, 384 dimensions). The model runs
// on this machine, so document text is never sent to a third party to be indexed.
import { pipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

let extractor;

export async function embed(texts) {
  extractor ??= await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "fp32" });
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}
