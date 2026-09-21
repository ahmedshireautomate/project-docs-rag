// Usage: npm run ask -- "Can PT-2 be sprayed?"
import { loadIndex } from "./retrieve.js";
import { answer, describeError } from "./answer.js";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run ask -- "your question"');
  process.exit(1);
}

try {
  const result = await answer(loadIndex(), question);
  console.log(
    "\n" + result.segments.map((s) => s.text + s.refs.map((n) => `[${n}]`).join("")).join("") + "\n",
  );
  for (const source of result.sources) {
    console.log(`[${source.n}] ${source.chunk.file} > ${source.chunk.heading}`);
    for (const quote of source.quotes) console.log(`      "${quote}"`);
  }
  console.log(`\n${result.model}, ${result.usage.input_tokens} tokens in, ${result.usage.output_tokens} out`);
} catch (error) {
  console.error(describeError(error));
  process.exit(1);
}
