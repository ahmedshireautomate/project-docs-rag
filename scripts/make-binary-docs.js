// Renders the two text sources in corpus-src/ as a real PDF and a real DOCX,
// so ingestion is exercised on the formats project documents actually arrive in.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, "corpus-src", name), "utf8");

function parse(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith("## ")) return { level: 2, text: line.slice(3) };
      if (line.startsWith("# ")) return { level: 1, text: line.slice(2) };
      return { level: 0, text: line };
    });
}

function wrap(text, font, size, maxWidth) {
  const lines = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function makePdf(source, target) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 56;
  let page = pdf.addPage([595, 842]);
  let y = 842 - margin;

  for (const block of parse(read(source))) {
    const size = block.level === 1 ? 15 : block.level === 2 ? 12 : 10.5;
    const font = block.level ? bold : regular;
    y -= block.level ? 10 : 4;
    for (const line of wrap(block.text, font, size, 595 - margin * 2)) {
      if (y < margin + size) {
        page = pdf.addPage([595, 842]);
        y = 842 - margin;
      }
      page.drawText(line, { x: margin, y, size, font });
      y -= size * 1.45;
    }
  }
  // pdf-parse bundles an older pdf.js that cannot read object streams.
  fs.writeFileSync(path.join(root, "corpus", target), await pdf.save({ useObjectStreams: false }));
}

async function makeDocx(source, target) {
  const children = parse(read(source)).map((block) =>
    block.level === 1
      ? new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1 })
      : block.level === 2
        ? new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_2 })
        : new Paragraph({ text: block.text }),
  );
  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(path.join(root, "corpus", target), await Packer.toBuffer(doc));
}

await makePdf("03-method-statement-painting.txt", "03-method-statement-painting.pdf");
await makeDocx("04-inspection-test-plan.txt", "04-inspection-test-plan.docx");
console.log("Wrote corpus/03-method-statement-painting.pdf and corpus/04-inspection-test-plan.docx");
