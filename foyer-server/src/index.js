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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

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

    if (pathname === '/api/bootstrap' && request.method === 'GET') {
      if (!isAuthed(request, env)) return new Response(null, { status: 401 });
      const lastUpdatedStr = new Date(lastUpdated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return new Response(JSON.stringify({
        title: env.TITLE,
        lastUpdated: lastUpdatedStr,
        facts: funFacts,
        exampleQuestions,
        defaultModel: env.MODEL,
        defaultPrompt: promptTemplate,
        toc,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (pathname === '/api/ask' && request.method === 'POST') {
      if (!isAuthed(request, env)) return new Response('Unauthorized', { status: 401 });

      const { question, promptOverride, modelOverride } = await request.json();
      const fullPrompt = buildPrompt(question, promptOverride);
      const model = (modelOverride && modelOverride.trim()) ? modelOverride.trim() : env.MODEL;

      let totalCost = 0;

      function logUsage(label, model, usage) {
        if (!usage) return;
        const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0, cost = 0 } = usage;
        totalCost += cost;
        console.log(`[cost] ${label} | model=${model} | prompt=${prompt_tokens} completion=${completion_tokens} total=${total_tokens} | $${cost.toFixed(6)}`);
      }

      async function callLLM() {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: fullPrompt }] }),
        });
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        logUsage('main', model, data.usage);
        return data.choices?.[0]?.message?.content ?? '';
      }

      async function isGibberish(text) {
        const gibModel = 'openai/gpt-5-mini';
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: gibModel,
            stream: false,
            messages: [{
              role: 'user',
              content: `Is the following text garbled, incoherent, or nonsensical — i.e. not readable English prose? Ignore any URLs or citation links; focus only on whether the surrounding words and sentences make sense. Answer only YES or NO.\n\n${text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 1200)}`,
            }],
          }),
        });
        if (!resp.ok) return false;
        const data = await resp.json();
        logUsage('gibberish-check', gibModel, data.usage);
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

      const encoder = new TextEncoder();
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      (async () => {
        const chunkSize = 80;
        for (let i = 0; i < text.length; i += chunkSize) {
          await writer.write(encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + chunkSize) } }] })}\n\n`
          ));
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'));
        await writer.write(encoder.encode(`event: cost\ndata: ${JSON.stringify({ cost: totalCost })}\n\n`));
        writer.close();
      })();

      return new Response(readable, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }
  },
};
