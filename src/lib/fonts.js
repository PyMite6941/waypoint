// Fonts named by imported decks. A font that is not on this computer is fetched from
// Google Fonts when it exists there (most Google Slides fonts do), and the common Office
// fonts fall back to free look-alikes with the same letter widths, so text wraps as it did.

// Office font -> free font with matching metrics (all on Google Fonts).
const ALIKE = {
  calibri: 'Carlito', cambria: 'Caladea', arial: 'Arimo', helvetica: 'Arimo', 'helvetica neue': 'Arimo',
  'times new roman': 'Tinos', times: 'Tinos', 'courier new': 'Cousine', georgia: 'Gelasio',
  'century gothic': 'Didact Gothic', 'segoe ui': 'Open Sans', 'arial narrow': 'Archivo Narrow', verdana: 'DejaVu Sans',
};
const SERIF = /serif|times|georgia|garamond|cambria|caladea|tinos|playfair|merriweather|lora|baskerville|palatino|bodoni|didot/i;
const MONO = /mono|courier|consol|code|cousine/i;

const quote = f => `"${f.replace(/"/g, '')}"`;

export function fontStack(name) {
  const alike = ALIKE[name.toLowerCase()];
  const generic = MONO.test(name) ? 'monospace' : SERIF.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif';
  return [quote(name), alike && quote(alike), 'var(--font)', generic].filter(Boolean).join(', ');
}

// Is a font installed? Compare its width against two fallbacks; a missing font measures the same as both.
let ctx;
function installed(name) {
  ctx ??= document.createElement('canvas').getContext('2d');
  const sample = 'mmmmmmmmmlli1WQ@#';
  return ['monospace', 'serif'].some(base => {
    ctx.font = `40px ${base}`;
    const a = ctx.measureText(sample).width;
    ctx.font = `40px ${quote(name)}, ${base}`;
    return ctx.measureText(sample).width !== a;
  });
}

const asked = new Set();
function fetchFont(family) {
  if (asked.has(family) || !navigator.onLine) return;
  asked.add(family);
  const url = spec => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}${spec}&display=swap`;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url(':ital,wght@0,400;0,700;1,400;1,700') });
  // Not every family has bold and italic; ask again for just the regular weight.
  link.onerror = () => { link.remove(); document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url('') })); };
  document.head.append(link);
}

// Every font a deck names, from elements and rich text runs.
export function fontsOf(deck) {
  const names = new Set();
  for (const s of deck.slides) for (const e of s.els) {
    if (e.font) names.add(e.font);
    for (const p of e.rich || []) for (const r of p.runs) if (r.font) names.add(r.font);
  }
  return [...names];
}

// Make the deck's fonts available. Returns the names that are neither installed nor have a look-alike.
export function loadFonts(deck) {
  const missing = [];
  for (const name of fontsOf(deck)) {
    if (installed(name)) continue;
    const alike = ALIKE[name.toLowerCase()];
    if (alike) { if (!installed(alike)) fetchFont(alike); }
    else { fetchFont(name); missing.push(name); }
  }
  return missing;
}

// Common fonts offered in the editor, besides the theme's own.
export const FONT_CHOICES = ['Arial', 'Calibri', 'Georgia', 'Helvetica Neue', 'Inter', 'Lato', 'Merriweather', 'Montserrat', 'Open Sans', 'Playfair Display', 'Poppins', 'Roboto', 'Source Sans 3', 'Times New Roman', 'Verdana'];
