/**
 * Crawl a Notion export directory and produce a single XML corpus file.
 * Usage: node generateCorpus.js [--summarise] <export_dir> [output.xml]
 *
 * --summarise  Send each page through Gemini via OpenRouter instead of dumping raw markdown.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { captureCanva } from "./transcribeCanva.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Args
const args = process.argv.slice(2);
const summarise = args.includes("--summarise");
const positional = args.filter((a) => !a.startsWith("--"));

if (!positional[0]) {
  console.error("Usage: node notion_export.js [--summarise] <export_dir> [output.xml]");
  process.exit(1);
}

const EXPORT_DIR = path.resolve(positional[0]);
const exportName = path.basename(EXPORT_DIR);
const OUTPUT_FILE = positional[1] ?? `temp/notion/${exportName}.xml`;

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

// Load .env
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

if (summarise) loadEnv();

// XML escape
function xmlEscape(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Recursively collect .md and .csv files in depth-first order
function collectFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".csv"))) {
      results.push(fullPath);
    }
  }
  return results;
}

// Extract Notion page ID and title from filename (32-char hex suffix)
function extractNotion(filePath) {
  const name = path.basename(filePath);
  const match = name.match(/^(.*?)\s+([a-f0-9]{32})\.(md|csv)$/);
  if (!match) return { id: null, title: name };
  return { id: match[2], title: match[1] };
}

// Find all Canva URLs in content
function findCanvaUrls(content) {
  const matches = content.match(/https:\/\/www\.canva\.com\/design\/[^\s)"'\]]+/g) ?? [];
  // Deduplicate and strip trailing punctuation
  return [...new Set(matches.map((u) => u.replace(/[.,;]+$/, "")))];
}

// Summarise content via Gemini on OpenRouter
async function summarisePage(content, url) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "user",
          content: `Summarise the following Notion page content clearly and concisely. Preserve key facts, lists, and structure. No commentary.\n\nURL: ${url}\n\n${content}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${err}`);
  }

  const json = await res.json();
  return json.choices[0].message.content.trim();
}

async function fetchCanvaSlides(canvaUrl) {
  console.error(`  Capturing Canva: ${canvaUrl}`);
  const slides = await captureCanva(canvaUrl, { transcribe: true });
  return slides.map((s) => ({ url: s.url, body: `\n${s.text}\n  ` }));
}

// Main
const files = collectFiles(EXPORT_DIR);
console.error(`Found ${files.length} files in ${EXPORT_DIR}`);

const allBlocks = [];

// Track which Canva URLs have already been captured this run
const capturedCanvaUrls = new Set();

for (const filePath of files) {
  const { id, title } = extractNotion(filePath);
  const url = id ? `https://www.notion.so/${id}` : `file://${filePath}`;
  const raw = fs.readFileSync(filePath, "utf-8");

  console.error(`Processing: ${path.relative(EXPORT_DIR, filePath)}`);

  let body;
  if (summarise) {
    console.error(`  Summarising...`);
    body = await summarisePage(raw, url);
  } else {
    body = xmlEscape(raw);
  }

  allBlocks.push(`  <content url="${url}">\n${body}\n  </content>`);

  // Handle Canva links
  const canvaUrls = findCanvaUrls(raw);
  for (const canvaUrl of canvaUrls) {
    if (capturedCanvaUrls.has(canvaUrl)) continue;
    capturedCanvaUrls.add(canvaUrl);

    try {
      const slides = await fetchCanvaSlides(canvaUrl);
      for (const slide of slides) {
        allBlocks.push(`  <content url="${slide.url}">${slide.body}  </content>`);
      }
    } catch (err) {
      console.error(`  Warning: Canva capture failed for ${canvaUrl}: ${err.message}`);
    }
  }
}

const xml = `<corpus source="${exportName}">\n\n${allBlocks.join("\n\n")}\n\n</corpus>\n`;
fs.writeFileSync(OUTPUT_FILE, xml, "utf-8");
console.error(`\nDone. Corpus saved to ${OUTPUT_FILE}`);

