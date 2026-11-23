// Turning other files into Waypoint decks. Each importer resolves to { deck, warnings }.
// The heavy ones (PowerPoint, Keynote, OpenDocument, PDF) load only when first used.
import { H, W, cleanDeck, layoutSlide, uid } from '../deck.js';
import { readImage } from '../files.js';

export const IMPORT_TYPES = [
  { ext: ['pptx', 'ppsx', 'potx', 'pptm'], name: 'PowerPoint / Google Slides', note: 'Layout, colours, fonts, notes, transitions and builds' },
  { ext: ['key'], name: 'Keynote', note: 'Text, shapes, pictures, notes, transitions and builds' },
  { ext: ['odp'], name: 'OpenDocument (LibreOffice)', note: 'Text, shapes, pictures, notes, transitions and builds' },
  { ext: ['ppt', 'pps'], name: 'PowerPoint 97-2003', note: 'Text, shapes, pictures, notes and transitions' },
  { ext: ['pdf'], name: 'PDF', note: 'Each page becomes a slide, exactly as it looks' },
  { ext: ['json'], name: 'Waypoint deck', note: '.waypoint.json' },
  { ext: ['md', 'markdown', 'txt'], name: 'Outline', note: 'Markdown or plain text: each heading starts a slide' },
  { ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], name: 'Pictures', note: 'One slide per picture' },
];
export const IMPORT_ACCEPT = IMPORT_TYPES.flatMap(t => t.ext.map(e => `.${e}`)).join(',');
export const isDeckFile = name => /\.(pptx|ppsx|potx|pptm|pdf|json|md|markdown|txt|key|odp|ppt|pps)$/i.test(name);

const extOf = name => name.split('.').pop().toLowerCase();

// files: [{ name, bytes: Uint8Array | ArrayBuffer }]. Several pictures make one deck.
export async function importFiles(files) {
  const pictures = files.filter(f => /^(png|jpe?g|gif|webp|svg)$/.test(extOf(f.name)));
  if (pictures.length && pictures.length === files.length) return importPictures(pictures);
  const f = files.find(x => !pictures.includes(x)) || files[0];
  const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
  const ext = extOf(f.name);
  if (/^(pptx|ppsx|potx|pptm)$/.test(ext)) return (await import('./pptx-import.js')).importPptx(bytes, f.name);
  if (ext === 'pdf') return importPdf(bytes, f.name);
  if (ext === 'json') return { deck: cleanDeck(JSON.parse(new TextDecoder().decode(bytes))), warnings: [] };
  if (/^(md|markdown|txt)$/.test(ext)) return importOutline(new TextDecoder().decode(bytes), f.name);
  if (ext === 'key') return (await import('./keynote-import.js')).importKeynote(bytes, f.name);
  if (ext === 'odp') return (await import('./odp-import.js')).importOdp(bytes, f.name);
  if (ext === 'ppt' || ext === 'pps') return (await import('./ppt-import.js')).importPpt(bytes, f.name);
  throw new Error(`Waypoint cannot open .${ext} files.`);
}

// Links (Google Slides, OneDrive, Dropbox…) are in links.js.

/* ---------- PDF: every page as a picture ---------- */

async function importPdf(bytes, name) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const assets = {}, slides = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2400 / base.width, 1600 / base.height) });
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(viewport.width), height: Math.round(viewport.height) });
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const [r, g, b] = ctx.getImageData(1, 1, 1, 1).data;   // fill the letterbox with the page's own edge colour
    const id = uid();
    assets[id] = canvas.toDataURL('image/jpeg', 0.9);
    const k = Math.min(W / canvas.width, H / canvas.height), w = Math.round(canvas.width * k), h = Math.round(canvas.height * k);
    const text = await page.getTextContent().catch(() => null);
    const firstLine = text?.items.map(i => i.str).find(s => s.trim())?.trim();
    slides.push({
      id: uid(), bg: `rgb(${r}, ${g}, ${b})`, notes: '', next: [], name: firstLine ? firstLine.slice(0, 60) : `Page ${n}`,
      els: [{ id: uid(), type: 'image', src: id, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h }],
    });
  }
  return {
    deck: { v: 1, title: name.replace(/\.pdf$/i, ''), theme: 'paper', assets, slides },
    warnings: ['PDF pages come in as pictures: they look exactly right but their text cannot be edited.'],
  };
}

/* ---------- pictures ---------- */

async function importPictures(files) {
  const assets = {}, slides = [];
  for (const f of files) {
    const type = extOf(f.name) === 'svg' ? 'image/svg+xml' : `image/${extOf(f.name).replace('jpg', 'jpeg')}`;
    const img = await readImage(new File([f.bytes], f.name, { type }));
    const id = uid(), k = Math.min(W / img.w, H / img.h), w = Math.round(img.w * k), h = Math.round(img.h * k);
    assets[id] = img.src;
    slides.push({ id: uid(), bg: '#000000', notes: '', next: [], name: f.name.replace(/\.[^.]+$/, ''), els: [{ id: uid(), type: 'image', src: id, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h }] });
  }
  return { deck: { v: 1, title: files.length === 1 ? slides[0].name : 'Pictures', theme: 'ink', assets, slides }, warnings: [] };
}

/* ---------- outline (Markdown or plain text) ---------- */

// # Title starts a title slide, ## Heading a content slide, --- splits slides,
// bullets become the slide's points, > quotes a quote, and "Note:" lines become speaker notes.
export function importOutline(text, name = 'Outline') {
  const slides = [];
  let cur = null, title = '';
  const flush = () => {
    if (!cur) return;
    const kind = cur.quote ? 'quote' : cur.level === 1 && !cur.bullets.length ? 'title' : cur.bullets.length ? 'bullets' : 'section';
    slides.push(layoutSlide(kind, { title: cur.title, subtitle: cur.body.join(' '), bullets: [...cur.bullets, ...(kind === 'bullets' ? cur.body : [])], quote: cur.quote, by: cur.by, notes: cur.notes.join('\n') }));
    cur = null;
  };
  const start = (t, level) => { flush(); cur = { title: t, level, bullets: [], body: [], notes: [], quote: '', by: '' }; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if ((m = /^(#{1,3})\s+(.*)/.exec(line))) { start(m[2].trim(), m[1].length); if (!title) title = m[2].trim(); }
    else if (/^(---+|\*\*\*+)$/.test(line.trim())) flush();
    else if (!line.trim()) continue;
    else {
      if (!cur) start('', 2);
      if ((m = /^\s*(?:[-*+•]|\d+[.)])\s+(.*)/.exec(line))) cur.bullets.push(`${'  '.repeat(Math.floor((/^\s*/.exec(line)[0].length) / 2))}${m[1]}`);
      else if ((m = /^>\s?(.*)/.exec(line))) { const q = m[1]; if (/^[-—]\s*/.test(q)) cur.by = q.replace(/^[-—]\s*/, ''); else cur.quote += (cur.quote ? ' ' : '') + q; }
      else if ((m = /^(?:note|notes)\s*:\s*(.*)/i.exec(line))) cur.notes.push(m[1]);
      else if (!cur.title) cur.title = line.trim();
      else cur.body.push(line.trim());
    }
  }
  flush();
  if (!slides.length) throw new Error('There is nothing in that file to make slides from.');
  return { deck: { v: 1, title: title || name.replace(/\.[^.]+$/, ''), theme: 'paper', assets: {}, slides }, warnings: [] };
}
