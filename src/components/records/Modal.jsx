import { useEffect, useRef } from 'react';
import { overlay, modal } from './ui.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * An accessible dialog. Focus moves into it when it opens, Tab stays inside it, and focus returns
 * to what opened it when it closes. Escape or a click on the backdrop closes it, unless it is not
 * `dismissible` (for example while a save is in flight).
 */
export default function Modal({ title, onClose, dismissible = true, children, maxWidth }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    const first = dialogRef.current?.querySelector(FOCUSABLE);
    (first ?? dialogRef.current)?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (dismissible) onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) ?? [])];
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const outside = !dialogRef.current.contains(document.activeElement);
      if (event.shiftKey && (outside || document.activeElement === firstItem)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (outside || document.activeElement === lastItem)) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, dismissible]);

  return (
    <div style={overlay} onMouseDown={(event) => event.target === event.currentTarget && dismissible && onClose?.()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={{ ...modal, ...(maxWidth ? { maxWidth } : {}), outline: 'none' }}>
        <h2 style={{ fontFamily: 'Lora, serif', fontSize: 20, color: 'var(--u-navy)', margin: '0 0 16px' }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
