import { useSyncExternalStore, useState, useRef, useEffect, useId } from 'react';
import { getLanguage, subscribe, setLanguage, t } from '../../../Server/frontend/src/locales/core.js';
export { t, errorText, statusText, getLanguage, fieldText, recordError } from '../../../Server/frontend/src/locales/core.js';
export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage, () => 'vi');
const updateTitle = () => {
  if (!globalThis.document) return;
  document.title = t('IPCSIM Simulation');
  document.querySelector('meta[name="application-name"]')?.setAttribute('content', t('IPCSIM Simulation'));
};
updateTitle();
subscribe(updateTitle);
export function LanguageSelector() {
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    container.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return <div className="language-selector" ref={container} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" className="language-trigger" ref={trigger} aria-label={t('Language')}
      title={t('Language')} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 7h14M5 17h14" />
      </svg>
    </button>
    {open && <div id={id} className="language-menu" role="menu" aria-label={t('Language')} onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll('button'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      {['vi', 'en'].map(value => <button type="button" key={value} role="menuitemradio" aria-checked={language === value}
        onClick={() => { setLanguage(value); setOpen(false); trigger.current?.focus(); }}>
        <span>{value === 'vi' ? 'Tiếng Việt' : 'English'}</span><span aria-hidden="true">{language === value ? '✓' : ''}</span>
      </button>)}
    </div>}
  </div>;
}
