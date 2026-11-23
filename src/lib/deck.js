// The deck model. No DOM, no React: safe to use anywhere.
//
// deck  = { v, title, theme, assets: { id: dataURL }, slides: [slide] }
// slide = { id, bg, notes, next: [slide id], els: [el],
//           bgImg (asset id), trans: { fx, dur }, name (title for slides without text) }
// el    = { id, type: text|rect|ellipse|image|line, x, y, w, h,
//           text, size, bold, align, color, fill, src (asset id), link (slide id),
//           anim: { fx, step, dur, delay }  build: step 0 plays with the slide, 1.. on each click
//           optional, mostly from imported files:
//           font, italic, underline, valign (top|middle|bottom), lh (line height), pad [t, r, b, l], nowrap,
//           rot (degrees), opacity, line (outline colour), lineW, radius, geom (see GEOMS),
//           crop [l, t, r, b] (fractions), flip (h|v|hv, lines), rich: [paragraph] }
// paragraph = { align, lvl, bullet, runs: [{ t, b, i, u, color, size, font }] }
//   `text` always holds the plain text too, so anything that ignores `rich` still shows the words.
// All geometry is in slide units on a 1600 x 900 canvas.

export const W = 1600, H = 900;
export const THEMES = { paper: 'Paper', ink: 'Ink', chalk: 'Chalk', signal: 'Signal' };
// The same colours as style.css, for exporters that need real values. `font` is the first choice.
export const THEME_COLORS = {
  paper: { bg: '#fbfaf7', fg: '#1c1b19', accent: '#c2410c', font: 'Georgia' },
  ink: { bg: '#121315', fg: '#f1efea', accent: '#e9b44c', font: 'Segoe UI' },
  chalk: { bg: '#1f3a34', fg: '#eef3ee', accent: '#f2c14e', font: 'Avenir Next' },
  signal: { bg: '#ffffff', fg: '#0b1f33', accent: '#1d4ed8', font: 'Helvetica Neue' },
};

// Slide transitions and build (entrance) effects. Shared by the show, the editor and the exporters.
export const TRANSITIONS = { none: 'None', fade: 'Fade', push: 'Push', cover: 'Cover', wipe: 'Wipe', zoom: 'Zoom', flip: 'Flip', cube: 'Cube', morph: 'Morph' };
export const BUILDS = {
  appear: 'Appear', fade: 'Fade in', rise: 'Rise', 'fly-left': 'Fly in from left', 'fly-right': 'Fly in from right',
  'fly-up': 'Fly in from bottom', drop: 'Drop in', zoom: 'Zoom', pop: 'Pop', wipe: 'Wipe', blur: 'Focus', spin: 'Spin',
};
// How many clicks of builds a slide has before Next moves on.
export const buildSteps = slide => slide.els.reduce((n, e) => Math.max(n, e.anim?.fx ? e.anim.step || 0 : 0), 0);

// Outline shapes beyond rectangles and ellipses, as polygons in fractions of the box.
export const GEOMS = {
  triangle: [[.5, 0], [1, 1], [0, 1]],
  rtTriangle: [[0, 0], [1, 1], [0, 1]],
  diamond: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
  parallelogram: [[.25, 0], [1, 0], [.75, 1], [0, 1]],
  trapezoid: [[.25, 0], [.75, 0], [1, 1], [0, 1]],
  pentagon: [[.5, 0], [1, .38], [.81, 1], [.19, 1], [0, .38]],
  hexagon: [[.25, 0], [.75, 0], [1, .5], [.75, 1], [.25, 1], [0, .5]],
  octagon: [[.29, 0], [.71, 0], [1, .29], [1, .71], [.71, 1], [.29, 1], [0, .71], [0, .29]],
  homePlate: [[0, 0], [.8, 0], [1, .5], [.8, 1], [0, 1]],
  chevron: [[0, 0], [.8, 0], [1, .5], [.8, 1], [0, 1], [.2, .5]],
  rightArrow: [[0, .25], [.65, .25], [.65, 0], [1, .5], [.65, 1], [.65, .75], [0, .75]],
  leftArrow: [[1, .25], [.35, .25], [.35, 0], [0, .5], [.35, 1], [.35, .75], [1, .75]],
  upArrow: [[.25, 1], [.25, .35], [0, .35], [.5, 0], [1, .35], [.75, .35], [.75, 1]],
  downArrow: [[.25, 0], [.25, .65], [0, .65], [.5, 1], [1, .65], [.75, .65], [.75, 0]],
  plus: [[.33, 0], [.67, 0], [.67, .33], [1, .33], [1, .67], [.67, .67], [.67, 1], [.33, 1], [.33, .67], [0, .67], [0, .33], [.33, .33]],
  star5: [[.5, 0], [.62, .38], [1, .38], [.69, .62], [.81, 1], [.5, .76], [.19, 1], [.31, .62], [0, .38], [.38, .38]],
};

export const uid = () => Math.random().toString(36).slice(2, 9);
export const textEl = (text, x, y, w, h, size, more) => ({ id: uid(), type: 'text', x, y, w, h, text, size, ...more });
export const newSlide = (title = 'Title', body = 'Body') => ({
  id: uid(), bg: '', notes: '', next: [],
  els: [textEl(title, 120, 110, 1360, 110, 76, { bold: true }), textEl(body, 120, 270, 1360, 500, 38)],
});
// Slide layouts, used by the + Slide menu and by AI generation.
//   content = { title, subtitle, bullets: [..], left: [..], right: [..], quote, by, notes }
export const LAYOUTS = { bullets: 'Title and bullets', title: 'Title', section: 'Section', two: 'Two columns', quote: 'Quote', blank: 'Blank' };
const lines = a => (Array.isArray(a) ? a : String(a ?? '').split('\n')).map(x => String(x).replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
const bulleted = a => lines(a).map(x => `• ${x}`).join('\n');
// Layouts measure their text so nothing overlaps: titles shrink (then wrap) to fit, and body
// text starts below the title and steps down in size until it fits the space left.
// Widths are estimated from an average character width, kept a little generous on purpose.
const AVG = 0.52;   // average glyph width in ems, across the theme fonts (bold titles included)
const LH = 1.25;    // line height, as in style.css
const linesAt = (text, w, size) => String(text).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((l.length * size * AVG) / w)), 0);
const heightAt = (text, w, size) => linesAt(text, w, size) * size * LH;
// The largest size in `sizes` (largest first) whose text fits in w x h, else the smallest.
const fit = (text, w, h, sizes) => sizes.find(z => heightAt(text, w, z) <= h) ?? sizes[sizes.length - 1];
const range = (big, small, step = 4) => { const out = []; for (let z = big; z >= small; z -= step) out.push(z); return out; };
const box = (text, w, size, pad = 8) => Math.ceil(heightAt(text, w, size) + pad);

export function layoutSlide(kind, c = {}) {
  const t = c.title || '', els = [];
  const add = (text, ...rest) => { if (text) els.push(textEl(text, ...rest)); };
  const MARGIN = 80, BOTTOM = H - MARGIN;
  if (kind === 'title' || kind === 'section') {
    // Title and subtitle as one block around the middle (title) or just below it (section).
    const big = kind === 'title' ? 96 : 84, center = kind === 'title' ? 'center' : undefined;
    const ts = fit(t, 1360, 2 * big * LH, range(big, 56));
    const sub = c.subtitle || '';
    const ss = fit(sub, 1360, 3 * 40 * LH, range(kind === 'title' ? 40 : 36, 28, 2));
    const th = box(t, 1360, ts), sh = sub ? box(sub, 1360, ss) : 0, gap = sub ? 36 : 0;
    const top = Math.max(MARGIN, Math.round((kind === 'title' ? (H - th - gap - sh) / 2 : H * 0.36 - th / 2)));
    add(t, 120, top, 1360, th, ts, { bold: true, align: center, valign: 'bottom' });
    add(sub, 120, top + th + gap, 1360, Math.max(sh, 60), ss, { align: center });
  } else if (kind === 'two' || kind === 'bullets') {
    const ts = fit(t, 1360, 2 * 72 * LH, range(kind === 'two' ? 68 : 72, 48));
    const th = t ? box(t, 1360, ts) : 0;
    add(t, 120, MARGIN + 20, 1360, th, ts, { bold: true });
    const y = MARGIN + 20 + (t ? th + 44 : 0), h = BOTTOM - y;
    if (kind === 'two') {
      const left = bulleted(c.left), right = bulleted(c.right);
      const size = Math.min(fit(left, 640, h, range(36, 22, 2)), fit(right, 640, h, range(36, 22, 2)));
      add(left, 120, y, 640, h, size);
      add(right, 840, y, 640, h, size);
    } else {
      const body = bulleted(c.bullets);
      add(body, 120, y, 1360, h, fit(body, 1360, h, range(40, 22, 2)));
    }
  } else if (kind === 'quote') {
    const q = c.quote && `“${c.quote.replace(/^["“]|["”]$/g, '')}”`;
    const by = c.by && `— ${c.by.replace(/^[-—\s]+/, '')}`;
    const qs = q ? fit(q, 1280, 520, range(60, 32)) : 60, qh = q ? box(q, 1280, qs) : 0, gap = by ? 48 : 0, bh = by ? 60 : 0;
    const top = Math.max(MARGIN, Math.round((H - qh - gap - bh) / 2));
    add(q, 160, top, 1280, qh, qs, { align: 'center', valign: 'bottom' });
    add(by, 160, top + qh + gap, 1280, bh, 32, { align: 'center' });
  }
  return { id: uid(), bg: '', notes: String(c.notes || ''), next: [], els };
}

// What a fresh slide of each layout says before you type over it.
export const PLACEHOLDER = {
  bullets: { title: 'Title', bullets: ['First point', 'Second point'] },
  title: { title: 'Title', subtitle: 'Subtitle' },
  section: { title: 'Section' },
  two: { title: 'Title', left: ['Left'], right: ['Right'] },
  quote: { quote: 'A quote', by: 'Someone' },
  blank: {},
};

export const newDeck = () => ({ v: 1, title: 'Untitled deck', theme: 'paper', assets: {}, slides: [newSlide('Untitled deck', 'Double-click to edit')] });

export function demoDeck() {
  const [a, b, c, d] = [
    newSlide('Waypoint', 'Slides you can steer.\nPress Present, then use the arrow keys or a clicker as usual.'),
    newSlide('Go anywhere', 'Press G for every slide at once.\nType a number and Enter to jump straight there.\nBackspace returns to the slide you came from.'),
    newSlide('Let the room choose', 'Any text, box or image can link to a slide.\nThe buttons below are links. Click one while presenting.'),
    newSlide('Your screen, their screen', 'With a second display, Present puts the slides there and gives you a controller: notes, a timer and every slide, ready to click. With one display the slides open in their own window.'),
  ];
  const button = (label, x, to) => textEl(label, x, 640, 420, 110, 34, { bold: true, align: 'center', fill: '#c2410c', color: '#ffffff', link: to.id });
  c.els.push(button('Go anywhere', 120, b), button('Your screen', 580, d));
  a.notes = 'Notes written here show up on the controller while you present.';
  c.next = [b.id, d.id];
  return { v: 1, title: 'Welcome to Waypoint', theme: 'paper', assets: {}, slides: [a, b, c, d] };
}

// Accept a deck from disk or storage: fill gaps and drop anything that is not ours.
export function cleanDeck(d) {
  if (!d || !Array.isArray(d.slides) || !d.slides.length) throw new Error('Not a Waypoint deck');
  const assets = {};
  for (const [id, src] of Object.entries(d.assets || {})) if (typeof src === 'string' && src.startsWith('data:image/')) assets[id] = src;
  return {
    v: 1,
    title: String(d.title || 'Untitled deck'),
    theme: d.theme in THEMES ? d.theme : 'paper',
    assets,
    slides: d.slides.map(s => ({
      id: s.id || uid(), bg: typeof s.bg === 'string' ? s.bg : '', notes: String(s.notes || ''), next: Array.isArray(s.next) ? s.next : [],
      els: Array.isArray(s.els) ? s.els.filter(e => e && typeof e === 'object' && e.type) : [],
      ...(s.bgImg in assets && { bgImg: s.bgImg }),
      ...(s.trans?.fx in TRANSITIONS && s.trans.fx !== 'none' && { trans: { fx: s.trans.fx, dur: +s.trans.dur || 0.6 } }),
      ...(s.name && { name: String(s.name) }),
    })),
    // Where it was imported from, so File, Update from link can fetch the latest version.
    ...(typeof d.source?.url === 'string' && /^https:\/\//.test(d.source.url) && { source: { url: d.source.url, service: String(d.source.service || ''), at: +d.source.at || 0 } }),
  };
}

export const slideTitle = s => (s.els.find(e => e.type === 'text' && e.text?.trim())?.text.trim().split('\n')[0].replace(/^[•*-]\s*/, '') || s.name || 'Untitled').slice(0, 40);
export const indexOfId = (deck, id) => deck.slides.findIndex(s => s.id === id);
export const clampIndex = (deck, i) => Math.max(0, Math.min(deck.slides.length - 1, i));
// The slides a slide offers as jumps, as indexes, skipping any that were deleted.
export const choicesOf = (deck, slide) => slide.next.map(id => indexOfId(deck, id)).filter(i => i >= 0);
