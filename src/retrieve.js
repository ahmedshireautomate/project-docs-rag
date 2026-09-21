// Hybrid retrieval: BM25 (exact terms such as "RFI-014" or "PT-2") and embedding
// similarity (paraphrases), merged with reciprocal rank fusion.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embed } from "./embed.js";

export const INDEX_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index", "index.json");

const K1 = 1.5;
const B = 0.75;
const RRF_K = 60;

export const tokenize = (text) => text.toLowerCase().match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) ?? [];

export function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) throw new Error("No index found. Run `npm run ingest` first.");
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const df = new Map();
  for (const chunk of index.chunks) {
    chunk.tokens = tokenize(`${chunk.heading} ${chunk.text}`);
    for (const term of new Set(chunk.tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  index.df = df;
  index.avgLength = index.chunks.reduce((sum, c) => sum + c.tokens.length, 0) / index.chunks.length;
  return index;
}

function bm25Scores(index, query) {
  const n = index.chunks.length;
  const terms = [...new Set(tokenize(query))];
  return index.chunks.map((chunk) => {
    let score = 0;
    for (const term of terms) {
      const tf = chunk.tokens.filter((t) => t === term).length;
      if (!tf) continue;
      const df = index.df.get(term);
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * chunk.tokens.length) / index.avgLength));
    }
    return score;
  });
}

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

function ranks(scores) {
  const order = scores.map((score, i) => ({ score, i })).sort((a, b) => b.score - a.score);
  const rank = new Array(scores.length);
  order.forEach((entry, position) => (rank[entry.i] = entry.score > 0 ? position + 1 : Infinity));
  return rank;
}

export async function retrieve(index, query, topK = 6) {
  const [queryVector] = await embed([query]);
  const lexical = bm25Scores(index, query);
  const semantic = index.chunks.map((chunk) => dot(queryVector, chunk.embedding));
  const lexicalRank = ranks(lexical);
  const semanticRank = ranks(semantic);
  return index.chunks
    .map((chunk, i) => ({
      chunk,
      bm25: lexical[i],
      cosine: semantic[i],
      score: 1 / (RRF_K + lexicalRank[i]) + 1 / (RRF_K + semanticRank[i]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
