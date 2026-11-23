import { useEffect, useRef, useState } from 'react';
import { listen, loadDeck, send } from '../lib/store.js';
import Show from './Show.jsx';

// The audience window (`?audience&at=N`), opened by Present on another monitor or in
// a window of its own. It runs the show; the controller in the editor window steers it.
export default function Audience({ initial, start }) {
  const [deck, setDeck] = useState(initial);
  const at = useRef(start);

  useEffect(() => {
    document.title = `${initial.title} · Waypoint`;
    const stop = listen(async m => {
      if (m.type === 'end') window.close();
      else if (m.type === 'deck') { const fresh = await loadDeck(); if (fresh) setDeck(fresh); }
    });
    // However this window goes away, tell the controller where the show stopped.
    const bye = () => send({ type: 'ended', i: at.current });
    addEventListener('pagehide', bye);
    return () => { stop(); removeEventListener('pagehide', bye); };
  }, []);

  return (
    <Show
      deck={deck} start={start} fullscreen audience
      onMove={i => { at.current = i; }}
      onExit={i => { at.current = i; send({ type: 'ended', i }); window.close(); }}
    />
  );
}
