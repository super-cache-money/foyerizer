/**
 * Run all generators against a Notion export and save outputs to a
 * timestamped run folder.
 *
 * Usage: node generateEverything.js [--summarise] <export_dir>
 *
 * Or import and call:
 *   import { generateEverything } from './generateEverything.js';
 *   const runDir = await generateEverything(exportDir, { summarise: true });
 *
 * Output: output-corpi/YYYY-MM-DD_HH-MM_Root-Page-Name/
 *   corpus.xml  toc.html  funFacts.json  exampleQuestions.json
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function rootPageName(exportDir) {
  const mdFiles = fs.readdirSync(exportDir).filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) return path.basename(exportDir);
  return mdFiles[0].replace(/\s+[a-f0-9]{32}\.md$/, "").trim();
}

function slugify(str) {
  return str.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

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

async function step(label, fn) {
  console.error(`\n─── ${label} ${"─".repeat(Math.max(0, 48 - label.length))}`);
  try {
    await fn();
    console.error(`✓ ${label} done`);
  } catch (err) {
    console.error(`✗ ${label} failed: ${err.message}`);
    throw err;
  }
}

export async function generateEverything(exportDir, { summarise = false } = {}) {
  const resolvedExportDir = path.resolve(exportDir);
  const runName = `${timestamp()}_${slugify(rootPageName(resolvedExportDir))}`;
  const runDir = path.join("output-corpi", runName);
  fs.mkdirSync(runDir, { recursive: true });
  console.error(`\nRun folder: ${runDir}\n`);

  const corpusPath = path.join(runDir, "corpus.xml");

  await step("generateToc.js", async () => {
    const toc = await run("generateToc.js", [resolvedExportDir], { captureStdout: true });
    fs.writeFileSync(path.join(runDir, "toc.html"), toc, "utf-8");
  });

  await step("generateCorpus.js", async () => {
    const corpusArgs = summarise
      ? ["--summarise", resolvedExportDir, corpusPath]
      : [resolvedExportDir, corpusPath];
    await run("generateCorpus.js", corpusArgs);
  });

  await step("generateFunFacts.js", async () => {
    await run("generateFunFacts.js", [corpusPath]);
  });

  await step("generateExampleQuestions.js", async () => {
    await run("generateExampleQuestions.js", [corpusPath]);
  });

  console.error(`\n✓ All done → ${runDir}`);
  return runDir;
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const summarise = args.includes("--summarise");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (!positional[0]) {
    console.error("Usage: node generateEverything.js [--summarise] <export_dir>");
    process.exit(1);
  }
  generateEverything(positional[0], { summarise }).catch(() => process.exit(1));
}
