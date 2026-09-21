// Build the index: load every document in corpus/, chunk it, embed the chunks
// and write index/index.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "./load.js";
import { chunkDocument } from "./chunk.js";
import { embed, EMBEDDING_MODEL } from "./embed.js";
import { INDEX_PATH } from "./retrieve.js";

const corpusDir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "corpus");

const docs = await loadCorpus(corpusDir);
const chunks = docs.flatMap(chunkDocument);
// The heading is embedded with the text so a chunk keeps its context.
const vectors = await embed(chunks.map((c) => `${c.docTitle}. ${c.heading}. ${c.text}`));
chunks.forEach((chunk, i) => (chunk.embedding = vectors[i].map((v) => Number(v.toFixed(5)))));

fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
fs.writeFileSync(
  INDEX_PATH,
  JSON.stringify({ embeddingModel: EMBEDDING_MODEL, builtAt: new Date().toISOString(), chunks }),
);

for (const doc of docs) {
  console.log(`${doc.file}: ${doc.sections.length} sections, ${chunks.filter((c) => c.file === doc.file).length} chunks`);
}
console.log(`Indexed ${chunks.length} chunks from ${docs.length} documents.`);
