import { useEffect, useId, useRef, type ReactNode } from 'react';
import { enter } from '../lib/motion';

// Native <dialog> that stays mounted while closed, so a half-typed form keeps its text when the
// dialog is dismissed and reopened. Escape and Cancel close it; only a successful submit clears a form.
export function Modal({ open, onClose, title, intro, children }: { open: boolean; onClose: () => void; title: string; intro?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); enter(d, { opacity: [0.3, 1], y: [12, 0], scale: [0.98, 1] }, { duration: 0.28 }); }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby={titleId}>
      <div className="dialog-body">
        <h2 id={titleId}>{title}</h2>
        {intro && <p className="intro">{intro}</p>}
        {children}
      </div>
    </dialog>
  );
}
