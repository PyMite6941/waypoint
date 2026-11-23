// Slide transitions, played with the Web Animations API on two stacked layers:
// `from` (the slide leaving, underneath) and `to` (the slide arriving, on top).
// `dir` is 1 going forward and -1 going back, so Push and Cover move the right way.
// Resolves when the transition has finished (or was cut short).

const ease = 'cubic-bezier(.4, 0, .2, 1)';

function frames(fx, dir) {
  const pct = n => `${n * dir}%`;
  switch (fx) {
    case 'fade': return { to: [{ opacity: 0 }, { opacity: 1 }] };
    case 'push': return { from: [{ translate: '0 0' }, { translate: `${pct(-100)} 0` }], to: [{ translate: `${pct(100)} 0` }, { translate: '0 0' }] };
    case 'cover': return { to: [{ translate: `${pct(100)} 0` }, { translate: '0 0' }], from: [{ filter: 'brightness(1)' }, { filter: 'brightness(.6)' }] };
    case 'wipe': return { to: dir > 0 ? [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }] : [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }] };
    case 'zoom': return { from: [{ scale: 1, opacity: 1 }, { scale: 1.25, opacity: 0 }], to: [{ scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1 }] };
    case 'flip': return {
      from: [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${-180 * dir}deg)` }],
      to: [{ transform: `rotateY(${180 * dir}deg)` }, { transform: 'rotateY(0deg)' }],
    };
    case 'cube': return {
      from: [{ transformOrigin: dir > 0 ? '100% 50%' : '0% 50%', transform: 'translateX(0) rotateY(0deg)' }, { transformOrigin: dir > 0 ? '100% 50%' : '0% 50%', transform: `translateX(${pct(-100)}) rotateY(${-90 * dir}deg)` }],
      to: [{ transformOrigin: dir > 0 ? '0% 50%' : '100% 50%', transform: `translateX(${pct(100)}) rotateY(${90 * dir}deg)` }, { transformOrigin: dir > 0 ? '0% 50%' : '100% 50%', transform: 'translateX(0) rotateY(0deg)' }],
    };
    default: return null;
  }
}

// Which object on the old slide each object on the new one came from: same id
// (duplicated in place), otherwise the same text, picture or shape.
function pairs(a, b) {
  const used = new Set(), out = new Map();
  const same = (x, y) => x.type === y.type && (
    x.type === 'text' ? x.text.trim() === y.text.trim()
      : x.type === 'image' ? x.src === y.src
        : (x.fill || '') === (y.fill || '') && (x.geom || '') === (y.geom || ''));
  for (const pass of [(x, y) => x.id === y.id, same]) {
    for (const y of b.els) {
      if (out.has(y.id)) continue;
      const x = a.els.find(o => !used.has(o.id) && pass(o, y));
      if (x) { used.add(x.id); out.set(y.id, x); }
    }
  }
  return out;
}

// Morph (Keynote's Magic Move): objects on both slides glide from where they were to
// where they are now; everything else fades.
function morph(from, to, a, b, dur) {
  const opts = { duration: dur, easing: ease, fill: 'both' };
  const found = pairs(a, b);
  const runs = [to.querySelector('.bgl').animate([{ opacity: 0 }, { opacity: 1 }], opts)];
  for (const node of from.querySelectorAll('[data-id]')) if ([...found.values()].some(x => x.id === node.dataset.id)) node.style.visibility = 'hidden';
  for (const node of to.querySelectorAll('.el[data-id]')) {
    const y = b.els.find(e => e.id === node.dataset.id), x = y && found.get(y.id);
    if (!x) { runs.push(node.animate([{ opacity: 0 }, { opacity: 1 }], { ...opts, delay: dur * 0.35, duration: dur * 0.65 })); continue; }
    // Scaling happens about the centre, so move centre to centre.
    const dx = x.x + x.w / 2 - (y.x + y.w / 2), dy = x.y + x.h / 2 - (y.y + y.h / 2);
    const sx = x.w / (y.w || 1), sy = x.h / (y.h || 1);
    const keep = y.type === 'text' ? Math.sqrt(sx * sy) : null;   // text keeps its proportions while it moves
    runs.push(node.animate([
      { translate: `${dx}px ${dy}px`, scale: keep ? `${keep}` : `${sx} ${sy}`, rotate: `${(x.rot || 0) - (y.rot || 0)}deg`, opacity: x.opacity ?? 1 },
      { translate: '0 0', scale: '1', rotate: '0deg', opacity: y.opacity ?? 1 },
    ], opts));
  }
  return runs;
}

export function playTransition({ fx, dur = 0.6, dir = 1, from, to, a, b }) {
  if (!from || !to || !fx || fx === 'none') return Promise.resolve();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ms = Math.max(50, dur * 1000);
  let runs;
  if (reduced) runs = [to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'both' })];
  else if (fx === 'morph') runs = morph(from, to, a, b, ms);
  else {
    const f = frames(fx, dir) || frames('fade', dir);
    const half = fx === 'flip';
    runs = [
      f.from && from.animate(f.from, { duration: half ? ms / 2 : ms, easing: half ? 'ease-in' : ease, fill: 'both' }),
      f.to && to.animate(f.to, { duration: half ? ms / 2 : ms, delay: half ? ms / 2 : 0, easing: half ? 'ease-out' : ease, fill: 'both' }),
    ].filter(Boolean);
  }
  return Promise.all(runs.map(r => r.finished.catch(() => {}))).then(() => runs.forEach(r => r.cancel()));
}
