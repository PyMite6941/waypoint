import { useEffect, useState } from 'react';
import { ACTIONS, actionOf, clickerSettings, keyId, keyLabel, saveClicker } from '../lib/clicker.js';
import Modal from './Modal.jsx';

// Clicker setup: press the clicker's buttons and see what each one does in a show. A button
// Waypoint does not know yet can be taught here; the choice is kept on this device.
export default function ClickerDialog({ onClose }) {
  const [cfg, setCfg] = useState(clickerSettings);
  const [presses, setPresses] = useState([]);   // newest first: { id, at }
  const update = c => { setCfg(c); saveClicker(c); };

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape' && !e.repeat && !presses.length) return;   // let Esc close the dialog
      if (e.key === 'Tab' || e.repeat) return;
      e.preventDefault();
      const id = keyId(e);
      setPresses(p => [{ id, at: performance.now() }, ...p.filter(x => x.id !== id)].slice(0, 6));
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [presses.length]);

  const teach = (id, act) => {
    const learned = Object.fromEntries(Object.entries(cfg.learned || {}).map(([a, ids]) => [a, ids.filter(x => x !== id)]));
    if (act) learned[act] = [...(learned[act] || []), id];
    update({ ...cfg, learned });
  };
  const taught = id => Object.values(cfg.learned || {}).some(ids => ids.includes(id));
  const doesNow = id => actionOf({ key: id.startsWith('code:') ? 'Unidentified' : id, code: id.slice(5) }, cfg);
  const desktop = !!window.desktop;

  return (
    <Modal title="Clicker setup" onClose={onClose}>
      <div className="form clicker">
        <p>
          Plug in the clicker&apos;s USB receiver (or pair it over Bluetooth). There is nothing to install: clickers type
          like a keyboard, and Waypoint already knows the usual buttons: <b>Page Down</b> / <b>→</b> next,
          <b> Page Up</b> / <b>←</b> previous, <b>B</b> or <b>.</b> black screen. The start-show button (F5 or Esc) is caught
          so it never reloads the page.
        </p>
        <div className="clickerTest" aria-live="polite">
          {!presses.length && <p className="dim">Press each button on your clicker now…</p>}
          {presses.map(({ id, at }) => {
            const act = doesNow(id);
            return (
              <div key={`${id}${at}`} className="clickerKey">
                <kbd>{keyLabel(id)}</kbd>
                <span className={act ? 'ok' : 'dim'}>{act ? ACTIONS[act] : 'Not used in a show'}</span>
                <span className="grow" />
                <span className="toggles" role="group" aria-label={`Use ${keyLabel(id)} for`}>
                  {['next', 'prev', 'black'].map(a => (
                    <button key={a} className={act === a ? 'on' : undefined} onMouseDown={e => e.preventDefault()} onClick={() => teach(id, a)} title={`Use for ${ACTIONS[a]}`} style={{ width: 'auto', padding: '3px 8px' }}>{ACTIONS[a]}</button>
                  ))}
                </span>
                {taught(id) && <button className="link" onClick={() => teach(id, null)}>Forget</button>}
              </div>
            );
          })}
        </div>
        {desktop ? (
          <label className="check">
            <input type="checkbox" checked={cfg.background !== false} onChange={e => update({ ...cfg, background: e.target.checked })} />
            Keep the clicker working while another app is in front. Page Up / Down go to the slides until the show ends.
          </label>
        ) : (
          <p className="hint">
            In a browser the clicker reaches whichever Waypoint window is in front: the slides or the controller, both work.
            If you click into another app mid-talk, click back on a Waypoint window first. That click never changes the slide.
            The desktop app keeps the clicker working even while another app is in front.
          </p>
        )}
      </div>
      <footer>
        <button className="link" onClick={() => { update({ learned: {}, background: true }); setPresses([]); }}>Reset to defaults</button>
        <span className="grow" />
        <button className="primary" onClick={onClose}>Done</button>
      </footer>
    </Modal>
  );
}
