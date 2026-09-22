// Minimal web UI, rendered on the server: http://localhost:3000
import http from "node:http";
import { loadIndex, retrieve } from "./retrieve.js";
import { answer, describeError } from "./answer.js";

const PORT = Number(process.env.PORT ?? 3000);
const index = loadIndex();
const documents = [...new Set(index.chunks.map((c) => c.file))];

const SAMPLES = [
  "What wall finish goes in the staff shower, and has it changed from the original schedule?",
  "Can we spray the anti-microbial paint in the Treatment Room to save time?",
  "Which openings do I deduct in a wall take-off, and what waste allowance applies to paint?",
  "Why is decoration on hold in Consulting Room B?",
  "What is the contract sum for the fit-out?",
];

const esc = (value) =>
  String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

const STYLE = `
  :root { --ink:#1b2430; --muted:#5d6b7c; --line:#dfe4ea; --ground:#f5f6f8; --card:#fff; --accent:#0f5f8c; --accent-soft:#e3f0f7; --warn:#8a5a00; --warn-soft:#fdf3dc; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink); font:15px/1.55 "Segoe UI",system-ui,sans-serif; }
  main { max-width:920px; margin:0 auto; padding:32px 20px 64px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 20px; }
  form { display:flex; gap:8px; }
  input[type=text] { flex:1; padding:11px 14px; font:inherit; border:1px solid var(--line); border-radius:8px; background:var(--card); }
  button { padding:11px 20px; font:inherit; font-weight:600; color:#fff; background:var(--accent); border:0; border-radius:8px; cursor:pointer; }
  .samples { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0 24px; }
  .samples a { font-size:13px; color:var(--accent); background:var(--accent-soft); padding:4px 10px; border-radius:999px; text-decoration:none; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:20px 22px; margin-bottom:16px; }
  .card h2 { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:0 0 10px; }
  .answer { font-size:16px; white-space:pre-wrap; }
  .notfound { background:var(--warn-soft); border-color:#ecd9a8; }
  .notfound h2 { color:var(--warn); }
  sup a { color:var(--accent); text-decoration:none; font-weight:600; padding:0 1px; }
  .source { padding:12px 0; border-top:1px solid var(--line); }
  .source:first-of-type { border-top:0; padding-top:0; }
  .source .where { font-weight:600; }
  .source .n { display:inline-block; min-width:22px; color:var(--accent); font-weight:700; }
  blockquote { margin:6px 0 0 22px; padding:6px 12px; border-left:3px solid var(--accent); background:var(--accent-soft); font-size:14px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  td, th { text-align:left; padding:6px 8px; border-top:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; border-top:0; }
  .meta { color:var(--muted); font-size:13px; }
  .error { color:#9b1c1c; }
`;

function page(body, question = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project Documents Q&amp;A</title><style>${STYLE}</style></head><body><main>
<h1>Project Documents Q&amp;A</h1>
<p class="sub">Answers come only from the ${documents.length} indexed project documents, with the exact supporting text quoted.</p>
<form action="/ask" method="get"><input type="text" name="q" value="${esc(question)}" placeholder="Ask about the specification, schedule, RFIs, ITP or minutes" autofocus><button>Ask</button></form>
<div class="samples">${SAMPLES.map((s) => `<a href="/ask?q=${encodeURIComponent(s)}">${esc(s)}</a>`).join("")}</div>
${body}</main></body></html>`;
}

function renderAnswer(result) {
  const prose = result.segments
    .map((s) => esc(s.text) + (s.refs.length ? `<sup>${s.refs.map((n) => `<a href="#s${n}">[${n}]</a>`).join("")}</sup>` : ""))
    .join("");
  const sources = result.sources
    .map(
      (s) => `<div class="source" id="s${s.n}"><div class="where"><span class="n">[${s.n}]</span>${esc(s.chunk.file)} &rsaquo; ${esc(s.chunk.heading)}</div>
${s.quotes.map((q) => `<blockquote>${esc(q)}</blockquote>`).join("")}</div>`,
    )
    .join("");
  return `<div class="card ${result.notFound ? "notfound" : ""}"><h2>${result.notFound ? "Not covered by the documents" : "Answer"}</h2><div class="answer">${prose}</div></div>
${sources ? `<div class="card"><h2>Sources quoted</h2>${sources}</div>` : ""}`;
}

function renderRetrieved(hits) {
  return `<div class="card"><h2>Passages retrieved (hybrid BM25 + embeddings)</h2><table><tr><th>#</th><th>Document</th><th>Section</th><th>BM25</th><th>Cosine</th></tr>
${hits.map((h, i) => `<tr><td>${i + 1}</td><td>${esc(h.chunk.file)}</td><td>${esc(h.chunk.heading)}</td><td>${h.bm25.toFixed(2)}</td><td>${h.cosine.toFixed(3)}</td></tr>`).join("")}</table></div>`;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/") return res.end(page(""));
    if (url.pathname !== "/ask") {
      res.statusCode = 404;
      return res.end(page("<p>Not found.</p>"));
    }
    const question = (url.searchParams.get("q") ?? "").trim().slice(0, 500);
    if (!question) return res.end(page(""));
    const hits = await retrieve(index, question);
    let body;
    try {
      const result = await answer(index, question);
      body = renderAnswer(result) + renderRetrieved(hits) +
        `<p class="meta">${esc(result.model)} &middot; ${result.usage.input_tokens} tokens in, ${result.usage.output_tokens} out</p>`;
    } catch (error) {
      body = `<div class="card"><h2>Answer</h2><p class="error">${esc(describeError(error))}</p></div>` + renderRetrieved(hits);
    }
    res.end(page(body, question));
  })
  .listen(PORT, () => console.log(`Project Documents Q&A running at http://localhost:${PORT}`));
