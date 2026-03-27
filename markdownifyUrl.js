/**
 * Fetch a URL via Playwright (after JS renders), convert the live HTML to markdown.
 * Usage: node markdownifyUrl.js <url>
 *
 * Outputs markdown to stdout.
 */
import { chromium } from "playwright";
import { convertHtmlToMarkdown } from "dom-to-semantic-markdown";
import { JSDOM } from "jsdom";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node markdownifyUrl.js <url>");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(url);
await page.waitForLoadState("networkidle");

const html = await page.content();
await browser.close();

const dom = new JSDOM(html);
const markdown = convertHtmlToMarkdown(html, {
  overrideDOMParser: new dom.window.DOMParser(),
  extractMainContent: true,
  refifyUrls: true,
});

process.stdout.write(markdown);
