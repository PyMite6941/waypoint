// Keynote (.key) to a Waypoint deck, read directly, no Mac needed.
//
// A .key file is a zip. Index/*.iwa hold the document as protobuf messages compressed with
// Snappy; Data/ holds the pictures. Every message has an id, and messages point at each other
// by id: document -> show -> slide tree -> slides -> drawables (text boxes, shapes, pictures,
// groups) -> text storages and styles. Field numbers follow Apple's archives as documented by
// keynote-parser (github.com/psobot/keynote-parser, protos/versions/14.5).
//
// What carries over: slides in order (skipped ones left out), positions and sizes, text with
// fonts, sizes, colours, bold/italic/underline, alignment, bullets and levels, shapes and
// lines with their fills and borders, pictures (masked ones cropped), groups, slide
// backgrounds, the master's decorations, speaker notes, transitions and builds.
// What does not: tables, charts and video come in as labelled boxes; effects are dropped.
import JSZip from 'jszip';
import { H, W, uid } from '../deck.js';
import { addPicture, clean, dark } from './util.js';

/* ---------- Snappy and protobuf ---------- */

// IWA framing: chunks of [0x00, 3-byte little-endian length, Snappy data without checksums].
function unchunk(bytes) {
  const parts = [];
  for (let p = 0; p + 4 <= bytes.length;) {
    const len = bytes[p + 1] | (bytes[p + 2] << 8) | (bytes[p + 3] << 16);
    parts.push(unsnappy(bytes.subarray(p + 4, p + 4 + len)));
    p += 4 + len;
  }
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

export function unsnappy(src) {
  let p = 0, len = 0, mul = 1, b;
  do { b = src[p++]; len += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80);
  const out = new Uint8Array(len);
  let o = 0;
  while (p < src.length && o < len) {
    const tag = src[p++], kind = tag & 3;
    if (kind === 0) {
      let n = tag >> 2;
      if (n >= 60) { const k = n - 59; n = 0; for (let i = 0; i < k; i++) n += src[p++] * 2 ** (8 * i); }
      n += 1;
      out.set(src.subarray(p, p + n), o);
      p += n; o += n;
    } else {
      let n, off;
      if (kind === 1) { n = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | src[p++]; }
      else if (kind === 2) { n = (tag >> 2) + 1; off = src[p] | (src[p + 1] << 8); p += 2; }
      else { n = (tag >> 2) + 1; off = (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16)) + src[p + 3] * 2 ** 24; p += 4; }
      if (!off || off > o) throw new Error('This Keynote file is damaged.');
      for (let i = 0; i < n; i++, o++) out[o] = out[o - off];
    }
  }
  return out.subarray(0, o);
}

// A protobuf message, decoded on first use. Values: varints as numbers, 32-bit fields as
// floats, 64-bit fields as doubles, length-delimited fields as bytes.
class Msg {
  constructor(bytes) { this.bytes = bytes; this.f = null; }
  fields() {
    if (this.f) return this.f;
    const f = (this.f = new Map()), b = this.bytes, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 0;
    const varint = () => { let r = 0, m = 1, x; do { x = b[p++]; r += (x & 0x7f) * m; m *= 128; } while (x & 0x80 && p < b.length); return r; };
    while (p < b.length) {
      const key = varint(), n = Math.floor(key / 8), w = key % 8;
      let v;
      if (w === 0) v = varint();
      else if (w === 1) { v = dv.getFloat64(p, true); p += 8; }
      else if (w === 5) { v = dv.getFloat32(p, true); p += 4; }
      else if (w === 2) { const len = varint(); v = b.subarray(p, p + len); p += len; }
      else break;   // groups: not used by these archives
      if (!f.has(n)) f.set(n, []);
      f.get(n).push(v);
    }
    return f;
  }
  all(n) { return this.fields().get(n) || []; }
  has(n) { return this.fields().has(n); }
  num(n, d) { const v = this.all(n)[0]; return typeof v === 'number' ? v : d; }
  bool(n, d) { const v = this.num(n); return v === undefined ? d : !!v; }
  str(n) { const v = this.all(n)[0]; return v instanceof Uint8Array ? new TextDecoder().decode(v) : undefined; }
  strs(n) { return this.all(n).filter(v => v instanceof Uint8Array).map(v => new TextDecoder().decode(v)); }
  msg(n) { const v = this.all(n)[0]; return v instanceof Uint8Array ? new Msg(v) : null; }
  msgs(n) { return this.all(n).filter(v => v instanceof Uint8Array).map(v => new Msg(v)); }
  ref(n) { return this.msg(n)?.num(1); }
  refs(n) { return this.msgs(n).map(m => m.num(1)).filter(v => v !== undefined); }
  // Repeated enums may be packed into one byte string.
  enums(n) {
    return this.all(n).flatMap(v => {
      if (typeof v === 'number') return [v];
      const out = []; let p = 0;
      while (p < v.length) { let r = 0, m = 1, x; do { x = v[p++]; r += (x & 0x7f) * m; m *= 128; } while (x & 0x80); out.push(r); }
      return out;
    });
  }
}

// Every archive in one .iwa file, by id: { type, m }.
function readIwa(bytes, objects) {
  const data = unchunk(bytes);
  let p = 0;
  const varint = () => { let r = 0, m = 1, x; do { x = data[p++]; r += (x & 0x7f) * m; m *= 128; } while (x & 0x80); return r; };
  while (p < data.length) {
    const len = varint();
    const info = new Msg(data.subarray(p, p + len));
    p += len;
    const id = info.num(1);
    let first = true;
    for (const mi of info.msgs(2)) {
      const n = mi.num(3, 0), body = data.subarray(p, p + n);
      p += n;
      if (first && id !== undefined) objects.set(id, { type: mi.num(1), m: new Msg(body) });
      first = false;   // later messages patch the first; the first holds what we need
    }
  }
}

/* ---------- archive types (TSPRegistry ids) ---------- */

const T = {
  document: 1, show: 2, slideNode: 4, slide: 6, placeholder: 7, build: 8, slideStyle: 9, note: 15, buildChunk: 153,
  storage: [2001, 2002, 2003, 2004, 2005], charStyle: 2021, paraStyle: 2022, listStyle: 2023, textShapeStyle: 2025, shapeInfo: 2011,
  shape: 3004, image: 3005, mask: 3006, movie: 3007, group: 3008, line: 3009, shapeStyle: 3015, table: 6000, metadata: 11006,
};

/* ---------- the importer ---------- */

export async function importKeynote(bytes, fileName = 'Presentation') {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('This Keynote file could not be opened. If it came from a Mac, it may be a folder ("package") rather than a single file: in Keynote choose File, Advanced, Change File Type, Single File, then try again.'); }
  if (zip.file('index.apxl') || zip.file('index.apxl.gz')) throw new Error('This Keynote file is from Keynote 5 (2009) or older. Open it in a newer Keynote and save it again, or export it to PowerPoint.');
  if (zip.file('.iwph')) throw new Error('This Keynote file is password protected. Remove the password in Keynote (File, Change Password) and try again.');
  const iwas = Object.keys(zip.files).filter(n => /^Index\/.*\.iwa$/.test(n));
  if (!iwas.length) throw new Error('This is not a Keynote file.');

  const objects = new Map();
  for (const name of iwas) readIwa(await zip.file(name).async('uint8array'), objects);
  // Metadata.iwa is outside Index/ in some versions.
  for (const name of Object.keys(zip.files).filter(n => /(^|\/)Metadata\.iwa$/.test(n) && !iwas.includes(n))) readIwa(await zip.file(name).async('uint8array'), objects);
  const get = id => (id === undefined ? null : objects.get(id) || null);
  const ofType = t => [...objects.values()].filter(o => o.type === t);

  const warnings = new Set();
  const doc = ofType(T.document)[0];
  const show = get(doc?.m.ref(2)) || ofType(T.show)[0];
  if (!show) throw new Error('This Keynote file has no slides that can be read.');
  const size = show.m.msg(4);
  const sw = size?.num(1, 1024) || 1024, sh = size?.num(2, 768) || 768;
  const k = Math.min(W / sw, H / sh), ox = (W - sw * k) / 2, oy = (H - sh * k) / 2;
  const u = v => Math.round(v * k);   // points -> slide units

  // Pictures: data id -> file in Data/.
  const files = new Map();
  for (const md of ofType(T.metadata)) for (const d of md.m.msgs(4)) files.set(d.num(1), d.str(4) || d.str(3));
  const dataNames = Object.keys(zip.files).filter(n => n.startsWith('Data/'));
  const assets = {}, pictureCache = new Map();
  async function picture(dataId) {
    if (dataId === undefined) return null;
    if (pictureCache.has(dataId)) return pictureCache.get(dataId);
    const job = (async () => {
      const name = files.get(dataId);
      let path = name && dataNames.find(n => n === `Data/${name}`);
      if (!path && name) { const stem = name.replace(/\.[^.]+$/, ''); path = dataNames.find(n => n.startsWith(`Data/${stem}`)); }
      if (!path) path = dataNames.find(n => new RegExp(`-${dataId}\\.[a-z0-9]+$`, 'i').test(n));
      if (!path) return null;
      const ext = path.split('.').pop();
      const id = await addPicture(assets, await zip.file(path).async('uint8array'), ext);
      if (!id) warnings.add(`Some pictures are in a format browsers cannot show (.${ext}) and were left out.`);
      return id;
    })();
    pictureCache.set(dataId, job);
    return job;
  }

  /* --- styles: each property is looked up the style's parent chain --- */

  const styleBase = o => (o?.type === T.textShapeStyle ? o.m.msg(1)?.msg(1) : o?.m.msg(1));
  function inherit(id, pick) {
    for (let o = get(id), n = 0; o && n < 30; o = get(styleBase(o)?.ref(3)), n++) {
      const v = pick(o);
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }
  const shapeProps = o => (o.type === T.textShapeStyle ? o.m.msg(1)?.msg(11) : o.m.msg(11));
  const charProp = (id, pick) => inherit(id, o => { const c = o.m.msg(11); return c ? pick(c) : undefined; });
  const paraProp = (id, pick) => inherit(id, o => { const p = o.m.msg(12); return p ? pick(p) : undefined; });

  function color(c) {
    if (!c) return undefined;
    const a = c.num(6, 1);
    let rgb;
    const model = c.num(1, 1);
    if (model === 3) { const w = c.num(11, 0); rgb = [w, w, w]; }
    else if (model === 2) { const [cc, m, y, kk] = [7, 8, 9, 10].map(n => c.num(n, 0)); rgb = [(1 - cc) * (1 - kk), (1 - m) * (1 - kk), (1 - y) * (1 - kk)]; }
    else rgb = [3, 4, 5].map(n => c.num(n, 0));
    const [r, g, b] = rgb.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255));
    return a < 0.995 ? `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})` : `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }
  async function fill(f) {
    if (!f) return undefined;
    if (f.has(1)) return color(f.msg(1));
    const g = f.msg(2);
    if (g) {
      const stops = g.msgs(2).map(s => `${color(s.msg(1))} ${Math.round(s.num(2, 0) * 100)}%`);
      const angle = g.msg(5)?.num(1);
      if (stops.length > 1) return g.num(1) === 1 ? `radial-gradient(${stops.join(', ')})` : `linear-gradient(${angle !== undefined ? Math.round(90 - (angle * 180) / Math.PI) : 180}deg, ${stops.join(', ')})`;
      return stops[0]?.split(' ')[0];
    }
    const img = f.msg(3);
    if (img) return { image: await picture(img.ref(6) ?? img.ref(7)) };
    return 'transparent';
  }

  function fontOf(name) {
    if (!name) return {};
    const [base, style = ''] = name.split('-');
    const family = base.replace(/(PSMT|PS|MT)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return { font: family || undefined, b: /Bold|Black|Heavy|Semibold|Demi/i.test(style) || undefined, i: /Italic|Oblique/i.test(style) || undefined };
  }

  /* --- text --- */

  const at = (table, i) => { let v; for (const e of table) { if (e.num(1, 0) <= i) v = e; else break; } return v; };
  function charStyle(id) {
    if (id === undefined) return {};
    const font = charProp(id, c => (c.bool(4) ? null : c.str(5)));
    const f = fontOf(font);
    return {
      size: charProp(id, c => c.num(3)),
      b: charProp(id, c => c.bool(1)) ?? f.b,
      i: charProp(id, c => c.bool(2)) ?? f.i,
      u: charProp(id, c => (c.has(11) ? c.num(11) > 0 : undefined)),
      color: charProp(id, c => (c.bool(6) ? null : c.has(7) ? color(c.msg(7)) : undefined)),
      font: f.font,
    };
  }
  function bulletFor(listId, level, n) {
    if (listId === undefined) return null;
    const list = get(listId);
    if (!list) return null;
    const types = list.m.enums(11), strings = list.m.strs(16), numbers = list.m.enums(15);
    const type = types[Math.min(level, types.length - 1)] ?? 0;
    if (type === 2) return strings[Math.min(level, strings.length - 1)] || '•';
    if (type === 1) return '•';
    if (type === 3) {
      const nt = numbers[Math.min(level, numbers.length - 1)] ?? 0;
      const label = nt >= 9 && nt <= 14 ? String.fromCharCode((nt <= 11 ? 64 : 96) + n) : nt >= 3 && nt <= 8 ? roman(n, nt >= 6) : String(n);
      return [0, 3, 6, 9, 12].includes(nt) ? `${label}.` : [1, 4, 7, 10, 13].includes(nt) ? `(${label})` : `${label})`;
    }
    return null;
  }

  // A storage -> { paras, plain, first } in Waypoint's rich text form.
  function text(storageId, shapeParaStyle, isBody) {
    const s = get(storageId)?.m;
    if (!s) return null;
    const raw = s.strs(3).join('').replace(/\uFFFC/g, '');
    if (!raw.trim()) return null;
    const paraTable = s.msg(5)?.msgs(1) || [], charTable = s.msg(8)?.msgs(1) || [], listTable = s.msg(7)?.msgs(1) || [], dataTable = s.msg(6)?.msgs(1) || [];
    const paras = [], plain = [];
    const counters = [];
    let start = 0, first = null, lh = null;
    for (const line of raw.split(/[\n\u2029]/)) {
      const end = start + line.length;
      const pid = at(paraTable, start)?.ref(2) ?? shapeParaStyle;
      const base = charStyle(pid);
      const level = at(dataTable, start)?.num(2, 0) || 0;
      const align = { 0: 'left', 1: 'right', 2: 'center', 3: 'justify' }[paraProp(pid, p => p.num(1))];
      const before = paraProp(pid, p => p.num(21));
      if (lh === null) {
        const ls = paraProp(pid, p => p.msg(13));
        lh = ls && (ls.num(1, 0) === 0) ? Math.max(0.7, ls.num(2, 1) * 1.2) : 1.2;
      }
      const runs = [];
      const cuts = new Set([start, end]);
      for (const e of charTable) { const i = e.num(1, 0); if (i > start && i < end) cuts.add(i); }
      const sorted = [...cuts].sort((a, b) => a - b);
      for (let j = 0; j < sorted.length - 1; j++) {
        const t = raw.slice(sorted[j], sorted[j + 1]).replace(/\u2028/g, '\n');
        if (!t) continue;
        const cs = charStyle(at(charTable, sorted[j])?.ref(2));
        const r = { t };
        for (const key of ['b', 'i', 'u', 'color', 'font']) { const v = cs[key] ?? base[key]; if (v) r[key] = v; }
        const size = cs.size ?? base.size;
        if (size) r.size = u(size);
        runs.push(r);
      }
      if (!runs.length) runs.push({ t: '' });
      counters.length = level + 1;
      counters[level] = (counters[level] || 0) + 1;
      const listId = at(listTable, start)?.ref(2);
      const bullet = line.trim() ? bulletFor(listId, level, counters[level]) ?? (isBody && listId === undefined ? '•' : null) : null;
      const para = { lvl: level || undefined, align, size: runs[0].size, before: before ? u(before) : undefined, runs };
      if (bullet) para.bullet = bullet;
      paras.push(clean(para));
      plain.push(`${'  '.repeat(level)}${bullet ? `${bullet} ` : ''}${line}`);
      if (!first && line.trim()) first = { ...runs[0], align };
      start = end + 1;
    }
    return { paras, plain: plain.join('\n'), first, lh: Math.round(lh * 100) / 100 };
  }

  /* --- drawables --- */

  const geometryOf = d => {
    const g = d?.msg(1);
    const pos = g?.msg(1), sz = g?.msg(2);
    return { x: pos?.num(1, 0) || 0, y: pos?.num(2, 0) || 0, w: sz?.num(1, 0) || 0, h: sz?.num(2, 0) || 0, angle: g?.num(4, 0) || 0 };
  };
  const boxOf = (g, off) => ({
    x: Math.round(ox + (g.x + off.x) * k), y: Math.round(oy + (g.y + off.y) * k),
    w: Math.max(1, u(g.w)), h: Math.max(1, u(g.h)), rot: g.angle ? Math.round(((360 - g.angle) % 360) * 10) / 10 : undefined,
  });

  // A path source -> what Waypoint draws: { type, geom?, path?, radius?, open? }.
  function outlineOf(ps, box) {
    if (!ps) return { type: 'rect' };
    const flip = `${ps.bool(1) ? 'h' : ''}${ps.bool(2) ? 'v' : ''}` || undefined;
    const scalar = ps.msg(4);
    if (scalar) {
      const t = scalar.num(1, 0), v = scalar.num(2, 0);
      if (t === 0) return { type: 'rect', radius: Math.round(Math.min(u(v), box.w / 2, box.h / 2)) || 0 };
      if (t === 1) { const sides = Math.round(v); return { type: 'rect', geom: { 3: 'triangle', 5: 'pentagon', 6: 'hexagon', 8: 'octagon' }[sides] || (sides === 4 ? 'diamond' : 'hexagon'), flip }; }
      return { type: 'rect', geom: 'chevron', flip };
    }
    const point = ps.msg(3);
    if (point) {
      const t = point.num(1, 0);
      return { type: 'rect', geom: t === 0 ? 'leftArrow' : t === 1 ? 'rightArrow' : t === 10 ? 'rightArrow' : t === 100 ? 'star5' : t === 200 ? 'plus' : undefined, flip };
    }
    const bez = ps.msg(5) || ps.msg(8);
    const path = bez?.msg(3);
    if (!path) return { type: 'rect' };
    const nat = bez.msg(2);
    const nw = nat?.num(1, 0) || 1, nh = nat?.num(2, 0) || 1;
    const els = path.msgs(1).map(e => ({ t: e.num(1), pts: e.msgs(2).map(p => [p.num(1, 0), p.num(2, 0)]) }));
    const closed = els.some(e => e.t === 5);
    const curves = els.filter(e => e.t === 4).length, lines = els.filter(e => e.t === 2).length;
    if (!closed) return { type: 'line', ends: els.flatMap(e => e.pts).filter(Boolean), nw, nh, flip };
    if (curves === 0 && lines === 3 && els.filter(e => e.t === 1).length <= 2) return { type: 'rect', flip };
    if (curves === 4 && lines === 0) return { type: 'ellipse' };
    const f = v => Math.round(v * 100) / 100;
    const d = els.map(e => (e.t === 1 ? `M${e.pts.map(p => p.map(f).join(' '))}` : e.t === 2 ? `L${e.pts.map(p => p.map(f).join(' '))}` : e.t === 3 ? `Q${e.pts.map(p => p.map(f).join(' ')).join(' ')}` : e.t === 4 ? `C${e.pts.map(p => p.map(f).join(' ')).join(' ')}` : 'Z')).join(' ');
    return { type: 'rect', path: { d, w: f(nw), h: f(nh) }, flip };
  }

  async function strokeOf(props) {
    const st = props?.msg(2);
    if (!st) return {};
    if (st.msg(6)?.num(1) === 2) return {};   // empty pattern: no border
    const c = color(st.msg(1));
    const w = st.num(2, 1);
    return c && w > 0 ? { line: c, lineW: Math.max(1, Math.round(w * k)) } : {};
  }

  // Draw one drawable into `els`; `off` is the group offset. Returns the ids it produced.
  async function drawable(id, off, els, ctx) {
    const o = get(id);
    if (!o) return [];
    const made = [];
    const add = el => { const e = clean({ ...el, id: uid() }); els.push(e); made.push(e.id); return e; };

    if (o.type === T.group) {
      const g = geometryOf(o.m.msg(1));
      for (const c of o.m.refs(2)) made.push(...await drawable(c, { x: off.x + g.x, y: off.y + g.y }, els, ctx));
      return made;
    }

    if (o.type === T.image) {
      const d = o.m.msg(1), g = geometryOf(d);
      let box = boxOf(g, off), crop;
      const mask = get(o.m.ref(5));
      if (mask) {
        const mg = geometryOf(mask.m.msg(1));
        if (g.w && g.h && mg.w && mg.h) {
          crop = [mg.x / g.w, mg.y / g.h, 1 - (mg.x + mg.w) / g.w, 1 - (mg.y + mg.h) / g.h].map(v => Math.max(0, Math.min(1, Math.round(v * 10000) / 10000)));
          box = boxOf({ ...mg, x: g.x + mg.x, y: g.y + mg.y, angle: g.angle }, off);
        }
      }
      const src = await picture(o.m.ref(11) ?? o.m.ref(15) ?? o.m.ref(13));
      if (src) add({ type: 'image', src, ...box, crop: crop?.some(Boolean) ? crop : undefined });
      return made;
    }

    if ([T.movie, T.table].includes(o.type) || ![T.placeholder, T.shapeInfo, T.shape, T.line].includes(o.type)) {
      // Tables, charts, video and anything else: keep the space with a labelled box.
      const g = geometryOf(o.m.msg(1)?.has(1) ? o.m.msg(1) : o.m.msg(1)?.msg(1));
      if (!g.w || !g.h) return made;
      const label = o.type === T.table ? 'Table' : o.type === T.movie ? 'Video' : 'Chart or object';
      warnings.add('Tables, charts and video come in as labelled boxes. Rebuild them in Waypoint or paste a picture of them.');
      add({ type: 'text', ...boxOf(g, off), text: label, size: 32, align: 'center', valign: 'middle', color: '#6b6b6b', fill: 'rgba(127, 127, 127, 0.12)', radius: 0, line: '#9a9a9a', lineW: 2 });
      return made;
    }

    // Placeholder -> ShapeInfo -> Shape -> Drawable.
    let shapeInfo = o.m, kind;
    if (o.type === T.placeholder) {
      kind = o.m.num(2, 0);
      if (kind === 1) return made;   // slide number
      if (kind === 2 && ctx.hideTitle) return made;
      if (kind === 3 && ctx.hideBody) return made;
      shapeInfo = o.m.msg(1);
    }
    const shape = o.type === T.shape || o.type === T.line ? (o.type === T.line ? o.m.msg(1) : o.m) : shapeInfo?.msg(1);
    if (!shape) return made;
    const drawableMsg = shape.msg(1), g = geometryOf(drawableMsg), box = boxOf(g, off);
    const styleId = shape.ref(2);
    const props = await (async () => { const v = inherit(styleId, x => shapeProps(x)?.msg(1) ?? undefined); return v; })();
    const strokeProps = inherit(styleId, x => (shapeProps(x)?.has(2) ? shapeProps(x) : undefined));
    const opacity = inherit(styleId, x => shapeProps(x)?.num(3));
    const fillCss = await fill(props);
    const outline = await strokeOf(strokeProps);
    const form = outlineOf(shape.msg(3), box);

    if (form.type === 'line') {
      if (!outline.line) return made;
      const [a, b] = [form.ends[0] || [0, 0], form.ends[form.ends.length - 1] || [form.nw, form.nh]];
      const sx = g.w / form.nw || 1, sy = g.h / form.nh || 1;
      const x1 = g.x + a[0] * sx, y1 = g.y + a[1] * sy, x2 = g.x + b[0] * sx, y2 = g.y + b[1] * sy;
      const lb = boxOf({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), angle: g.angle }, off);
      add({ type: 'line', ...lb, ...outline, flip: (x2 < x1) !== (y2 < y1) ? 'h' : undefined, opacity: opacity < 1 ? opacity : undefined });
      return made;
    }

    // Text inside the shape.
    const textProps = get(styleId)?.type === T.textShapeStyle ? (sid => inherit(sid, x => (x.type === T.textShapeStyle ? x.m.msg(11) : undefined)))(styleId) : undefined;
    const tsp = id2 => inherit(styleId, x => (x.type === T.textShapeStyle ? x.m.msg(11)?.[id2.fn](id2.n) : undefined));
    const shapeParaStyle = tsp({ fn: 'ref', n: 10 });
    const valignNum = tsp({ fn: 'num', n: 2 });
    const padding = inherit(styleId, x => (x.type === T.textShapeStyle && x.m.msg(11)?.has(6) ? x.m.msg(11).msg(6) : undefined));
    const t = shapeInfo && o.type !== T.shape ? text(shapeInfo.ref(4) ?? shapeInfo.ref(3), shapeParaStyle, kind === 3) : null;
    void textProps;

    const hasFill = fillCss && fillCss !== 'transparent';
    const isImageFill = fillCss && typeof fillCss === 'object';
    const plainBox = form.type === 'rect' && !form.geom && !form.path;
    const base = { ...box, opacity: opacity !== undefined && opacity < 1 ? Math.round(opacity * 100) / 100 : undefined };
    if (isImageFill && fillCss.image) add({ type: 'image', src: fillCss.image, ...base });
    else if ((hasFill || outline.line) && (!t || !plainBox)) {
      add({ type: form.type === 'ellipse' ? 'ellipse' : 'rect', ...base, fill: hasFill ? fillCss : 'transparent', ...outline, geom: form.geom, path: form.path, flip: form.flip, radius: form.radius || undefined });
    }
    if (!t) return made;
    const pad = padding ? [padding.num(2, 0), padding.num(3, 0), padding.num(4, 0), padding.num(1, 0)].map(v => u(v)) : undefined;
    const first = t.first || {};
    add({
      type: 'text', ...base, text: t.plain, rich: t.paras,
      size: first.size || t.paras[0]?.size || u(24), bold: first.b || undefined, italic: first.i || undefined, underline: first.u || undefined,
      color: first.color || undefined, font: first.font || undefined, align: first.align || undefined,
      valign: { 0: 'top', 1: 'middle', 2: 'bottom' }[valignNum] || (kind === 2 ? 'middle' : 'top'),
      lh: t.lh, pad, radius: plainBox ? form.radius || 0 : 0,
      ...(plainBox && hasFill && !isImageFill ? { fill: fillCss, ...outline } : {}),
    });
    return made;
  }

  /* --- slides --- */

  const nodes = [];
  const walk = ids => { for (const id of ids) { const n = get(id); if (!n) continue; nodes.push(n); walk(n.m.refs(1)); } };
  walk(show.m.msg(3)?.refs(2) || []);
  const slides = [];
  let skipped = 0;
  for (const node of nodes) {
    if (node.m.bool(4)) { skipped++; continue; }
    const slide = get(node.m.ref(2));
    if (!slide) continue;
    const sm = slide.m, els = [];
    const styleId = sm.ref(1);
    const vis = n => inherit(styleId, x => x.m.msg(11)?.has(n) ? x.m.msg(11).bool(n) : undefined);
    const ctx = { hideTitle: vis(4) === false, hideBody: vis(5) === false };

    // The master's own decorations (not its placeholders) sit behind the slide's.
    const master = get(sm.ref(17));
    if (master) for (const d of master.m.refs(42).length ? master.m.refs(42) : master.m.refs(7)) {
      if (get(d)?.type !== T.placeholder) await drawable(d, { x: 0, y: 0 }, els, { hideTitle: true, hideBody: true });
    }
    const made = new Map();
    for (const d of sm.refs(42).length ? sm.refs(42) : sm.refs(7)) made.set(d, await drawable(d, { x: 0, y: 0 }, els, ctx));

    // Background.
    let bg = '', bgImg;
    const bgFill = await fill(inherit(styleId, x => x.m.msg(11)?.msg(1) ?? undefined) ?? (master && inherit(master.m.ref(1), x => x.m.msg(11)?.msg(1) ?? undefined)));
    if (bgFill && typeof bgFill === 'object') bgImg = bgFill.image || undefined;
    else if (bgFill && bgFill !== 'transparent') bg = bgFill;

    // Builds, in the order they play.
    let step = 0;
    const chunks = sm.refs(43).map(get).filter(Boolean);
    const order = chunks.length ? chunks.map(c => ({ build: get(c.m.ref(1)), auto: c.m.bool(5), delay: c.m.num(3), dur: c.m.num(4) })) : sm.refs(2).map(id => ({ build: get(id), auto: false }));
    const seen = new Set();
    for (const { build, auto, delay, dur } of order) {
      if (!build || seen.has(build)) continue;
      seen.add(build);
      const aa = build.m.msg(4)?.msg(18);
      const type = aa?.str(1) || 'In';
      if (!/^in$/i.test(type) && !/build ?in/i.test(type)) continue;
      if (!auto) step++;
      const ids = made.get(build.m.ref(1)) || [];
      const fx = buildFx(aa?.str(2) || '', aa?.num(4));
      for (const e of els) if (ids.includes(e.id)) e.anim = clean({ fx, step, dur: Math.round((dur ?? aa?.num(3) ?? 0.5) * 100) / 100, delay: delay ? Math.round(delay * 100) / 100 : undefined });
    }

    const note = get(sm.ref(27));
    const notes = note ? (get(note.m.ref(1))?.m.strs(3).join('') || '').replace(/\uFFFC/g, '').replace(/\u2029/g, '\n').trim() : '';
    const ta = sm.msg(4)?.msg(2)?.msg(8);
    const trans = transFx(ta?.str(2) || '');
    slides.push({
      id: uid(), bg, notes, next: [], els, name: sm.str(10) || undefined,
      ...(bgImg && { bgImg }),
      ...(trans && { trans: { fx: trans, dur: Math.round((ta.num(3) || 1) * 100) / 100 } }),
    });
  }
  if (!slides.length) throw new Error('This Keynote file has no slides that can be read.');
  if (skipped) warnings.add(`${skipped} skipped slide${skipped > 1 ? 's were' : ' was'} left out, as in Keynote's own show.`);
  if (sw / sh < 1.6) warnings.add('This deck is 4:3. Its slides sit in the middle of the 16:9 frame.');
  const firstBg = slides[0].bg || '#ffffff';
  return { deck: { v: 1, title: fileName.replace(/\.[^.]+$/, ''), theme: dark(firstBg) ? 'ink' : 'signal', assets, slides: slides.map(s => ({ ...clean(s), bg: s.bg })) }, warnings: [...warnings] };
}

// Keynote effect names ("apple:dissolve", "com.apple.iWork.Keynote.BUKMoveIn", ...) -> ours.
function transFx(name) {
  const n = name.toLowerCase();
  if (!n || n === 'none' || /none$/.test(n)) return null;
  if (/magic|morph/.test(n)) return 'morph';
  if (/push/.test(n)) return 'push';
  if (/move|cover|reveal/.test(n)) return 'cover';
  if (/wipe|clothesline/.test(n)) return 'wipe';
  if (/cube|rotate|swap/.test(n)) return 'cube';
  if (/flip|page|twirl/.test(n)) return 'flip';
  if (/scale|zoom|grid|scale|swoosh/.test(n)) return 'zoom';
  return 'fade';
}
function buildFx(name, direction) {
  const n = name.toLowerCase();
  if (/appear/.test(n)) return 'appear';
  if (/move|fly|slide/.test(n)) return direction === 12 || direction === 21 ? 'fly-right' : direction === 14 || direction === 23 ? 'fly-up' : 'fly-left';
  if (/drop|fall/.test(n)) return 'drop';
  if (/pop|bounce/.test(n)) return 'pop';
  if (/scale|zoom|grow/.test(n)) return 'zoom';
  if (/wipe|iris/.test(n)) return 'wipe';
  if (/blur|focus/.test(n)) return 'blur';
  if (/spin|twirl|rotate/.test(n)) return 'spin';
  if (/rise|float|anvil/.test(n)) return 'rise';
  return 'fade';
}
function roman(n, lower) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return lower ? out.toLowerCase() : out;
}
