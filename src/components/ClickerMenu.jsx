import { useEffect, useRef, useState } from 'react';
import { chooseDevice, chosenDevice, deviceSource, findDevice, findIn, lastDevices, listDevices, onChosenChange, openBluetoothSettings, watchChosen } from '../lib/clickerDevices.js';

// The toolbar's Clicker menu: pick the Bluetooth clicker you present with, see whether it is
// connected, pair one, or teach Waypoint its keys.
export default function ClickerMenu({ onSetup }) {
  const menu = useRef(null);
  const [list, setList] = useState(lastDevices);   // undefined: looking; null: cannot list
  const [looking, setLooking] = useState(false);
  const [chosen, setChosen] = useState(chosenDevice);
  const [connected, setConnected] = useState(null);
  const [error, setError] = useState('');
  const source = deviceSource();

  useEffect(() => onChosenChange(() => setChosen(chosenDevice())), []);
  useEffect(() => watchChosen(setConnected), []);   // once, then whenever the menu is opened

  async function refresh() {
    setError('');
    setList(lastDevices());   // the last list at once; the fresh one replaces it
    setLooking(true);
    try {
      const found = await listDevices({ fresh: true });
      setList(found);
      if (chosenDevice()) setConnected(found ? Boolean(findIn(found, chosenDevice())?.connected) : null);
    } catch (err) { setList(null); setError(err.message); }
    finally { setLooking(false); }
  }
  async function find() {
    setError('');
    try {
      const id = await findDevice();
      const found = await listDevices();
      setList(found);
      const d = found?.find(x => x.id === id);
      if (d) chooseDevice(d);
    } catch (err) { if (err?.name !== 'NotFoundError') setError(err.message); }
  }
  const pick = d => { chooseDevice(d); menu.current?.removeAttribute('open'); };

  const clickers = list?.filter(d => d.input) || [];
  const others = list?.filter(d => !d.input) || [];
  const mark = d => (findIn([d], chosen) ? '✓' : '');
  const item = d => (
    <button key={d.id} role="menuitemradio" aria-checked={Boolean(findIn([d], chosen))} onClick={() => pick(d)}>
      <span className="ck">{mark(d)}</span>
      <span className="nm">{d.name}</span>
      <span className={`dot ${d.connected ? 'on' : ''}`} title={d.connected ? 'Connected' : 'Not connected'} />
    </button>
  );
  const status = !chosen ? null : connected === true ? 'on' : connected === false ? 'off' : 'unknown';

  return (
    <details className="menu clickerMenu" ref={menu} onToggle={e => e.currentTarget.open && refresh()}>
      <summary title={chosen ? `Clicker: ${chosen.name}${status === 'on' ? ', connected' : status === 'off' ? ', not connected' : ''}` : 'Choose your clicker'}>
        Clicker{status && <span className={`dot ${status}`} />}
      </summary>
      <div role="menu">
        <p className="menuHead">{chosen ? <>Using <b>{chosen.name}</b>{status === 'on' ? ' · connected' : status === 'off' ? ' · not connected' : ''}</> : 'Using any keyboard or clicker'}</p>
        <button role="menuitemradio" aria-checked={!chosen} onClick={() => pick(null)}>
          <span className="ck">{chosen ? '' : '✓'}</span><span className="nm">Any keyboard or clicker</span>
        </button>
        <hr />
        {list === undefined && <p className="menuNote">Looking for Bluetooth devices…</p>}
        {list === null && source && <p className="menuNote">Could not read the list of devices.{error && ` ${error}`}</p>}
        {list === null && !source && (
          <p className="menuNote">This browser cannot list Bluetooth devices. Your clicker still works: its keys go straight to the show. Chrome, Edge and the desktop app can list it here.</p>
        )}
        {list && clickers.length === 0 && (
          <p className="menuNote">
            No clickers found.{' '}
            {source === 'desktop'
              ? 'Turn your clicker on and pair it in Bluetooth settings, then it will appear here.'
              : 'Turn your clicker on and pair it with this computer, then choose Find a clicker to allow it.'}
          </p>
        )}
        {clickers.length > 0 && <p className="menuLabel">Clickers</p>}
        {clickers.map(item)}
        {others.length > 0 && <p className="menuLabel">Other paired devices</p>}
        {others.map(item)}
        {chosen && list && !findIn(list, chosen) && (
          <button role="menuitemradio" aria-checked onClick={() => pick(chosen)}>
            <span className="ck">✓</span><span className="nm">{chosen.name}</span><span className="dim">not found</span>
          </button>
        )}
        {error && list !== null && <p className="menuNote error">{error}</p>}
        <hr />
        {source === 'hid' && <button onClick={find}>Find a clicker…</button>}
        {source === 'desktop' && <button onClick={openBluetoothSettings}>Bluetooth settings…</button>}
        {source && <button onClick={refresh} disabled={looking}>{looking && list ? 'Checking…' : 'Refresh'}</button>}
        <button onClick={() => { menu.current?.removeAttribute('open'); onSetup(); }}>Teach clicker keys…</button>
      </div>
    </details>
  );
}

/** A small "Clicker: name ●" status for the presenter view, with a warning when it drops out. */
export function ClickerStatus() {
  const [chosen, setChosen] = useState(chosenDevice);
  const [connected, setConnected] = useState(null);
  useEffect(() => onChosenChange(() => setChosen(chosenDevice())), []);
  useEffect(() => watchChosen(setConnected, 20000), []);   // keep an eye on it during the talk
  if (!chosen) return null;
  return (
    <span className={`pvClicker${connected === false ? ' warn' : ''}`} role={connected === false ? 'alert' : undefined}
      title={connected === false ? 'Turn the clicker on, or use the arrow keys' : 'Your clicker'}>
      <span className={`dot ${connected === true ? 'on' : connected === false ? 'off' : 'unknown'}`} />
      {connected === false ? `${chosen.name} is not connected` : chosen.name}
    </span>
  );
}
