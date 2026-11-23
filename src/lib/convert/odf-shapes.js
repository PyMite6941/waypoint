// OpenDocument custom shapes (draw:enhanced-geometry) to an SVG path.
//
// LibreOffice describes each preset shape (cloud, smiley, arrows, callouts...) as a path whose
// numbers can be formulas over the shape's size and its adjustment handles:
//   <draw:equation draw:name="f1" draw:formula="$0 *sin(?f0 *(pi/180))"/>
//   draw:enhanced-path="M ?f7 0 X 0 ?f8 L 0 ?f9 Y ?f7 21600 ... Z N"
// The formulas are read by a small parser here (never eval), and the path commands, including
// ODF's arcs and elliptical quadrants, become SVG path commands in viewBox units.

const FUNCS = {
  abs: Math.abs, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan,
  atan2: (y, x) => Math.atan2(y, x), min: Math.min, max: Math.max, if: (c, a, b) => (c > 0 ? a : b),
};

function tokenize(s) {
  const out = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+)|(\?f\d+|\$\d+)|([a-z][a-z0-9]*)|([-+*/(),]))/giy;
  let m;
  while ((m = re.exec(s)) && m[0]) out.push(m[1] !== undefined ? { n: parseFloat(m[1]) } : m[2] ? { ref: m[2] } : m[3] ? { id: m[3].toLowerCase() } : { op: m[4] });
  return out;
}

// The shape's equations, evaluated on demand: value('?f3'), value('$0'), value('right'), value('21600').
function geometry(eg) {
  const vb = (eg.getAttribute('svg:viewBox') || '0 0 21600 21600').split(/[\s,]+/).map(Number);
  const [l, t, vw, vh] = vb.length === 4 && vb[2] && vb[3] ? vb : [0, 0, 21600, 21600];
  const mods = (eg.getAttribute('draw:modifiers') || '').trim().split(/\s+/).filter(Boolean).map(Number);
  const eqs = {};
  for (const e of eg.childNodes) if (e.nodeType === 1 && e.localName === 'equation') eqs[e.getAttribute('draw:name')] = e.getAttribute('draw:formula') || '0';
  const vars = {
    pi: Math.PI, left: l, top: t, right: l + vw, bottom: t + vh, width: vw, height: vh, xstretch: 0, ystretch: 0,
    hasstroke: 1, hasfill: 1, logwidth: vw, logheight: vh,
  };
  const memo = {}, busy = new Set();
  const ref = r => {
    if (r[0] === '$') return mods[+r.slice(1)] ?? 0;
    const name = `f${r.slice(2)}`;
    if (name in memo) return memo[name];
    if (busy.has(name) || !(name in eqs)) return 0;
    busy.add(name);
    const v = evaluate(eqs[name]);
    busy.delete(name);
    return (memo[name] = Number.isFinite(v) ? v : 0);
  };
  function evaluate(src) {
    const tk = tokenize(src);
    let p = 0;
    const peek = () => tk[p], take = () => tk[p++];
    const expr = () => {
      let v = term();
      while (peek()?.op === '+' || peek()?.op === '-') v = take().op === '+' ? v + term() : v - term();
      return v;
    };
    const term = () => {
      let v = unary();
      while (peek()?.op === '*' || peek()?.op === '/') { const o = take().op, r = unary(); v = o === '*' ? v * r : r ? v / r : 0; }
      return v;
    };
    const unary = () => (peek()?.op === '-' ? (take(), -unary()) : peek()?.op === '+' ? (take(), unary()) : atom());
    const atom = () => {
      const x = take();
      if (!x) return 0;
      if (x.n !== undefined) return x.n;
      if (x.ref) return ref(x.ref);
      if (x.op === '(') { const v = expr(); if (peek()?.op === ')') take(); return v; }
      if (x.id) {
        if (FUNCS[x.id] && peek()?.op === '(') {
          take();
          const args = [];
          if (peek()?.op !== ')') { args.push(expr()); while (peek()?.op === ',') { take(); args.push(expr()); } }
          if (peek()?.op === ')') take();
          return FUNCS[x.id](...args);
        }
        return vars[x.id] ?? 0;
      }
      return 0;
    };
    return expr();
  }
  return { box: [l, t, vw, vh], value: tok => (/^[?$]/.test(tok) ? ref(tok) : vars[tok.toLowerCase()] ?? (parseFloat(tok) || 0)) };
}

/** The enhanced path as { d, w, h } in viewBox units, or null when there is nothing to draw. */
export function enhancedPath(eg) {
  const src = eg.getAttribute('draw:enhanced-path');
  if (!src) return null;
  const g = geometry(eg);
  const [l, t, vw, vh] = g.box;
  const toks = src.match(/[A-Za-z]|\?f\d+|\$\d+|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let i = 0, cmd = null;
  const isCmd = s => /^[A-Za-z]$/.test(s);
  const num = () => g.value(toks[i++]);
  const has = n => i + n <= toks.length && toks.slice(i, i + n).every(x => !isCmd(x));
  const r = v => Math.round(v * 100) / 100;
  const P = (x, y) => `${r(x - l)} ${r(y - t)}`;
  let d = '', cx = 0, cy = 0, sx = 0, sy = 0, quadX = true;
  const arc = (rx, ry, x, y, large, sweep) => `A${r(rx)} ${r(ry)} 0 ${large} ${sweep} ${P(x, y)}`;
  // Elliptical arc around the box (x1,y1)-(x2,y2), from the angle of (x3,y3) to that of (x4,y4).
  const boxArc = (move, clockwise) => {
    const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num(), x4 = num(), y4 = num();
    const ecx = (x1 + x2) / 2, ecy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2 || 1e-6, ry = Math.abs(y2 - y1) / 2 || 1e-6;
    const a0 = Math.atan2((y3 - ecy) / ry, (x3 - ecx) / rx), a1 = Math.atan2((y4 - ecy) / ry, (x4 - ecx) / rx);
    const p0 = [ecx + rx * Math.cos(a0), ecy + ry * Math.sin(a0)], p1 = [ecx + rx * Math.cos(a1), ecy + ry * Math.sin(a1)];
    const tau = 2 * Math.PI;
    const delta = clockwise ? (a1 - a0 + tau) % tau : (a0 - a1 + tau) % tau;
    d += `${move ? 'M' : 'L'}${P(...p0)}`;
    if (move) { sx = p0[0]; sy = p0[1]; }
    if (delta < 1e-6) {   // a full ellipse: two halves
      const mid = [2 * ecx - p0[0], 2 * ecy - p0[1]];
      d += arc(rx, ry, ...mid, 0, clockwise ? 1 : 0) + arc(rx, ry, ...p0, 0, clockwise ? 1 : 0);
      [cx, cy] = p0;
    } else { d += arc(rx, ry, ...p1, delta > Math.PI ? 1 : 0, clockwise ? 1 : 0); [cx, cy] = p1; }
  };
  while (i < toks.length) {
    if (isCmd(toks[i])) { cmd = toks[i++].toUpperCase(); if (cmd === 'X' || cmd === 'Y') quadX = cmd === 'X'; continue; }
    switch (cmd) {
      case 'M': if (!has(2)) { i++; break; } cx = num(); cy = num(); sx = cx; sy = cy; d += `M${P(cx, cy)}`; cmd = 'L'; break;
      case 'L': if (!has(2)) { i++; break; } cx = num(); cy = num(); d += `L${P(cx, cy)}`; break;
      case 'C': if (!has(6)) { i++; break; } { const a = [num(), num(), num(), num(), num(), num()]; d += `C${P(a[0], a[1])} ${P(a[2], a[3])} ${P(a[4], a[5])}`; [cx, cy] = [a[4], a[5]]; } break;
      case 'Q': if (!has(4)) { i++; break; } { const a = [num(), num(), num(), num()]; d += `Q${P(a[0], a[1])} ${P(a[2], a[3])}`; [cx, cy] = [a[2], a[3]]; } break;
      case 'A': case 'B': case 'W': case 'V': if (!has(8)) { i++; break; } boxArc(cmd === 'B' || cmd === 'V', cmd === 'W' || cmd === 'V'); break;
      case 'T': case 'U': {
        if (!has(6)) { i++; break; }
        const ecx = num(), ecy = num(), rx = Math.abs(num()) || 1e-6, ry = Math.abs(num()) || 1e-6, t0 = num(), t1 = num();
        const pt = a => [ecx + rx * Math.cos((a * Math.PI) / 180), ecy - ry * Math.sin((a * Math.PI) / 180)];
        const p0 = pt(t0);
        d += `${cmd === 'U' || !d ? 'M' : 'L'}${P(...p0)}`;
        if (cmd === 'U') { sx = p0[0]; sy = p0[1]; }
        let sweep = (((t1 - t0) % 360) + 360) % 360;
        if (sweep < 1e-6 && t1 !== t0) sweep = 360;
        if (sweep >= 359.999) { const mid = pt(t0 + 180); d += arc(rx, ry, ...mid, 0, 0) + arc(rx, ry, ...p0, 0, 0); [cx, cy] = p0; }
        else { const p1 = pt(t1); d += arc(rx, ry, ...p1, sweep > 180 ? 1 : 0, 0); [cx, cy] = p1; }
        break;
      }
      case 'X': case 'Y': {
        if (!has(2)) { i++; break; }
        const x = num(), y = num();
        const dx = Math.sign(x - cx), dy = Math.sign(y - cy);
        if (!dx || !dy) d += `L${P(x, y)}`;
        else d += arc(Math.abs(x - cx), Math.abs(y - cy), x, y, 0, (quadX ? dx * dy > 0 : dx * dy < 0) ? 1 : 0);
        cx = x; cy = y; quadX = !quadX;
        break;
      }
      case 'Z': d += 'Z'; cx = sx; cy = sy; break;
      default: i++;   // N, F, S take no numbers; G (from OOXML) is rare and skipped
    }
    if (cmd === 'Z' || cmd === 'N' || cmd === 'F' || cmd === 'S') cmd = null;
  }
  return /M/.test(d) ? { d, w: r(vw), h: r(vh) } : null;
}
