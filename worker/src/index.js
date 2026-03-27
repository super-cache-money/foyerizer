import { corpus, toc, funFacts, exampleQuestions, prompt as promptTemplate, lastUpdated } from './data.js';

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k.trim() === name) return v.join('=');
  }
  return null;
}

function isAuthed(request, env) {
  return getCookie(request, 'foyer_auth') === env.PASSWORD;
}

function buildPrompt(question, customTemplate) {
  return (customTemplate || promptTemplate)
    .replace('{question}', question)
    .replace('{toc.html}', toc)
    .replace('{corpus.xml}', corpus);
}

const HTML = (title, lastUpdatedStr, facts, questions, defaultModel, defaultPrompt, tocHtml) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #faf9f7;
    --surface: #f2f0ec;
    --border: #dedad3;
    --text: #0f0e0c;
    --muted: #6b6560;
    --accent: #1a1815;
    --accent-hover: #3d3a35;
    --tile-bg: #edeae4;
    --tile-border: #d4cfc7;
  }
  html, body { height: 100%; }
  body { background: var(--bg); color: var(--text); font-family: 'EB Garamond', Georgia, serif; font-size: 18px; height: 100%; display: flex; flex-direction: column; overflow: hidden; -webkit-font-smoothing: antialiased; }

  /* Password overlay */
  #auth-overlay {
    position: fixed; inset: 0; background: var(--bg); z-index: 100;
    display: flex; align-items: center; justify-content: center;
  }
  #auth-overlay.hidden { display: none; }
  .auth-box {
    background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
    padding: 48px; max-width: 380px; width: 100%; text-align: center;
    box-shadow: 0 2px 20px rgba(0,0,0,0.06);
  }
  .auth-box h2 { font-size: 1.6rem; margin-bottom: 8px; font-weight: 500; }
  .auth-box p { color: var(--muted); font-size: 0.9rem; margin-bottom: 28px; font-family: 'Outfit', sans-serif; }
  .auth-box input {
    width: 100%; padding: 12px 16px; background: var(--bg); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); font-size: 1rem; margin-bottom: 12px; outline: none;
  }
  .auth-box input:focus { border-color: var(--accent); }
  .auth-box button {
    width: 100%; padding: 12px; background: var(--accent); border: none; border-radius: 6px;
    color: #faf9f7; font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background 0.15s;
    font-family: 'Outfit', sans-serif; letter-spacing: 0.02em;
  }
  .auth-box button:hover { background: var(--accent-hover); }
  .auth-error { color: #c0392b; font-size: 0.82rem; margin-top: 8px; min-height: 20px; font-family: 'Outfit', sans-serif; }

  /* Navbar */
  nav {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 24px; border-bottom: 1px solid var(--border); gap: 12px;
  }
  .nav-title { font-weight: 600; font-size: 0.95rem; font-family: 'Outfit', sans-serif; letter-spacing: -0.01em; }
  .nav-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .nav-updated { color: var(--muted); font-size: 0.75rem; font-family: 'Outfit', sans-serif; }

  /* Nav buttons */
  .nav-btn {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); font-size: 0.78rem; padding: 0 12px; cursor: pointer;
    display: flex; align-items: center; gap: 6px; height: 30px; white-space: nowrap;
    font-family: 'Outfit', sans-serif; letter-spacing: 0.01em;
  }
  .nav-btn:hover { border-color: var(--accent); background: var(--tile-bg); }
  .nav-btn--icon { padding: 0; width: 30px; min-width: 30px; justify-content: center; font-size: 0.95rem; }

  /* Recent chats */
  .chats-wrapper { position: relative; }
  .chats-dropdown {
    display: none; position: absolute; right: 0; top: calc(100% + 8px);
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    min-width: 320px; max-width: 420px; z-index: 50; overflow: hidden;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  }
  .chats-dropdown.open { display: block; }
  .chats-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 0.8rem; color: var(--muted); }
  .chats-warning { color: #f0a04b; }
  .chat-item { padding: 12px 16px; cursor: pointer; border-bottom: 1px solid var(--border); }
  .chat-item:last-child { border-bottom: none; }
  .chat-item:hover { background: var(--bg); }
  .chat-item-q { font-size: 0.88rem; font-weight: 500; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chat-item-ts { font-size: 0.75rem; color: var(--muted); }
  .chats-empty { padding: 20px 16px; color: var(--muted); font-size: 0.85rem; text-align: center; }

  /* Settings panel */
  #settings-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 90;
    align-items: flex-start; justify-content: flex-end;
  }
  #settings-overlay.open { display: flex; }
  #settings-panel {
    background: var(--bg); border-left: 1px solid var(--border);
    width: 100%; max-width: 520px; height: 100vh; overflow-y: auto;
    padding: 28px 28px 48px; display: flex; flex-direction: column; gap: 24px;
  }
  .settings-header { display: flex; align-items: center; justify-content: space-between; }
  .settings-header h2 { font-size: 1.1rem; font-weight: 700; }
  .settings-close { background: none; border: none; color: var(--muted); font-size: 1.4rem; cursor: pointer; line-height: 1; padding: 4px; }
  .settings-close:hover { color: var(--text); }
  .settings-notice {
    background: rgba(240, 160, 75, 0.1); border: 1px solid rgba(240, 160, 75, 0.3);
    border-radius: 8px; padding: 10px 14px; font-size: 0.82rem; color: #f0a04b;
  }
  .field { display: flex; flex-direction: column; gap: 8px; }
  .field label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-family: 'Outfit', sans-serif; }
  .field input, .field textarea {
    background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); font-size: 0.9rem; padding: 10px 14px; outline: none;
    font-family: inherit; transition: border-color 0.15s; width: 100%;
  }
  .field input:focus, .field textarea:focus { border-color: var(--accent); }
  .field textarea { min-height: 320px; resize: vertical; line-height: 1.6; font-size: 0.83rem; font-family: 'SF Mono', 'Fira Code', monospace; }
  .settings-active-badge {
    font-size: 0.72rem; background: var(--accent); color: #faf9f7;
    border-radius: 4px; padding: 1px 6px; margin-left: 6px; vertical-align: middle;
  }
  .settings-actions { display: flex; gap: 10px; }
  .btn-save {
    flex: 1; padding: 10px; background: var(--accent); border: none; border-radius: 6px;
    color: #faf9f7; font-size: 0.85rem; font-weight: 500; cursor: pointer;
    font-family: 'Outfit', sans-serif;
  }
  .btn-save:hover { background: var(--accent-hover); }
  .btn-reset {
    padding: 10px 16px; background: none; border: 1px solid var(--border); border-radius: 8px;
    color: var(--muted); font-size: 0.9rem; cursor: pointer;
  }
  .btn-reset:hover { border-color: #ff6b6b; color: #ff6b6b; }

  /* Layout */
  .app-body { flex: 1; display: flex; overflow: hidden; }

  /* TOC Sidebar */
  #toc-sidebar {
    width: 280px; min-width: 220px; max-width: 320px; flex-shrink: 0;
    border-right: 1px solid var(--border); overflow-y: auto;
    padding: 24px 16px; background: var(--surface); font-family: 'Outfit', sans-serif;
  }
  #toc-sidebar h3 {
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--muted); margin-bottom: 14px; padding-left: 4px;
  }
  #toc-sidebar ul { list-style: none; padding-left: 0; }
  #toc-sidebar li { padding-left: 0; }
  #toc-sidebar ul ul { padding-left: 14px; border-left: 1px solid var(--border); margin-left: 6px; }
  #toc-sidebar a {
    display: block; padding: 4px 6px; border-radius: 6px;
    color: var(--muted); font-size: 0.8rem; text-decoration: none; line-height: 1.45;
    transition: color 0.12s, background 0.12s;
  }
  #toc-sidebar a:hover { color: var(--text); background: var(--bg); }
  #toc-sidebar details > summary {
    list-style: none; cursor: pointer; padding: 4px 6px; border-radius: 6px;
    color: var(--muted); font-size: 0.8rem; line-height: 1.45;
    transition: color 0.12s, background 0.12s;
  }
  #toc-sidebar details > summary:hover { color: var(--text); background: var(--bg); }
  #toc-sidebar details > summary::marker,
  #toc-sidebar details > summary::-webkit-details-marker { display: none; }
  #toc-sidebar details[open] > summary { color: var(--text); }

  /* TOC mobile toggle */
  #toc-toggle {
    display: none; background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); font-size: 0.82rem; padding: 0 12px;
    cursor: pointer; height: 32px; align-items: center; gap: 6px;
  }
  #toc-toggle:hover { border-color: var(--accent); }

  /* Main */
  main { flex: 1; overflow-y: auto; padding: 48px 32px 80px; min-width: 0; }
  .ask-wrap { max-width: 760px; margin: 0 auto; }
  .ask-label { font-size: 0.72rem; color: var(--muted); margin-bottom: 10px; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Outfit', sans-serif; }
  .ask-box { position: relative; }
  textarea#question {
    width: 100%; min-height: 100px; background: #fff; border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); font-size: 1.05rem; line-height: 1.65;
    padding: 16px 16px 52px 16px; resize: none; outline: none; transition: border-color 0.15s;
    font-family: 'EB Garamond', Georgia, serif; box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  }
  textarea#question:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(44,41,37,0.06); }
  .ask-submit {
    position: absolute; bottom: 12px; right: 12px;
    background: var(--accent); border: none; border-radius: 6px;
    color: #faf9f7; font-size: 0.8rem; font-weight: 500; padding: 7px 18px;
    cursor: pointer; transition: background 0.15s; letter-spacing: 0.02em;
    font-family: 'Outfit', sans-serif;
  }
  .ask-submit:hover { background: var(--accent-hover); }
  .ask-submit:disabled { opacity: 0.35; cursor: not-allowed; }

  /* Example questions drawer */
  .questions-toggle {
    margin-top: 10px; background: none; border: none; color: var(--muted);
    font-size: 0.8rem; cursor: pointer; padding: 0; display: flex; align-items: center; gap: 4px;
    transition: color 0.15s;
  }
  .questions-toggle:hover { color: var(--text); }
  .questions-toggle .arrow { transition: transform 0.2s; display: inline-block; }
  .questions-toggle.open .arrow { transform: rotate(90deg); }
  .questions-drawer {
    display: none; margin-top: 10px; border: 1px solid var(--border);
    border-radius: 10px; overflow: hidden;
  }
  .questions-drawer.open { display: block; }
  .question-item {
    padding: 10px 14px; font-size: 0.88rem; color: var(--text); cursor: pointer;
    border-bottom: 1px solid var(--border); transition: background 0.12s;
    line-height: 1.4;
  }
  .question-item:last-child { border-bottom: none; }
  .question-item:hover { background: var(--surface); color: var(--text); }

  /* Loading */
  #loading { display: none; margin-top: 32px; text-align: center; }
  #loading.visible { display: block; }
  .loading-dots { display: flex; justify-content: center; gap: 6px; margin-bottom: 20px; }
  .dot {
    width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes pulse { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }
  .fun-fact {
    font-size: 0.88rem; line-height: 2; max-width: 480px; margin: 0 auto; min-height: 64px;
    transition: opacity 0.4s; font-style: italic; text-align: center;
    background: linear-gradient(90deg, var(--muted) 25%, #c8c2b8 50%, var(--muted) 75%);
    background-size: 200% auto;
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    animation: shimmer 3s linear infinite;
  }
  @keyframes shimmer { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }

  /* Answer */
  #answer { margin-top: 40px; }
  .answer-para { margin-bottom: 24px; }
  .answer-text { line-height: 1.8; font-size: 1.05rem; }
  .answer-text a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .answer-text a:hover { color: var(--accent-hover); }
  .answer-text strong { font-weight: 600; }
  .source-tiles { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .source-tile {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--tile-bg); border: 1px solid var(--tile-border);
    border-radius: 5px; padding: 5px 11px; font-size: 0.78rem; color: var(--text);
    text-decoration: none; transition: border-color 0.15s, background 0.15s;
    max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: 'Outfit', sans-serif; letter-spacing: 0.01em;
  }
  .source-tile:hover { border-color: var(--accent); background: var(--border); }
  .source-tile .tile-icon { font-size: 0.7rem; opacity: 0.5; }

  /* Responsive */
  @media (max-width: 768px) {
    #toc-toggle { display: inline-flex; align-items: center; padding: 6px 10px; }
    #toc-sidebar {
      display: none; position: fixed; inset: 0; width: 100%; max-width: 100%;
      z-index: 60; border-right: none; padding-bottom: 48px;
    }
    #toc-sidebar.open { display: block; }
    #toc-close-btn {
      display: block; margin-bottom: 16px; background: none; border: none;
      color: var(--muted); font-size: 0.9rem; cursor: pointer; text-align: left; padding: 0;
    }
    main { padding: 24px 16px 64px; }
    .nav-updated { display: none; }
    nav { padding: 10px 12px; flex-wrap: nowrap; gap: 8px; }
    .nav-title { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
    nav > div:first-child { min-width: 0; flex: 1; overflow: hidden; gap: 6px; }
    .nav-right { gap: 6px; flex-shrink: 0; }
    .nav-btn { padding: 0 8px; font-size: 0.76rem; }
  }
  @media (min-width: 769px) {
    #toc-close-btn { display: none; }
  }
</style>
</head>
<body>

<!-- Password overlay -->
<div id="auth-overlay">
  <div class="auth-box">
    <h2>🔒 ${title}</h2>
    <p>Enter the password to access this foyer.</p>
    <input type="password" id="pw-input" placeholder="Password" autocomplete="current-password" />
    <button id="pw-btn">Enter</button>
    <div class="auth-error" id="auth-error"></div>
  </div>
</div>

<!-- Settings panel -->
<div id="settings-overlay">
  <div id="settings-panel">
    <div class="settings-header">
      <h2>Settings</h2>
      <button class="settings-close" id="settings-close">×</button>
    </div>
    <div class="settings-notice">⚠ Settings are saved to local storage and may be cleared by the browser.</div>
    <div class="field">
      <label>Model override <span id="model-badge" class="settings-active-badge" style="display:none">active</span></label>
      <input type="text" id="settings-model" placeholder="${defaultModel}" />
    </div>
    <div class="field">
      <label>Prompt template <span id="prompt-badge" class="settings-active-badge" style="display:none">active</span></label>
      <textarea id="settings-prompt"></textarea>
    </div>
    <div class="settings-actions">
      <button class="btn-save" id="settings-save">Save</button>
      <button class="btn-reset" id="settings-reset">Reset to defaults</button>
    </div>
  </div>
</div>

<!-- App -->
<nav>
  <div style="display:flex;align-items:center;gap:8px;">
    <button id="toc-toggle" onclick="toggleToc()">☰ Contents</button>
    <span class="nav-title">${title}</span>
  </div>
  <div class="nav-right">
    <span class="nav-updated">Last updated: ${lastUpdatedStr}</span>
    <div class="chats-wrapper">
      <button class="nav-btn" id="chats-btn">
        Recent<span id="chats-count"></span>
      </button>
      <div class="chats-dropdown" id="chats-dropdown">
        <div class="chats-header">
          Recent chats &nbsp;<span class="chats-warning">⚠ Stored locally — may be cleared by browser</span>
        </div>
        <div id="chats-list"></div>
      </div>
    </div>
    <button class="nav-btn nav-btn--icon" id="settings-btn" title="Settings" style="position:relative">⚙<span id="settings-active-dot" style="display:none;position:absolute;top:4px;right:4px;width:6px;height:6px;border-radius:50%;background:var(--accent)"></span></button>
  </div>
</nav>

<div class="app-body">
<aside id="toc-sidebar">
  <button id="toc-close-btn" onclick="toggleToc()">✕ Close</button>
  <h3>Table of Contents</h3>
  ${tocHtml}
</aside>
<main>
  <div class="ask-wrap">
  <div class="ask-label">Ask anything</div>
  <div class="ask-box">
    <textarea id="question"></textarea>
    <button class="ask-submit" id="submit-btn">Ask →</button>
  </div>
  <button class="questions-toggle" id="questions-toggle"><span class="arrow">›</span> Example questions</button>
  <div class="questions-drawer" id="questions-drawer"></div>

  <div id="loading">
    <div class="loading-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="fun-fact" id="fun-fact"></div>
  </div>

  <div id="answer"></div>
  </div>
</main>
</div>

<script>
function toggleToc() {
  document.getElementById('toc-sidebar').classList.toggle('open');
}

const FACTS = ${facts};
const EXAMPLE_QUESTIONS = ${questions};
const DEFAULT_MODEL = ${JSON.stringify(defaultModel)};
const DEFAULT_PROMPT = ${JSON.stringify(defaultPrompt)};
const SETTINGS_KEY = 'foyer_settings';
const CHATS_KEY = 'foyer_chats';

let factsTimer = null;
let factIdx = 0;

// ── Settings ──────────────────────────────────────────────────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  updateSettingsBadges();
}

function updateSettingsBadges() {
  const s = loadSettings();
  const modelActive = !!(s.modelOverride && s.modelOverride !== DEFAULT_MODEL);
  const promptActive = !!(s.promptOverride && s.promptOverride !== DEFAULT_PROMPT);
  document.getElementById('model-badge').style.display = modelActive ? '' : 'none';
  document.getElementById('prompt-badge').style.display = promptActive ? '' : 'none';
  document.getElementById('settings-active-dot').style.display = (modelActive || promptActive) ? '' : 'none';
}

function openSettings() {
  const s = loadSettings();
  document.getElementById('settings-model').value = s.modelOverride || '';
  document.getElementById('settings-prompt').value = s.promptOverride || DEFAULT_PROMPT;
  document.getElementById('settings-overlay').classList.add('open');
}

document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-overlay').classList.remove('open');
});
document.getElementById('settings-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settings-overlay')) {
    document.getElementById('settings-overlay').classList.remove('open');
  }
});

document.getElementById('settings-save').addEventListener('click', () => {
  const modelVal = document.getElementById('settings-model').value.trim();
  const promptVal = document.getElementById('settings-prompt').value;
  saveSettings({ modelOverride: modelVal || null, promptOverride: promptVal !== DEFAULT_PROMPT ? promptVal : null });
  document.getElementById('settings-overlay').classList.remove('open');
});

document.getElementById('settings-reset').addEventListener('click', () => {
  localStorage.removeItem(SETTINGS_KEY);
  document.getElementById('settings-model').value = '';
  document.getElementById('settings-prompt').value = DEFAULT_PROMPT;
  updateSettingsBadges();
});

// ── Auth ──────────────────────────────────────────────────────────────────
async function checkAuth() {
  const res = await fetch('/api/check-auth');
  if (res.ok) document.getElementById('auth-overlay').classList.add('hidden');
}

document.getElementById('pw-btn').addEventListener('click', tryAuth);
document.getElementById('pw-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryAuth(); });

async function tryAuth() {
  const pw = document.getElementById('pw-input').value;
  const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  if (res.ok) {
    document.getElementById('auth-overlay').classList.add('hidden');
  } else {
    document.getElementById('auth-error').textContent = 'Incorrect password.';
  }
}

// ── Markdown mini-renderer ────────────────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(text) {
  // Strip markdown links from prose — they appear as source tiles below instead
  // Handles nested brackets e.g. [Title [sub]](url)
  let result = text.replace(/\\[(?:[^\\]\\[]|\\[[^\\]]*\\])*\\]\\([^)]+\\)/g, '');
  // Escape HTML then apply bold/italic
  result = escapeHtml(result)
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>');
  return result;
}

function extractSources(text) {
  const re = /\\[([^\\]]+)\\]\\(([^)]+)\\)/g;
  const sources = [];
  let m;
  while ((m = re.exec(text)) !== null) sources.push({ label: m[1], url: m[2] });
  return sources;
}

function renderSourceTiles(sources) {
  if (!sources.length) return '';
  return '<div class="source-tiles">' + sources.map(s => {
    let url = s.url;
    if (url.startsWith('://')) url = 'https' + url;
    else if (url.startsWith('//')) url = 'https:' + url;
    let label = s.label;
    if (url.includes('canva.com')) {
      const slide = url.match(/#(\d+)$/);
      label = slide ? \`Canva · slide \${slide[1]}\` : 'Canva';
    }
    return \`<a class="source-tile" href="\${url}" target="_blank" rel="noopener"><span class="tile-icon">↗</span>\${label}</a>\`;
  }).join('') + '</div>';
}

// ── Loading animation ─────────────────────────────────────────────────────
function startLoading() {
  document.getElementById('loading').classList.add('visible');
  document.getElementById('answer').innerHTML = '';
  factIdx = Math.floor(Math.random() * FACTS.length);
  showFact();
  factsTimer = setInterval(() => { factIdx = (factIdx + 1) % FACTS.length; showFact(); }, 3500);
}

function showFact() {
  const el = document.getElementById('fun-fact');
  el.style.opacity = '0';
  setTimeout(() => { el.innerHTML = FACTS[factIdx].split('\\n').map(l => l.replace(/&/g,'&amp;').replace(/</g,'&lt;')).join('<br>'); el.style.opacity = '1'; }, 300);
}

function stopLoading() {
  clearInterval(factsTimer);
  document.getElementById('loading').classList.remove('visible');
}

// ── Ask ───────────────────────────────────────────────────────────────────
document.getElementById('submit-btn').addEventListener('click', doAsk);
document.getElementById('question').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doAsk();
});

async function doAsk() {
  const question = document.getElementById('question').value.trim();
  if (!question) return;

  const settings = loadSettings();
  document.getElementById('submit-btn').disabled = true;
  startLoading();

  const answerEl = document.getElementById('answer');
  answerEl.innerHTML = '';
  let fullAnswer = '';
  let buffer = '';

  try {
    const body = { question };
    if (settings.modelOverride) body.modelOverride = settings.modelOverride;
    if (settings.promptOverride) body.promptOverride = settings.promptOverride;

    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      document.getElementById('auth-overlay').classList.remove('hidden');
      stopLoading();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    function flushParagraph(text) {
      if (!text.trim()) return;
      const div = document.createElement('div');
      div.className = 'answer-para';
      const sources = extractSources(text);
      div.innerHTML = \`<div class="answer-text">\${renderMarkdown(text)}</div>\${renderSourceTiles(sources)}\`;
      answerEl.appendChild(div);
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const token = JSON.parse(data).choices?.[0]?.delta?.content ?? '';
          if (!token) continue;
          fullAnswer += token;
          buffer += token;
          const parts = buffer.split(/\\n\\n+/);
          for (let i = 0; i < parts.length - 1; i++) flushParagraph(parts[i]);
          buffer = parts[parts.length - 1];
        } catch {}
      }
    }

    stopLoading();
    if (buffer.trim()) flushParagraph(buffer);
    console.log('Full answer:', fullAnswer);
    saveChat(question, fullAnswer);

  } catch (err) {
    stopLoading();
    answerEl.innerHTML = \`<p style="color:#ff6b6b">Error: \${err.message}</p>\`;
  }

  document.getElementById('submit-btn').disabled = false;
}

// ── Recent chats ──────────────────────────────────────────────────────────
function loadChats() {
  try { return JSON.parse(localStorage.getItem(CHATS_KEY) || '[]'); } catch { return []; }
}

function saveChat(question, answer) {
  const chats = loadChats();
  chats.unshift({ question, answer, ts: Date.now() });
  localStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, 20)));
  renderChats();
}

function renderChats() {
  const chats = loadChats();
  const list = document.getElementById('chats-list');
  const count = document.getElementById('chats-count');
  count.textContent = chats.length ? \` (\${chats.length})\` : '';
  if (!chats.length) { list.innerHTML = '<div class="chats-empty">No recent chats yet.</div>'; return; }
  list.innerHTML = chats.map((c, i) =>
    \`<div class="chat-item" data-idx="\${i}">
      <div class="chat-item-q">\${c.question}</div>
      <div class="chat-item-ts">\${new Date(c.ts).toLocaleString()}</div>
    </div>\`
  ).join('');
  list.querySelectorAll('.chat-item').forEach(el => {
    el.addEventListener('click', () => {
      const chat = loadChats()[+el.dataset.idx];
      document.getElementById('question').value = chat.question;
      const answerEl = document.getElementById('answer');
      answerEl.innerHTML = '';
      chat.answer.split(/\\n\\n+/).forEach(para => {
        if (!para.trim()) return;
        const div = document.createElement('div');
        div.className = 'answer-para';
        const sources = extractSources(para);
        div.innerHTML = \`<div class="answer-text">\${renderMarkdown(para)}</div>\${renderSourceTiles(sources)}\`;
        answerEl.appendChild(div);
      });
      document.getElementById('chats-dropdown').classList.remove('open');
    });
  });
}

document.getElementById('chats-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('chats-dropdown').classList.toggle('open');
});
document.addEventListener('click', () => document.getElementById('chats-dropdown').classList.remove('open'));
document.getElementById('chats-dropdown').addEventListener('click', e => e.stopPropagation());

// ── Example questions ─────────────────────────────────────────────────────
(function() {
  const toggle = document.getElementById('questions-toggle');
  const drawer = document.getElementById('questions-drawer');
  if (!EXAMPLE_QUESTIONS.length) { toggle.style.display = 'none'; return; }

  drawer.innerHTML = EXAMPLE_QUESTIONS.map(q =>
    \`<div class="question-item">\${q}</div>\`
  ).join('');

  drawer.querySelectorAll('.question-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      document.getElementById('question').value = EXAMPLE_QUESTIONS[i];
      document.getElementById('question').focus();
      toggle.classList.remove('open');
      drawer.classList.remove('open');
    });
  });

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open');
    drawer.classList.toggle('open');
  });
})();

// ── Init ──────────────────────────────────────────────────────────────────
checkAuth();
renderChats();
updateSettingsBadges();
if (EXAMPLE_QUESTIONS.length) {
  document.getElementById('question').placeholder = EXAMPLE_QUESTIONS[Math.floor(Math.random() * EXAMPLE_QUESTIONS.length)];
}
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/check-auth' && request.method === 'GET') {
      return new Response(null, { status: isAuthed(request, env) ? 200 : 401 });
    }

    if (pathname === '/api/auth' && request.method === 'POST') {
      const { password } = await request.json();
      if (password === env.PASSWORD) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `foyer_auth=${env.PASSWORD}; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000; Path=/`,
          },
        });
      }
      return new Response(JSON.stringify({ error: 'wrong password' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (pathname === '/api/ask' && request.method === 'POST') {
      if (!isAuthed(request, env)) return new Response('Unauthorized', { status: 401 });

      const { question, promptOverride, modelOverride } = await request.json();
      const fullPrompt = buildPrompt(question, promptOverride);
      const model = (modelOverride && modelOverride.trim()) ? modelOverride.trim() : env.MODEL;

      async function callLLM() {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: fullPrompt }] }),
        });
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        return data.choices?.[0]?.message?.content ?? '';
      }

      async function isGibberish(text) {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'openai/gpt-5-mini',
            stream: false,
            messages: [{
              role: 'user',
              content: `Is the following text garbled, incoherent, or nonsensical — i.e. not readable English prose? Ignore any URLs or citation links; focus only on whether the surrounding words and sentences make sense. Answer only YES or NO.\n\n${text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 1200)}`,
            }],
          }),
        });
        if (!resp.ok) return false; // if check fails, assume OK
        const data = await resp.json();
        const verdict = (data.choices?.[0]?.message?.content ?? '').trim().toUpperCase();
        console.log('Gibberish check verdict:', verdict);
        return verdict.startsWith('YES');
      }

      let text = '';
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          text = await callLLM();
          if (!(await isGibberish(text))) break;
          console.error(`Attempt ${attempt + 1} gibberish detected, retrying...\nGibberish text: ${text}`);
        } catch (err) {
          lastErr = err;
        }
      }

      if (lastErr && !text) {
        return new Response(`OpenRouter error: ${lastErr.message}`, { status: 502 });
      }

      // Re-emit as SSE so client streaming code is unchanged
      const encoder = new TextEncoder();
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      (async () => {
        const chunkSize = 80;
        for (let i = 0; i < text.length; i += chunkSize) {
          await writer.write(encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + chunkSize) } }] })}

`
          ));
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'));
        writer.close();
      })();

      return new Response(readable, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }

    const lastUpdatedStr = new Date(lastUpdated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const html = HTML(env.TITLE, lastUpdatedStr, JSON.stringify(funFacts), JSON.stringify(exampleQuestions), env.MODEL, promptTemplate, toc);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
