/**
 * Generate funny haikus from a corpus XML file, one per content chunk.
 * Usage: node generateFunFacts.js <corpus.xml> [haiku_count]
 *
 * Output: funFacts.json alongside the corpus.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const corpusPath = process.argv[2];
const TARGET = parseInt(process.argv[3] ?? "50", 10);
const BATCHES = parseInt(process.argv[4] ?? "10", 10);
const MIN_CHARS = 80; // skip near-empty blocks

if (!corpusPath) {
  console.error("Usage: node generateFunFacts.js <corpus.xml> [haiku_count]");
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
const outputPath = path.join(outputDir, "funFacts.json");

// Extract <content> blocks from the corpus
const contentBlocks = [];
const re = /<content[^>]*>([\s\S]*?)<\/content>/g;
let m;
while ((m = re.exec(corpus)) !== null) contentBlocks.push(m[1].trim());

if (contentBlocks.length === 0) {
  throw new Error("No <content> blocks found in corpus.");
}

// Filter short blocks, then split into BATCHES groups
const validBlocks = contentBlocks.filter((b) => b.length >= MIN_CHARS);
const batchCount = Math.min(BATCHES, validBlocks.length);
const haikusPerBatch = Math.ceil(TARGET / batchCount);
const batchSize = Math.ceil(validBlocks.length / batchCount);
const batches = Array.from({ length: batchCount }, (_, i) =>
  validBlocks.slice(i * batchSize, (i + 1) * batchSize)
);

console.error(
  `${contentBlocks.length} blocks → ${validBlocks.length} usable → ` +
  `${batchCount} batches × ${haikusPerBatch} haikus = ~${batchCount * haikusPerBatch} total`
);

async function haikuForBatch(blocks, n, index) {
  const content = blocks.join("\n\n---\n\n");
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
            `You are a witty poet. Write exactly ${n} funny haikus (5-7-5 syllables each) inspired by the content provided. ` +
            `Each haiku should be distinct. Reply with only the haikus, one per line-group, separated by a blank line. No titles, no numbering, no commentary.`,
        },
        { role: "user", content },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error on batch ${index} (${res.status}): ${err}`);
  }

  const json = await res.json();
  // Split response on blank lines into individual haikus
  return json.choices[0].message.content
    .trim()
    .split(/\n\s*\n/)
    .map((h) => h.trim())
    .filter(Boolean);
}

console.error(`Generating ${batchCount} batches in parallel...`);
const results = await Promise.all(
  batches.map((blocks, i) =>
    haikuForBatch(blocks, haikusPerBatch, i).then((hs) => {
      console.error(`  ✓ Batch ${i + 1}/${batchCount} → ${hs.length} haikus`);
      return hs;
    })
  )
);
const haikus = results.flat();

fs.writeFileSync(outputPath, JSON.stringify(haikus, null, 2), "utf-8");
console.error(`Done. ${haikus.length} haikus saved to ${outputPath}`);
