import { useEffect, useRef, useState } from 'react';
import { Leaf, Menu } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import t from '../data/translations.js';
import useMediaQuery, { PHONE_QUERY } from '../lib/useMediaQuery.js';
import Sidebar from './Sidebar.jsx';

/** The phone's top bar: the menu button, the app's mark and the name of the page. */
function TopBar({ title, menuOpen, onOpenMenu, buttonRef, labels }) {
  return (
    <header className="mobile-topbar no-print">
      <button
        ref={buttonRef}
        type="button"
        className="mobile-topbar-button"
        aria-label={labels.openMenu}
        aria-expanded={menuOpen}
        aria-controls="app-menu"
        onClick={onOpenMenu}
      >
        <Menu size={22} aria-hidden="true" />
      </button>
      <div aria-hidden="true" className="menu-mark"><Leaf size={15} color="var(--u-navy)" strokeWidth={2.25} /></div>
      <span className="mobile-topbar-title">{title}</span>
    </header>
  );
}

/**
 * The frame around every page: the side menu and the scrolling page area. On a phone the menu becomes a
 * drawer that slides over the page from a top-bar button, and closes after a choice, with Escape, or with
 * a tap on the dimmed page.
 *
 * @param {{ activePage: string, onNavigate: (page: string) => void, sidebar: object, children: import('react').ReactNode }} props
 *   `sidebar` holds the Sidebar props other than the page and navigation.
 */
export default function AppShell({ activePage, onNavigate, sidebar, children }) {
  const { lang } = useLanguage();
  const labels = t[lang].nav;
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);
  const main = useRef(null);
  const drawerOpen = isPhone && menuOpen;

  useEffect(() => {
    if (main.current) main.current.scrollTop = 0;
  }, [activePage]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const navigate = (page) => {
    setMenuOpen(false);
    onNavigate(page);
  };

  return (
    <div className={`app-shell${isPhone ? ' app-shell--phone' : ''}`}>
      {isPhone && (
        <TopBar title={labels[activePage] ?? 'OrganicPath CA'} menuOpen={drawerOpen} onOpenMenu={() => setMenuOpen(true)} buttonRef={menuButton} labels={labels} />
      )}
      <Sidebar {...sidebar} activePage={activePage} onNavigate={navigate} drawer={isPhone} open={drawerOpen} onClose={() => setMenuOpen(false)} />
      <main ref={main} className="app-main">
        {children}
      </main>
    </div>
  );
}
