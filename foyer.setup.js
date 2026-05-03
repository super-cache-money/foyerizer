/**
 * Reads config, embeds corpus data, writes foyer-server/src/data.js and foyer-server/wrangler.toml.
 *
 * Run directly:
 *   node foyer.setup.js dev [config.yaml]
 *   node foyer.setup.js deploy [config.yaml]
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

export function setup(configArg) {
  const configPath = path.resolve(configArg ?? 'default.config.yaml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf-8'));
  const { title, model, prompt: promptTemplate, corpusDir, password } = config;

  const resolvedCorpusDir = path.resolve(path.dirname(configPath), corpusDir);

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const workerName = `foyer-for-${slug}`;
  console.log(`→ Worker name: ${workerName}`);

  const corpusPath = path.join(resolvedCorpusDir, 'corpus.xml');
  const tocPath = path.join(resolvedCorpusDir, 'toc.html');
  const funFactsPath = path.join(resolvedCorpusDir, 'funFacts.json');
  const exampleQuestionsPath = path.join(resolvedCorpusDir, 'exampleQuestions.json');

  for (const p of [corpusPath, tocPath, funFactsPath, exampleQuestionsPath]) {
    if (!fs.existsSync(p)) { console.error(`Missing required file: ${p}`); process.exit(1); }
  }

  const corpus = fs.readFileSync(corpusPath, 'utf-8');
  const toc = fs.readFileSync(tocPath, 'utf-8');
  const funFacts = JSON.parse(fs.readFileSync(funFactsPath, 'utf-8'));
  const exampleQuestions = JSON.parse(fs.readFileSync(exampleQuestionsPath, 'utf-8'));
  const lastUpdated = fs.statSync(corpusPath).mtime.toISOString();

  console.log(`→ Corpus: ${Math.round(corpus.length / 1024)}KB | TOC: ${Math.round(toc.length / 1024)}KB | ${funFacts.length} fun facts | ${exampleQuestions.length} example questions`);
  console.log(`→ Last updated: ${lastUpdated}`);

  const workerDir = path.join(__dirname, 'foyer-server');

  const dataJs = `// Auto-generated — do not edit
export const title = ${JSON.stringify(title)};
export const corpus = ${JSON.stringify(corpus)};
export const toc = ${JSON.stringify(toc)};
export const funFacts = ${JSON.stringify(funFacts)};
export const exampleQuestions = ${JSON.stringify(exampleQuestions)};
export const prompt = ${JSON.stringify(promptTemplate)};
export const lastUpdated = ${JSON.stringify(lastUpdated)};
`;
  fs.writeFileSync(path.join(workerDir, 'src', 'data.js'), dataJs, 'utf-8');
  console.log(`→ Wrote foyer-server/src/data.js (${Math.round(dataJs.length / 1024)}KB)`);

  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) console.warn('⚠  OPENAI_API_KEY not found in .env');

  function tomlStr(s) {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
  }

  const wranglerToml = `name = "${workerName}"
main = "src/index.js"
compatibility_date = "2024-09-23"
assets = { directory = "./public" }

[vars]
TITLE = "${tomlStr(title)}"
MODEL = "${tomlStr(model)}"
PASSWORD = "${tomlStr(password)}"
OPENROUTER_API_KEY = "${apiKey}"
LAST_UPDATED = "${lastUpdated}"
`;
  fs.writeFileSync(path.join(workerDir, 'wrangler.toml'), wranglerToml, 'utf-8');
  console.log(`→ Wrote foyer-server/wrangler.toml`);

  return { workerDir };
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, configArg] = process.argv.slice(2);
  const { workerDir } = setup(configArg);
  const wranglerConfig = path.join(workerDir, 'wrangler.toml');
  if (mode === 'dev') {
    console.log('→ Starting dev server...\n');
    execSync(`npx wrangler dev --config ${wranglerConfig}`, { cwd: __dirname, stdio: 'inherit' });
  } else if (mode === 'deploy') {
    console.log('→ Deploying...\n');
    execSync(`npx wrangler deploy --config ${wranglerConfig}`, { cwd: __dirname, stdio: 'inherit' });
  } else {
    console.error('Usage: node foyer.setup.js [dev|deploy] [config.yaml]');
    process.exit(1);
  }
}
