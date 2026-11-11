// The deck model. No DOM, no React: safe to use anywhere.
//
// deck  = { v, title, theme, assets: { id: dataURL }, slides: [slide] }
// slide = { id, bg, notes, next: [slide id], els: [el] }
// el    = { id, type: text|rect|ellipse|image, x, y, w, h,
//           text, size, bold, align, color, fill, src (asset id), link (slide id) }
// All geometry is in slide units on a 1600 x 900 canvas.

export const W = 1600, H = 900;
export const THEMES = { paper: 'Paper', ink: 'Ink', chalk: 'Chalk', signal: 'Signal' };

export const uid = () => Math.random().toString(36).slice(2, 9);
export const textEl = (text, x, y, w, h, size, more) => ({ id: uid(), type: 'text', x, y, w, h, text, size, ...more });
export const newSlide = (title = 'Title', body = 'Body') => ({
  id: uid(), bg: '', notes: '', next: [],
  els: [textEl(title, 120, 110, 1360, 110, 76, { bold: true }), textEl(body, 120, 270, 1360, 500, 38)],
});
export const newDeck = () => ({ v: 1, title: 'Untitled deck', theme: 'paper', assets: {}, slides: [newSlide('Untitled deck', 'Double-click to edit')] });

export function demoDeck() {
  const [a, b, c, d] = [
    newSlide('Waypoint', 'Slides you can steer.\nPress Present, then use the arrow keys or a clicker as usual.'),
    newSlide('Go anywhere', 'Press G for every slide at once.\nType a number and Enter to jump straight there.\nBackspace returns to the slide you came from.'),
    newSlide('Let the room choose', 'Any text, box or image can link to a slide.\nThe buttons below are links. Click one while presenting.'),
    newSlide('Presenter view', 'Open Presenter view on your own screen for notes, a timer and a slide picker. The audience only sees the slides.'),
  ];
  const button = (label, x, to) => textEl(label, x, 640, 420, 110, 34, { bold: true, align: 'center', fill: '#c2410c', color: '#ffffff', link: to.id });
  c.els.push(button('Go anywhere', 120, b), button('Presenter view', 580, d));
  a.notes = 'Notes written here show up in Presenter view.';
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
    slides: d.slides.map(s => ({ id: s.id || uid(), bg: s.bg || '', notes: s.notes || '', next: Array.isArray(s.next) ? s.next : [], els: Array.isArray(s.els) ? s.els : [] })),
  };
}

export const slideTitle = s => (s.els.find(e => e.type === 'text' && e.text.trim())?.text.trim().split('\n')[0] || 'Untitled').slice(0, 40);
export const indexOfId = (deck, id) => deck.slides.findIndex(s => s.id === id);
export const clampIndex = (deck, i) => Math.max(0, Math.min(deck.slides.length - 1, i));
// The slides a slide offers as jumps, as indexes, skipping any that were deleted.
export const choicesOf = (deck, slide) => slide.next.map(id => indexOfId(deck, id)).filter(i => i >= 0);
