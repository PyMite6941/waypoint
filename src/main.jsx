import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Audience from './components/Audience.jsx';
import { demoDeck } from './lib/deck.js';
import { loadDeck } from './lib/store.js';
import { enableOffline } from './lib/offline.js';
import './style.css';

// The same page is the editor, or with ?audience the slides window that Present opens.
const query = new URLSearchParams(location.search);

loadDeck().then(saved => {
  const initial = saved || demoDeck();
  const view = query.has('audience') ? <Audience initial={initial} start={+query.get('at') || 0} /> : <App initial={initial} />;
  createRoot(document.getElementById('root')).render(<StrictMode>{view}</StrictMode>);
});

enableOffline();
