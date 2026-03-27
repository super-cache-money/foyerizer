/**
 * Generate a hierarchical table of contents from a Notion export.
 * Usage: node notion_toc.js <export_dir>
 */
import fs from "fs";
import path from "path";

const exportDir = process.argv[2] ?? "./Export";

// Strip the trailing hex ID from a Notion export filename
function stripId(name) {
  return name.replace(/\s+[0-9a-f]{32}$/, "").trim();
}

function extractId(name) {
  return name.match(/([0-9a-f]{32})$/)?.[1] ?? null;
}

function notionUrl(id) {
  return `https://www.notion.so/${id}`;
}

const CANVA_RE = /https:\/\/www\.canva\.com\/design\/([^/\s"')\[\]]+)\/[^\s"')\[\]]+\/view[^\s"')\[\]]*/g;

function extractCanvaLinks(mdPath) {
  const content = fs.readFileSync(mdPath, "utf-8");
  const links = [];
  for (const match of content.matchAll(CANVA_RE)) {
    const url = match[0];
    const designId = match[1];
    if (!links.find((l) => l.url === url)) {
      links.push({
        title: `Canva: ${designId}`,
        url,
        children: [],
        isDatabase: false,
      });
    }
  }
  return links;
}

// Build a tree of pages from a directory.
// Each node: { title, url, children, isDatabase }
function buildTree(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  // Pages: .md files
  const pages = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => {
      const baseName = file.name.replace(/\.md$/, "");
      const title = stripId(baseName);
      const id = extractId(baseName);
      const childDir = path.join(dir, title);
      const subpages =
        fs.existsSync(childDir) && fs.statSync(childDir).isDirectory()
          ? buildTree(childDir)
          : [];
      const canvaLinks = extractCanvaLinks(path.join(dir, file.name));
      const children = [...subpages, ...canvaLinks];
      return { title, url: id ? notionUrl(id) : null, children, isDatabase: false };
    });

  // Databases: .csv files (excluding _all.csv variants)
  const databases = entries
    .filter((e) => e.isFile() && e.name.endsWith(".csv") && !e.name.endsWith("_all.csv"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => {
      const baseName = file.name.replace(/\.csv$/, "");
      const title = stripId(baseName);
      const id = extractId(baseName);
      const childDir = path.join(dir, title);
      const children =
        fs.existsSync(childDir) && fs.statSync(childDir).isDirectory()
          ? buildTree(childDir)
          : [];
      return { title, url: id ? notionUrl(id) : null, children, isDatabase: true };
    });

  // Merge and sort pages + databases together by title
  return [...pages, ...databases].sort((a, b) => a.title.localeCompare(b.title));
}

function renderTree(nodes, indent = "") {
  const lines = [];
  lines.push(`${indent}<ul>`);
  for (const node of nodes) {
    const anchor = node.url ? `<a href="${node.url}">${node.title}</a>` : node.title;
    if (node.isDatabase && node.children.length > 0) {
      lines.push(`${indent}  <li><details>`);
      lines.push(`${indent}    <summary>${anchor}</summary>`);
      lines.push(renderTree(node.children, indent + "    "));
      lines.push(`${indent}  </details></li>`);
    } else if (node.children.length > 0) {
      lines.push(`${indent}  <li>${anchor}`);
      lines.push(renderTree(node.children, indent + "  "));
      lines.push(`${indent}  </li>`);
    } else {
      lines.push(`${indent}  <li>${anchor}</li>`);
    }
  }
  lines.push(`${indent}</ul>`);
  return lines.join("\n");
}

const tree = buildTree(exportDir);
console.log(renderTree(tree));
