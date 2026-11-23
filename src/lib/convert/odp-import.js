// OpenDocument presentations (.odp: LibreOffice Impress, OpenOffice, Collabora, also what
// Google Slides and PowerPoint write as "ODP") to a Waypoint deck.
//
// An .odp is a zip: content.xml has the slides (draw:page) and their own styles, styles.xml
// the master pages, named styles, gradients and the page size, Pictures/ the images.
// Each shape's look comes from a chain of styles (its own, then parent styles, then the
// family's default), so every property is looked up along that chain.
import JSZip from 'jszip';
import { GEOMS, H, W, uid } from '../deck.js';
import { addPicture, clean, dark } from './util.js';
import { enhancedPath } from './odf-shapes.js';

const kids = (n, name) => [...(n?.childNodes || [])].filter(c => c.nodeType === 1 && (!name || c.localName === name));
const kid = (n, name) => kids(n, name)[0] || null;
const attr = (n, name) => (n && n.getAttribute ? n.getAttribute(name) || null : null);

// ODF lengths -> centimetres.
function cm(v) {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|inch|pt|pc|px)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return { cm: n, mm: n / 10, in: n * 2.54, inch: n * 2.54, pt: (n * 2.54) / 72, pc: (n * 2.54) / 6, px: (n * 2.54) / 96 }[m[2] || 'cm'];
}

export async function importOdp(bytes, fileName = 'Presentation') {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('This OpenDocument file could not be opened.'); }
  const mime = (await zip.file('mimetype')?.async('string'))?.trim();
  if (mime && !/presentation/.test(mime)) throw new Error('This OpenDocument file is not a presentation (it may be a text document or spreadsheet).');
  if (zip.file('META-INF/manifest.xml') && /manifest:encryption-data/.test(await zip.file('META-INF/manifest.xml').async('string'))) throw new Error('This presentation is password protected. Open it in LibreOffice, remove the password (File, Properties, Security) and try again.');
  const parseXml = async name => { const t = await zip.file(name)?.async('string'); return t ? new DOMParser().parseFromString(t, 'application/xml') : null; };
  const content = await parseXml('content.xml');
  if (!content) throw new Error('This is not an OpenDocument presentation.');
  const stylesDoc = await parseXml('styles.xml');
  const warnings = new Set();

  /* --- styles: "family:name" -> element, from both files --- */
  const styles = new Map(), defaults = new Map(), lists = new Map(), named = new Map(), layouts = new Map(), masters = new Map();
  for (const d of [stylesDoc, content]) {
    if (!d) continue;
    for (const s of d.getElementsByTagNameNS('*', 'style')) if (s.localName === 'style' && attr(s, 'style:name')) styles.set(`${attr(s, 'style:family')}:${attr(s, 'style:name')}`, s);
    for (const s of d.getElementsByTagNameNS('*', 'default-style')) defaults.set(attr(s, 'style:family'), s);
    for (const s of d.getElementsByTagNameNS('*', 'list-style')) if (attr(s, 'style:name') && s.parentNode?.localName !== 'graphic-properties') lists.set(attr(s, 'style:name'), s);
    for (const tag of ['gradient', 'fill-image', 'marker', 'stroke-dash', 'opacity']) for (const s of d.getElementsByTagNameNS('*', tag)) if (attr(s, 'draw:name')) named.set(`${tag}:${attr(s, 'draw:name')}`, s);
    for (const s of d.getElementsByTagNameNS('*', 'page-layout')) layouts.set(attr(s, 'style:name'), s);
    for (const s of d.getElementsByTagNameNS('*', 'master-page')) masters.set(attr(s, 'style:name'), s);
  }
  const chain = (name, family) => {
    const out = [];
    for (let s = name && styles.get(`${family}:${name}`), n = 0; s && n < 20; n++) {
      out.push(s);
      const p = attr(s, 'style:parent-style-name');
      s = p && styles.get(`${family}:${p}`);
    }
    if (defaults.has(family)) out.push(defaults.get(family));
    return out;
  };
  // A property from the first style in the chains that sets it.
  const prop = (chains, props, name) => {
    for (const c of chains) for (const s of c) { const v = attr(kid(s, props), name); if (v !== null) return v; }
    return null;
  };

  /* --- page size --- */
  const firstPage = content.getElementsByTagNameNS('*', 'page')[0];
  const firstMaster = masters.get(attr(firstPage, 'draw:master-page-name')) || [...masters.values()][0];
  const pl = kid(layouts.get(attr(firstMaster, 'style:page-layout-name')), 'page-layout-properties');
  const pw = cm(attr(pl, 'fo:page-width')) || 28, ph = cm(attr(pl, 'fo:page-height')) || 15.75;
  const k = Math.min(W / pw, H / ph), ox = (W - pw * k) / 2, oy = (H - ph * k) / 2;
  const u = v => (cm(v) ?? 0) * k;           // ODF length -> slide units
  const ptU = pt => (pt * 2.54 * k) / 72;      // points -> slide units

  /* --- pictures --- */
  const assets = {}, pics = new Map();
  async function picture(href, node) {
    if (!href) {
      const bin = kid(node, 'binary-data');
      if (!bin) return null;
      const raw = atob(bin.textContent.replace(/\s+/g, ''));
      const b = Uint8Array.from(raw, c => c.charCodeAt(0));
      return addPicture(assets, b, 'png');
    }
    const path = href.replace(/^\.\//, '');
    if (pics.has(path)) return pics.get(path);
    const job = (async () => {
      const f = zip.file(path);
      if (!f) return null;
      const ext = path.split('.').pop();
      const id = await addPicture(assets, await f.async('uint8array'), ext);
      if (!id) warnings.add(`Some pictures are in a format browsers cannot show (.${ext}) and were left out.`);
      return id;
    })();
    pics.set(path, job);
    return job;
  }

  /* --- colours and fills --- */
  const withAlpha = (hex, a) => {
    if (!hex || a === null || a === undefined || a >= 0.995) return hex;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
  };
  const pct = v => (v && /%$/.test(v) ? parseFloat(v) / 100 : null);
  async function fillOf(chains, props = 'graphic-properties') {
    const kind = prop(chains, props, 'draw:fill');
    const opacity = pct(prop(chains, props, 'draw:opacity'));
    if (kind === 'none') return 'transparent';
    if (kind === 'gradient') {
      const g = named.get(`gradient:${prop(chains, props, 'draw:fill-gradient-name')}`);
      if (g) {
        const a = attr(g, 'draw:start-color') || '#000000', b = attr(g, 'draw:end-color') || '#ffffff';
        const style = attr(g, 'draw:style') || 'linear';
        const angRaw = attr(g, 'draw:angle') || '0';
        const ang = /deg$/.test(angRaw) ? parseFloat(angRaw) : /rad$/.test(angRaw) ? (parseFloat(angRaw) * 180) / Math.PI : parseFloat(angRaw) / 10;
        const css = (180 - ang + 360) % 360;
        if (style === 'radial' || style === 'ellipsoid' || style === 'square' || style === 'rectangular') return `radial-gradient(${b}, ${a})`;
        if (style === 'axial') return `linear-gradient(${Math.round(css)}deg, ${b}, ${a}, ${b})`;
        return `linear-gradient(${Math.round(css)}deg, ${a}, ${b})`;
      }
    }
    if (kind === 'bitmap') {
      const img = named.get(`fill-image:${prop(chains, props, 'draw:fill-image-name')}`);
      const id = img && await picture(attr(img, 'xlink:href'), img);
      if (id) return { image: id };
    }
    if (kind === 'hatch') return withAlpha(prop(chains, props, 'draw:fill-color') || '#729fcf', 0.3);
    if (kind === 'solid' || (kind === null && prop(chains, props, 'draw:fill-color'))) return withAlpha(prop(chains, props, 'draw:fill-color') || '#729fcf', opacity);
    return kind === null ? undefined : 'transparent';
  }
  function strokeOf(chains) {
    const kind = prop(chains, 'graphic-properties', 'draw:stroke');
    if (kind === 'none' || !kind) return {};
    const w = u(prop(chains, 'graphic-properties', 'svg:stroke-width') || '0');
    const opacity = pct(prop(chains, 'graphic-properties', 'svg:stroke-opacity'));
    return { line: withAlpha(prop(chains, 'graphic-properties', 'svg:stroke-color') || '#3465a4', opacity), lineW: Math.max(1, Math.round(w)) };
  }
  const arrowOf = chains => {
    const s = prop(chains, 'graphic-properties', 'draw:marker-start'), e = prop(chains, 'graphic-properties', 'draw:marker-end');
    return s && e ? 'both' : e ? 'end' : s ? 'start' : undefined;
  };

  /* --- text --- */
  function textProps(chains, base = {}) {
    const get = n => prop(chains, 'text-properties', n);
    const out = { ...base };
    const size = get('fo:font-size');
    if (size && /%$/.test(size)) { if (out.size) out.size = Math.round(out.size * parseFloat(size) / 100); }
    else if (size) { const c = cm(size); if (c) out.size = Math.round(c * k); }
    const color = get('fo:color');
    if (color && get('style:use-window-font-color') !== 'true') out.color = color;
    const wt = get('fo:font-weight');
    if (wt) out.b = wt === 'bold' || +wt >= 600;
    const st = get('fo:font-style');
    if (st) out.i = st === 'italic' || st === 'oblique';
    const ul = get('style:text-underline-style');
    if (ul) out.u = ul !== 'none';
    const font = get('fo:font-family') || get('style:font-name');
    if (font) out.font = font.replace(/['"]/g, '').split(',')[0].trim();
    return out;
  }
  const bulletLabel = (lvlStyle, n) => {
    if (!lvlStyle) return null;
    if (lvlStyle.localName === 'list-level-style-bullet') {
      const c = attr(lvlStyle, 'text:bullet-char') || '•';
      return /[-]/.test(c) || c === '●' ? '•' : c;
    }
    if (lvlStyle.localName === 'list-level-style-number') {
      const fmt = attr(lvlStyle, 'style:num-format') || '1';
      if (!fmt) return null;
      const label = fmt === 'a' ? String.fromCharCode(96 + n) : fmt === 'A' ? String.fromCharCode(64 + n) : fmt === 'i' ? roman(n).toLowerCase() : fmt === 'I' ? roman(n) : String(n);
      return `${attr(lvlStyle, 'style:num-prefix') || ''}${label}${attr(lvlStyle, 'style:num-suffix') ?? '.'}`;
    }
    if (lvlStyle.localName === 'list-level-style-image') return '•';
    return null;
  };
  const levelStyle = (listStyle, level) => listStyle && kids(listStyle).find(l => +attr(l, 'text:level') === level + 1);

  // A text container (draw:text-box, or the shape itself) -> paragraphs.
  function text(container, frameChains, opts) {
    const paras = [], plain = [];
    let first = null;
    const frameBase = textProps(frameChains, {});
    const counters = [];
    const para = (p, level, listStyle, inList) => {
      const pChains = [chain(attr(p, 'text:style-name'), 'paragraph'), ...frameChains];
      const base = textProps(pChains, frameBase);
      const runs = [];
      const walk = (n, style, link) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) { const t = c.nodeValue.replace(/\s+/g, ' '); if (t) runs.push({ ...style, t, link }); continue; }
          if (c.nodeType !== 1) continue;
          const name = c.localName;
          if (name === 's') runs.push({ ...style, t: ' '.repeat(+attr(c, 'text:c') || 1) });
          else if (name === 'tab') runs.push({ ...style, t: '\t' });
          else if (name === 'line-break') runs.push({ ...style, t: '\n' });
          else if (name === 'span') walk(c, textProps([chain(attr(c, 'text:style-name'), 'text')], style), link);
          else if (name === 'a') walk(c, style, attr(c, 'xlink:href'));
          else if (['page-number', 'date', 'time', 'title', 'page-count'].includes(name)) runs.push({ ...style, t: c.textContent || '' });
          else if (!['annotation', 'bookmark', 'bookmark-start', 'bookmark-end', 'soft-page-break', 'note'].includes(name)) walk(c, style, link);
        }
      };
      walk(p, base, null);
      // Merge runs that look the same; trim the paragraph's ends.
      const merged = [];
      for (const r of runs) {
        const prev = merged[merged.length - 1];
        if (prev && ['b', 'i', 'u', 'color', 'font', 'size', 'link'].every(x => prev[x] === r[x])) prev.t += r.t;
        else merged.push({ ...r });
      }
      if (merged.length) { merged[0].t = merged[0].t.replace(/^ +/, ''); merged[merged.length - 1].t = merged[merged.length - 1].t.replace(/ +$/, ''); }
      const line = merged.map(r => r.t).join('');
      const align = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'justify' }[prop(pChains, 'paragraph-properties', 'fo:text-align')];
      const before = cm(prop(pChains, 'paragraph-properties', 'fo:margin-top'));
      counters.length = level + 1;
      counters[level] = (counters[level] || 0) + 1;
      const showBullets = inList && opts.bullets;
      const bullet = showBullets && line.trim() ? bulletLabel(levelStyle(listStyle, level), counters[level]) : null;
      const out = merged.length ? merged.map(r => clean({ t: r.t, b: r.b || undefined, i: r.i || undefined, u: r.u || undefined, color: r.color, font: r.font, size: r.size, link: r.link || undefined })) : [{ t: '' }];
      const pp = { lvl: level || undefined, align, size: out[0].size, before: before ? Math.round(before * k) : undefined, runs: out };
      if (bullet) pp.bullet = bullet;
      paras.push(clean(pp));
      plain.push(`${'  '.repeat(level)}${bullet ? `${bullet} ` : ''}${line}`);
      if (!first && line.trim()) first = { ...out[0], align };
      if (!opts.link) opts.link = merged.find(r => r.link)?.link;
    };
    const block = (n, level, listStyle, inList) => {
      for (const c of kids(n)) {
        if (c.localName === 'p' || c.localName === 'h') para(c, level, listStyle, inList);
        else if (c.localName === 'list') {
          const ls = lists.get(attr(c, 'text:style-name')) || listStyle || opts.listStyle;
          for (const item of kids(c)) if (item.localName === 'list-item' || item.localName === 'list-header') block(item, inList ? level + 1 : level, ls, item.localName === 'list-item');
        } else if (c.localName === 'list-item') block(c, level, listStyle, true);
      }
    };
    block(container, 0, opts.listStyle, false);
    if (!plain.some(l => l.trim())) return null;
    return { paras, plain: plain.join('\n'), first };
  }

  /* --- geometry --- */
  // Position, size and rotation; draw:transform holds both for rotated shapes.
  function boxOf(n) {
    const w = u(attr(n, 'svg:width')), h = u(attr(n, 'svg:height'));
    let x = u(attr(n, 'svg:x')), y = u(attr(n, 'svg:y')), rot;
    const tf = attr(n, 'draw:transform');
    if (tf) {
      const a = parseFloat(/rotate\s*\(\s*([-\d.e]+)/.exec(tf)?.[1] || '0');
      const t = /translate\s*\(\s*([-\d.e]+\w*)\s+([-\d.e]+\w*)/.exec(tf);
      if (t) { x = u(t[1]); y = u(t[2]); }
      if (a) {
        // Rotated counter-clockwise by `a` around the top-left corner, then moved there.
        const cx = x + (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a), cy = y - (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a);
        x = cx - w / 2; y = cy - h / 2;
        rot = Math.round((((-a * 180) / Math.PI) % 360 + 360) % 360 * 10) / 10 || undefined;
      }
    }
    return { x: Math.round(ox + x), y: Math.round(oy + y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), rot };
  }
  const viewBox = n => { const v = (attr(n, 'svg:viewBox') || '').split(/[\s,]+/).map(Number); return v.length === 4 && v[2] && v[3] ? v : null; };
  const pointsPath = (n, close) => {
    const vb = viewBox(n);
    const pts = (attr(n, 'draw:points') || '').trim().split(/\s+/).map(p => p.split(',').map(Number));
    if (!vb || pts.length < 2) return null;
    return { d: `M${pts.map(([a, b]) => `${a - vb[0]} ${b - vb[1]}`).join(' L')}${close ? ' Z' : ''}`, w: vb[2], h: vb[3] };
  };
  const PRESETS = {
    rectangle: null, 'round-rectangle': 'round', ellipse: 'ellipse', circle: 'ellipse', 'isosceles-triangle': 'triangle', 'right-triangle': 'rtTriangle',
    diamond: 'diamond', parallelogram: 'parallelogram', trapezoid: 'trapezoid', pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon',
    'star5': 'star5', cross: 'plus', 'right-arrow': 'rightArrow', 'left-arrow': 'leftArrow', 'up-arrow': 'upArrow', 'down-arrow': 'downArrow',
    chevron: 'chevron', 'pentagon-right': 'homePlate', 'round-quadrat': 'round', quadrat: null,
    'mso-spt100': null, 'ooxml-rect': null, 'ooxml-roundRect': 'round', 'ooxml-ellipse': 'ellipse', 'ooxml-triangle': 'triangle', 'ooxml-rtTriangle': 'rtTriangle',
    'ooxml-diamond': 'diamond', 'ooxml-parallelogram': 'parallelogram', 'ooxml-trapezoid': 'trapezoid', 'ooxml-pentagon': 'pentagon', 'ooxml-hexagon': 'hexagon',
    'ooxml-octagon': 'octagon', 'ooxml-star5': 'star5', 'ooxml-plus': 'plus', 'ooxml-rightArrow': 'rightArrow', 'ooxml-leftArrow': 'leftArrow',
    'ooxml-upArrow': 'upArrow', 'ooxml-downArrow': 'downArrow', 'ooxml-chevron': 'chevron', 'ooxml-homePlate': 'homePlate',
  };
  // A custom shape's preset, or its path when it is one we do not know.
  function customForm(n, box) {
    const eg = kid(n, 'enhanced-geometry');
    const type = attr(eg, 'draw:type') || 'rectangle';
    const flip = `${attr(eg, 'draw:mirror-horizontal') === 'true' ? 'h' : ''}${attr(eg, 'draw:mirror-vertical') === 'true' ? 'v' : ''}` || undefined;
    if (type in PRESETS) {
      const p = PRESETS[type];
      if (p === 'ellipse') return { type: 'ellipse' };
      if (p === 'round') {
        const mod = parseFloat((attr(eg, 'draw:modifiers') || '').split(/\s+/)[0]);
        const vb = viewBox(eg);
        const share = Number.isFinite(mod) && vb ? mod / Math.min(vb[2], vb[3]) : 0.1667;
        return { type: 'rect', radius: Math.round(Math.min(box.w, box.h) * Math.min(0.5, share)) };
      }
      if (!p || GEOMS[p]) return { type: 'rect', geom: p || undefined, flip };
    }
    // Any other shape: its own outline, worked out from the shape's formulas.
    const path = eg && enhancedPath(eg);
    if (path) return { type: 'rect', path, flip };
    warnings.add('Some unusual shapes came in as rectangles.');
    return { type: 'rect', flip };
  }

  /* --- one drawing element -> Waypoint elements --- */
  async function element(n, els, ctx, ids) {
    const name = n.localName;
    if (name === 'g') { for (const c of kids(n)) await element(c, els, ctx, ids); return; }
    if (['notes', 'forms', 'par', 'seq', 'page-thumbnail', 'animations', 'layer-set'].includes(name) || n.namespaceURI?.includes('animation')) return;
    const cls = attr(n, 'presentation:class');
    if (ctx.master && cls) return;   // the master's placeholders only shape the slides' own
    if (['page-number', 'footer', 'header', 'date-time'].includes(cls)) return;
    const chains = [chain(attr(n, 'presentation:style-name'), 'presentation'), chain(attr(n, 'draw:style-name'), 'graphic')];
    const placeholderChains = cls && ctx.masterNode ? (() => {
      const mp = kids(ctx.masterNode).find(c => attr(c, 'presentation:class') === (cls === 'subtitle' ? 'subtitle' : cls));
      return mp ? [chain(attr(mp, 'presentation:style-name'), 'presentation')] : [];
    })() : [];
    const allChains = [...chains, ...placeholderChains];
    const made = [];
    const add = el => { const e = clean({ id: uid(), ...el }); els.push(e); made.push(e.id); return e; };
    const opacityOf = () => { const o = pct(prop(allChains, 'graphic-properties', 'draw:opacity')); return o !== null && o < 1 ? o : undefined; };
    const linkOf = () => { const ev = n.getElementsByTagNameNS?.('*', 'event-listener')?.[0]; return attr(ev, 'xlink:href') || undefined; };

    if (name === 'line' || name === 'connector' || name === 'measure') {
      const x1 = u(attr(n, 'svg:x1')), y1 = u(attr(n, 'svg:y1')), x2 = u(attr(n, 'svg:x2')), y2 = u(attr(n, 'svg:y2'));
      const st = strokeOf(allChains);
      if (!st.line) return;
      const flip = `${x2 < x1 ? 'h' : ''}${y2 < y1 ? 'v' : ''}` || undefined;
      add({ type: 'line', x: Math.round(ox + Math.min(x1, x2)), y: Math.round(oy + Math.min(y1, y2)), w: Math.max(1, Math.round(Math.abs(x2 - x1))), h: Math.max(1, Math.round(Math.abs(y2 - y1))), ...st, arrow: arrowOf(allChains), flip });
      ids.set(attr(n, 'draw:id') || attr(n, 'xml:id'), made);
      return;
    }

    const box = boxOf(n);
    if (name === 'frame') {
      const img = kid(n, 'image'), tb = kid(n, 'text-box'), obj = kid(n, 'object') || kid(n, 'object-ole'), table = kid(n, 'table') || n.getElementsByTagNameNS?.('*', 'table')?.[0];
      if (img) {
        const src = await picture(attr(img, 'xlink:href'), img);
        if (src) {
          const clip = /rect\(([^)]+)\)/.exec(prop(allChains, 'graphic-properties', 'fo:clip') || '');
          let crop;
          if (clip) {
            const [t, r, b, l] = clip[1].split(/[\s,]+/).map(v => cm(v) || 0);
            const ow = (box.w / k) + l + r, oh = (box.h / k) + t + b;
            crop = [l / ow, t / oh, r / ow, b / oh].map(v => Math.round(v * 10000) / 10000);
          }
          add({ type: 'image', src, ...box, crop: crop?.some(Boolean) ? crop : undefined, opacity: opacityOf(), link: linkOf() });
        }
      } else if (table || (obj && !tb)) {
        warnings.add('Tables, charts and embedded objects come in as labelled boxes. Rebuild them in Waypoint or paste a picture of them.');
        add({ type: 'text', ...box, text: table ? 'Table' : 'Chart or object', size: 32, align: 'center', valign: 'middle', color: '#6b6b6b', fill: 'rgba(127, 127, 127, 0.12)', radius: 0, line: '#9a9a9a', lineW: 2 });
      } else if (tb) {
        await shapeWithText(n, tb, { type: 'rect' }, box, allChains, cls, add, linkOf);
      }
    } else if (['custom-shape', 'rect', 'ellipse', 'circle', 'polygon', 'polyline', 'path', 'regular-polygon', 'caption'].includes(name)) {
      let form;
      if (name === 'custom-shape') form = customForm(n, box);
      else if (name === 'ellipse' || name === 'circle') form = { type: 'ellipse' };
      else if (name === 'polygon' || name === 'polyline') form = { type: name === 'polyline' ? 'open' : 'rect', path: pointsPath(n, name === 'polygon') };
      else if (name === 'path') { const vb = viewBox(n); const d = attr(n, 'svg:d'); form = { type: /z\s*$/i.test(d || '') ? 'rect' : 'open', path: vb && d ? { d, w: vb[2], h: vb[3] } : null }; }
      else if (name === 'regular-polygon') form = { type: 'rect', geom: { 3: 'triangle', 5: 'pentagon', 6: 'hexagon', 8: 'octagon' }[attr(n, 'draw:corners')] || 'hexagon' };
      else form = { type: 'rect', radius: name === 'rect' && attr(n, 'draw:corner-radius') ? Math.round(u(attr(n, 'draw:corner-radius'))) : undefined };
      await shapeWithText(n, n, form, box, allChains, cls, add, linkOf);
    }
    const id = attr(n, 'draw:id') || attr(n, 'xml:id');
    if (id) ids.set(id, made);
  }

  async function shapeWithText(n, textNode, form, box, chains, cls, add, linkOf) {
    const fill = await fillOf(chains);
    const outline = strokeOf(chains);
    const isImageFill = fill && typeof fill === 'object';
    const hasFill = fill && fill !== 'transparent' && !isImageFill;
    const opacity = pct(prop(chains, 'graphic-properties', 'draw:opacity'));
    const base = { ...box, opacity: opacity !== null && opacity < 1 ? opacity : undefined };
    const embeddedList = chains.flat().map(s => kid(kid(s, 'graphic-properties'), 'list-style')).find(Boolean);
    const opts = { bullets: cls !== 'title' && cls !== 'subtitle', listStyle: embeddedList, link: null };
    const t = text(textNode, chains, opts);
    const plainBox = form.type === 'rect' && !form.geom && !form.path;
    const link = linkOf() || opts.link || undefined;

    if (form.type === 'open') {
      // An open polyline or path: draw its outline only.
      if (form.path && outline.line) add({ type: 'rect', ...base, fill: 'transparent', path: form.path, ...outline, link });
    } else if (isImageFill) add({ type: 'image', src: fill.image, ...base, link });
    else if ((hasFill || outline.line) && (!t || !plainBox)) {
      add({ type: form.type === 'ellipse' ? 'ellipse' : 'rect', ...base, fill: hasFill ? fill : 'transparent', ...outline, geom: form.geom, path: form.path || undefined, flip: form.flip, radius: form.radius || undefined, link });
    }
    if (!t) return;
    const pad = ['fo:padding-top', 'fo:padding-right', 'fo:padding-bottom', 'fo:padding-left'].map(p => Math.round(u(prop(chains, 'graphic-properties', p) || '0.125cm')));
    const va = prop(chains, 'graphic-properties', 'draw:textarea-vertical-align');
    const first = t.first || {};
    const fallbackSize = cls === 'title' ? ptU(44) : cls === 'outline' || cls === 'subtitle' ? ptU(32) : ptU(18);
    for (const p of t.paras) { if (!p.size) p.size = Math.round(fallbackSize); for (const r of p.runs) if (!r.size) r.size = p.size; }
    add({
      type: 'text', ...base, text: t.plain, rich: t.paras,
      size: first.size || t.paras[0]?.size || Math.round(fallbackSize), bold: first.b || undefined, italic: first.i || undefined, underline: first.u || undefined,
      color: first.color || undefined, font: first.font || undefined, align: first.align || undefined,
      valign: { middle: 'middle', bottom: 'bottom', top: 'top' }[va] || (cls === 'title' || cls === 'subtitle' ? 'middle' : 'top'),
      lh: 1.15, pad, radius: plainBox ? form.radius || 0 : 0,
      ...(plainBox && (hasFill || outline.line) ? { fill: hasFill ? fill : undefined, ...outline } : {}),
      link,
    });
  }

  /* --- slides --- */
  const pages = [...content.getElementsByTagNameNS('*', 'page')].filter(p => p.parentNode?.localName === 'presentation');
  if (!pages.length) throw new Error('This presentation has no slides.');
  const slides = [];
  let hidden = 0;
  for (const page of pages) {
    const pageStyle = chain(attr(page, 'draw:style-name'), 'drawing-page');
    const dp = n => prop([pageStyle], 'drawing-page-properties', n);
    if (dp('presentation:visibility') === 'hidden') { hidden++; continue; }
    const master = masters.get(attr(page, 'draw:master-page-name')) || firstMaster;
    const masterStyle = chain(attr(master, 'draw:style-name'), 'drawing-page');
    const els = [], ids = new Map();
    if (master && dp('presentation:background-objects-visible') !== 'false') {
      for (const c of kids(master)) await element(c, els, { master: true }, new Map());
    }
    for (const c of kids(page)) await element(c, els, { masterNode: master }, ids);

    // Background: the slide's own, else the master's.
    let bg = '', bgImg;
    const ownFill = dp('draw:fill');
    const bgFill = ownFill && ownFill !== 'none' ? await fillOf([pageStyle], 'drawing-page-properties')
      : dp('presentation:background-visible') !== 'false' ? await fillOf([masterStyle], 'drawing-page-properties') : undefined;
    if (bgFill && typeof bgFill === 'object') bgImg = bgFill.image;
    else if (bgFill && bgFill !== 'transparent') bg = bgFill;

    // Transition: the newer anim:transitionFilter, or the older page-style attributes.
    const tf = [...page.getElementsByTagNameNS('*', 'transitionFilter')].find(f => !f.parentNode?.parentNode || attr(f.parentNode, 'smil:begin')?.endsWith('.begin') || true);
    const tType = attr(tf, 'smil:type') || dp('smil:type') || dp('presentation:transition-type');
    const tStyle = dp('presentation:transition-style');
    const tDur = parseFloat(attr(tf, 'smil:dur') || dp('presentation:duration')?.replace(/^PT|S$/g, '') || '') || ({ slow: 1.2, medium: 0.8, fast: 0.4 }[dp('presentation:transition-speed')] ?? 0.8);
    const fx = transFx(tType || tStyle, attr(tf, 'smil:subtype') || dp('smil:subtype'));

    // Builds: the main sequence, one step per click.
    let step = 0;
    const main = [...page.getElementsByTagNameNS('*', 'seq')].find(s => attr(s, 'presentation:node-type') === 'main-sequence');
    for (const node of main ? main.getElementsByTagNameNS('*', 'par') : []) {
      const kind = attr(node, 'presentation:node-type');
      if (!kind || attr(node, 'presentation:preset-class') !== 'entrance') continue;
      if (kind === 'on-click') step++;
      const target = [...node.getElementsByTagNameNS('*', '*')].map(x => attr(x, 'smil:targetElement')).find(Boolean);
      const made = ids.get(target) || [];
      const dur = parseFloat([...node.getElementsByTagNameNS('*', '*')].map(x => attr(x, 'smil:dur')).find(Boolean) || '0.5') || 0.5;
      const delay = parseFloat(attr(node, 'smil:begin') || '0') || undefined;
      for (const e of els) if (made.includes(e.id)) e.anim = clean({ fx: buildFx(attr(node, 'presentation:preset-id') || '', attr(node, 'presentation:preset-sub-type') || ''), step, dur: Math.round(dur * 100) / 100, delay });
    }

    const notesNode = kid(page, 'notes');
    const notesFrame = kids(notesNode).find(f => attr(f, 'presentation:class') === 'notes');
    const notes = notesFrame ? [...notesFrame.getElementsByTagNameNS('*', 'p')].map(p => p.textContent).join('\n').trim() : '';
    slides.push(clean({
      id: uid(), bg, notes, next: [], els, name: attr(page, 'draw:name')?.replace(/^page\d+$/, '') || undefined, bgImg,
      trans: fx ? { fx, dur: Math.round(tDur * 100) / 100 } : undefined,
    }));
    slides[slides.length - 1].bg = bg;
  }
  if (!slides.length) throw new Error('Every slide in this presentation is hidden.');
  if (hidden) warnings.add(`${hidden} hidden slide${hidden > 1 ? 's were' : ' was'} left out.`);
  if (pw / ph < 1.6) warnings.add(`This deck is ${pw / ph < 1.4 ? '4:3' : 'narrower than 16:9'}. Its slides sit in the middle of the 16:9 frame.`);

  const metaTitle = (await parseXml('meta.xml'))?.getElementsByTagNameNS('*', 'title')?.[0]?.textContent?.trim();
  return { deck: { v: 1, title: metaTitle || fileName.replace(/\.[^.]+$/, ''), theme: dark(slides[0].bg || '#ffffff') ? 'ink' : 'signal', assets, slides }, warnings: [...warnings] };
}

// SMIL transition types (and the older ODF transition styles) -> ours.
function transFx(type, subtype = '') {
  if (!type || type === 'none') return null;
  const t = `${type} ${subtype}`.toLowerCase();
  if (/push/.test(t)) return 'push';
  if (/slidewipe|cover|uncover|move-from|moveto|slide/.test(t)) return 'cover';
  if (/fade|dissolve|crossfade/.test(t)) return 'fade';
  if (/zoom|fanwipe|ellipse|iris|box|stretch|scale/.test(t)) return 'zoom';
  if (/wipe|bar|clock|blinds|checker|comb|random/.test(t)) return 'wipe';
  if (/flip|turn|rotate|cube|3d/.test(t)) return /cube/.test(t) ? 'cube' : 'flip';
  return 'fade';
}
function buildFx(preset, sub) {
  const p = preset.toLowerCase();
  if (/appear/.test(p)) return 'appear';
  if (/fly-in|fly-in-slow|move|peek/.test(p)) return /left/.test(sub) ? 'fly-left' : /right/.test(sub) ? 'fly-right' : /bottom/.test(sub) ? 'fly-up' : /top/.test(sub) ? 'drop' : 'fly-left';
  if (/zoom|grow|expand|stretch/.test(p)) return 'zoom';
  if (/wipe|wheel|box|circle|diamond|plus|split|checker|blinds/.test(p)) return 'wipe';
  if (/spin|swivel|spiral|pinwheel|boomerang/.test(p)) return 'spin';
  if (/rise|ascend|float/.test(p)) return 'rise';
  if (/descend|drop|bounce/.test(p)) return 'drop';
  if (/pop|magnify/.test(p)) return 'pop';
  return 'fade';
}
function roman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
