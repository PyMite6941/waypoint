// PowerPoint (.pptx) to a Waypoint deck. Google Slides, Keynote and LibreOffice all
// export .pptx, so this is the way in for all of them.
//
// What carries over: every slide in order, positions and sizes, theme and custom colours,
// fonts, text formatting (rich text, bullets, alignment, spacing), shapes (including
// freeform), pictures (cropped), tables, groups, slide backgrounds, the layout's and
// master's decorations, speaker notes, transitions, entrance animations and links between slides.
// What does not: charts and video become a still or a labelled box, 3D and effects are dropped.
import JSZip from 'jszip';
import { GEOMS, H, W, uid } from '../deck.js';
import { clean, dark, shrink } from './util.js';

/* ---------- XML helpers (namespace prefixes vary, so match on local names) ---------- */

const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const kids = (n, name) => (n ? [...n.children].filter(c => c.localName === name) : []);
const kid = (n, ...path) => path.reduce((x, name) => x && [...x.children].find(c => c.localName === name), n) || null;
const find = (n, name) => n?.getElementsByTagNameNS('*', name)[0] || null;
const findAll = (n, name) => (n ? [...n.getElementsByTagNameNS('*', name)] : []);
const at = (n, name) => n?.getAttribute(name) ?? null;
const num = (n, name, fallback = 0) => { const v = at(n, name); return v === null || v === '' || Number.isNaN(+v) ? fallback : +v; };

const dirOf = p => p.slice(0, p.lastIndexOf('/') + 1);
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dirOf(base) + target).split('/'), out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
  return out.join('/');
}

/* ---------- colours ---------- */

const PRESET = { black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', gray: '808080', grey: '808080', orange: 'ffa500', purple: '800080' };
const toHex = rgb => `#${rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/* ---------- the importer ---------- */

export async function importPptx(bytes, fileName = 'Presentation') {
  const zip = await JSZip.loadAsync(bytes);
  const texts = new Map(), docs = new Map(), relsCache = new Map(), media = new Map();
  const warnings = new Set();
  const read = async path => { if (!texts.has(path)) texts.set(path, await zip.file(path)?.async('string') ?? null); return texts.get(path); };
  const doc = async path => { if (!docs.has(path)) { const t = await read(path); docs.set(path, t && parse(t)); } return docs.get(path); };
  async function rels(path) {
    if (relsCache.has(path)) return relsCache.get(path);
    const d = await doc(`${dirOf(path)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`);
    const map = {};
    for (const r of findAll(d, 'Relationship')) map[at(r, 'Id')] = { type: at(r, 'Type') || '', target: at(r, 'TargetMode') === 'External' ? at(r, 'Target') : resolve(path, at(r, 'Target')), external: at(r, 'TargetMode') === 'External' };
    relsCache.set(path, map);
    return map;
  }
  const relOfType = (map, type) => Object.values(map).find(r => r.type.endsWith(`/${type}`));

  const pres = await doc('ppt/presentation.xml');
  if (!pres) throw new Error('This is not a PowerPoint file.');
  const presRels = await rels('ppt/presentation.xml');
  const size = kid(pres.documentElement, 'sldSz');
  const cx = num(size, 'cx', 12192000), cy = num(size, 'cy', 6858000);
  const k = Math.min(W / cx, H / cy), ox = (W - cx * k) / 2, oy = (H - cy * k) / 2;
  const pt = v => v * 12700 * k;          // points -> slide units
  const emu = v => v * k;
  const defaultText = kid(pres.documentElement, 'defaultTextStyle');

  // Assets: each picture once, shrunk when huge, kept as PNG or JPEG (readable everywhere).
  const assets = {};
  async function asset(path) {
    if (media.has(path)) return media.get(path);
    const job = (async () => {
      const ext = path.split('.').pop().toLowerCase();
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' }[ext];
      if (!type) { warnings.add(`Some pictures are in a format browsers cannot show (.${ext}) and were left out.`); return null; }
      const file = zip.file(path);
      if (!file) return null;
      let src = `data:${type};base64,${await file.async('base64')}`;
      src = await shrink(src, type);
      const id = uid();
      assets[id] = src;
      return id;
    })();
    media.set(path, job);
    return job;
  }

  /* --- theme, master and layout, per slide --- */

  async function themeOf(masterPath) {
    const t = await doc(relOfType(await rels(masterPath), 'theme')?.target);
    const scheme = {};
    for (const c of kid(find(t, 'clrScheme'), 'dk1') ? find(t, 'clrScheme').children : []) {
      const v = kid(c, 'srgbClr') ? at(kid(c, 'srgbClr'), 'val') : at(kid(c, 'sysClr'), 'lastClr');
      if (v) scheme[c.localName] = v;
    }
    const fonts = { major: at(kid(find(t, 'majorFont'), 'latin'), 'typeface'), minor: at(kid(find(t, 'minorFont'), 'latin'), 'typeface') };
    const fmt = find(t, 'fmtScheme');
    return { scheme, fonts, fills: kid(fmt, 'fillStyleLst')?.children, lines: kid(fmt, 'lnStyleLst')?.children, bgFills: kid(fmt, 'bgFillStyleLst')?.children };
  }

  const parts = new Map();   // slide layout / master path -> { doc, path, rels, theme, clrMap }
  async function part(path, theme, clrMap) {
    if (parts.has(path)) return parts.get(path);
    const d = await doc(path), r = await rels(path);
    const p = { doc: d, path, rels: r, theme, clrMap, tree: find(d, 'spTree') };
    parts.set(path, p);
    return p;
  }

  // Colour from a node holding srgbClr / schemeClr / ..., with its modifiers.
  function color(holder, ctx, ph) {
    const c = holder && [...holder.children].find(n => /Clr$/.test(n.localName));
    if (!c) return null;
    let hex;
    if (c.localName === 'srgbClr') hex = at(c, 'val');
    else if (c.localName === 'sysClr') hex = at(c, 'lastClr') || (at(c, 'val') === 'window' ? 'ffffff' : '000000');
    else if (c.localName === 'prstClr') hex = PRESET[at(c, 'val')] || '000000';
    else if (c.localName === 'scrgbClr') hex = toHex(['r', 'g', 'b'].map(x => num(c, x) / 100000 * 255)).slice(1);
    else if (c.localName === 'schemeClr') {
      const v = at(c, 'val');
      if (v === 'phClr') { if (!ph) return null; hex = ph.replace('#', '').slice(0, 6); }
      else hex = ctx.theme.scheme[ctx.clrMap[v] || v] || ctx.theme.scheme[v];
    }
    if (!hex) return null;
    let rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)), alpha = 1;
    for (const m of c.children) {
      const v = num(m, 'val') / 100000;
      if (m.localName === 'alpha') alpha = v;
      else if (m.localName === 'tint') rgb = rgb.map(x => x * v + 255 * (1 - v));
      else if (m.localName === 'shade') rgb = rgb.map(x => x * v);
      else if (/^(lumMod|lumOff|satMod)$/.test(m.localName)) {
        const hsl = rgbToHsl(rgb);
        if (m.localName === 'lumMod') hsl[2] *= v; else if (m.localName === 'lumOff') hsl[2] += v; else hsl[1] *= v;
        hsl[1] = Math.min(1, hsl[1]); hsl[2] = Math.max(0, Math.min(1, hsl[2]));
        rgb = hslToRgb(hsl);
      }
    }
    return alpha < 1 ? `rgba(${rgb.map(Math.round).join(', ')}, ${+alpha.toFixed(3)})` : toHex(rgb);
  }

  // A fill: css colour or gradient, { image } for a picture fill, 'transparent', or null (not set here).
  async function fill(holder, ctx, ph) {
    if (!holder) return null;
    if (kid(holder, 'noFill')) return 'transparent';
    const solid = kid(holder, 'solidFill');
    if (solid) return color(solid, ctx, ph);
    const grad = kid(holder, 'gradFill');
    if (grad) {
      const stops = kids(kid(grad, 'gsLst'), 'gs').map(g => [num(g, 'pos') / 1000, color(g, ctx, ph)]).filter(s => s[1]).sort((a, b) => a[0] - b[0]);
      if (!stops.length) return null;
      if (stops.length === 1) return stops[0][1];
      const list = stops.map(([pos, c]) => `${c} ${+pos.toFixed(1)}%`).join(', ');
      return kid(grad, 'path') ? `radial-gradient(circle, ${list})` : `linear-gradient(${Math.round(num(kid(grad, 'lin'), 'ang') / 60000 + 90)}deg, ${list})`;
    }
    const blip = kid(holder, 'blipFill');
    if (blip) {
      const id = at(kid(blip, 'blip'), 'r:embed');
      const target = id && ctx.rels[id]?.target;
      return target ? { image: await asset(target), crop: cropOf(blip) } : null;
    }
    const patt = kid(holder, 'pattFill');
    if (patt) return color(kid(patt, 'fgClr'), ctx, ph);
    return null;
  }
  const cropOf = blip => { const r = kid(blip, 'srcRect'); return r ? ['l', 't', 'r', 'b'].map(x => num(r, x) / 100000) : null; };

  // Theme style references (shapes drawn with the theme's default look).
  function styleRef(style, name) {
    const ref = kid(style, name);
    return ref && { idx: num(ref, 'idx'), ref };
  }

  /* --- placeholders: a slide's title, body etc. inherit from its layout, then its master --- */

  const phOf = sp => kid(sp, 'nvSpPr', 'nvPr', 'ph') || kid(sp, 'nvPicPr', 'nvPr', 'ph') || kid(sp, 'nvGraphicFramePr', 'nvPr', 'ph');
  const typeOf = ph => at(ph, 'type') || 'obj';
  const family = t => (t === 'ctrTitle' || t === 'title' ? 'title' : t === 'subTitle' || t === 'obj' || t === 'body' ? 'body' : t);
  function matchPh(tree, ph, byIdx = true) {
    if (!tree || !ph) return null;
    const all = findAll(tree, 'ph');
    const idx = at(ph, 'idx'), type = typeOf(ph);
    const shape = n => n.parentElement?.parentElement?.parentElement || null;   // ph -> nvPr -> nvSpPr -> sp
    if (byIdx && idx !== null) { const hit = all.find(p => at(p, 'idx') === idx); if (hit) return shape(hit); }
    const exact = all.find(p => typeOf(p) === type);
    if (exact) return shape(exact);
    const loose = all.find(p => family(typeOf(p)) === family(type));
    return loose ? shape(loose) : null;
  }

  /* --- text --- */

  const lvlNode = (list, l) => kid(list, `lvl${l + 1}pPr`);
  function textStyles(chain, ph, ctx) {
    // Paragraph-level property sets for each level, most specific first.
    const master = ctx.master;
    const txStyles = kid(master.doc?.documentElement, 'txStyles');
    const fam = ph ? family(typeOf(ph)) : null;
    const style = fam === 'title' ? kid(txStyles, 'titleStyle') : fam === 'body' ? kid(txStyles, 'bodyStyle') : kid(txStyles, 'otherStyle');
    // own: set on this shape or the placeholders it inherits from; rest: the deck-wide defaults.
    return l => ({
      own: chain.map(sp => lvlNode(kid(sp, 'txBody', 'lstStyle'), l)).filter(Boolean),
      rest: [...(ph ? [lvlNode(style, l)] : []), lvlNode(defaultText, l), ...(!ph ? [lvlNode(style, l)] : [])].filter(Boolean),
    });
  }

  function bodyProps(chain) {
    const pick = name => { for (const sp of chain) { const b = kid(sp, 'txBody', 'bodyPr'); if (b && at(b, name) !== null) return at(b, name); } return null; };
    const autofit = chain.map(sp => kid(sp, 'txBody', 'bodyPr', 'normAutofit')).find(Boolean);
    return {
      anchor: pick('anchor'), wrap: pick('wrap'),
      ins: ['tIns', 'rIns', 'bIns', 'lIns'].map((n, i) => { const v = pick(n); return v === null ? (i % 2 ? 91440 : 45720) : +v; }),
      scale: autofit ? num(autofit, 'fontScale', 100000) / 100000 : 1,
      reduce: autofit ? num(autofit, 'lnSpcReduction', 0) / 100000 : 0,
    };
  }

  async function text(sp, chain, ph, ctx, fontColor) {
    const body = kid(sp, 'txBody');
    if (!body) return null;
    const bp = bodyProps(chain);
    const levels = textStyles(chain, ph, ctx);
    const paras = [], plain = [];
    const counters = [];
    let first = null, lh = null;
    for (const p of kids(body, 'p')) {
      const pPr = kid(p, 'pPr'), l = Math.min(8, num(pPr, 'lvl'));
      const lv = levels(l), own = [pPr, ...lv.own].filter(Boolean), list = [...own, ...lv.rest];
      const pget = name => { for (const n of list) if (at(n, name) !== null) return at(n, name); return null; };
      const pkid = name => { for (const n of list) { const c = kid(n, name); if (c) return c; } return null; };
      const rget = (rPr, name) => { if (rPr && at(rPr, name) !== null) return at(rPr, name); for (const n of list) { const d = kid(n, 'defRPr'); if (d && at(d, name) !== null) return at(d, name); } return null; };
      const rcolor = rPr => {
        // The shape's theme font colour (white text on a filled shape) outranks the deck defaults.
        for (const n of [rPr, ...own.map(x => kid(x, 'defRPr'))]) { const f = kid(n, 'solidFill'); if (f) return color(f, ctx); }
        if (fontColor) return fontColor;
        for (const n of lv.rest.map(x => kid(x, 'defRPr'))) { const f = kid(n, 'solidFill'); if (f) return color(f, ctx); }
        return null;
      };
      const rfont = rPr => {
        for (const n of [rPr, ...list.map(x => kid(x, 'defRPr'))]) {
          const t = at(kid(n, 'latin'), 'typeface');
          if (t) return t === '+mj-lt' ? ctx.theme.fonts.major : t === '+mn-lt' ? ctx.theme.fonts.minor : t;
        }
        return ph && family(typeOf(ph)) === 'title' ? ctx.theme.fonts.major : ctx.theme.fonts.minor;
      };
      const runs = [];
      for (const r of p.children) {
        if (r.localName === 'br') { runs.push({ t: '\n' }); continue; }
        if (r.localName !== 'r' && r.localName !== 'fld') continue;
        const rPr = kid(r, 'rPr');
        let t = kid(r, 't')?.textContent ?? '';
        if (rget(rPr, 'cap') === 'all') t = t.toUpperCase();
        const sz = rget(rPr, 'sz');
        const run = {
          t, b: rget(rPr, 'b') === '1' || rget(rPr, 'b') === 'true', i: rget(rPr, 'i') === '1' || rget(rPr, 'i') === 'true',
          u: !!rget(rPr, 'u') && rget(rPr, 'u') !== 'none', color: rcolor(rPr), size: Math.round(pt((sz ? +sz : 1800) / 100) * bp.scale * 10) / 10, font: rfont(rPr),
        };
        const link = kid(rPr, 'hlinkClick');
        if (link) run.link = ctx.rels[at(link, 'r:id')]?.target;
        runs.push(run);
      }
      const words = runs.map(r => r.t).join('');
      // Bullets and numbering.
      let bullet = null;
      if (words.trim() && !pkid('buNone')) {
        const ch = pkid('buChar'), auto = pkid('buAutoNum');
        if (auto) {
          counters[l] = (counters[l] ?? num(auto, 'startAt', 1) - 1) + 1;
          counters.length = l + 1;
          const n = counters[l], type = at(auto, 'type') || 'arabicPeriod';
          const label = /alphaLc/.test(type) ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : /alphaUc/.test(type) ? String.fromCharCode(64 + ((n - 1) % 26) + 1) : /romanLc/.test(type) ? roman(n).toLowerCase() : /romanUc/.test(type) ? roman(n) : String(n);
          bullet = /ParenR$/.test(type) ? `${label})` : /ParenBoth$/.test(type) ? `(${label})` : `${label}.`;
        } else if (ch) {
          const symbolFont = /wingdings|symbol|webdings/i.test(at(pkid('buFont'), 'typeface') || '');
          const c = at(ch, 'char') || '•';
          bullet = symbolFont || /[§Øü]/.test(c) ? '•' : c;
        }
      } else if (!words.trim()) counters.length = l;
      const endSz = at(kid(p, 'endParaRPr'), 'sz') || rget(null, 'sz');
      const para = { lvl: l, runs: runs.filter(r => r.t), size: Math.round(pt((endSz ? +endSz : 1800) / 100) * bp.scale * 10) / 10 };
      const algn = pget('algn');
      if (algn) para.align = { ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[algn];
      if (bullet) para.bullet = bullet;
      const before = pkid('spcBef');
      if (before && paras.length) {
        const pts = kid(before, 'spcPts'), pct = kid(before, 'spcPct');
        para.before = pts ? Math.round(pt(num(pts, 'val') / 100)) : pct ? Math.round(num(pct, 'val') / 100000 * para.size) : 0;
      }
      if (lh === null) {
        const ln = pkid('lnSpc'), pct = kid(ln, 'spcPct'), pts = kid(ln, 'spcPts');
        lh = pct ? Math.max(0.6, (num(pct, 'val') / 100000 - bp.reduce) * 1.2) : pts ? Math.max(0.6, pt(num(pts, 'val') / 100) / (para.size || 40)) : (1 - bp.reduce) * 1.2;
      }
      if (!first && para.runs.some(r => r.t.trim())) first = { ...para.runs.find(r => r.t.trim()), align: para.align };
      paras.push(para);
      plain.push(`${'  '.repeat(l)}${bullet ? `${bullet} ` : ''}${words}`);
    }
    while (paras.length && !paras.at(-1).runs.some(r => r.t.trim())) { paras.pop(); plain.pop(); }
    if (!plain.join('').trim()) return null;
    return { paras, plain: plain.join('\n'), first, lh: Math.round(lh * 100) / 100, bp };
  }

  /* --- shapes --- */

  // Where a shape sits, through any groups it is in. tf maps EMU boxes to slide units.
  const rootTf = (x, y, w, h) => [ox + emu(x), oy + emu(y), emu(w), emu(h)];
  function boxOf(xfrm, tf) {
    const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
    if (!off || !ext) return null;
    const [x, y, w, h] = tf(num(off, 'x'), num(off, 'y'), num(ext, 'cx'), num(ext, 'cy'));
    return { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), rot: Math.round(num(xfrm, 'rot') / 60000) || undefined, flipH: at(xfrm, 'flipH') === '1', flipV: at(xfrm, 'flipV') === '1' };
  }

  // Freeform outlines become an SVG path (moves, lines and curves only).
  function pathOf(custGeom) {
    const paths = kids(kid(custGeom, 'pathLst'), 'path');
    if (!paths.length) return null;
    const W0 = num(paths[0], 'w') || 1, H0 = num(paths[0], 'h') || 1;
    let d = '', ok = true;
    for (const p of paths) {
      if (at(p, 'fill') === 'none' && paths.length > 1) continue;
      const sx = W0 / (num(p, 'w') || W0), sy = H0 / (num(p, 'h') || H0);
      let cx = 0, cy = 0;
      const pts = n => kids(n, 'pt').map(q => [num(q, 'x', NaN) * sx, num(q, 'y', NaN) * sy]);
      for (const c of p.children) {
        const ps = pts(c);
        if (ps.some(([a, b]) => Number.isNaN(a) || Number.isNaN(b))) { ok = false; break; }
        if (c.localName === 'moveTo') { [[cx, cy]] = ps; d += `M${r1(cx)} ${r1(cy)}`; }
        else if (c.localName === 'lnTo') { [[cx, cy]] = ps; d += `L${r1(cx)} ${r1(cy)}`; }
        else if (c.localName === 'cubicBezTo') { d += `C${ps.map(([a, b]) => `${r1(a)} ${r1(b)}`).join(' ')}`; [cx, cy] = ps[2]; }
        else if (c.localName === 'quadBezTo') { d += `Q${ps.map(([a, b]) => `${r1(a)} ${r1(b)}`).join(' ')}`; [cx, cy] = ps[1]; }
        else if (c.localName === 'arcTo') {
          const wr = num(c, 'wR') * sx, hr = num(c, 'hR') * sy, st = num(c, 'stAng') / 60000 * Math.PI / 180, sw = num(c, 'swAng') / 60000 * Math.PI / 180;
          const ccx = cx - wr * Math.cos(st), ccy = cy - hr * Math.sin(st);
          const n = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2))), step = sw / n, kk = 4 / 3 * Math.tan(step / 4);
          for (let i = 0; i < n; i++) {
            const a1 = st + i * step, a2 = a1 + step;
            const p1 = [cx - kk * wr * Math.sin(a1), cy + kk * hr * Math.cos(a1)];
            const ex = ccx + wr * Math.cos(a2), ey = ccy + hr * Math.sin(a2);
            const p2 = [ex + kk * wr * Math.sin(a2), ey - kk * hr * Math.cos(a2)];
            d += `C${r1(p1[0])} ${r1(p1[1])} ${r1(p2[0])} ${r1(p2[1])} ${r1(ex)} ${r1(ey)}`;
            cx = ex; cy = ey;
          }
        } else if (c.localName === 'close') d += 'Z';
      }
    }
    return ok && d ? { d, w: W0, h: H0 } : null;
  }

  async function lineOf(spPr, style, ctx) {
    const ln = kid(spPr, 'ln');
    if (kid(ln, 'noFill')) return null;
    const lnRef = styleRef(style, 'lnRef');
    let c = kid(ln, 'solidFill') ? color(kid(ln, 'solidFill'), ctx) : null;
    let w = ln && at(ln, 'w') !== null ? num(ln, 'w') : null;
    if ((!c || w === null) && lnRef?.idx) {
      const themed = ctx.theme.lines?.[lnRef.idx - 1];
      const ph = color(lnRef.ref, ctx);
      if (!c) c = kid(themed, 'solidFill') ? color(kid(themed, 'solidFill'), ctx, ph) : ph;
      if (w === null) w = num(themed, 'w', 9525);
    }
    if (!c || (!ln && !lnRef?.idx)) return null;
    const arrow = at(kid(ln, 'tailEnd'), 'type') && at(kid(ln, 'tailEnd'), 'type') !== 'none' ? 'end' : null;
    const start = at(kid(ln, 'headEnd'), 'type') && at(kid(ln, 'headEnd'), 'type') !== 'none';
    return { line: c, lineW: Math.max(1, Math.round(emu(w ?? 12700) * 10) / 10), arrow: start ? (arrow ? 'both' : 'start') : arrow };
  }

  // One <p:sp>, <p:pic>, <p:grpSp>, <p:graphicFrame> or <p:cxnSp> -> elements (appended to `out`).
  async function shape(node, tf, ctx, out, fromLayout) {
    const name = node.localName;
    if (name === 'AlternateContent') {
      const pick = kid(node, 'Fallback') || kid(node, 'Choice');
      for (const c of pick?.children || []) await shape(c, tf, ctx, out, fromLayout);
      return;
    }
    if (name === 'grpSp') {
      const x = kid(node, 'grpSpPr', 'xfrm');
      const off = kid(x, 'off'), ext = kid(x, 'ext'), chOff = kid(x, 'chOff'), chExt = kid(x, 'chExt');
      let inner = tf;
      if (off && ext && chOff && chExt) {
        const sx = num(ext, 'cx') / (num(chExt, 'cx') || 1), sy = num(ext, 'cy') / (num(chExt, 'cy') || 1);
        inner = (a, b, w, h) => tf(num(off, 'x') + (a - num(chOff, 'x')) * sx, num(off, 'y') + (b - num(chOff, 'y')) * sy, w * sx, h * sy);
      }
      for (const c of node.children) await shape(c, inner, ctx, out, fromLayout);
      return;
    }
    const cNvPr = find(node, 'cNvPr');
    const spid = at(cNvPr, 'id');
    const add = el => { out.push(el); if (spid && !fromLayout) (ctx.spids[spid] ??= []).push(el); return el; };
    const linkPath = (() => { const h = kid(cNvPr, 'hlinkClick'); return h && ctx.rels[at(h, 'r:id')]?.target; })();
    const withLink = el => (linkPath && /slides\/slide\d+\.xml$/.test(linkPath) ? { ...el, linkPath } : el);

    if (name === 'pic') {
      const ph = phOf(node);
      const xfrm = kid(node, 'spPr', 'xfrm') || (ph && kid(matchPh(ctx.layout.tree, ph), 'spPr', 'xfrm'));
      const box = boxOf(xfrm, tf);
      const blipFill = kid(node, 'blipFill'), blip = kid(blipFill, 'blip');
      const target = ctx.rels[at(blip, 'r:embed')]?.target;
      if (!box || !target) return;
      const id = await asset(target);
      if (!id) return;
      if (find(node, 'videoFile') || find(node, 'audioFile')) warnings.add('Videos and sounds come in as their preview picture.');
      const alpha = kid(blip, 'alphaModFix');
      add(withLink({
        id: uid(), type: 'image', src: id, x: box.x, y: box.y, w: box.w, h: box.h, rot: box.rot,
        crop: cropOf(blipFill) || undefined, opacity: alpha ? num(alpha, 'amt', 100000) / 100000 : undefined,
        ...(box.flipH || box.flipV ? { flip: `${box.flipH ? 'h' : ''}${box.flipV ? 'v' : ''}` } : {}),
      }));
      return;
    }

    if (name === 'graphicFrame') {
      const box = boxOf(kid(node, 'xfrm'), tf);
      if (!box) return;
      const data = find(node, 'graphicData');
      const tbl = kid(data, 'tbl');
      if (tbl) return table(tbl, box, ctx, add);
      const uri = at(data, 'uri') || '';
      if (/diagram/.test(uri)) {
        const relIds = find(data, 'relIds');
        const drawing = Object.values(ctx.rels).find(r => r.type.endsWith('/diagramDrawing'));
        const d = drawing && await doc(drawing.target);
        if (d && relIds) {
          const dctx = { ...ctx, rels: await rels(drawing.target) };
          const frameTf = (a, b, w, h) => [box.x + emu(a), box.y + emu(b), emu(w), emu(h)];
          for (const c of find(d, 'spTree')?.children || []) await shape(c, frameTf, dctx, out, fromLayout);
          return;
        }
      }
      const isChart = /chart/.test(uri);
      warnings.add(isChart ? 'Charts come in as a labelled box: paste a picture of the chart over it.' : 'Some embedded objects came in as a labelled box.');
      add({ id: uid(), type: 'text', x: box.x, y: box.y, w: box.w, h: box.h, text: isChart ? 'Chart' : 'Embedded object', size: 32, align: 'center', valign: 'middle', color: '#6b6b6b', fill: 'rgba(127, 127, 127, 0.12)', radius: 0, line: '#9a9a9a', lineW: 2 });
      return;
    }

    if (name !== 'sp' && name !== 'cxnSp') return;
    const ph = phOf(node);
    if (ph && fromLayout) return;   // layout and master placeholders are prompts, not content
    const layoutSp = ph ? matchPh(ctx.layout.tree, ph) : null;
    const masterSp = ph ? matchPh(ctx.master.tree, layoutSp ? phOf(layoutSp) : ph, false) || matchPh(ctx.master.tree, ph, false) : null;
    const chain = [node, layoutSp, masterSp].filter(Boolean);
    const spPrs = chain.map(n => kid(n, 'spPr'));
    const box = boxOf(spPrs.map(s => kid(s, 'xfrm')).find(Boolean), tf);
    if (!box) return;
    const style = kid(node, 'style');
    const geomNode = spPrs.map(s => kid(s, 'prstGeom') || kid(s, 'custGeom')).find(Boolean);
    const prst = geomNode?.localName === 'prstGeom' ? at(geomNode, 'prst') : geomNode ? 'cust' : 'rect';

    // Fill: own, then inherited, then the theme style.
    let f = null;
    for (const s of spPrs) { f = await fill(s, ctx); if (f !== null) break; }
    const fillRef = styleRef(style, 'fillRef');
    if (f === null && fillRef?.idx) {
      const themed = fillRef.idx >= 1000 ? ctx.theme.bgFills?.[fillRef.idx - 1001] : ctx.theme.fills?.[fillRef.idx - 1];
      const phc = color(fillRef.ref, ctx);
      f = themed ? await fill({ children: [themed] }, ctx, phc) ?? phc : phc;
    }
    const ln = await lineOf(spPrs.find(s => kid(s, 'ln')) || spPrs[0], style, ctx);
    const fontRef = kid(style, 'fontRef');
    const t = await text(node, chain, ph, ctx, fontRef ? color(fontRef, ctx) : null);
    const base = { x: box.x, y: box.y, w: box.w, h: box.h, rot: box.rot };

    if (/line|Connector|connector/.test(prst) || name === 'cxnSp') {
      if (!ln) return;
      add(withLink({ id: uid(), type: 'line', ...base, w: Math.max(1, box.w), h: Math.max(1, box.h), line: ln.line, lineW: ln.lineW, arrow: ln.arrow || undefined, flip: box.flipH || box.flipV ? `${box.flipH ? 'h' : ''}${box.flipV ? 'v' : ''}` : undefined }));
      return;
    }

    const isImageFill = f && typeof f === 'object';
    const fillCss = isImageFill ? undefined : f && f !== 'transparent' ? f : undefined;
    const visibleShape = isImageFill || fillCss || ln;
    const plainBox = prst === 'rect' || prst === 'roundRect' || prst === 'snip1Rect' || prst === 'round2SameRect';
    const adj = /val (-?\d+)/.exec(at(find(geomNode, 'gd'), 'fmla') || '')?.[1];
    const radius = prst === 'roundRect' ? Math.round(Math.min(box.w, box.h) * (adj ? +adj / 100000 : 0.16667)) : 0;
    const outline = ln ? { line: ln.line, lineW: ln.lineW } : {};

    if (isImageFill && f.image) add(withLink({ id: uid(), type: 'image', src: f.image, ...base, crop: f.crop || undefined }));
    else if (visibleShape && (!t || !plainBox)) {
      const shapeEl = { id: uid(), type: prst === 'ellipse' ? 'ellipse' : 'rect', ...base, fill: fillCss || 'transparent', ...outline };
      if (shapeEl.type === 'rect') {
        if (GEOMS[prst]) shapeEl.geom = prst;
        else if (prst === 'cust') { const p = pathOf(geomNode); if (p) { shapeEl.path = p; if (box.flipH || box.flipV) shapeEl.flip = `${box.flipH ? 'h' : ''}${box.flipV ? 'v' : ''}`; } }
        shapeEl.radius = radius;
      }
      add(withLink(shapeEl));
    }
    if (!t) return;

    const el = {
      id: uid(), type: 'text', ...base, text: t.plain, rich: t.paras,
      size: t.first?.size || t.paras[0]?.size || 32, bold: t.first?.b || undefined, italic: t.first?.i || undefined, underline: t.first?.u || undefined,
      color: t.first?.color || undefined, font: t.first?.font || undefined, align: t.first?.align || undefined,
      valign: { ctr: 'middle', b: 'bottom', t: 'top' }[t.bp.anchor] || (ph && family(typeOf(ph)) === 'title' ? 'middle' : 'top'),
      lh: t.lh, pad: t.bp.ins.map(v => Math.round(emu(v))), nowrap: t.bp.wrap === 'none' || undefined,
      radius: plainBox ? radius : 0,
    };
    if (plainBox && !isImageFill) { el.fill = fillCss; Object.assign(el, outline); }
    const runLink = t.paras.flatMap(p => p.runs).find(r => r.link)?.link;
    add(withLink(runLink && !linkPath ? { ...el, linkPath: runLink } : el));
  }

  function table(tbl, box, ctx, add) {
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map(c => emu(num(c, 'w')));
    const scaleX = box.w / (cols.reduce((a, b) => a + b, 0) || 1);
    let y = box.y;
    return (async () => {
      for (const tr of kids(tbl, 'tr')) {
        const h = emu(num(tr, 'h'));
        let x = box.x, ci = 0;
        for (const tc of kids(tr, 'tc')) {
          const span = num(tc, 'gridSpan', 1), w = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0) * scaleX;
          ci += span;
          if (at(tc, 'hMerge') === '1' || at(tc, 'vMerge') === '1') { x += w; continue; }
          const tcPr = kid(tc, 'tcPr');
          const f = await fill(tcPr, ctx);
          const lineNode = kid(tcPr, 'lnB') || kid(tcPr, 'lnT') || kid(tcPr, 'lnL');
          const border = lineNode && !kid(lineNode, 'noFill') ? color(kid(lineNode, 'solidFill'), ctx) : null;
          const t = await text(tc, [tc], null, ctx, null);
          const pad = [num(tcPr, 'marT', 45720), num(tcPr, 'marR', 91440), num(tcPr, 'marB', 45720), num(tcPr, 'marL', 91440)].map(v => Math.round(emu(v)));
          add({
            id: uid(), type: 'text', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.max(1, Math.round(h)),
            text: t?.plain || ' ', rich: t?.paras, size: t?.first?.size || Math.round(pt(18)), color: t?.first?.color, font: t?.first?.font, bold: t?.first?.b || undefined,
            align: t?.first?.align, valign: { ctr: 'middle', b: 'bottom' }[at(tcPr, 'anchor')] || 'top', lh: t?.lh || 1.2, pad,
            fill: typeof f === 'string' && f !== 'transparent' ? f : undefined, radius: 0, line: border || '#9a9a9a', lineW: 1,
          });
          x += w;
        }
        y += h;
      }
    })();
  }

  async function background(chain, ctx) {
    for (const p of chain) {
      const bg = kid(find(p.doc, 'cSld'), 'bg');
      if (!bg) continue;
      const c = { ...ctx, rels: p.rels };
      const pr = kid(bg, 'bgPr');
      if (pr) {
        const f = await fill(pr, c);
        if (f && typeof f === 'object') return { bgImg: f.image };
        if (f) return { bg: f === 'transparent' ? '#ffffff' : f };
      }
      const ref = kid(bg, 'bgRef');
      if (ref) {
        const idx = num(ref, 'idx'), phc = color(ref, c);
        const themed = idx >= 1001 ? ctx.theme.bgFills?.[idx - 1001] : ctx.theme.fills?.[idx - 1];
        const f = themed ? await fill({ children: [themed] }, c, phc) : phc;
        if (f && typeof f === 'object') return { bgImg: f.image, bg: phc || undefined };
        return { bg: f || phc || '#ffffff' };
      }
    }
    return { bg: '#ffffff' };
  }

  /* --- transitions and builds --- */

  const TRANS = { fade: 'fade', dissolve: 'fade', cut: 'none', push: 'push', cover: 'cover', pull: 'cover', wipe: 'wipe', split: 'wipe', strips: 'wipe', wheel: 'wipe', circle: 'zoom', zoom: 'zoom', newsflash: 'zoom', flip: 'flip', gallery: 'flip', conveyor: 'push', pan: 'push', ferris: 'push', flythrough: 'zoom', prism: 'cube', doors: 'wipe', window: 'zoom', vortex: 'zoom', ripple: 'zoom', morph: 'morph', randomBar: 'fade', blinds: 'wipe', checker: 'fade', comb: 'wipe', shred: 'fade', honeycomb: 'fade', glitter: 'fade', switch: 'flip', reveal: 'fade', warp: 'zoom', curtains: 'wipe', wind: 'push', prestige: 'flip', fracture: 'fade', crush: 'zoom', peelOff: 'cover', pageCurlDouble: 'cover', pageCurlSingle: 'cover', airplane: 'push', origami: 'flip' };
  function transition(sld) {
    const t = findAll(sld, 'transition')[0];
    if (!t) return undefined;
    const kind = [...t.children].map(c => c.localName).find(n => n !== 'sndAc' && n !== 'extLst');
    if (!kind) return undefined;
    const fx = TRANS[kind] || 'fade';
    if (fx === 'none') return undefined;
    const dur = at(t, 'p14:dur') ? num(t, 'p14:dur') / 1000 : { slow: 1, med: 0.75, fast: 0.5 }[at(t, 'spd')] ?? 0.7;
    return { fx, dur: Math.min(5, Math.max(0.2, dur)) };
  }

  // Entrance effects in click order. Effect ids follow PowerPoint's presets.
  const ENTR = { 1: 'appear', 10: 'fade', 2: 'fly', 3: 'wipe', 22: 'wipe', 12: 'wipe', 16: 'wipe', 23: 'zoom', 53: 'zoom', 21: 'zoom', 18: 'zoom', 42: 'rise', 47: 'rise', 45: 'fade', 26: 'drop', 9: 'blur', 49: 'spin', 31: 'spin', 37: 'pop', 55: 'pop', 41: 'rise' };
  function builds(sld, spids) {
    let step = 0, any = false;
    for (const c of findAll(sld, 'cTn')) {
      if (at(c, 'presetClass') !== 'entr') continue;
      const nodeType = at(c, 'nodeType');
      if (nodeType === 'clickEffect' || (!any && nodeType !== 'withEffect' && nodeType !== 'afterEffect')) step++;
      any = true;
      const target = at(find(c, 'spTgt'), 'spid');
      const els = spids[target];
      if (!els) continue;
      let fx = ENTR[num(c, 'presetID')] || 'fade';
      if (fx === 'fly') fx = { 4: 'fly-up', 8: 'fly-left', 2: 'fly-right', 1: 'drop' }[num(c, 'presetSubtype')] || 'fly-up';
      const durs = findAll(c, 'cTn').map(n => at(n, 'dur')).filter(d => d && /^\d+$/.test(d)).map(Number);
      const delay = num(kid(kid(c, 'stCondLst'), 'cond'), 'delay', 0);
      for (const el of els) if (!el.anim) el.anim = { fx, step, dur: Math.min(10, Math.max(0.1, (durs.length ? Math.max(...durs) : 500) / 1000)), ...(delay > 0 && { delay: delay / 1000 }) };
    }
  }

  /* --- slides --- */

  const slideRefs = kids(kid(pres.documentElement, 'sldIdLst'), 'sldId').map(n => presRels[at(n, 'r:id')]?.target).filter(Boolean);
  if (!slideRefs.length) throw new Error('This presentation has no slides.');
  const slides = [], pathToId = {};
  for (const path of slideRefs) {
    const sld = await doc(path);
    if (!sld) continue;
    const r = await rels(path);
    const layoutPath = relOfType(r, 'slideLayout')?.target;
    const masterPath = layoutPath && relOfType(await rels(layoutPath), 'slideMaster')?.target;
    if (!masterPath) continue;
    const theme = await themeOf(masterPath);
    const masterDoc = await doc(masterPath);
    const clrMapNode = find(masterDoc, 'clrMap');
    let clrMap = Object.fromEntries([...(clrMapNode?.attributes || [])].map(a => [a.name, a.value]));
    for (const d of [await doc(layoutPath), sld]) { const o = find(d, 'overrideClrMapping'); if (o) clrMap = Object.fromEntries([...o.attributes].map(a => [a.name, a.value])); }
    const master = await part(masterPath, theme, clrMap), layout = await part(layoutPath, theme, clrMap);
    const ctx = { theme, clrMap, master, layout, rels: r, spids: {} };
    const els = [];

    const showMaster = at(sld.documentElement, 'showMasterSp') !== '0' && at(layout.doc.documentElement, 'showMasterSp') !== '0';
    if (showMaster) for (const c of master.tree?.children || []) await shape(c, rootTf, { ...ctx, rels: master.rels }, els, true);
    for (const c of layout.tree?.children || []) await shape(c, rootTf, { ...ctx, rels: layout.rels }, els, true);
    for (const c of find(sld, 'spTree')?.children || []) await shape(c, rootTf, ctx, els, false);
    builds(sld, ctx.spids);

    const notesPath = relOfType(r, 'notesSlide')?.target;
    let notes = '';
    if (notesPath) {
      const nd = await doc(notesPath);
      const body = findAll(nd, 'sp').find(sp => at(phOf(sp), 'type') === 'body');
      notes = kids(kid(body, 'txBody'), 'p').map(p => findAll(p, 't').map(t => t.textContent).join('')).join('\n').trim();
    }
    const bg = await background([{ doc: sld, rels: r }, layout, master], ctx);
    const id = uid();
    pathToId[path] = id;
    slides.push({ id, notes, next: [], els: els.map(clean), bg: bg.bg || '', ...(bg.bgImg && { bgImg: bg.bgImg }), ...(transition(sld) && { trans: transition(sld) }) });
  }

  // Links to other slides, now that every slide has an id.
  for (const s of slides) for (const e of s.els) {
    if (e.linkPath) { if (pathToId[e.linkPath]) e.link = pathToId[e.linkPath]; delete e.linkPath; }
    for (const p of e.rich || []) for (const run of p.runs) delete run.link;
  }

  const core = await doc('docProps/core.xml');
  const title = find(core, 'title')?.textContent?.trim() || fileName.replace(/\.[^.]+$/, '');
  const firstBg = slides[0]?.bg || '#ffffff';
  return { deck: { v: 1, title, theme: dark(firstBg) ? 'ink' : 'signal', assets, slides }, warnings: [...warnings] };
}

/* ---------- small helpers ---------- */

const r1 = v => Math.round(v * 10) / 10;
function roman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
