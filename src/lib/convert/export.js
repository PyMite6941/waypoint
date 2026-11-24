// Waypoint decks out to other formats.
//   PowerPoint (.pptx): opens in PowerPoint, Keynote and Google Slides (File, Import slides,
//     or upload to Drive). Keeps layout, colours, fonts, notes, links, transitions and builds.
//   Pictures (.zip of PNGs): every slide exactly as it looks, at 1920 x 1080.
// PDF is done by printing (see App), the Waypoint format by files.js.
import { animOf, isCustom } from '../anims.js';
import { BUILDS, THEME_COLORS, buildSteps } from '../deck.js';
import { actsOf } from '../effects.js';

const IN = 120;                        // slide units per inch: 1600 units = 13.333 in (16:9 widescreen)
const inch = v => +(v / IN).toFixed(4);
const pts = v => +(v * 72 / IN).toFixed(2);

// CSS colour -> { color: 'RRGGBB', transparency: 0-100 }, or null for "none".
function rgbOf(css, theme) {
  if (!css || css === 'transparent' || css === 'none') return null;
  if (css.startsWith('var(')) return rgbOf(theme[/--(\w+)/.exec(css)?.[1]] || theme.fg, theme);
  let m = /#([0-9a-f]{3,8})\b/i.exec(css);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map(c => c + c).join('');
    return { color: h.slice(0, 6).toUpperCase(), transparency: h.length === 8 ? Math.round((1 - parseInt(h.slice(6), 16) / 255) * 100) : 0 };
  }
  m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i.exec(css);
  if (m) return { color: [m[1], m[2], m[3]].map(v => Math.round(+v).toString(16).padStart(2, '0')).join('').toUpperCase(), transparency: m[4] ? Math.round((1 - +m[4]) * 100) : 0 };
  return null;
}
const fillOpt = (css, theme) => { const c = rgbOf(css, theme); return c ? { color: c.color, transparency: c.transparency || undefined } : undefined; };

// Pictures PowerPoint can take: PNG, JPEG, GIF. Anything else (WebP, SVG) is redrawn as PNG; crops are applied here.
function picture(src, crop) {
  const ok = /^data:image\/(png|jpeg|gif)/.test(src);
  if (ok && !crop?.some(Boolean)) return Promise.resolve(src);
  return new Promise(resolve => {
    const img = new Image();
    img.onerror = () => resolve(src);
    img.onload = () => {
      const [l, t, r, b] = crop || [0, 0, 0, 0];
      const w = img.naturalWidth || 800, h = img.naturalHeight || 600;
      const sw = Math.max(1, w * (1 - l - r)), sh = Math.max(1, h * (1 - t - b));
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(sw), height: Math.round(sh) });
      canvas.getContext('2d').drawImage(img, w * l, h * t, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = src;
  });
}

// SVG path (M L C Q Z only, as the importer writes) -> pptxgenjs custom geometry points, in inches within the box.
function pathPoints(el) {
  const sx = el.w / el.path.w / IN, sy = el.h / el.path.h / IN, out = [];
  const re = /([MLCQZ])([^MLCQZ]*)/gi;
  let m;
  while ((m = re.exec(el.path.d))) {
    const n = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const p = i => ({ x: +(n[i] * sx).toFixed(4), y: +(n[i + 1] * sy).toFixed(4) });
    const cmd = m[1].toUpperCase();
    if (cmd === 'M') out.push({ ...p(0), moveTo: true });
    else if (cmd === 'L') out.push(p(0));
    else if (cmd === 'C') { const a = p(0), b = p(2); out.push({ ...p(4), curve: { type: 'cubic', x1: a.x, y1: a.y, x2: b.x, y2: b.y } }); }
    else if (cmd === 'Q') { const a = p(0); out.push({ ...p(2), curve: { type: 'quadratic', x1: a.x, y1: a.y } }); }
    else if (cmd === 'Z') out.push({ close: true });
  }
  return out;
}

// Our bullet text ("•", "–", "1.", "a)") -> a pptxgenjs bullet.
function bulletOf(b) {
  if (/^\d/.test(b)) return { type: 'number' };
  if (/^[a-z][.)]$/i.test(b)) return { type: 'number', style: /^[A-Z]/.test(b) ? 'alphaUcPeriod' : 'alphaLcPeriod' };
  const ch = [...b.trim()][0];
  return ch && ch !== '•' ? { characterCode: ch.codePointAt(0).toString(16).padStart(4, '0').toUpperCase() } : true;
}

function textRuns(el, theme, slideNum) {
  const base = {
    fontFace: el.font || theme.font, fontSize: pts(el.size || 38), bold: !!el.bold, italic: !!el.italic, underline: el.underline ? { style: 'sng' } : undefined,
    color: rgbOf(el.color || theme.fg, theme)?.color,
  };
  const link = slideNum ? { hyperlink: { slide: slideNum } } : {};
  if (el.rich?.length) {
    return el.rich.flatMap((p, pi) => {
      const runs = p.runs.length ? p.runs : [{ t: '' }];
      return runs.flatMap((r, ri) => r.t.split('\n').map((t, li, all) => ({
        text: t,
        options: {
          ...base, ...link,
          ...(r.b !== undefined && { bold: r.b }), ...(r.i !== undefined && { italic: r.i }), ...(r.u && { underline: { style: 'sng' } }),
          ...(r.color && { color: rgbOf(r.color, theme)?.color }), ...((r.size || p.size) && { fontSize: pts(r.size || p.size) }), ...(r.font && { fontFace: r.font }),
          align: p.align || el.align || 'left', indentLevel: p.lvl || 0, paraSpaceBefore: p.before ? pts(p.before) : undefined,
          bullet: ri === 0 && li === 0 && p.bullet ? bulletOf(p.bullet) : undefined,
          breakLine: li < all.length - 1 || (ri === runs.length - 1 && pi < el.rich.length - 1),
        },
      })));
    });
  }
  // Plain text: lines starting with a bullet character become real bullets.
  return el.text.split('\n').map((line, i, all) => {
    const m = /^(\s*)[•◦▪\-*]\s+(.*)$/.exec(line);
    return { text: m ? m[2] : line, options: { ...base, ...link, align: el.align || 'left', bullet: m ? { indent: 18 } : undefined, indentLevel: m ? Math.floor(m[1].length / 2) : 0, breakLine: i < all.length - 1 } };
  });
}

const XML_FX = {
  fade: 'p:fade', push: 'p:push dir="l"', cover: 'p:cover dir="l"', wipe: 'p:wipe dir="r"', zoom: 'p:zoom',
  flip: 'p14:flip dir="r"', cube: 'p14:prism isContent="1"', morph: 'p159:morph option="byObject"',
};
function transitionXml(t) {
  if (!t?.fx || t.fx === 'none') return '';
  const ms = Math.round((t.dur || 0.6) * 1000), spd = ms <= 500 ? 'fast' : ms <= 800 ? 'med' : 'slow';
  const fx = XML_FX[t.fx] || 'p:fade';
  const req = t.fx === 'morph' ? 'p159' : 'p14';
  const fallbackFx = /^p:/.test(fx) ? fx : 'p:fade';
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="${req}"><p:transition spd="${spd}" p14:dur="${ms}"><${fx}/></p:transition></mc:Choice><mc:Fallback><p:transition spd="${spd}"><${fallbackFx}/></p:transition></mc:Fallback></mc:AlternateContent>`;
}

// PowerPoint's timing tree for entrances and exits, one click group per build step.
// Custom animations go out as a fade in or out (PowerPoint has no keyframes). Emphasis, moves and
// anything started by clicking an object are left out: those objects simply show.
function timingXml(slide, idOf, deck) {
  const steps = buildSteps(slide);
  const animated = slide.els.filter(e => idOf[e.id]).flatMap(e => actsOf(deck, e)
    .filter(a => !a.on && (a.kind === 'in' || a.kind === 'out') && !(a.entrance && isCustom(a.fx) && animOf(deck, a.fx)?.kind === 'emphasis'))
    .map(a => ({ el: e, ...a, fx: a.kind === 'out' ? 'out' : BUILDS[a.fx] ? a.fx : 'fade' })));
  if (!animated.length) return '';
  let n = 3;
  const tgt = spid => `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;
  const anim = (spid, attr, from, to, dur) => `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${n++}" dur="${dur}" fill="hold"/>${tgt(spid)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
  const fade = (spid, dur) => `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${n++}" dur="${dur}"/>${tgt(spid)}</p:cBhvr></p:animEffect>`;
  function effect(a, nodeType) {
    const el = a.el, spid = idOf[el.id], fx = a.fx, dur = Math.round((fx === 'appear' ? 0.001 : a.dur || 0.5) * 1000), delay = Math.round((a.delay || 0) * 1000);
    if (fx === 'out') {
      const id = n++, body = `<p:animEffect transition="out" filter="fade"><p:cBhvr><p:cTn id="${n++}" dur="${dur}"/>${tgt(spid)}</p:cBhvr></p:animEffect>`;
      const hide = `<p:set><p:cBhvr><p:cTn id="${n++}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${Math.max(0, dur - 1)}"/></p:stCondLst></p:cTn>${tgt(spid)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="hidden"/></p:to></p:set>`;
      return `<p:par><p:cTn id="${id}" presetID="10" presetClass="exit" presetSubtype="0" fill="hold" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${body}${hide}</p:childTnLst></p:cTn></p:par>`;
    }
    const [preset, sub, body] = {
      appear: [1, 0, ''],
      'fly-left': [2, 8, anim(spid, 'ppt_x', '0-#ppt_w/2', '#ppt_x', dur) + anim(spid, 'ppt_y', '#ppt_y', '#ppt_y', dur)],
      'fly-right': [2, 2, anim(spid, 'ppt_x', '1+#ppt_w/2', '#ppt_x', dur) + anim(spid, 'ppt_y', '#ppt_y', '#ppt_y', dur)],
      'fly-up': [2, 4, anim(spid, 'ppt_x', '#ppt_x', '#ppt_x', dur) + anim(spid, 'ppt_y', '1+#ppt_h/2', '#ppt_y', dur)],
      drop: [2, 1, anim(spid, 'ppt_x', '#ppt_x', '#ppt_x', dur) + anim(spid, 'ppt_y', '0-#ppt_h/2', '#ppt_y', dur)],
      rise: [42, 0, fade(spid, dur) + anim(spid, 'ppt_y', '#ppt_y+.1', '#ppt_y', dur)],
      zoom: [53, 16, anim(spid, 'ppt_w', '0', '#ppt_w', dur) + anim(spid, 'ppt_h', '0', '#ppt_h', dur) + fade(spid, dur)],
      pop: [53, 16, anim(spid, 'ppt_w', '0', '#ppt_w', dur) + anim(spid, 'ppt_h', '0', '#ppt_h', dur) + fade(spid, dur)],
      spin: [53, 16, anim(spid, 'ppt_w', '0', '#ppt_w', dur) + anim(spid, 'ppt_h', '0', '#ppt_h', dur) + fade(spid, dur)],
      wipe: [22, 8, `<p:animEffect transition="in" filter="wipe(left)"><p:cBhvr><p:cTn id="${n++}" dur="${dur}"/>${tgt(spid)}</p:cBhvr></p:animEffect>`],
    }[fx] || [10, 0, fade(spid, dur)];
    const id = n++;
    const set = `<p:set><p:cBhvr><p:cTn id="${n++}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${tgt(spid)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
    return `<p:par><p:cTn id="${id}" presetID="${preset}" presetClass="entr" presetSubtype="${sub}" fill="hold" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${set}${body}</p:childTnLst></p:cTn></p:par>`;
  }
  let groups = '';
  for (let step = 0; step <= steps; step++) {
    const els = animated.filter(a => (a.step || 0) === step);
    if (!els.length) continue;
    const start = step === 0 ? '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' : '<p:cond delay="indefinite"/>';
    const outer = n++, inner = n++;
    const effects = els.map((e, i) => effect(e, i ? 'withEffect' : step === 0 ? 'afterEffect' : 'clickEffect')).join('');
    groups += `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst>${start}</p:stCondLst><p:childTnLst><p:par><p:cTn id="${inner}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
  }
  const slideTgt = '<p:tgtEl><p:sldTgt/></p:tgtEl>';
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${groups}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0">${slideTgt}</p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0">${slideTgt}</p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
}

export async function exportPptx(deck) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const theme = THEME_COLORS[deck.theme] || THEME_COLORS.paper;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = deck.title;
  pptx.theme = { headFontFace: theme.font, bodyFontFace: theme.font };
  const slideNum = id => { const i = deck.slides.findIndex(s => s.id === id); return i >= 0 ? i + 1 : 0; };

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    const bg = rgbOf(s.bg || theme.bg, theme) || rgbOf(theme.bg, theme);
    slide.background = s.bgImg && deck.assets[s.bgImg] ? { data: await picture(deck.assets[s.bgImg]) } : { color: bg.color };
    if (s.notes) slide.addNotes(s.notes);
    for (const el of s.els) {
      const box = { x: inch(el.x), y: inch(el.y), w: inch(Math.max(el.w, 1)), h: inch(Math.max(el.h, 1)), rotate: el.rot || undefined, objectName: el.id };
      const line = el.lineW ? { line: { ...fillOpt(el.line || theme.fg, theme), width: pts(el.lineW) } } : {};
      const link = el.link && slideNum(el.link) ? { hyperlink: { slide: slideNum(el.link) } } : {};
      const transparency = el.opacity != null && el.opacity < 1 ? Math.round((1 - el.opacity) * 100) : undefined;
      if (el.type === 'text') {
        const filled = !!el.fill;
        const pad = el.pad || (filled ? [0, 24, 0, 24] : [0, 0, 0, 0]);
        slide.addText(textRuns(el, theme, link.hyperlink?.slide), {
          ...box, ...line, margin: [pts(pad[3]), pts(pad[1]), pts(pad[2]), pts(pad[0])],
          valign: { middle: 'middle', bottom: 'bottom' }[el.valign] || (filled && !el.valign ? 'middle' : 'top'),
          fill: fillOpt(el.fill, theme), shape: filled && (el.radius ?? 10) > 0 ? 'roundRect' : undefined, rectRadius: filled ? inch(el.radius ?? 10) : undefined,
          lineSpacingMultiple: +((el.lh || 1.25) / 1.2).toFixed(2), wrap: !el.nowrap, fit: 'none', paraSpaceBefore: 0,
        });
      } else if (el.type === 'image') {
        if (!deck.assets[el.src]) continue;
        slide.addImage({ ...box, ...link, data: await picture(deck.assets[el.src], el.crop), transparency, flipH: el.flip?.includes('h'), flipV: el.flip?.includes('v') });
      } else if (el.type === 'line') {
        const arrow = el.arrow === 'end' || el.arrow === 'both' ? { endArrowType: 'triangle' } : {};
        const start = el.arrow === 'start' || el.arrow === 'both' ? { beginArrowType: 'triangle' } : {};
        slide.addShape('line', { ...box, line: { ...fillOpt(el.line || theme.fg, theme), width: pts(el.lineW || 4), ...arrow, ...start }, flipH: el.flip?.includes('h'), flipV: el.flip?.includes('v') });
      } else {
        const fill = fillOpt(el.fill || theme.accent, theme);
        const shapeFill = fill ? { fill: { ...fill, transparency: fill.transparency ?? transparency } } : { fill: { type: 'none' } };
        if (el.path) slide.addShape('custGeom', { ...box, ...shapeFill, ...line, points: pathPoints(el), flipH: el.flip?.includes('h'), flipV: el.flip?.includes('v') });
        else if (el.type === 'ellipse') slide.addShape('ellipse', { ...box, ...shapeFill, ...line, ...link });
        else if (el.geom) slide.addShape(el.geom, { ...box, ...shapeFill, ...line, ...link });
        else {
          const r = el.radius ?? 10;
          slide.addShape(r > 0 ? 'roundRect' : 'rect', { ...box, ...shapeFill, ...line, ...link, rectRadius: r > 0 ? inch(r) : undefined });
        }
      }
    }
  }

  // pptxgenjs has no transitions or animations: add them to each slide's XML.
  const bytes = await pptx.write({ outputType: 'uint8array' });
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  for (let i = 0; i < deck.slides.length; i++) {
    const path = `ppt/slides/slide${i + 1}.xml`, s = deck.slides[i];
    let xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    const idOf = {};
    for (const m of xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)) idOf[m[2]] = m[1];
    const extra = transitionXml(s.trans) + timingXml(s, idOf, deck);
    if (!extra) continue;
    xml = xml.replace('</p:clrMapOvr></p:sld>', `</p:clrMapOvr>${extra}</p:sld>`);
    zip.file(path, xml);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// Every slide as a PNG, at 1920 x 1080, in a .zip. `render(container)` must draw the deck
// into the container as .slide elements (App does this with the same SlideView the show uses).
export async function exportPictures(deck, slideNodes) {
  const [{ toPng }, { default: JSZip }] = await Promise.all([import('html-to-image'), import('jszip')]);
  const zip = new JSZip();
  await document.fonts?.ready;
  for (let i = 0; i < slideNodes.length; i++) {
    const url = await toPng(slideNodes[i], { width: 1600, height: 900, pixelRatio: 1.2, cacheBust: false, skipFonts: false });
    zip.file(`${String(i + 1).padStart(2, '0')}.png`, url.split(',')[1], { base64: true });
  }
  return zip.generateAsync({ type: 'uint8array' });
}
