import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
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

const PORT = process.env.GENERATOR_PORT || 3001;
const SECRET = process.env.GENERATOR_SECRET;
if (!SECRET) { console.error('GENERATOR_SECRET not set in .env'); process.exit(1); }

const app = express();
app.use(express.json());

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k.trim() === name) return v.join('=');
  }
  return null;
}

function requireAuth(req, res, next) {
  if (getCookie(req, 'fg_secret') === SECRET) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// Always serve the HTML — auth handled client-side
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'foyer-generator', 'public', 'index.html'));
});

app.post('/api/login', (req, res) => {
  if (req.body.secret === SECRET) {
    res.setHeader('Set-Cookie', `fg_secret=${SECRET}; HttpOnly; SameSite=Strict; Max-Age=31536000; Path=/`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'wrong secret' });
});

app.get('/api/defaults', requireAuth, (req, res) => {
  const config = yaml.load(fs.readFileSync(path.join(__dirname, 'default.config.yaml'), 'utf-8'));
  res.json({ model: config.model, prompt: config.prompt });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// Spawn a child script, pipe stdout+stderr to onLog line-by-line.
// If captureSilentStdout=true, stdout is buffered and returned but not logged.
function spawnLogged(args, onLog, { captureSilentStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: __dirname,
    });
    const stdoutChunks = [];
    const lines = (buf) => buf.toString().split('\n').filter(l => l.trim());
    proc.stdout.on('data', (d) => {
      stdoutChunks.push(d);
      if (!captureSilentStdout) lines(d).forEach(onLog);
    });
    proc.stderr.on('data', (d) => lines(d).forEach(onLog));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`exited with code ${code}`));
      else resolve(Buffer.concat(stdoutChunks).toString('utf-8'));
    });
  });
}

app.post('/api/generate', requireAuth, upload.single('zip'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no zip uploaded' });
  const title = req.body.title?.trim();
  const password = req.body.password?.trim();
  const model = req.body.model?.trim();
  const prompt = req.body.prompt;
  const summarise = req.body.summarise;

  const errs = [];
  if (!title || title.length > 200) errs.push('title must be 1–200 chars');
  if (!password || password.length > 200) errs.push('password must be 1–200 chars');
  if (model && !/^[a-zA-Z0-9/._:@-]+$/.test(model)) errs.push('model contains invalid characters');
  if (prompt && prompt.length > 20000) errs.push('prompt too long (max 20000 chars)');
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const log = (line) => { console.log('[stream]', line); res.write(`data: ${line}\n\n`); };
  const emit = (event, data) => { console.log('[event]', event, data); res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const keepAlive = setInterval(() => res.write(':\n\n'), 30000);

  const uploadId = crypto.randomUUID();
  const uploadDir = path.join(__dirname, 'foyer-generator', 'uploads', uploadId);

  try {
    // Extract zip
    fs.mkdirSync(uploadDir, { recursive: true });
    log('→ Extracting zip...');
    const zip = new AdmZip(req.file.buffer);
    let exportDir = path.join(uploadDir, 'export');
    zip.extractAllTo(exportDir, true);

    // Recursively unwrap: descend into single-child dirs and extract nested zips
    function findContentRoot(dir) {
      const entries = fs.readdirSync(dir);
      if (entries.some(e => e.endsWith('.md'))) return dir;

      // If sole entry is a zip, extract it in-place and recurse
      if (entries.length === 1 && entries[0].endsWith('.zip')) {
        const innerZip = new AdmZip(path.join(dir, entries[0]));
        const innerDir = path.join(dir, '_inner');
        innerZip.extractAllTo(innerDir, true);
        return findContentRoot(innerDir);
      }

      // If sole entry is a directory, descend
      if (entries.length === 1 && fs.statSync(path.join(dir, entries[0])).isDirectory()) {
        return findContentRoot(path.join(dir, entries[0]));
      }

      return dir;
    }
    exportDir = findContentRoot(exportDir);
    log(`→ Extracted → ${path.relative(uploadDir, exportDir)}`);

    // Determine runDir (mirrors generateEverything.js logic)
    const mdFiles = fs.readdirSync(exportDir).filter(f => f.endsWith('.md'));
    const rootName = mdFiles.length > 0
      ? mdFiles[0].replace(/\s+[a-f0-9]{32}\.md$/, '').trim()
      : path.basename(exportDir);
    const slugify = s => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    const pad = n => String(n).padStart(2, '0');
    const now = new Date();
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const runName = `${ts}_${slugify(rootName)}`;
    const runDir = path.join(__dirname, 'output-corpi', runName);
    fs.mkdirSync(runDir, { recursive: true });
    log(`\nRun folder: output-corpi/${runName}`);

    const corpusPath = path.join(runDir, 'corpus.xml');

    // TOC — stdout is the HTML, captured silently
    log('\n─── generateToc.js ' + '─'.repeat(30));
    const toc = await spawnLogged(
      [path.join(__dirname, 'generateToc.js'), exportDir],
      log,
      { captureSilentStdout: true }
    );
    fs.writeFileSync(path.join(runDir, 'toc.html'), toc, 'utf-8');
    log('✓ TOC written');

    // Corpus
    log('\n─── generateCorpus.js ' + '─'.repeat(27));
    const corpusArgs = summarise === 'true'
      ? ['--summarise', exportDir, corpusPath]
      : [exportDir, corpusPath];
    await spawnLogged([path.join(__dirname, 'generateCorpus.js'), ...corpusArgs], log);
    log('✓ Corpus done');

    // Fun facts
    log('\n─── generateFunFacts.js ' + '─'.repeat(25));
    await spawnLogged([path.join(__dirname, 'generateFunFacts.js'), corpusPath], log);
    log('✓ Fun facts done');

    // Example questions
    log('\n─── generateExampleQuestions.js ' + '─'.repeat(17));
    await spawnLogged([path.join(__dirname, 'generateExampleQuestions.js'), corpusPath], log);
    log('✓ Example questions done');

    // Write foyer config alongside corpus
    const configPath = path.join(runDir, 'foyer.config.yaml');
    fs.writeFileSync(configPath, yaml.dump({ title, model, password, prompt, corpusDir: '.' }), 'utf-8');
    log('\n→ Wrote foyer.config.yaml');

    // Deploy
    log('\n─── Deploying to Cloudflare Workers ' + '─'.repeat(13));
    let deployedUrl = '';
    await spawnLogged([path.join(__dirname, 'foyer.setup.js'), 'deploy', configPath], (line) => {
      log(line);
      const m = line.match(/https:\/\/[\w-]+\.workers\.dev/);
      if (m && !deployedUrl) deployedUrl = m[0];
    });

    log('\n✓ All done!');
    emit('done', { url: deployedUrl });
  } catch (err) {
    log(`\n✗ Failed: ${err.message}`);
    emit('error', { message: err.message });
  } finally {
    clearInterval(keepAlive);
    fs.rmSync(uploadDir, { recursive: true, force: true });
    res.end();
  }
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (!res.headersSent) res.status(500).json({ error: err.message });
});

process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

app.listen(PORT, () => console.log(`foyer-generator on http://localhost:${PORT}`));
