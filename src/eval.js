// Scores the system against eval/questions.json.
//   npm run eval -- --retrieval-only   retrieval hit rate only; needs no API key
//   npm run eval                       retrieval plus answer checks
//
// Retrieval: a question passes when an expected document is in the top-k.
// Answers: every expected fact must appear, at least one citation must be
// attached, and questions the documents cannot answer must be declined.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadIndex, retrieve } from "./retrieve.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const questions = JSON.parse(fs.readFileSync(path.join(here, "..", "eval", "questions.json"), "utf8"));
const retrievalOnly = process.argv.includes("--retrieval-only");
const TOP_K = 6;

const index = loadIndex();
const rows = [];

for (const q of questions) {
  const row = { id: q.id, question: q.question };

  if (q.expectFiles) {
    const hits = await retrieve(index, q.question, TOP_K);
    const position = hits.findIndex((h) => q.expectFiles.includes(h.chunk.file));
    row.retrievalRank = position + 1;
    row.retrievalPass = position >= 0;
    row.top = hits.slice(0, 3).map((h) => `${h.chunk.file} > ${h.chunk.heading}`);
  }

  if (!retrievalOnly) {
    const { answer } = await import("./answer.js");
    const result = await answer(index, q.question, { topK: TOP_K });
    row.answer = result.text;
    row.citations = result.sources.length;
    if (q.expectNotFound) {
      row.answerPass = result.notFound;
    } else {
      const missing = q.expectAnswer.filter((pattern) => !new RegExp(pattern, "i").test(result.text));
      row.missing = missing;
      row.answerPass = missing.length === 0 && !result.notFound && result.sources.length > 0;
    }
  }

  rows.push(row);
  const flags = [
    "retrievalPass" in row ? `retrieval ${row.retrievalPass ? `pass (rank ${row.retrievalRank})` : "FAIL"}` : "retrieval n/a",
    "answerPass" in row ? `answer ${row.answerPass ? "pass" : "FAIL"}` : null,
  ].filter(Boolean);
  console.log(`${q.id}  ${flags.join("  |  ")}  ${q.question}`);
}

const retrievalRows = rows.filter((r) => "retrievalPass" in r);
const summary = {
  retrieval: `${retrievalRows.filter((r) => r.retrievalPass).length}/${retrievalRows.length} answerable questions have an expected document in the top ${TOP_K}`,
  top1: `${retrievalRows.filter((r) => r.retrievalRank === 1).length}/${retrievalRows.length} have it at rank 1`,
};
if (!retrievalOnly) {
  summary.answers = `${rows.filter((r) => r.answerPass).length}/${rows.length} answers pass (facts present, cited, unanswerable questions declined)`;
}
console.log("\n" + Object.values(summary).join("\n"));

const out = path.join(here, "..", "eval", retrievalOnly ? "results-retrieval.json" : "results-full.json");
fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), summary, rows }, null, 2));
console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
