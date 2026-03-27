/**
 * Run all generators against a Notion export and save outputs to a
 * timestamped run folder.
 *
 * Usage: node generateEverything.js [--summarise] <export_dir>
 *
 * Output: temp/runs/YYYY-MM-DD_HH-MM_Root-Page-Name/
 *   corpus.xml
 *   funFacts.json
 *   toc.html
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const summarise = args.includes("--summarise");
const positional = args.filter((a) => !a.startsWith("--"));

if (!positional[0]) {
  console.error("Usage: node generateEverything.js [--summarise] <export_dir>");
  process.exit(1);
}

const EXPORT_DIR = path.resolve(positional[0]);

// Derive a clean root page name from the top-level .md file
function rootPageName(exportDir) {
  const mdFiles = fs.readdirSync(exportDir).filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) return path.basename(exportDir);
  const name = mdFiles[0].replace(/\s+[a-f0-9]{32}\.md$/, "").trim();
  return name;
}

function slugify(str) {
  return str.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

const runName = `${timestamp()}_${slugify(rootPageName(EXPORT_DIR))}`;
const RUN_DIR = path.join("output-corpi", runName);
fs.mkdirSync(RUN_DIR, { recursive: true });
console.error(`\nRun folder: ${RUN_DIR}\n`);

// Spawn a script and return its stdout as a string
function run(script, scriptArgs, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [path.join(__dirname, script), ...scriptArgs], {
      stdio: ["ignore", captureStdout ? "pipe" : "inherit", "inherit"],
    });

    const chunks = [];
    if (captureStdout) proc.stdout.on("data", (d) => chunks.push(d));

    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`${script} exited with code ${code}`));
      else resolve(captureStdout ? Buffer.concat(chunks).toString("utf-8") : null);
    });
  });
}

const corpusPath = path.join(RUN_DIR, "corpus.xml");

async function step(label, fn) {
  console.error(`\n─── ${label} ${"─".repeat(Math.max(0, 48 - label.length))}`);
  try {
    await fn();
    console.error(`✓ ${label} done`);
  } catch (err) {
    console.error(`✗ ${label} failed: ${err.message}`);
    process.exit(1);
  }
}

await step("generateToc.js", async () => {
  const toc = await run("generateToc.js", [EXPORT_DIR], { captureStdout: true });
  fs.writeFileSync(path.join(RUN_DIR, "toc.html"), toc, "utf-8");
});

await step("generateCorpus.js", async () => {
  const corpusArgs = summarise
    ? ["--summarise", EXPORT_DIR, corpusPath]
    : [EXPORT_DIR, corpusPath];
  await run("generateCorpus.js", corpusArgs);
});

await step("generateFunFacts.js", async () => {
  await run("generateFunFacts.js", [corpusPath]);
});

await step("generateExampleQuestions.js", async () => {
  await run("generateExampleQuestions.js", [corpusPath]);
});

console.error(`\n✓ All done → ${RUN_DIR}`);
