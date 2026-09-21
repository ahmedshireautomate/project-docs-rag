// Loads .md, .txt, .pdf and .docx files into one common shape:
// { file, title, sections: [{ heading, text }] }
import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const SUPPORTED = new Set([".md", ".txt", ".pdf", ".docx"]);

// A numbered heading as it appears in extracted PDF text, e.g. "3. Drying and recoat times".
const PLAIN_HEADING = /^\d+(\.\d+)*\.?\s+[A-Z][^.]{2,68}$/;

function sectionsFromMarkdown(text) {
  const sections = [];
  let title = null;
  let current = { heading: "Introduction", lines: [] };
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading && heading[1].length === 1 && !title) {
      title = heading[2].trim();
    } else if (heading) {
      sections.push(current);
      current = { heading: heading[2].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return { title, sections };
}

function sectionsFromPlainText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const title = lines.shift() ?? null;
  const sections = [];
  let current = { heading: "Introduction", lines: [] };
  for (const line of lines) {
    if (PLAIN_HEADING.test(line)) {
      sections.push(current);
      current = { heading: line, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return { title, sections, joinWith: " " };
}

// Rebuilds the lines of each page from the text items' baselines, so headings
// stay on their own line.
async function pdfToText(file) {
  const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const { items } = await (await pdf.getPage(pageNumber)).getTextContent();
    let baseline = null;
    let line = "";
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      if (baseline !== null && y !== baseline) {
        lines.push(line);
        line = "";
      }
      baseline = y;
      line += item.str;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

async function docxToMarkdown(file) {
  const { value: html } = await mammoth.convertToHtml({ path: file });
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/g, "\n# $1\n")
    .replace(/<h[23][^>]*>(.*?)<\/h[23]>/g, "\n## $1\n")
    .replace(/<\/(p|li|tr)>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export async function loadDocument(file) {
  const ext = path.extname(file).toLowerCase();
  let parsed;
  if (ext === ".pdf") {
    parsed = sectionsFromPlainText(await pdfToText(file));
  } else if (ext === ".docx") {
    parsed = sectionsFromMarkdown(await docxToMarkdown(file));
  } else {
    parsed = sectionsFromMarkdown(fs.readFileSync(file, "utf8"));
  }
  const sections = parsed.sections
    .map((s) => ({
      heading: s.heading,
      text: s.lines.join(parsed.joinWith ?? "\n").replace(/\n{3,}/g, "\n\n").trim(),
    }))
    .filter((s) => s.text.length > 0);
  return { file: path.basename(file), title: parsed.title ?? path.basename(file), sections };
}

export async function loadCorpus(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => SUPPORTED.has(path.extname(name).toLowerCase()))
    .sort();
  return Promise.all(files.map((name) => loadDocument(path.join(dir, name))));
}
