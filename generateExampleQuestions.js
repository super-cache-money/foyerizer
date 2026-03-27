/**
 * Generate example questions from a corpus XML file.
 * Tries the whole corpus first; falls back to page-by-page if the result is thin.
 * Usage: node generateExampleQuestions.js <corpus.xml> [count]
 *
 * Output: exampleQuestions.json alongside the corpus.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const corpusPath = process.argv[2];
const TARGET = parseInt(process.argv[3] ?? "10", 10);
const MIN_CHARS = 80;

if (!corpusPath) {
  console.error("Usage: node generateExampleQuestions.js <corpus.xml> [count]");
  process.exit(1);
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

loadEnv();

const corpus = fs.readFileSync(corpusPath, "utf-8");
const outputDir = path.dirname(path.resolve(corpusPath));
const outputPath = path.join(outputDir, "exampleQuestions.json");

async function askForQuestions(content, n) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.4",
      messages: [
        {
          role: "system",
          content:
            `You are a curious and thoughtful reader. Given the corpus content, generate exactly ${n} natural, authentic questions that this corpus might help to answer.\n\n` +
            `The questions should:\n` +
            `• Feel open-ended or exploratory, not like a test or quiz\n` +
            `• Not try to exhaustively cover the content\n` +
            `• Avoid overly specific phrasing that mirrors the text verbatim\n` +
            `• Be very general.\n` +
            `• Be short.\n\n` +
            `Write in a casual, human tone — as if someone is thinking aloud.\n\n` +
            `Return a JSON array of ${n} question strings, and nothing else.`,
        },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${err}`);
  }

  const json = await res.json();
  const raw = JSON.parse(json.choices[0].message.content.trim());
  const arr = Array.isArray(raw) ? raw : Object.values(raw)[0];
  return Array.isArray(arr) ? arr.filter((q) => typeof q === "string" && q.trim().endsWith("?")) : [];
}

// Extract content blocks
const contentBlocks = [];
const re = /<content[^>]*>([\s\S]*?)<\/content>/g;
let m;
while ((m = re.exec(corpus)) !== null) contentBlocks.push(m[1].trim());

const validBlocks = contentBlocks.filter((b) => b.length >= MIN_CHARS);
console.error(`${contentBlocks.length} blocks (${validBlocks.length} usable)`);

// Try whole corpus first
console.error("Attempting whole-corpus generation...");
let questions = [];
try {
  questions = await askForQuestions(corpus, TARGET);
  console.error(`  Got ${questions.length} questions`);
} catch (err) {
  console.error(`  Failed: ${err.message}`);
}

// Fall back to page-by-page if we didn't get enough
if (questions.length < Math.ceil(TARGET / 2)) {
  console.error("Falling back to page-by-page generation...");

  const step = validBlocks.length / TARGET;
  const sampledBlocks = Array.from({ length: Math.min(TARGET, validBlocks.length) }, (_, i) =>
    validBlocks[Math.floor(i * step)]
  );

  const results = await Promise.all(
    sampledBlocks.map((block, i) =>
      askForQuestions(block, 1)
        .then((qs) => { console.error(`  ✓ Block ${i + 1}/${sampledBlocks.length}`); return qs; })
        .catch((err) => { console.error(`  ✗ Block ${i + 1}: ${err.message}`); return []; })
    )
  );

  questions = results.flat().slice(0, TARGET);
  console.error(`  Got ${questions.length} questions`);
}

fs.writeFileSync(outputPath, JSON.stringify(questions, null, 2), "utf-8");
console.error(`Done. ${questions.length} questions saved to ${outputPath}`);
