// PowerPoint 97-2003 (.ppt) to a Waypoint deck, following Microsoft's published format specs
// ([MS-CFB] compound files, [MS-PPT] records, [MS-ODRAW] shapes).
//
// A .ppt is a little file system (CFB). Its "PowerPoint Document" stream is a list of records
// (8-byte header: version/instance, type, length; version 0xF means "container of records").
// The "Current User" stream points at the last edit, whose persist directory maps object ids
// to offsets: document, slides, masters, notes. Each slide holds an OfficeArt drawing (shapes
// with an anchor rectangle, a property table, and text records); pictures live in the
// "Pictures" stream. Lengths are in master units: 576 per inch, 8 per point.
import { H, W, uid } from '../deck.js';
import { addPicture, clean, dark, sniffImage } from './util.js';

/* ---------- compound file ---------- */

function readCfb(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!sig.every((v, i) => b[i] === v)) return null;
  const u32 = o => dv.getUint32(o, true);
  const secSize = 1 << dv.getUint16(30, true), miniSize = 1 << dv.getUint16(32, true);
  const sector = n => (n + 1) * secSize;
  // FAT sector list: the header's DIFAT, then the DIFAT chain.
  const fatSecs = [];
  for (let i = 0; i < 109; i++) { const s = u32(76 + i * 4); if (s < 0xfffffffa) fatSecs.push(s); }
  for (let s = u32(68), n = u32(72); n > 0 && s < 0xfffffffa; n--) {
    const per = secSize / 4 - 1;
    for (let i = 0; i < per; i++) { const x = u32(sector(s) + i * 4); if (x < 0xfffffffa) fatSecs.push(x); }
    s = u32(sector(s) + per * 4);
  }
  const fat = new Uint32Array(fatSecs.length * (secSize / 4));
  fatSecs.forEach((s, i) => { for (let j = 0; j < secSize / 4; j++) fat[i * (secSize / 4) + j] = sector(s) + j * 4 < b.length ? u32(sector(s) + j * 4) : 0xfffffffe; });
  const chain = (start, table) => { const out = []; for (let s = start, n = 0; s < 0xfffffffa && n < table.length + 1; s = table[s], n++) out.push(s); return out; };
  const readChain = (start, size) => {
    const out = new Uint8Array(size === undefined ? chain(start, fat).length * secSize : size);
    let o = 0;
    for (const s of chain(start, fat)) { if (o >= out.length) break; const part = b.subarray(sector(s), sector(s) + Math.min(secSize, out.length - o)); out.set(part, o); o += part.length; }
    return out;
  };
  const dir = readChain(u32(48));
  const ddv = new DataView(dir.buffer);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = ddv.getUint16(o + 64, true);
    let name = '';
    for (let i = 0; i < Math.max(0, len / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({ name, type: dir[o + 66], start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
  }
  const root = entries[0];
  const miniFat = (() => { const n = u32(64); if (!n) return new Uint32Array(0); const raw = readChain(u32(60)); return new Uint32Array(raw.buffer, 0, raw.length / 4); })();
  const miniStream = root ? readChain(root.start, root.size) : new Uint8Array(0);
  const cutoff = u32(56) || 4096;
  return name => {
    const e = entries.find(x => x.type === 2 && x.name.toLowerCase() === name.toLowerCase());
    if (!e) return null;
    if (e.size >= cutoff) return readChain(e.start, e.size);
    const out = new Uint8Array(e.size);
    let o = 0;
    for (const s of chain(e.start, miniFat)) { if (o >= out.length) break; const part = miniStream.subarray(s * miniSize, s * miniSize + Math.min(miniSize, out.length - o)); out.set(part, o); o += part.length; }
    return out;
  };
}

/* ---------- records ---------- */

const RT = {
  Document: 0x03e8, DocumentAtom: 0x03e9, Slide: 0x03ee, SlideAtom: 0x03ef, Notes: 0x03f0, NotesAtom: 0x03f1, Environment: 0x03f2,
  SlidePersistAtom: 0x03f3, MainMaster: 0x03f8, SlideShowSlideInfo: 0x03f9, ColorScheme: 0x07f0, FontCollection: 0x07d5, FontEntity: 0x0fb7,
  SlideListWithText: 0x0ff0, AnimationInfo: 0x1014, AnimationInfoAtom: 0x0ff1, TextHeader: 0x0f9f, TextChars: 0x0fa0, TextBytes: 0x0fa8,
  StyleTextProp: 0x0fa1, TxMasterStyle: 0x0fa3, OutlineTextRef: 0x0f9e, Placeholder: 0x0bc3, Drawing: 0x040c, DrawingGroup: 0x040b,
  UserEdit: 0x0ff5, PersistDirectory: 0x1772, InteractiveInfo: 0x0ff2, InteractiveInfoAtom: 0x0ff3, ExObjList: 0x0409, ExHyperlink: 0x0fd7,
  ExHyperlinkAtom: 0x0fd3, CString: 0x0fba, TextInteractiveInfo: 0x0fdf,
  DggContainer: 0xf000, BStore: 0xf001, DgContainer: 0xf002, SpgrContainer: 0xf003, SpContainer: 0xf004, FBSE: 0xf007, FSPGR: 0xf009,
  FSP: 0xf00a, FOPT: 0xf00b, ClientTextbox: 0xf00d, ChildAnchor: 0xf00f, ClientAnchor: 0xf010, ClientData: 0xf011, TertiaryFOPT: 0xf122,
};

class Rec {
  constructor(b, off) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const vi = dv.getUint16(off, true);
    this.ver = vi & 0xf; this.inst = vi >> 4; this.type = dv.getUint16(off + 2, true);
    this.len = Math.min(dv.getUint32(off + 4, true), b.length - off - 8);
    this.b = b; this.off = off; this.body = b.subarray(off + 8, off + 8 + this.len);
    this.dv = new DataView(this.body.buffer, this.body.byteOffset, this.body.byteLength);
    this._kids = null;
  }
  get end() { return this.off + 8 + this.len; }
  get kids() {
    if (this._kids) return this._kids;
    this._kids = [];
    if (this.ver !== 0xf) return this._kids;
    for (let o = 0; o + 8 <= this.body.length;) { const r = new Rec(this.body, o); this._kids.push(r); if (r.len < 0) break; o = r.end; }
    return this._kids;
  }
  kid(type) { return this.kids.find(k => k.type === type) || null; }
  all(type) { return this.kids.filter(k => k.type === type); }
  find(type) { for (const k of this.kids) { if (k.type === type) return k; const f = k.find(type); if (f) return f; } return null; }
  u8(o) { return o < this.body.length ? this.body[o] : 0; }
  u16(o) { return o + 2 <= this.body.length ? this.dv.getUint16(o, true) : 0; }
  i16(o) { return o + 2 <= this.body.length ? this.dv.getInt16(o, true) : 0; }
  u32(o) { return o + 4 <= this.body.length ? this.dv.getUint32(o, true) : 0; }
  i32(o) { return o + 4 <= this.body.length ? this.dv.getInt32(o, true) : 0; }
}

const utf16 = (b, start = 0, end = b.length) => { let s = ''; for (let i = start; i + 1 < end; i += 2) { const c = b[i] | (b[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); } return s; };
const latin1 = b => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };
const hex = (r, g, b) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;

/* ---------- text style runs ---------- */

// TextPFException: paragraph properties present per mask bit, in this order.
function readPF(r, o) {
  const m = r.u32(o); o += 4;
  const pf = {};
  if (m & 0xf) { const f = r.u16(o); o += 2; if (m & 1) pf.bullet = !!(f & 1); }
  if (m & 0x80) { pf.bulletChar = String.fromCharCode(r.u16(o)); o += 2; }
  if (m & 0x10) o += 2;
  if (m & 0x40) o += 2;
  if (m & 0x20) o += 4;
  if (m & 0x800) { pf.align = ['left', 'center', 'right', 'justify', 'left', 'justify', 'justify'][r.u16(o)]; o += 2; }
  if (m & 0x1000) { pf.lineSpacing = r.i16(o); o += 2; }
  if (m & 0x2000) { pf.before = r.i16(o); o += 2; }
  if (m & 0x4000) o += 2;
  if (m & 0x100) o += 2;
  if (m & 0x400) o += 2;
  if (m & 0x8000) o += 2;
  if (m & 0x100000) { const n = r.u16(o); o += 2 + n * 4; }
  if (m & 0x10000) o += 2;
  if (m & 0xe0000) o += 2;
  if (m & 0x200000) o += 2;
  return [pf, o];
}
// TextCFException: character properties.
function readCF(r, o) {
  const m = r.u32(o); o += 4;
  const cf = {};
  if (m & 0x3eb7) {
    const s = r.u16(o); o += 2;
    if (m & 1) cf.b = !!(s & 1);
    if (m & 2) cf.i = !!(s & 2);
    if (m & 4) cf.u = !!(s & 4);
  }
  if (m & 0x10000) { cf.fontRef = r.u16(o); o += 2; }
  if (m & 0x200000) o += 2;
  if (m & 0x400000) o += 2;
  if (m & 0x800000) o += 2;
  if (m & 0x20000) { cf.size = r.u16(o); o += 2; }
  if (m & 0x40000) { cf.color = [r.u8(o), r.u8(o + 1), r.u8(o + 2), r.u8(o + 3)]; o += 4; }
  if (m & 0x80000) o += 2;
  return [cf, o];
}
function readStyleRuns(r, textLen) {
  const paras = [], chars = [];
  let o = 0, total = 0;
  try {
    while (total < textLen + 1 && o + 6 <= r.len) {
      const count = r.u32(o), level = r.u16(o + 4);
      const [pf, next] = readPF(r, o + 6);
      paras.push({ count, level, ...pf });
      o = next; total += count || textLen + 1;
    }
    total = 0;
    while (total < textLen + 1 && o + 4 <= r.len) {
      const count = r.u32(o);
      const [cf, next] = readCF(r, o + 4);
      chars.push({ count, ...cf });
      o = next; total += count || textLen + 1;
    }
  } catch { /* a damaged run table: keep what was read */ }
  return { paras, chars };
}
// Master text styles: per text type, five levels of { pf, cf }.
function readMasterStyle(r) {
  const levels = [];
  let o = 2;
  const n = r.u16(0);
  for (let i = 0; i < n && o < r.len; i++) {
    if (r.inst >= 5) o += 2;
    const [pf, a] = readPF(r, o);
    const [cf, b2] = readCF(r, a);
    levels.push({ pf, cf });
    o = b2;
  }
  return levels;
}

/* ---------- the importer ---------- */

export async function importPpt(bytes, fileName = 'Presentation') {
  const open = readCfb(bytes);
  if (!open) throw new Error('This is not a PowerPoint 97-2003 file.');
  const doc = open('PowerPoint Document');
  if (!doc) throw new Error('This file has no PowerPoint slides in it (it may be a Word or Excel file).');
  if (open('EncryptedSummary')) throw new Error('This presentation is password protected. Remove the password in PowerPoint (File, Info, Protect Presentation) and try again.');
  const pictures = open('Pictures');
  const warnings = new Set();

  // Persist directory: newest edit first, older edits fill the gaps.
  const persist = new Map();
  const cu = open('Current User');
  let editOff = cu && cu.length >= 20 ? new DataView(cu.buffer, cu.byteOffset).getUint32(16, true) : null;
  let docRef = null;
  const seenEdits = new Set();
  if (editOff === null || editOff >= doc.length) editOff = findLast(doc, RT.UserEdit);
  while (editOff !== null && editOff < doc.length && !seenEdits.has(editOff)) {
    seenEdits.add(editOff);
    const ue = new Rec(doc, editOff);
    if (ue.type !== RT.UserEdit) break;
    if (docRef === null) docRef = ue.u32(16);
    const pd = new Rec(doc, ue.u32(12));
    if (pd.type === RT.PersistDirectory) {
      for (let o = 0; o + 4 <= pd.len;) {
        const v = pd.u32(o), start = v & 0xfffff, n = v >>> 20;
        o += 4;
        for (let i = 0; i < n; i++, o += 4) if (!persist.has(start + i)) persist.set(start + i, pd.u32(o));
      }
    }
    const prev = ue.u32(8);
    editOff = prev ? prev : null;
  }
  const at = ref => (persist.has(ref) && persist.get(ref) < doc.length ? new Rec(doc, persist.get(ref)) : null);
  const document = at(docRef) || (() => { const o = findFirst(doc, RT.Document); return o === null ? null : new Rec(doc, o); })();
  if (!document || document.type !== RT.Document) throw new Error('This PowerPoint file is damaged or too old to read.');

  const da = document.kid(RT.DocumentAtom);
  const sw = da?.i32(0) || 5760, sh = da?.i32(4) || 4320;
  const k = Math.min(W / sw, H / sh), ox = (W - sw * k) / 2, oy = (H - sh * k) / 2;
  const mu = v => v * k;                 // master units -> slide units
  const emu = v => (v / 12700) * 8 * k;  // EMU -> slide units

  // Fonts and master text styles from the document's environment.
  const env = document.kid(RT.Environment);
  const fonts = (env?.kid(RT.FontCollection)?.all(RT.FontEntity) || []).map(f => utf16(f.body, 0, 64));
  const docStyles = {};
  for (const ms of env?.all(RT.TxMasterStyle) || []) docStyles[ms.inst] = readMasterStyle(ms);

  // Pictures: FBSE entries in the drawing group, data in the Pictures stream.
  const blips = [];
  const bstore = document.kid(RT.DrawingGroup)?.find(RT.BStore);
  for (const f of bstore?.all(RT.FBSE) || []) blips.push({ off: f.u32(28), size: f.u32(20), embedded: f.len > 36 ? f.body.subarray(36) : null });
  const dggOpt = document.kid(RT.DrawingGroup)?.find(RT.DggContainer)?.kid(RT.FOPT);
  const baseProps = dggOpt ? props(dggOpt) : {};
  const assets = {}, picCache = new Map();
  async function picture(pib) {
    if (!pib || !blips[pib - 1]) return null;
    if (picCache.has(pib)) return picCache.get(pib);
    const job = (async () => {
      const bl = blips[pib - 1];
      let rec = null;
      if (bl.embedded && bl.embedded.length > 8) rec = new Rec(bl.embedded, 0);
      else if (pictures && bl.off < pictures.length) rec = new Rec(pictures, bl.off);
      if (!rec) return null;
      const t = rec.type;
      if (t === 0xf01a || t === 0xf01b || t === 0xf01c) { warnings.add('Some pictures are Windows metafiles (WMF/EMF), which browsers cannot show; they were left out.'); return null; }
      // Skip the 16 or 32-byte ids and the tag byte, then find the picture's own header.
      const body = rec.body;
      let start = -1;
      for (let i = 16; i < Math.min(60, body.length); i++) if (sniffImage(body.subarray(i)) && sniffImage(body.subarray(i)) !== 'svg') { start = i; break; }
      if (t === 0xf01f) {   // DIB: add a BMP file header
        const dibStart = [17, 33].find(i => body.length > i + 40 && new DataView(body.buffer, body.byteOffset + i).getUint32(0, true) === 40) ?? 17;
        const dib = body.subarray(dibStart);
        const dv = new DataView(dib.buffer, dib.byteOffset);
        const bits = dv.getUint16(14, true), colors = dv.getUint32(32, true) || (bits <= 8 ? 1 << bits : 0);
        const head = new Uint8Array(14);
        const hv = new DataView(head.buffer);
        head[0] = 0x42; head[1] = 0x4d; hv.setUint32(2, 14 + dib.length, true); hv.setUint32(10, 14 + 40 + colors * 4, true);
        const bmp = new Uint8Array(14 + dib.length); bmp.set(head); bmp.set(dib, 14);
        return addPicture(assets, bmp, 'bmp');
      }
      if (start < 0) return null;
      const data = body.subarray(start);
      return addPicture(assets, data, sniffImage(data));
    })();
    picCache.set(pib, job);
    return job;
  }

  /* --- slide lists: slides, masters, notes, each with their outline texts --- */
  const lists = { 0: [], 1: [], 2: [] };
  for (const sl of document.all(RT.SlideListWithText)) {
    let cur = null;
    for (const r of sl.kids) {
      if (r.type === RT.SlidePersistAtom) { cur = { ref: r.u32(0), id: r.u32(12), texts: [] }; lists[sl.inst]?.push(cur); }
      else if (cur) textRecord(cur.texts, r);
    }
  }
  const masterById = new Map(lists[1].map(m => [m.id, m]));

  // Shapes' text records -> [{ type, text, style }].
  function textRecord(texts, r) {
    if (r.type === RT.TextHeader) texts.push({ type: r.u32(0), text: '', style: null });
    else if (r.type === RT.TextChars && texts.length) texts[texts.length - 1].text = utf16(r.body.length % 2 ? r.body.subarray(0, -1) : r.body).replace(/\0/g, '');
    else if (r.type === RT.TextBytes && texts.length) texts[texts.length - 1].text = latin1(r.body);
    else if (r.type === RT.StyleTextProp && texts.length) texts[texts.length - 1].styleRec = r;
    else if (r.type === RT.TextInteractiveInfo && texts.length) texts[texts.length - 1].hasLink = true;
  }

  // Hyperlinks: id -> address.
  const links = new Map();
  for (const h of document.kid(RT.ExObjList)?.all(RT.ExHyperlink) || []) {
    const id = h.kid(RT.ExHyperlinkAtom)?.u32(0);
    const strs = h.all(RT.CString).map(s => utf16(s.body));
    const target = strs.find(s => /^(https?:|mailto:|www\.)/i.test(s)) || strs[1] || strs[0];
    if (id !== undefined && target) links.set(id, /^www\./i.test(target) ? `https://${target}` : target);
  }

  /* --- colours --- */
  const schemeOf = container => {
    const cs = container?.all(RT.ColorScheme).find(c => c.inst === 1) || container?.kid(RT.ColorScheme);
    return cs ? Array.from({ length: 8 }, (_, i) => hex(cs.u8(i * 4), cs.u8(i * 4 + 1), cs.u8(i * 4 + 2))) : null;
  };
  const colorRef = (v, scheme) => {
    const r = v & 0xff, g = (v >> 8) & 0xff, b = (v >> 16) & 0xff, flags = v >>> 24;
    if (flags & 0x08) return scheme?.[r] || '#000000';
    if (flags & 0x10) return null;   // system colour: no sensible value outside Windows
    return hex(r, g, b);
  };
  const cfColor = (c, scheme) => (!c ? undefined : c[3] === 0xfe ? hex(c[0], c[1], c[2]) : c[3] < 8 ? scheme?.[c[3]] : undefined);

  /* --- shape properties --- */
  function props(fopt) {
    const out = {};
    const n = fopt.inst;
    let complex = n * 6;
    for (let i = 0; i < n; i++) {
      const id = fopt.u16(i * 6), v = fopt.u32(i * 6 + 2);
      const pid = id & 0x3fff;
      if (id & 0x8000) { out[pid] = { complex: fopt.body.subarray(complex, complex + v) }; complex += v; }
      else out[pid] = v;
    }
    return out;
  }
  const boolProp = (p, pid, bit, useBit, dflt) => (p[pid] === undefined || !(p[pid] & useBit) ? dflt : !!(p[pid] & bit));

  /* --- one drawing (slide, master or notes) -> elements --- */
  async function drawing(container, ctx) {
    const dg = container.kid(RT.Drawing)?.kid(RT.DgContainer);
    const els = [], spids = new Map();
    let background = null;
    if (!dg) return { els, background, spids };
    const bgSp = dg.kid(RT.SpContainer);
    if (bgSp) background = props(bgSp.kid(RT.FOPT) || { inst: 0 });
    const root = dg.kid(RT.SpgrContainer);
    if (root) await group(root, null, els, ctx, spids);
    return { els, background, spids };
  }

  async function group(gr, map, els, ctx, spids) {
    let local = map;
    for (const [i, c] of gr.kids.entries()) {
      if (c.type === RT.SpgrContainer) { await group(c, local, els, ctx, spids); continue; }
      if (c.type !== RT.SpContainer) continue;
      if (i === 0) {
        // The group's own shape: maps its children's coordinates onto the slide.
        const fsp = c.kid(RT.FSP), spgr = c.kid(RT.FSPGR);
        if (spgr && fsp && fsp.u32(4) & 0x1) {
          const outer = anchorOf(c, map);
          const [l, t, r, b] = [spgr.i32(0), spgr.i32(4), spgr.i32(8), spgr.i32(12)];
          if (outer && r !== l && b !== t && !(fsp.u32(4) & 0x4)) {
            const sx = outer.w / (r - l), sy = outer.h / (b - t);
            local = { x: v => outer.x + (v - l) * sx, y: v => outer.y + (v - t) * sy, sx, sy };
          }
        }
        continue;
      }
      await shape(c, local, els, ctx, spids);
    }
  }

  // Anchor in master units: ClientAnchor (slide space) or ChildAnchor (group space).
  function anchorOf(sp, map) {
    const ca = sp.kid(RT.ClientAnchor), ch = sp.kid(RT.ChildAnchor);
    if (ch && map) {
      const [l, t, r, b] = [ch.i32(0), ch.i32(4), ch.i32(8), ch.i32(12)];
      return { x: map.x(l), y: map.y(t), w: (r - l) * map.sx, h: (b - t) * map.sy };
    }
    if (ca) {
      const [t, l, r, b] = ca.len >= 16 ? [ca.i32(0), ca.i32(4), ca.i32(8), ca.i32(12)] : [ca.i16(0), ca.i16(2), ca.i16(4), ca.i16(6)];
      return { x: l, y: t, w: r - l, h: b - t };
    }
    return null;
  }

  const SHAPES = { 4: 'diamond', 5: 'triangle', 6: 'rtTriangle', 7: 'parallelogram', 8: 'trapezoid', 9: 'hexagon', 10: 'octagon', 11: 'plus', 12: 'star5', 13: 'rightArrow', 15: 'homePlate', 55: 'chevron', 56: 'pentagon', 66: 'leftArrow', 67: 'downArrow', 68: 'upArrow' };

  async function shape(sp, map, els, ctx, spids) {
    const fsp = sp.kid(RT.FSP);
    if (!fsp) return;
    const kind = fsp.inst, flags = fsp.u32(4), spid = fsp.u32(0);
    if (flags & 0x8) return;   // deleted
    const a = anchorOf(sp, map);
    if (!a) return;
    const p = { ...props(sp.kid(RT.FOPT) || { inst: 0 }), ...props(sp.kid(RT.TertiaryFOPT) || { inst: 0 }) };
    const cd = sp.kid(RT.ClientData);
    const ph = cd?.kid(RT.Placeholder);
    const phType = ph ? ph.u8(4) : null;
    if (ph && ctx.master) return;                // masters' placeholders only style the slides' text
    if (ph && [7, 8, 9, 10, 11, 12].includes(phType) && !ctx.notes) {
      // master/notes slide images, footer, date, slide number placeholders
      if ([7, 8, 9].includes(phType)) return;
    }
    const all = { ...(ph ? {} : baseProps), ...p };
    const rot = all[0x0004] ? Math.round((((all[0x0004] | 0) / 65536) % 360 + 360) % 360 * 10) / 10 : 0;
    let x = a.x, y = a.y, w = a.w, h = a.h;
    // PowerPoint stores 45-135 degree turns with width and height swapped.
    if ((rot >= 45 && rot < 135) || (rot >= 225 && rot < 315)) { const cx = x + w / 2, cy = y + h / 2; [w, h] = [h, w]; x = cx - w / 2; y = cy - h / 2; }
    const box = { x: Math.round(ox + mu(x)), y: Math.round(oy + mu(y)), w: Math.max(1, Math.round(mu(w))), h: Math.max(1, Math.round(mu(h))), rot: rot || undefined };
    const flip = `${flags & 0x40 ? 'h' : ''}${flags & 0x80 ? 'v' : ''}` || undefined;
    const made = [];
    const add = el => { const e = clean({ id: uid(), ...el }); els.push(e); made.push(e.id); return e; };

    // Link on the shape (click action).
    let link;
    const ia = cd?.kid(RT.InteractiveInfo)?.kid(RT.InteractiveInfoAtom);
    if (ia) { const action = ia.u8(8), id = ia.u32(4); if (action === 4) link = links.get(id); else if (action === 3) link = { 0: undefined, 1: 'next', 2: 'prev', 3: 'first', 4: 'last' }[ia.u8(10)]; }
    if (typeof link === 'string' && !/^[a-z]+:/i.test(link)) link = undefined;
    if (['next', 'prev', 'first', 'last'].includes(link)) link = undefined;

    // Fill and line.
    const scheme = ctx.scheme;
    const filled = boolProp(all, 0x01bf, 0x10, 0x100000, !ph && kind !== 202 && kind !== 75 && kind !== 20 && kind !== 32);
    const fillType = all[0x0180] || 0;
    const fillOpacity = all[0x0182] !== undefined ? all[0x0182] / 65536 : 1;
    let fill = filled ? colorRef(all[0x0181] ?? 0x08000004, scheme) || '#ffffff' : undefined;
    if (fill && fillOpacity < 0.995) fill = withAlpha(fill, fillOpacity);
    if (filled && (fillType === 4 || fillType === 5 || fillType === 6 || fillType === 7)) {
      const second = colorRef(all[0x0183] ?? 0x00ffffff, scheme) || '#ffffff';
      const angle = ((all[0x018b] | 0) / 65536) || 0;
      fill = `linear-gradient(${Math.round(180 - angle)}deg, ${fill}, ${second})`;
    }
    const fillPic = filled && (fillType === 2 || fillType === 3) ? await picture(all[0x0186]) : null;
    const lined = boolProp(all, 0x01ff, 0x8, 0x80000, !ph && kind !== 202 && kind !== 75);
    const outline = lined ? { line: colorRef(all[0x01c0] ?? 0x08000001, scheme) || '#000000', lineW: Math.max(1, Math.round(emu(all[0x01cb] ?? 9525))) } : {};

    // Lines and connectors.
    if (kind === 20 || kind === 32 || (kind >= 33 && kind <= 40)) {
      if (!outline.line) return;
      const end = all[0x01d1], start = all[0x01d0];
      add({ type: 'line', ...box, rot: undefined, ...outline, arrow: start && end ? 'both' : end ? 'end' : start ? 'start' : undefined, flip, link });
      spids.set(spid, made);
      return;
    }

    // Pictures.
    const pib = all[0x0104];
    if (kind === 75 || (pib && !sp.kid(RT.ClientTextbox))) {
      const src = await picture(pib);
      if (src) {
        const crop = [0x0102, 0x0100, 0x0103, 0x0101].map(id => ((all[id] | 0) / 65536)).map(v => Math.round(Math.max(0, v) * 10000) / 10000);
        add({ type: 'image', src, ...box, crop: crop.some(Boolean) ? [crop[0], crop[1], crop[2], crop[3]] : undefined, link });
      } else if (pib) {
        add({ type: 'text', ...box, text: 'Picture', size: 28, align: 'center', valign: 'middle', color: '#6b6b6b', fill: 'rgba(127, 127, 127, 0.12)', radius: 0, line: '#9a9a9a', lineW: 2 });
      }
      spids.set(spid, made);
      return;
    }
    if (flags & 0x10) {   // OLE object: tables, charts
      warnings.add('Tables, charts and embedded objects come in as labelled boxes. Rebuild them in Waypoint or paste a picture of them.');
      add({ type: 'text', ...box, text: 'Chart or object', size: 32, align: 'center', valign: 'middle', color: '#6b6b6b', fill: 'rgba(127, 127, 127, 0.12)', radius: 0, line: '#9a9a9a', lineW: 2 });
      return;
    }

    // Text: in the shape, or a reference to the slide's outline text.
    const tb = sp.kid(RT.ClientTextbox);
    let t = null;
    if (tb) {
      const texts = [];
      for (const r of tb.kids) {
        if (r.type === RT.OutlineTextRef) { const ot = ctx.outline?.[r.u32(0)]; if (ot) texts.push(ot); }
        else textRecord(texts, r);
      }
      t = texts.find(x => x.text) || null;
    }
    const rich = t && richText(t, ctx, phType);

    const geom = SHAPES[kind];
    const radius = kind === 2 ? Math.round(Math.min(box.w, box.h) * ((all[0x0147] ?? 3600) / 21600)) : 0;
    const plainBox = kind === 1 || kind === 2 || kind === 202 || kind === 0 && !all[0x0145];
    if (fillPic) add({ type: 'image', src: fillPic, ...box, link });
    else if ((fill || outline.line) && (!rich || !plainBox)) {
      if (kind === 0 && all[0x0145]) warnings.add('Freeform shapes came in as rectangles.');
      add({ type: kind === 3 ? 'ellipse' : 'rect', ...box, fill: fill || 'transparent', ...outline, geom, flip: geom ? flip : undefined, radius: radius || undefined, link });
    }
    if (rich) {
      const inset = [0x0082, 0x0083, 0x0084, 0x0081].map((id, i) => Math.round(emu(all[id] ?? (i % 2 ? 91440 : 45720))));
      const anchor = all[0x0087];
      const isTitle = [0, 6].includes(t.type) || phType === 13 || phType === 15 || phType === 17;
      const first = rich.first || {};
      add({
        type: 'text', ...box, text: rich.plain, rich: rich.paras,
        size: first.size || rich.paras[0]?.size || 32, bold: first.b || undefined, italic: first.i || undefined, underline: first.u || undefined,
        color: first.color || undefined, font: first.font || undefined, align: first.align || undefined,
        valign: anchor === undefined ? (isTitle || t.type === 5 ? 'middle' : 'top') : [0, 3, 6, 8].includes(anchor) ? 'top' : [1, 4].includes(anchor) ? 'middle' : 'bottom',
        lh: rich.lh, pad: inset, radius: plainBox ? radius : 0,
        ...(plainBox && !fillPic && (fill || outline.line) ? { fill, ...outline } : {}),
        link,
      });
    }
    spids.set(spid, made);
  }

  // Text + its style runs, on top of the master's style for that kind of text.
  function richText(t, ctx, phType) {
    const text = t.text.replace(/\r$/, '');
    if (!text.trim()) return null;
    const runs = t.styleRec ? readStyleRuns(t.styleRec, t.text.length) : { paras: [], chars: [] };
    const master = ctx.masterStyles?.[t.type] || docStyles[t.type] || ctx.masterStyles?.[{ 5: 1, 6: 0, 7: 1, 8: 1 }[t.type]] || docStyles[4] || [];
    const isBody = [1, 5, 7, 8].includes(t.type);
    const scheme = ctx.scheme;
    const defaultSize = [0, 6].includes(t.type) ? 44 : isBody ? 32 : t.type === 2 ? 12 : 18;
    // Split by character ranges.
    const charAt = [];
    { let pos = 0; for (const c of runs.chars) { for (let i = 0; i < (c.count || text.length + 1); i++) charAt[pos + i] = c; pos += c.count || text.length + 1; } }
    const paraAt = [];
    { let pos = 0; for (const p of runs.paras) { for (let i = 0; i < (p.count || text.length + 1); i++) paraAt[pos + i] = p; pos += p.count || text.length + 1; } }
    const paras = [], plain = [];
    let first = null, start = 0, lh = null;
    const counters = [];
    for (const line of text.split('\r')) {
      const pr = paraAt[start] || { level: 0 };
      const level = Math.min(4, pr.level || 0);
      const ms = master[level] || master[0] || { pf: {}, cf: {} };
      const pf = { ...ms.pf, ...pr };
      const out = [];
      let i = 0;
      while (i < line.length) {
        const c = charAt[start + i] || {};
        let j = i + 1;
        while (j < line.length && (charAt[start + j] || {}) === c) j++;
        const cf = { ...ms.cf, ...c };
        const run = { t: line.slice(i, j).replace(/\v/g, '\n') };
        if (cf.b) run.b = true;
        if (cf.i) run.i = true;
        if (cf.u) run.u = true;
        const color = cfColor(cf.color, scheme) || (([0, 6].includes(t.type) ? scheme?.[3] : scheme?.[1]));
        if (color) run.color = color;
        const font = cf.fontRef !== undefined ? fonts[cf.fontRef] : undefined;
        if (font) run.font = font;
        run.size = Math.round(cf.size ? cf.size * 8 * k : defaultSize * 8 * k);
        out.push(run);
        i = j;
      }
      if (!out.length) out.push({ t: '', size: Math.round(((master[level]?.cf.size) || defaultSize) * 8 * k) });
      counters.length = level + 1;
      counters[level] = (counters[level] || 0) + 1;
      const bulletOn = pf.bullet ?? (isBody && phType !== null);
      const ch = pf.bulletChar && pf.bulletChar.charCodeAt(0) >= 0x20 && !/[-§Øü]/.test(pf.bulletChar) ? pf.bulletChar : '•';
      const bullet = bulletOn && line.trim() ? ch : null;
      const align = pf.align || ([0, 6].includes(t.type) ? 'center' : t.type === 5 ? 'center' : undefined);
      if (lh === null) lh = pf.lineSpacing > 0 ? Math.max(0.7, (pf.lineSpacing / 100) * 1.2) : 1.2;
      const para = { lvl: level || undefined, align, size: out[0].size, before: pf.before > 0 ? Math.round((pf.before / 100) * out[0].size * 0.2) : undefined, runs: out };
      if (bullet) para.bullet = bullet;
      paras.push(clean(para));
      plain.push(`${'  '.repeat(level)}${bullet ? `${bullet} ` : ''}${line.replace(/\v/g, ' ')}`);
      if (!first && line.trim()) first = { ...out[0], align };
      start += line.length + 1;
    }
    return { paras, plain: plain.join('\n'), first, lh: Math.round(lh * 100) / 100 };
  }

  async function backgroundOf(p, scheme) {
    if (!p) return {};
    const filled = boolProp(p, 0x01bf, 0x10, 0x100000, true);
    if (!filled) return {};
    const type = p[0x0180] || 0;
    if (type === 2 || type === 3) { const id = await picture(p[0x0186]); if (id) return { bgImg: id }; }
    const c = colorRef(p[0x0181] ?? 0x08000000, scheme);
    if (type >= 4 && type <= 7) return { bg: `linear-gradient(180deg, ${c}, ${colorRef(p[0x0183] ?? 0x00ffffff, scheme) || '#ffffff'})` };
    return c ? { bg: c } : {};
  }

  /* --- masters --- */
  const masters = new Map();
  async function masterFor(id) {
    if (masters.has(id)) return masters.get(id);
    const entry = masterById.get(id);
    const rec = entry && at(entry.ref);
    if (!rec) { masters.set(id, null); return null; }
    const styles = {};
    for (const ms of rec.all(RT.TxMasterStyle)) styles[ms.inst] = readMasterStyle(ms);
    const scheme = schemeOf(rec);
    const sa = rec.kid(RT.SlideAtom);
    const parent = rec.type === RT.Slide && sa ? await masterFor(sa.u32(12)) : null;   // title masters follow a main master
    const ctx = { master: true, scheme: scheme || parent?.scheme, masterStyles: { ...parent?.styles, ...styles }, outline: entry.texts };
    const d = await drawing(rec, ctx);
    const m = { rec, styles: ctx.masterStyles, scheme: ctx.scheme, els: d.els, background: d.background };
    masters.set(id, m);
    return m;
  }

  /* --- notes --- */
  const notesBySlide = new Map();
  for (const n of lists[2]) {
    const rec = at(n.ref);
    if (!rec || rec.type !== RT.Notes) continue;
    const slideId = rec.kid(RT.NotesAtom)?.u32(0);
    const texts = [];
    const walk = r => { for (const c of r.kids) { if (c.type === RT.ClientTextbox) { for (const x of c.kids) { if (x.type === RT.OutlineTextRef) { const ot = n.texts[x.u32(0)]; if (ot) texts.push(ot); } else textRecord(texts, x); } } else if (c.ver === 0xf) walk(c); } };
    walk(rec);
    const body = texts.filter(x => x.type === 2 && x.text.trim());
    if (slideId !== undefined) notesBySlide.set(slideId, (body.length ? body : n.texts.filter(x => x.type === 2)).map(x => x.text.replace(/\r/g, '\n').replace(/\v/g, '\n').trim()).join('\n').trim());
  }

  /* --- slides --- */
  const slides = [];
  let hidden = 0;
  for (const entry of lists[0]) {
    const rec = at(entry.ref);
    if (!rec || rec.type !== RT.Slide) continue;
    const sa = rec.kid(RT.SlideAtom);
    const flags = sa ? sa.u16(20) : 7;
    const master = sa ? await masterFor(sa.u32(12)) : null;
    const ssi = rec.kid(RT.SlideShowSlideInfo);
    if (ssi && ssi.u16(10) & 0x4) { hidden++; continue; }
    const scheme = (!(flags & 2) && schemeOf(rec)) || master?.scheme || schemeOf(rec);
    const ctx = { scheme, masterStyles: master?.styles, outline: entry.texts };
    const d = await drawing(rec, ctx);
    const els = [];
    if (master && flags & 1) els.push(...master.els.map(e => ({ ...e, id: uid() })));
    els.push(...d.els);

    const bgSrc = flags & 4 ? master?.background : d.background || master?.background;
    const bg = await backgroundOf(bgSrc, flags & 4 ? master?.scheme || scheme : scheme);

    // Transition.
    let trans;
    if (ssi) {
      const effect = ssi.u8(9), speed = ssi.u8(12);
      const fx = { 0: null, 1: 'fade', 2: 'wipe', 3: 'wipe', 4: 'cover', 5: 'fade', 6: 'fade', 7: 'cover', 8: 'wipe', 9: 'wipe', 10: 'wipe', 11: 'zoom', 13: 'wipe', 17: 'zoom', 18: 'zoom', 19: 'wipe', 20: 'push', 21: 'wipe', 22: 'zoom', 23: 'fade', 26: 'wipe', 27: 'zoom' }[effect];
      if (fx) trans = { fx, dur: [1, 0.7, 0.4][speed] ?? 0.7 };
    }

    // Builds (the 97-2003 kind): AnimationInfo on each shape.
    const builds = [];
    const scan = r => { for (const c of r.kids) { if (c.type === RT.SpContainer) { const fsp = c.kid(RT.FSP); const ai = c.kid(RT.ClientData)?.kid(RT.AnimationInfo)?.kid(RT.AnimationInfoAtom) || c.kid(RT.ClientData)?.find(0x0ff1); if (fsp && ai && ai.len >= 28) builds.push({ spid: fsp.u32(0), order: ai.u16(14), flags: ai.u16(4), effect: ai.u8(19), dir: ai.u8(20) }); } else if (c.ver === 0xf) scan(c); } };
    scan(rec.kid(RT.Drawing) || { kids: [] });
    builds.sort((a, b) => a.order - b.order);
    let step = 0;
    for (const b of builds) {
      if (!(b.flags & 0x4)) step++;
      const fx = { 0: 'appear', 1: 'fade', 2: 'wipe', 3: 'wipe', 5: 'fade', 10: 'wipe', 11: 'zoom', 12: b.dir === 0 ? 'fly-left' : b.dir === 2 ? 'fly-right' : b.dir === 3 ? 'fly-up' : b.dir === 1 ? 'drop' : 'fly-left', 13: 'wipe', 27: 'zoom' }[b.effect] || 'fade';
      for (const e of els) if ((d.spids.get(b.spid) || []).includes(e.id)) e.anim = { fx, step, dur: 0.5 };
    }

    slides.push(clean({ id: uid(), bg: bg.bg || '', notes: notesBySlide.get(entry.id) || '', next: [], els, bgImg: bg.bgImg, trans }));
    slides[slides.length - 1].bg = bg.bg || '';
  }
  if (!slides.length) throw new Error(hidden ? 'Every slide in this presentation is hidden.' : 'This presentation has no slides that can be read.');
  if (hidden) warnings.add(`${hidden} hidden slide${hidden > 1 ? 's were' : ' was'} left out.`);
  if (sw / sh < 1.6) warnings.add(`This deck is ${sw / sh < 1.4 ? '4:3' : 'narrower than 16:9'}. Its slides sit in the middle of the 16:9 frame.`);
  return { deck: { v: 1, title: fileName.replace(/\.[^.]+$/, ''), theme: dark(slides[0].bg || '#ffffff') ? 'ink' : 'signal', assets, slides }, warnings: [...warnings] };
}

function withAlpha(hexColor, a) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hexColor.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
}
// Scans for a record type at the top level of the stream (for files without a usable Current User).
function scanTop(doc, type, last) {
  let found = null;
  for (let o = 0; o + 8 <= doc.length;) {
    const r = new Rec(doc, o);
    if (r.type === type) { found = o; if (!last) return o; }
    if (r.len < 0 || r.end <= o) break;
    o = r.end;
  }
  return found;
}
const findFirst = (doc, type) => scanTop(doc, type, false);
const findLast = (doc, type) => scanTop(doc, type, true);
