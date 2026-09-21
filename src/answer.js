// Answers a question from the retrieved chunks only. Each chunk is sent as a
// document block with citations enabled, so every claim in the answer comes back
// tied to the exact quoted text that supports it.
import Anthropic from "@anthropic-ai/sdk";
import { retrieve } from "./retrieve.js";

const MODEL = process.env.RAG_MODEL || "claude-opus-5";
export const NOT_FOUND = "NOT IN DOCUMENTS";

const SYSTEM = `You answer questions about a construction project for the site and commercial team.

Use only the supplied documents. They are excerpts retrieved from the project's document set, so treat anything they do not state as unknown; do not fill gaps from general construction knowledge.

If the documents do not contain the answer, begin your reply with "${NOT_FOUND}:" and say in one sentence what is missing. A partial answer is fine when only part is covered: give the part that is supported and say what is not.

Documents can disagree because the project moves on. An RFI response or a later meeting minute supersedes the specification or schedule it refers to; when that happens, give the current position and mention what it replaced.

When a question needs arithmetic (areas, quantities, dates), show the figures you used so they can be checked.

Write plain prose, short and direct. No markdown headings or tables.`;

const client = new Anthropic();

export async function answer(index, question, { topK = 6 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("No Anthropic credential found. Set ANTHROPIC_API_KEY (see .env.example) to generate answers.");
  }
  const hits = await retrieve(index, question, topK);

  const documents = hits.map(({ chunk }) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: chunk.text },
    title: `${chunk.file} > ${chunk.heading}`,
    context: chunk.docTitle,
    citations: { enabled: true },
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages: [{ role: "user", content: [...documents, { type: "text", text: question }] }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`The model declined to answer (${response.stop_details?.category ?? "no category"}).`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The answer was cut off at max_tokens.");
  }

  // Number the sources in the order the answer first cites them.
  const sources = [];
  const segments = [];
  for (const block of response.content) {
    if (block.type !== "text") continue;
    const refs = [];
    for (const citation of block.citations ?? []) {
      const { chunk } = hits[citation.document_index];
      let source = sources.find((s) => s.chunk.id === chunk.id);
      if (!source) {
        source = { n: sources.length + 1, chunk, quotes: [] };
        sources.push(source);
      }
      const quote = citation.cited_text.trim();
      if (!source.quotes.includes(quote)) source.quotes.push(quote);
      if (!refs.includes(source.n)) refs.push(source.n);
    }
    segments.push({ text: block.text, refs });
  }

  const text = segments.map((s) => s.text).join("");
  return {
    question,
    text,
    segments,
    sources,
    notFound: text.trimStart().startsWith(NOT_FOUND),
    retrieved: hits.map((h) => ({ id: h.chunk.id, file: h.chunk.file, heading: h.chunk.heading, score: h.score })),
    usage: response.usage,
    model: response.model,
  };
}

export function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY.";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Try again shortly.";
  if (error instanceof Anthropic.BadRequestError) return `The Anthropic API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API.";
  if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status}: ${error.message}`;
  return error.message;
}
