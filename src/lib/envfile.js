// Reading and writing a .env file without losing anything else in it.
//
// API keys use the names other tools already use, so one .env can serve several apps:
//   ANTHROPIC_API_KEY=sk-ant-...          the key labelled "default"
//   ANTHROPIC_API_KEY_WORK=sk-ant-...     a second key, labelled "work"
// Comments, blank lines and every other variable are kept as they are.

export const ENV_NAMES = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  custom: 'CUSTOM_API_KEY',
};

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const end = v.indexOf('"', 1);
    return (end > 0 ? v.slice(1, end) : v.slice(1)).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  if (v.startsWith("'")) { const end = v.indexOf("'", 1); return end > 0 ? v.slice(1, end) : v.slice(1); }
  return v.replace(/\s+#.*$/, '').trim();   // an unquoted value ends at " #"
}

/** Every variable in the file, in order: Map name -> value. */
export function parseEnv(text = '') {
  const vars = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = LINE.exec(line);
    if (m) vars.set(m[1], unquote(m[2]));
  }
  return vars;
}

/** Which provider and label a variable name belongs to, or null if it is not an API key we manage. */
export function keyName(name) {
  for (const [provider, base] of Object.entries(ENV_NAMES)) {
    if (name === base) return { provider, label: 'default' };
    if (name.startsWith(`${base}_`) && name.length > base.length + 1) return { provider, label: name.slice(base.length + 1).toLowerCase() };
  }
  return null;
}

/** The variable name for a provider's key with this label. */
export function varName(provider, label) {
  const clean = String(label || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return !clean || clean === 'DEFAULT' ? ENV_NAMES[provider] : `${ENV_NAMES[provider]}_${clean}`;
}

const quote = v => (/^[A-Za-z0-9_\-.:/+=@]*$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);

/**
 * The file with its API keys replaced by `keys` (Map name -> value). Keys we manage that are
 * not in `keys` are removed; new ones are added at the end; everything else is untouched.
 */
export function updateEnv(text, keys) {
  const left = new Map(keys);
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = !/^\s*#/.test(line) && LINE.exec(line);
    if (m && keyName(m[1])) {
      if (left.has(m[1])) { out.push(`${m[1]}=${quote(left.get(m[1]))}`); left.delete(m[1]); }
      continue;   // a key that was removed
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  if (left.size) {
    if (!out.some(l => l.includes('Waypoint'))) out.push(...(out.length ? [''] : []), '# API keys for Waypoint (and anything else that reads these names).', '# More than one key for a provider: add a label, e.g. ANTHROPIC_API_KEY_WORK=...');
    for (const [name, value] of left) out.push(`${name}=${quote(value)}`);
  }
  return `${out.join('\n')}\n`;
}
