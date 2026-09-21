// Heading-aware chunking. A section that fits stays whole, so a clause is never
// cut in half; a long section is packed sentence by sentence with a one-sentence
// overlap so a fact that straddles a boundary is still retrievable.
const MAX_CHARS = 900;

function units(text) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  return paragraphs.flatMap((p) => (p.length <= MAX_CHARS ? [p] : p.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g).map((s) => s.trim())));
}

export function chunkDocument(doc) {
  const chunks = [];
  for (const section of doc.sections) {
    let current = [];
    const flush = () => {
      if (!current.length) return;
      chunks.push({
        id: `${doc.file}#${chunks.length + 1}`,
        file: doc.file,
        docTitle: doc.title,
        heading: section.heading,
        text: current.join("\n\n"),
      });
    };
    for (const unit of units(section.text)) {
      if (current.length && current.join("\n\n").length + unit.length > MAX_CHARS) {
        flush();
        current = [current[current.length - 1]];
      }
      current.push(unit);
    }
    flush();
  }
  return chunks;
}
