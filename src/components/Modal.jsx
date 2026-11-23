import { useEffect, useRef } from 'react';

// A modal <dialog> that closes on Escape or a click on the backdrop.
export default function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog
      ref={ref} className={`modal${wide ? ' wide' : ''}`}
      onCancel={e => { e.preventDefault(); onClose(); }}
      onMouseDown={e => { if (e.target === ref.current) onClose(); }}
      onKeyDown={e => e.stopPropagation()}
    >
      <header><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header>
      {children}
    </dialog>
  );
}
