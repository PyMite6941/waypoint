// Editor state: the deck, which slide is open, what is selected, and undo history.
import { produce, setAutoFreeze } from 'immer';
import { clampIndex } from './deck.js';

// Edits copy only what they touch (structural sharing): a slide nobody changed stays the
// same object, so its thumbnail is not redrawn and the undo history shares unchanged slides
// instead of holding 100 full copies of the deck. Objects are left unfrozen because some
// code (importers, the show) builds on deck objects it is handed.
setAutoFreeze(false);

export const initState = deck => ({ deck, cur: 0, sel: null, past: [], future: [], tag: null });

// Keep `cur` and `sel` pointing at things that still exist.
function settle(s) {
  const cur = clampIndex(s.deck, s.cur);
  return { ...s, cur, sel: s.deck.slides[cur].els.some(e => e.id === s.sel) ? s.sel : null };
}

export function reducer(s, action) {
  switch (action.type) {
    // Edit the deck. `fn` receives a draft { deck, cur, sel } it may mutate freely.
    // Consecutive changes with the same `tag` (typing notes, dragging a colour) share one undo step.
    case 'change': {
      const draft = produce({ deck: s.deck, cur: s.cur, sel: s.sel }, d => { action.fn(d); });
      if (draft.deck === s.deck && draft.cur === s.cur && draft.sel === s.sel) return s;   // nothing changed
      const merge = action.tag && action.tag === s.tag;
      return settle({ ...draft, past: merge ? s.past : [...s.past.slice(-99), s.deck], future: [], tag: action.tag || null });
    }
    // Images are never undone: history swaps everything except assets.
    case 'undo': {
      if (!s.past.length) return s;
      return settle({ ...s, deck: { ...s.past.at(-1), assets: s.deck.assets }, past: s.past.slice(0, -1), future: [s.deck, ...s.future], tag: null });
    }
    case 'redo': {
      if (!s.future.length) return s;
      return settle({ ...s, deck: { ...s.future[0], assets: s.deck.assets }, past: [...s.past, s.deck], future: s.future.slice(1), tag: null });
    }
    // Look at a slide or select an element, without changing the deck.
    case 'view':
      return settle({ ...s, cur: action.cur ?? s.cur, sel: action.sel ?? null, tag: null });
    case 'load':
      return initState(action.deck);
    default:
      return s;
  }
}
