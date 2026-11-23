// Generate slides with whatever AI the user brings: an API key for Anthropic, any
// OpenAI-compatible service (OpenAI, OpenRouter, Groq, Gemini, Mistral, DeepSeek, xAI,
// Together…), a model running locally (Ollama, LM Studio), a subscription through the
// vendor's own command-line tool (desktop app: Codex CLI for a ChatGPT plan, Gemini CLI for
// a Google account), or, for any chat subscription, a prompt to copy into the chat and a
// reply to paste back.
//
// Keys live in a .env file on this computer (see keys.js) and go straight to the provider.
// A provider can have several keys; Waypoint counts each key's use and can switch between
// them. Nothing is sent to Waypoint. In the desktop app requests go through the main
// process, which avoids browser CORS limits.
import { LAYOUTS, layoutSlide } from './deck.js';
import { keysFor, markKey, recordUsage, usageOf } from './keys.js';

// kind: 'anthropic' | 'openai' (OpenAI-compatible chat completions) | 'manual'
export const PROVIDERS = {
  anthropic:  { name: 'Anthropic (Claude)', kind: 'anthropic', model: 'claude-opus-5-5', keys: 'https://platform.claude.com/settings/keys' },
  openai:     { name: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', keys: 'https://platform.openai.com/api-keys' },
  gemini:     { name: 'Google Gemini', kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keys: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter (hundreds of models)', kind: 'openai', base: 'https://openrouter.ai/api/v1', keys: 'https://openrouter.ai/keys' },
  groq:       { name: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', keys: 'https://console.groq.com/keys' },
  mistral:    { name: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1', keys: 'https://console.mistral.ai/api-keys' },
  deepseek:   { name: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com/v1', keys: 'https://platform.deepseek.com/api_keys' },
  xai:        { name: 'xAI (Grok)', kind: 'openai', base: 'https://api.x.ai/v1', keys: 'https://console.x.ai' },
  ollama:     { name: 'Ollama (on this computer)', kind: 'openai', base: 'http://localhost:11434/v1', local: true },
  lmstudio:   { name: 'LM Studio (on this computer)', kind: 'openai', base: 'http://localhost:1234/v1', local: true },
  custom:     { name: 'Other OpenAI-compatible API', kind: 'openai', base: '' },
  codex:      { name: 'ChatGPT plan, through Codex CLI (desktop app)', kind: 'cli', tool: 'codex', sub: 'ChatGPT Plus, Pro, Business or Enterprise',
                install: 'npm install -g @openai/codex', login: 'codex', loginHow: 'choose Sign in with ChatGPT', docs: 'https://developers.openai.com/codex/cli/' },
  gemini_cli: { name: 'Google account, through Gemini CLI (desktop app)', kind: 'cli', tool: 'gemini', sub: 'a Google account, or Google AI Pro or Ultra',
                install: 'npm install -g @google/gemini-cli', login: 'gemini', loginHow: 'choose Login with Google', docs: 'https://geminicli.com/docs/get-started/authentication' },
  manual:     { name: 'Copy and paste (any chat app or subscription)', kind: 'manual' },
};

// Chat apps the copy-and-paste route can open, with the prompt already on the clipboard.
// Claude Pro and Max can only be used this way: Anthropic does not let other apps sign in
// with a Claude subscription.
export const CHAT_APPS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'Copilot', url: 'https://copilot.microsoft.com/' },
];

/* ---------- settings ---------- */

const KEY = 'waypoint.ai';
// { provider, per: { [provider]: { model, base, active, limits: { [envName]: tokens a month } } } }
// The keys themselves are in the .env file, not here.
export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && PROVIDERS[s.provider]) return { provider: s.provider, per: s.per || {} };
  } catch { /* nothing saved, or storage blocked */ }
  return { provider: 'manual', per: {} };
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}
/**
 * A provider's keys with their use this month, and the order to try them in.
 * active is 'auto' (least used this month first, skipping keys over the limit you set,
 * rate limited or refused) or the .env name of one key to always use.
 */
export function keyPlan(s, id = s.provider) {
  const mine = s.per[id] || {}, limits = mine.limits || {};
  const keys = keysFor(id).map((k, i) => {
    const u = usageOf(id, k), used = u.input + u.output, limit = +limits[k.name] || 0;
    return { ...k, i, u, used, limit, over: limit > 0 && used >= limit, limited: u.limitedUntil > Date.now(), refused: u.refused };
  });
  const chosen = mine.active && mine.active !== 'auto' ? keys.find(k => k.name === mine.active) : null;
  if (chosen) return { keys, active: chosen.name, order: [chosen] };
  const usable = keys.filter(k => !k.over && !k.refused);
  const order = [
    ...usable.filter(k => !k.limited).sort((a, b) => a.used - b.used || a.i - b.i),
    ...usable.filter(k => k.limited).sort((a, b) => a.u.limitedUntil - b.u.limitedUntil),
  ];
  return { keys, active: 'auto', order };
}

// The settings for one provider, with its defaults filled in and the key to use first.
export function configOf(s, id = s.provider) {
  const p = PROVIDERS[id], mine = s.per[id] || {};
  const plan = p.kind === 'anthropic' || (p.kind === 'openai' && !p.local) ? keyPlan(s, id) : { keys: [], order: [], active: 'auto' };
  const first = plan.order[0];
  return {
    id, ...p, plan, key: first?.key || '', keyName: first?.name || '', keyLabel: first?.label || '',
    model: mine.model || p.model || '', base: (mine.base || p.base || '').replace(/\/+$/, ''),
  };
}
export function ready(c) {
  if (c.kind === 'manual') return true;
  if (c.kind === 'cli') return Boolean(window.desktop?.cli);
  if (!c.model) return false;
  if (c.kind === 'openai' && !c.base) return false;
  return Boolean(c.key) || Boolean(c.local) || c.id === 'custom';
}
/** What is missing before this provider can be used, in words, or ''. */
export function missing(c) {
  if (ready(c)) return '';
  if (c.kind === 'cli') return `${c.name.split(',')[0]} through ${c.tool === 'codex' ? 'Codex CLI' : 'Gemini CLI'} works in the desktop app only.`;
  const keys = c.plan.keys;
  if (!c.local && c.id !== 'custom' && !c.key) {
    if (!keys.length) return `Add a ${c.name} API key in AI settings.`;
    if (keys.every(k => k.refused)) return `${c.name} refused every saved key. Check them in AI settings.`;
    return `Every ${c.name} key is over the monthly limit you set. Raise a limit or add a key in AI settings.`;
  }
  return `Finish setting up ${c.name} in AI settings: it needs ${c.kind === 'openai' && !c.base ? 'an address and ' : ''}a model.`;
}

/**
 * Runs task(c) with the provider's keys in plan order. When a key is rate limited, out of
 * credit or refused, it is noted and, in automatic mode, the next key is tried.
 * task resolves to { text, usage: { input, output } }. onSwitch(fromLabel, toLabel) reports a change.
 */
export async function withKeys(c, task, onSwitch) {
  if (!c.plan.order.length) return task(c);
  const order = c.plan.order;
  let last;
  for (let n = 0; n < order.length; n++) {
    const k = order[n], ck = { ...c, key: k.key, keyName: k.name, keyLabel: k.label };
    try {
      const out = await task(ck);
      recordUsage(c.id, k, out.usage);
      return { ...out, keyLabel: k.label };
    } catch (err) {
      last = err;
      const status = err?.status, text = String(err?.message || '');
      const credit = status === 402 || /credit|quota|billing|insufficient|balance/i.test(text);
      if (status === 401 || status === 403) markKey(c.id, k, { refused: true, note: 'refused' });
      else if (status === 429 || credit) {
        const wait = +(err.headers?.get?.('retry-after') ?? err.headers?.['retry-after']) || (credit ? 3600 : 60);
        markKey(c.id, k, { limitedUntil: Date.now() + wait * 1000, note: credit ? 'out of credit' : 'rate limited' });
      } else throw err;
      err.keyLabel = k.label;
      if (n + 1 < order.length) onSwitch?.(k.label, order[n + 1].label);
    }
  }
  throw last;
}

/* ---------- transport ---------- */

// fetch, or the desktop app's main-process fetch when there is one (no CORS there).
// The desktop path returns the whole body at once, so there is no live progress.
async function send(url, init = {}) {
  if (window.desktop?.aiFetch) {
    if (init.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const headers = Object.fromEntries(new Headers(init.headers || {}));
    const r = await window.desktop.aiFetch(String(url), { method: init.method || 'GET', headers, body: init.body });
    if (init.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    if (r.error) throw new TypeError(r.error);
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
  }
  return fetch(url, init);
}

// The Anthropic SDK is loaded the first time it is needed, so the editor stays small.
let SDK = null;
async function anthropic(c) {
  SDK ||= (await import('@anthropic-ai/sdk')).default;
  return new SDK({ apiKey: c.key, dangerouslyAllowBrowser: true, maxRetries: 1, fetch: window.desktop?.aiFetch ? send : undefined });
}

// Opus 5.5, Opus 5, Sonnet 5.5 and the Fable models can hand a declined request to
// another model on the server. Older models do not take the parameter.
const FALLBACK_MODELS = /^claude-(fable-5|opus-5|sonnet-5-5)/;

// A readable message for anything that goes wrong talking to a provider.
export function explain(err, c) {
  if (err?.name === 'AbortError' || (SDK && err instanceof SDK.APIUserAbortError)) return 'Stopped.';
  const status = err?.status;
  if (c.kind === 'cli') return err?.message || String(err);
  const which = err?.keyLabel || c.keyLabel;
  const key = which ? ` "${which}"` : '';
  const others = c.plan?.keys?.length > 1 ? ' Waypoint tried your other keys too.' : '';
  if (status === 401 || status === 403) return `${c.name} refused the API key${key}. Check it in AI settings.${others}`;
  if (status === 402 || (status === 429 && /credit|quota|billing|insufficient|balance/i.test(err?.message || ''))) return `The ${c.name} key${key} is out of credit.${others || ' Add credit, or add another key in AI settings.'}`;
  if (status === 404) return `${c.name} does not know the model "${c.model}". Pick another in AI settings.`;
  if (status === 429) return `${c.name} says the key${key} is over a rate limit. Wait a moment${c.plan?.keys?.length > 1 ? '; your other keys were tried too' : ', or add a second key in AI settings'}.`;
  if (status === 400) return `${c.name} rejected the request: ${err.message}`;
  if (status >= 500) return `${c.name} is having trouble (${status}). Try again in a minute.`;
  if ((SDK && err instanceof SDK.APIConnectionError) || err instanceof TypeError) {
    if (c.local) return `Could not reach ${c.name} at ${c.base}. Is it running?${window.desktop ? '' : c.id === 'ollama' ? ' In a browser, Ollama also needs OLLAMA_ORIGINS=* set before it starts.' : ' In a browser, turn on CORS in its server settings.'}`;
    return `Could not reach ${c.name}.${window.desktop ? ' Check your connection.' : ' Check your connection. Some providers block requests made straight from a web page; the desktop app is not affected.'}`;
  }
  return err?.message || String(err);
}

async function failure(r) {
  let detail = '';
  try { const j = await r.clone().json(); detail = j.error?.message || j.message || j.error || ''; } catch { detail = (await r.text().catch(() => '')).slice(0, 200); }
  return Object.assign(new Error(detail || `${r.status} ${r.statusText}`), { status: r.status, headers: r.headers });
}

const authHeaders = c => (c.key ? { Authorization: `Bearer ${c.key}` } : {});

/* ---------- models ---------- */

// The models the key can use, so nobody has to type an exact model name.
export async function listModels(c) {
  if (c.kind === 'anthropic') {
    const ids = [];
    const client = await anthropic(c);
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    return ids;
  }
  const r = await send(`${c.base}/models`, { headers: authHeaders(c) });
  if (!r.ok) throw await failure(r);
  const j = await r.json();
  return (j.data || j.models || []).map(m => (m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
}

/* ---------- the prompt ---------- */

const SYSTEM = `You write slide decks for Waypoint, a presentation app. Reply with JSON only: no prose, no code fences.

Shape:
{"title": "Deck title", "slides": [ slide, ... ]}

Each slide has a "layout" and the fields that layout uses:
- {"layout": "title", "title": "...", "subtitle": "..."}            opening slide
- {"layout": "section", "title": "...", "subtitle": "..."}          divider between parts
- {"layout": "bullets", "title": "...", "bullets": ["...", "..."]}  the usual content slide
- {"layout": "two", "title": "...", "left": ["..."], "right": ["..."]}  comparisons, before/after, pros/cons
- {"layout": "quote", "quote": "...", "by": "..."}                  a quotation worth showing on its own
Any slide may also have "notes": what the speaker says, in full sentences.

Write for the screen, not the page: titles under 8 words, 3 to 5 bullets of under 12 words each, no full stops at the end of bullets, no markdown. Start with a title slide. Only quote real, well-known quotations and attribute them correctly; if unsure, use a bullets slide instead.`;

export function buildPrompt({ topic, count, audience, notes, deck, mode }) {
  const parts = [`Make about ${count} slides about:\n${topic.trim()}`];
  if (audience?.trim()) parts.push(`Audience and style: ${audience.trim()}`);
  parts.push(notes ? 'Give every slide speaker notes (2 to 4 sentences).' : 'Leave out speaker notes.');
  if (mode === 'add' && deck) {
    const existing = deck.slides.map(s => s.els.filter(e => e.type === 'text').map(e => e.text).join(' / ')).filter(Boolean);
    if (existing.length) parts.push(`These slides go into an existing deck titled "${deck.title}". Its slides so far, for context (do not repeat them, and skip the title slide):\n${existing.map((t, i) => `${i + 1}. ${t.slice(0, 160)}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

// For copy and paste: everything in one message.
export const fullPrompt = request => `${SYSTEM}\n\n---\n\n${buildPrompt(request)}`;

/* ---------- generating ---------- */

// Ask the model. onText(chars) reports progress where the provider streams.
// Resolves to { text, usage: { input, output } } (tokens, where the provider reports them).
export async function generate(c, request, { signal, onText } = {}) {
  const user = buildPrompt(request);
  if (c.kind === 'cli') return runCli(c, fullPrompt(request), { signal, onText });
  if (c.kind === 'anthropic') {
    const client = await anthropic(c);
    const params = { model: c.model, max_tokens: 16000, system: SYSTEM, messages: [{ role: 'user', content: user }] };
    const stream = FALLBACK_MODELS.test(c.model)
      ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
      : client.messages.stream(params, { signal });
    let n = 0;
    stream.on('text', t => onText?.((n += t.length)));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error(`The model declined to write this deck${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : '.'}`);
    // A reply cut off at max_tokens still comes back; parseReply keeps the slides that finished.
    const u = msg.usage || {};
    return {
      text: msg.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0 },
    };
  }
  const r = await send(`${c.base}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...authHeaders(c) },
    body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
  });
  if (!r.ok) throw await failure(r);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error(j.error?.message || 'The model sent back an empty reply.');
  return { text, usage: { input: j.usage?.prompt_tokens || 0, output: j.usage?.completion_tokens || 0 } };
}

// A subscription through the vendor's own CLI, run by the desktop app in an empty folder.
let runs = 0;
async function runCli(c, prompt, { signal, onText }) {
  const cli = window.desktop?.cli;
  if (!cli) throw new Error(missing(c));
  const id = `run${++runs}`;
  const stop = () => cli.stop(id);
  signal?.addEventListener('abort', stop);
  const off = onText ? cli.onProgress((rid, n) => rid === id && onText(n)) : null;
  try {
    const r = await cli.run({ id, tool: c.tool, model: c.model || '', prompt });
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    if (r.missing) throw new Error(`${c.tool === 'codex' ? 'Codex CLI' : 'Gemini CLI'} is not installed. In a terminal run: ${c.install}, then run ${c.login} once and ${c.loginHow}.`);
    if (r.error) {
      const login = /log ?in|sign ?in|auth|credential|unauthori[sz]ed|401/i.test(r.error);
      throw new Error(login ? `${c.login} is not signed in. Open a terminal, run ${c.login}, ${c.loginHow}, then try again. (${r.error.slice(0, 200)})` : r.error);
    }
    return { text: r.text, usage: {} };
  } finally { signal?.removeEventListener('abort', stop); off?.(); }
}

// Turn whatever came back (JSON, JSON in a code fence, JSON after some chatter, or JSON
// cut off at the end) into { title, slides }.
export function parseReply(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');   // reasoning models that think out loud
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1];
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error('The reply had no slides in it. Try again, or try another model.');
  s = s.slice(start);
  let data;
  try { data = JSON.parse(s); } catch {
    data = rescue(s);
    if (!data) throw new Error('The reply was not valid JSON. Try again, or try another model.');
  }
  const raw = Array.isArray(data) ? data : data.slides;
  if (!Array.isArray(raw) || !raw.length) throw new Error('The reply had no slides in it.');
  const slides = raw.filter(x => x && typeof x === 'object').map(x => {
    const layout = x.layout in LAYOUTS && x.layout !== 'blank' ? x.layout : 'bullets';
    return layoutSlide(layout, { ...x, title: str(x.title), subtitle: str(x.subtitle), quote: str(x.quote), by: str(x.by), notes: str(x.notes) });
  }).filter(s => s.els.length);
  if (!slides.length) throw new Error('The reply had no usable slides.');
  return { title: str(data.title), slides };
}
const str = v => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.join('\n') : v == null ? '' : String(v));

// A reply cut off part way: keep every slide that finished.
function rescue(s) {
  for (let end = s.lastIndexOf('}'); end > 0; end = s.lastIndexOf('}', end - 1)) {
    const head = s.slice(0, end + 1);
    for (const tail of [']}', ']', '']) {
      try { return JSON.parse(head + tail); } catch { /* keep trimming */ }
    }
  }
  return null;
}
