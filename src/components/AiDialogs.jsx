import { useEffect, useRef, useState } from 'react';
import { CHAT_APPS, PROVIDERS, configOf, explain, fullPrompt, generate, listModels, loadSettings, missing, parseReply, ready, saveSettings, withKeys } from '../lib/ai.js';
import { canPickFile, connectFile, envText, forgetFile, keyState, onKeys, openKeys, reconnect, removeKey, resetUsage, saveKey, showFile, useEnvText } from '../lib/keys.js';
import { Thumb } from './SlideView.jsx';

// A modal <dialog> that closes on Escape or a click on the backdrop.
export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog
      ref={ref} className={`modal${wide ? ' wide' : ''}`}
      onCancel={e => { e.preventDefault(); onClose(); }}
      onMouseDown={e => { if (e.target === ref.current) onClose(); }}
      onKeyDown={e => e.stopPropagation()}
    >
      <header><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header>
      {children}
    </dialog>
  );
}

/* ---------- settings ---------- */

/** The .env key store, loaded on first use; re-renders when it changes. */
export function useKeys() {
  const [state, setState] = useState(keyState);
  useEffect(() => { const off = onKeys(setState); openKeys(); return off; }, []);
  return state;
}

const short = n => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n));
const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Where the keys are kept, and the buttons to choose or allow that file on the web.
function KeyFile({ ks }) {
  const [error, setError] = useState('');
  const act = fn => async () => { setError(''); try { await fn(); } catch (err) { if (err?.name !== 'AbortError') setError(err.message); } };
  const openText = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) useEnvText(await f.text(), f.name);
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([envText()], { type: 'text/plain' }));
    a.download = ks.path && ks.path !== '.env' ? ks.path : 'waypoint.env';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  let body;
  if (!ks.loaded) body = <p className="hint">Reading your keys…</p>;
  else if (ks.backend === 'desktop' || ks.backend === 'dev') {
    body = (
      <p className="hint">
        Keys are saved in <code className="path">{ks.path}</code>{ks.backend === 'dev' && ' (the project folder; git ignores it)'}.
        {ks.backend === 'desktop' && <button className="link" onClick={showFile}>Show file</button>}
      </p>
    );
  } else if (ks.backend === 'file' && ks.needs === 'permission') {
    body = <p className="hint">Your keys are in <b>{ks.path}</b>. Allow Waypoint to use it again: <button onClick={act(reconnect)}>Allow</button></p>;
  } else if (ks.backend === 'file') {
    body = (
      <p className="hint">
        Keys are saved in <b>{ks.path}</b> on this computer.
        <button className="link" onClick={act(() => connectFile(false))}>Use another file</button>
        <button className="link" onClick={act(forgetFile)}>Stop using it</button>
      </p>
    );
  } else if (ks.backend === 'session') {
    body = (
      <p className="hint">
        Using <b>{ks.path}</b> until you close this tab. {ks.dirty ? <>You changed keys: <button onClick={download}>Download the updated .env</button> and keep it in place of the old one.</> : 'This browser cannot save it in place, so changes are downloaded as a new file.'}
      </p>
    );
  } else if (canPickFile()) {
    body = (
      <p className="hint">
        Waypoint keeps API keys in a <code>.env</code> file on your computer, not in the browser. Pick the file it should use:
        <span className="row"><button onClick={act(() => connectFile(false))}>Choose .env file</button><button onClick={act(() => connectFile(true))}>Create a new one</button></span>
      </p>
    );
  } else {
    body = (
      <p className="hint">
        Waypoint keeps API keys in a <code>.env</code> file on your computer. This browser cannot save files in place, so open the file each visit (Chrome, Edge and the desktop app remember it):
        <label className="filebutton"><input type="file" onChange={openText} />Open .env file</label>
      </p>
    );
  }
  return <>{body}{(error || ks.error) && <p className="error" role="alert">{error || ks.error}</p>}</>;
}

// A provider's keys: which one to use, how much each has been used, and adding or removing them.
function KeyList({ s, setS, c, ks }) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [sure, setSure] = useState('');
  const [error, setError] = useState('');
  const [, refresh] = useState(0);
  const mine = s.per[c.id] || {};
  const limits = mine.limits || {};
  const setMine = patch => setS(o => ({ ...o, per: { ...o.per, [c.id]: { ...o.per[c.id], ...patch } } }));
  const canSave = ['desktop', 'dev', 'file', 'session'].includes(ks.backend) && !ks.needs;
  const keys = c.plan.keys;
  const auto = c.plan.active === 'auto';
  const next = auto ? c.plan.order[0]?.name : null;

  async function add() {
    setError('');
    const key = value.trim();
    if (!key) return setError('Paste the key first.');
    const lab = label.trim() || (keys.length ? '' : 'default');
    if (!lab) return setError('Give this key a label, such as work or personal, so you can tell your keys apart.');
    try { await saveKey(c.id, lab, key); setValue(''); setLabel(''); }
    catch (err) { setError(err.message); }
  }
  async function remove(k) {
    if (sure !== k.name) return setSure(k.name);
    setSure('');
    try { await removeKey(k.name); if (mine.active === k.name) setMine({ active: 'auto' }); }
    catch (err) { setError(err.message); }
  }
  const statusOf = k => {
    if (k.refused) return <span className="tag bad">refused</span>;
    if (k.over) return <span className="tag bad">over limit</span>;
    if (k.limited) return <span className="tag warn">{k.u.note || 'rate limited'} until {clock(k.u.limitedUntil)}</span>;
    if (k.name === next) return <span className="tag ok">next</span>;
    return null;
  };

  return (
    <div className="keys">
      <div className="row keyhead"><b>API keys</b>{c.keys && <a href={c.keys} target="_blank" rel="noopener">Get a key</a>}</div>
      {keys.length > 0 && (
        <>
          <label className="check"><input type="radio" name="whichKey" checked={auto} onChange={() => setMine({ active: 'auto' })} /> Automatic: the key used least this month, moving on when one is rate limited, out of credit, refused or over its limit</label>
          <table className="keytable">
            <thead><tr><th /><th>Key</th><th>This month</th><th>Monthly limit</th><th /></tr></thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.name} className={c.plan.order[0]?.name === k.name ? 'current' : undefined}>
                  <td><input type="radio" name="whichKey" aria-label={`Always use ${k.label}`} checked={!auto && c.plan.active === k.name} onChange={() => setMine({ active: k.name })} /></td>
                  <td><b>{k.label}</b> <span className="dim">…{k.key.slice(-4)}</span><br /><span className="dim small">{k.name}</span></td>
                  <td>
                    {short(k.u.input + k.u.output)} tokens · {k.u.requests} {k.u.requests === 1 ? 'request' : 'requests'}
                    {k.limit > 0 && <div className="meter" title={`${Math.round((100 * k.used) / k.limit)}% of the limit`}><span style={{ width: `${Math.min(100, (100 * k.used) / k.limit)}%` }} /></div>}
                    <div>{statusOf(k)}</div>
                  </td>
                  <td>
                    <input type="number" min={0} step={10000} className="limit" value={limits[k.name] || ''} placeholder="none" aria-label={`Monthly token limit for ${k.label}`}
                      onChange={e => setMine({ limits: { ...limits, [k.name]: Math.max(0, +e.target.value || 0) || undefined } })} />
                  </td>
                  <td className="keyacts">
                    <button className="link" onClick={() => { resetUsage(c.id, k); refresh(n => n + 1); }} title="Start this month's count again, and clear a rate limit or refusal">Reset</button>
                    <button className="link" disabled={!canSave} onClick={() => remove(k)}>{sure === k.name ? 'Sure? Remove' : 'Remove'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Waypoint counts tokens itself, on this device, from each reply; your provider's dashboard has the exact figures and costs. Limits are yours to set: a key over its limit is skipped.</p>
        </>
      )}
      {canSave ? (
        <div className="addkey">
          <input value={label} placeholder={keys.length ? 'Label, e.g. work' : 'Label (optional)'} aria-label="Label for the new key" onChange={e => setLabel(e.target.value)} />
          <input type={show ? 'text' : 'password'} value={value} autoComplete="off" spellCheck={false} placeholder={keys.length ? 'Paste another key' : 'Paste your API key'} aria-label="API key" onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <button onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          <button className="primary" onClick={add}>Add key</button>
        </div>
      ) : ks.loaded && <p className="hint">Choose your .env file above to add keys.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

// Codex CLI or Gemini CLI: is it installed, and how to sign in.
function CliSetup({ c }) {
  const [found, setFound] = useState(undefined);
  const check = () => { setFound(undefined); window.desktop?.cli?.detect().then(r => setFound(r[c.tool] || null)).catch(() => setFound(null)); };
  useEffect(check, [c.tool]);
  if (!window.desktop?.cli) {
    return (
      <p className="hint">
        This uses your {c.sub} through {c.tool === 'codex' ? 'OpenAI’s Codex CLI' : 'Google’s Gemini CLI'}, which only the desktop app can run.{' '}
        <a href="https://github.com/PyMite6941/waypoint/releases/latest" target="_blank" rel="noopener">Get the desktop app</a>, or use Copy and paste with the chat app.
      </p>
    );
  }
  return (
    <div className="clisetup">
      <p>Uses your {c.sub}: no API key, and it counts toward that plan&rsquo;s limits. Waypoint runs <code>{c.tool}</code> read-only in an empty folder and sends it only the prompt.</p>
      <ol className="steps">
        <li>
          {found === undefined ? 'Looking for it…' : found ? <>Installed: <code className="path">{found}</code></> : <>Install it in a terminal: <code>{c.install}</code> <button className="link" onClick={check}>Check again</button></>}
        </li>
        <li>Sign in once: run <code>{c.login}</code> in a terminal and {c.loginHow}. <a href={c.docs} target="_blank" rel="noopener">Help</a></li>
      </ol>
    </div>
  );
}

export function AiSettings({ onClose }) {
  const [s, setS] = useState(loadSettings);
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState('');
  const ks = useKeys();
  const c = configOf(s);
  const set = (field, value) => setS(o => ({ ...o, per: { ...o.per, [o.provider]: { ...o.per[o.provider], [field]: value } } }));
  const pick = id => { setS(o => ({ ...o, provider: id })); setModels([]); setStatus(''); };
  const usesKeys = c.kind === 'anthropic' || (c.kind === 'openai' && !c.local);

  async function load() {
    setStatus('Asking for the model list…');
    try {
      const ids = await listModels(c);
      setModels(ids);
      setStatus(ids.length ? `Connected${c.keyLabel ? ` with the "${c.keyLabel}" key` : ''}. ${ids.length} models available.` : 'Connected, but no models were listed. Type the model name.');
      if (!c.model && ids.length) set('model', ids[0]);
    } catch (err) { setStatus(explain(err, c)); }
  }
  function done() {
    if (!saveSettings(s)) alert('This browser is not letting Waypoint store settings (private window?). They will last until you close the tab.');
    onClose(s);
  }

  return (
    <Modal title="AI settings" onClose={done} wide={usesKeys}>
      <div className="form">
        <label>Provider
          <select value={s.provider} onChange={e => pick(e.target.value)}>
            <optgroup label="API key">{Object.entries(PROVIDERS).filter(([, p]) => p.kind === 'anthropic' || (p.kind === 'openai' && !p.local)).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}</optgroup>
            <optgroup label="Subscription">{Object.entries(PROVIDERS).filter(([, p]) => p.kind === 'cli' || p.kind === 'manual').map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}</optgroup>
            <optgroup label="On this computer">{Object.entries(PROVIDERS).filter(([, p]) => p.local).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}</optgroup>
          </select>
        </label>

        {c.kind === 'manual' && (
          <p className="hint">
            Use any chat app: ChatGPT, Claude, Gemini, Copilot, a company chatbot. Waypoint copies a prompt and opens the app;
            you paste the reply back. This works with every <b>chat subscription</b> (ChatGPT Plus, Claude Pro or Max, Gemini,
            Copilot), and it is the only way to use <b>Claude Pro or Max</b>: Anthropic does not let other apps sign in with
            a Claude subscription. ChatGPT plans and Google accounts can also connect directly in the desktop app (see Subscription above).
          </p>
        )}

        {c.kind === 'cli' && <CliSetup c={c} />}

        {usesKeys && <><KeyFile ks={ks} /><KeyList s={s} setS={setS} c={c} ks={ks} /></>}

        {c.kind !== 'manual' && !(c.kind === 'cli' && !window.desktop?.cli) && (
          <>
            {c.kind === 'openai' && (
              <label>Address (base URL)
                <input value={c.base} placeholder="https://…/v1" spellCheck={false} onChange={e => set('base', e.target.value)} />
              </label>
            )}
            <label>Model {c.kind === 'cli' && <span className="dim">(optional: empty uses the CLI&rsquo;s own choice)</span>}
              <span className="row">
                <input list="aiModels" value={c.model} spellCheck={false} placeholder={c.kind === 'cli' ? 'Default' : 'Model name'} onChange={e => set('model', e.target.value.trim())} />
                {c.kind !== 'cli' && <button onClick={load} disabled={(!c.base && c.kind === 'openai') || (usesKeys && !c.key)}>Load models</button>}
              </span>
              <datalist id="aiModels">{models.map(m => <option key={m} value={m} />)}</datalist>
            </label>
            {status && <p className="status">{status}</p>}
            <p className="hint">
              {c.local ? 'Runs on this computer. Nothing leaves it.'
                : c.kind === 'cli' ? `Your prompt goes to ${c.tool === 'codex' ? 'OpenAI' : 'Google'} through the CLI, under that account's terms.`
                  : <>Keys go straight to {c.name}, never to Waypoint. Usage is billed to your account there.</>}
            </p>
          </>
        )}
      </div>
      <footer><span className="grow" /><button className="primary" onClick={done}>Done</button></footer>
    </Modal>
  );
}

/* ---------- generate ---------- */

const REQUEST = 'waypoint.ai.request';
const lastRequest = () => { try { return JSON.parse(sessionStorage.getItem(REQUEST)) || {}; } catch { return {}; } };

// Describe the talk, get slides back, look them over, then add them (one undo step).
export function AiGenerate({ deck, cur, onInsert, onSettings, onClose }) {
  const [settings, setSettings] = useState(loadSettings);
  useKeys();   // re-render once the keys are read
  const c = configOf(settings);
  const [note, setNote] = useState('');
  const [req, setReq] = useState(() => ({ topic: '', count: 8, audience: '', notes: true, mode: 'add', ...lastRequest() }));
  const [phase, setPhase] = useState('ask');   // ask | wait | paste | review
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState(null);
  const abort = useRef(null);
  const set = (k, v) => setReq(r => ({ ...r, [k]: v }));
  const request = { ...req, deck };

  useEffect(() => { try { sessionStorage.setItem(REQUEST, JSON.stringify(req)); } catch { /* fine */ } }, [req]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (phase !== 'wait') return;
    const t0 = Date.now(), t = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  function take(text) {
    try { setResult(parseReply(text)); setError(''); setPhase('review'); }
    catch (err) { setError(err.message); setPhase(c.kind === 'manual' ? 'paste' : 'ask'); }
  }

  async function go() {
    setError('');
    if (!req.topic.trim()) return setError('Say what the talk is about first.');
    if (c.kind === 'manual') return setPhase('paste');
    if (!ready(c)) return setError(missing(c));
    abort.current = new AbortController();
    setProgress(0); setSeconds(0); setNote(''); setPhase('wait');
    try {
      const signal = abort.current.signal;
      const out = await withKeys(c, ck => generate(ck, request, { signal, onText: setProgress }), (from, to) => setNote(`The "${from}" key could not be used; trying "${to}".`));
      take(out.text);
    } catch (err) {
      setError(explain(err, c));
      setPhase('ask');
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(fullPrompt(request)); setCopied(true); return true; }
    catch { setError('Could not copy. Select the prompt text and copy it yourself.'); return false; }
  }
  // Copy the prompt and open the chat app, where the person pastes it and sends.
  async function openChat(url) {
    await copy();
    window.open(url, '_blank', 'noopener');
  }

  function insert() {
    onInsert(result.slides, req.mode, result.title);
    onClose();
  }

  const preview = result && { ...deck, slides: result.slides };
  const where = req.mode === 'add' ? `after slide ${cur + 1}` : 'in place of every slide';

  return (
    <Modal title="Generate slides with AI" onClose={onClose} wide={phase === 'review' || phase === 'paste'}>
      {phase === 'ask' && (
        <div className="form">
          <label>What is the talk about?
            <textarea autoFocus rows={4} value={req.topic} onChange={e => set('topic', e.target.value)}
              placeholder="e.g. Why our team should move to four-day sprints: what we tried, what changed, what it costs" />
          </label>
          <div className="cols">
            <label>Slides
              <input type="number" min={1} max={40} value={req.count} onChange={e => set('count', Math.max(1, Math.min(40, +e.target.value || 1)))} />
            </label>
            <label className="grow">Audience and style <span className="dim">(optional)</span>
              <input value={req.audience} onChange={e => set('audience', e.target.value)} placeholder="e.g. new starters, friendly, plain English" />
            </label>
          </div>
          <label className="check"><input type="checkbox" checked={req.notes} onChange={e => set('notes', e.target.checked)} /> Write speaker notes</label>
          <fieldset className="choose">
            <label className="check"><input type="radio" checked={req.mode === 'add'} onChange={() => set('mode', 'add')} /> Add after slide {cur + 1}</label>
            <label className="check"><input type="radio" checked={req.mode === 'replace'} onChange={() => set('mode', 'replace')} /> Replace all {deck.slides.length} slides</label>
          </fieldset>
          <p className="using">
            Using <b>{c.name}</b>{c.kind !== 'manual' && c.model ? <> · {c.model}</> : null}
            {c.keyLabel ? <> · key &ldquo;{c.keyLabel}&rdquo;{c.plan.keys.length > 1 ? (c.plan.active === 'auto' ? ' (automatic)' : ' (fixed)') : ''}</> : null}
            <button className="link" onClick={() => onSettings(s => s && setSettings(s))}>Change</button>
          </p>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}

      {phase === 'wait' && (
        <div className="form waiting" aria-live="polite">
          <div className="spinner" />
          <p>Writing your slides with {c.kind === 'cli' ? `${c.tool === 'codex' ? 'Codex CLI' : 'Gemini CLI'}${c.model ? ` (${c.model})` : ''}` : c.model}… {seconds}s{progress ? ` · ${progress.toLocaleString()} characters` : ''}</p>
          {note && <p className="hint">{note}</p>}
        </div>
      )}

      {phase === 'paste' && (
        <div className="form">
          <ol className="steps">
            <li>
              <span className="row"><b>Copy this prompt</b><button className="primary" onClick={copy}>{copied ? 'Copied' : 'Copy prompt'}</button></span>
              <span className="row chatapps">Or copy it and open: {CHAT_APPS.map(a => <button key={a.name} onClick={() => openChat(a.url)}>{a.name}</button>)}</span>
              <textarea readOnly rows={5} value={fullPrompt(request)} onFocus={e => e.target.select()} />
            </li>
            <li><b>Paste it into your chat app</b> (ChatGPT, Claude, Gemini, anything) and send it.</li>
            <li>
              <b>Copy the whole reply and paste it here</b>
              <textarea rows={6} value={reply} onChange={e => setReply(e.target.value)} placeholder='{"title": …, "slides": […]}' />
            </li>
          </ol>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}

      {phase === 'review' && (
        <div className="form">
          <p>{result.slides.length} slides, ready to go {where}. Everything stays editable, and Undo takes them out again.</p>
          <div className="aiPreview">
            {result.slides.map((s, i) => (
              <figure key={s.id}><Thumb deck={preview} slide={s} width={196} /><figcaption>{i + 1}{s.notes ? ' · notes' : ''}</figcaption></figure>
            ))}
          </div>
        </div>
      )}

      <footer>
        {phase === 'ask' && <><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" onClick={go}>{c.kind === 'manual' ? 'Next' : 'Generate'}</button></>}
        {phase === 'wait' && <><span className="grow" /><button onClick={() => abort.current?.abort()}>Stop</button></>}
        {phase === 'paste' && <><button onClick={() => { setError(''); setPhase('ask'); }}>Back</button><span className="grow" /><button className="primary" disabled={!reply.trim()} onClick={() => take(reply)}>Make slides</button></>}
        {phase === 'review' && <>
          <button onClick={() => { setResult(null); setPhase('ask'); }}>Change request</button>
          <span className="grow" />
          {c.kind !== 'manual' && <button onClick={go}>Try again</button>}
          <button className="primary" onClick={insert}>{req.mode === 'add' ? 'Add slides' : 'Replace slides'}</button>
        </>}
      </footer>
    </Modal>
  );
}
