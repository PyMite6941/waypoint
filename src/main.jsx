import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Presenter from './components/Presenter.jsx';
import { demoDeck } from './lib/deck.js';
import { loadDeck } from './lib/store.js';
import { enableOffline } from './lib/offline.js';
import './style.css';

// The same page is the editor, or with ?presenter the presenter's window.
const View = location.search === '?presenter' ? Presenter : App;

loadDeck().then(saved => {
  createRoot(document.getElementById('root')).render(<StrictMode><View initial={saved || demoDeck()} /></StrictMode>);
});

enableOffline();
