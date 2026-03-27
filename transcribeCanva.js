/**
 * Capture and transcribe slides from a public Canva presentation.
 * Usage: node transcribeCanva.js [--no-transcribe] <canva_url> [output_dir]
 *
 * --no-transcribe  Save screenshots only, skip Gemini transcription.
 *
 * Can also be imported as a module:
 *   import { captureCanva } from "./transcribeCanva.js";
 *   const blocks = await captureCanva(url, { transcribe: true });
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

async function transcribeSlide(imagePath) {
  const imageData = fs.readFileSync(imagePath).toString("base64");
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
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageData}` },
            },
            {
              type: "text",
              text: "Extract all text content from this presentation slide. Output only the text as it appears on the slide, preserving structure (headings, bullet points, etc). No commentary.",
            },
          ],
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

const FIND_SLIDE_JS = () => {
  const viewH = window.innerHeight;
  const viewW = window.innerWidth;
  let best = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (
      r.width > 400 && r.height > 300 &&
      r.top > 40 && r.bottom < viewH - 30 &&
      r.width < viewW && r.height < viewH - 80
    ) {
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = { x: r.left, y: r.top, width: r.width, height: r.height };
      }
    }
  }
  return best;
};

/**
 * Capture slides from a Canva presentation.
 * @param {string} canvaUrl
 * @param {{ transcribe?: boolean, outputDir?: string }} options
 * @returns {Promise<Array<{ url: string, text: string }>>} slide blocks (empty if transcribe=false)
 */
export async function captureCanva(canvaUrl, { transcribe = true, outputDir } = {}) {
  if (transcribe) loadEnv();

  const designId = canvaUrl.match(/\/design\/([^/]+)/)?.[1] ?? "unknown";
  const OUTPUT_DIR = outputDir ?? `./temp/canva/${designId}`;

  if (fs.existsSync(OUTPUT_DIR)) fs.rmSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

  console.error(`Loading: ${canvaUrl}`);
  await page.goto(canvaUrl);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  const counterText = await page
    .locator("button[aria-label='Go to page']")
    .textContent({ timeout: 10000 });
  const total = parseInt(counterText.split("/")[1].trim(), 10);
  console.error(`Total slides: ${total}`);

  const nextBtn = page.locator("button[aria-label='Next page']");

  let clip = await page.evaluate(FIND_SLIDE_JS);
  if (clip) {
    console.error(
      `Detected slide area: x=${clip.x.toFixed(0)} y=${clip.y.toFixed(0)} ` +
        `w=${clip.width.toFixed(0)} h=${clip.height.toFixed(0)}`
    );
  } else {
    console.error("Warning: could not detect slide bounds, falling back to full viewport");
    clip = { x: 0, y: 55, width: 1600, height: 990 };
  }

  const slides = [];

  for (let i = 0; i < total; i++) {
    const slideNum = i + 1;
    const outPath = path.join(OUTPUT_DIR, `slide_${String(slideNum).padStart(3, "0")}.png`);

    await page.screenshot({ path: outPath, clip });
    console.error(`  Captured slide ${slideNum}/${total} → ${outPath}`);

    if (transcribe) {
      console.error(`  Transcribing slide ${slideNum}...`);
      const text = await transcribeSlide(outPath);
      slides.push({ url: `${canvaUrl}#${slideNum}`, text });
    }

    if (slideNum < total) {
      await nextBtn.click();
      await page.waitForTimeout(1200);
    }
  }

  await browser.close();
  console.error(`\nDone. ${total} slides saved to ${OUTPUT_DIR}/`);

  return slides;
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const transcribe = !args.includes("--no-transcribe");
  const positional = args.filter((a) => !a.startsWith("--"));
  const canvaUrl = positional[0] ?? "https://www.canva.com/design/DAHEDzMl25Q/V5_uKwWdgV1GeRM__ZtU8A/view";
  const outputDir = positional[1];

  const slides = await captureCanva(canvaUrl, { transcribe, outputDir });

  if (transcribe && slides.length) {
    const blocks = slides.map((s) => `  <content url="${s.url}">\n${s.text}\n  </content>`);
    process.stdout.write(`<corpus url="${canvaUrl}">\n\n${blocks.join("\n\n")}\n\n</corpus>\n`);
  }
}
