import {
  Leaf, LayoutDashboard, ClipboardCheck, ListChecks, FileText,
  LogOut, Microscope, Receipt, Users, ClipboardList, DollarSign,
  ShieldCheck, FlaskConical, BadgeCheck, ShieldHalf, Scale, Wrench,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import t from '../data/translations.js';
import RecordsNav from './records/RecordsNav.jsx';
import NavGroup from './nav/NavGroup.jsx';
import NavItem from './nav/NavItem.jsx';

const TOOLS_ITEMS = [
  { id: 'eligibility', icon: ClipboardCheck },
  { id: 'recordGenerators', icon: Microscope },
  { id: 'receipts', icon: Receipt },
  { id: 'certifiers', icon: Users },
  { id: 'soilLabs', icon: FlaskConical },
  { id: 'omriGuide', icon: BadgeCheck },
  { id: 'foodSafety', icon: ShieldHalf },
  { id: 'federalCode', icon: Scale },
  { id: 'stateReg', icon: ClipboardList },
  { id: 'occsp', icon: DollarSign },
];

const TOOLS_ACCENT = '#5bbcf0';

const PATHS = [
  { value: 'pursuing', en: 'Pursuing', es: 'En Proceso' },
  { value: 'certified', en: 'Certified', es: 'Certificado' },
];

const initialsOf = (name) => (name ? name.split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '?');

/**
 * The app's side menu, as a liquid-glass panel: a translucent, softly blurred surface that floats over a
 * faint, still color wash, with gentle edge highlights. Underneath it is still flat and quiet: plain line
 * icons, one accent (the current page), and sections that collapse and remember how you left them.
 * Styling comes from the `.side-menu` rules in global.js, which also provide solid fallbacks for
 * browsers without backdrop blur and for people who ask for reduced transparency or motion.
 */
export default function Sidebar({ activePage, onNavigate, user, farm, onLogout, certificationStatus, onChangeStatus, onSetStatus, needsReviewCount = 0, savedViews = [] }) {
  const { lang, toggleLang } = useLanguage();
  const tx = t[lang].nav;
  const label = (id) => tx[id];

  const coreItems = [
    { id: 'dashboard', icon: LayoutDashboard },
    ...(certificationStatus === 'certified' ? [{ id: 'maintenance', icon: ShieldCheck }] : []),
    { id: 'osp', icon: FileText },
    { id: 'tracker', icon: ListChecks },
  ];
  const row = ({ id, icon }) => <NavItem key={id} icon={icon} label={label(id)} active={activePage === id} onClick={() => onNavigate(id)} />;

  return (
    <aside className="side-menu no-print" style={{ width: 290, minWidth: 290, height: '100vh', flexShrink: 0, position: 'relative' }}>
      {/* A faint, still wash of color behind the glass, so the blur has something to soften. Purely decorative. */}
      <div className="menu-backdrop" aria-hidden="true">
        <span className="menu-orb menu-orb-sky" />
        <span className="menu-orb menu-orb-green" />
      </div>

      <div className="menu-panel">
      {/* Brand */}
      <div style={{ padding: '18px 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div aria-hidden="true" className="menu-mark">
            <Leaf size={16} color="var(--u-navy)" strokeWidth={2.25} />
          </div>
          <span style={{ color: '#fff', fontFamily: 'Lora, serif', fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>OrganicPath CA</span>
        </div>

        {certificationStatus && (
          <div className="menu-segment" role="group" aria-label={lang === 'en' ? 'Certification path' : 'Ruta de certificación'} style={{ display: 'flex', marginTop: 14 }}>
            {PATHS.map(({ value, en, es }) => (
              <button
                key={value}
                type="button"
                aria-pressed={certificationStatus === value}
                onClick={() => (onSetStatus ? onSetStatus(value) : onChangeStatus?.())}
                style={{ flex: 1 }}
              >
                {lang === 'en' ? en : es}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="menu-nav" aria-label={lang === 'en' ? 'Main' : 'Principal'} style={{ flex: 1, overflowY: 'auto', padding: '2px 8px 24px' }}>
        <NavGroup id="core">{coreItems.map(row)}</NavGroup>

        {farm && <RecordsNav activePage={activePage} onNavigate={onNavigate} needsReviewCount={needsReviewCount} savedViews={savedViews} />}

        <NavGroup id="tools" label={tx.tools} icon={Wrench} accent={TOOLS_ACCENT} count={TOOLS_ITEMS.length} forceOpen={TOOLS_ITEMS.some(({ id }) => id === activePage)}>
          {TOOLS_ITEMS.map(row)}
        </NavGroup>
      </nav>

      {/* Footer: language and account */}
      <div className="menu-footer">
        <div className="menu-segment" role="group" aria-label={lang === 'en' ? 'Language' : 'Idioma'} style={{ marginBottom: 10 }}>
          {[['en', 'EN'], ['es', 'ES']].map(([code, text]) => (
            <button key={code} type="button" aria-pressed={lang === code} onClick={() => { if (lang !== code) toggleLang(); }}>{text}</button>
          ))}
        </div>

        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div aria-hidden="true" className="menu-avatar">
              {initialsOf(user.name)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
              <div title={farm ? `${farm.name} · ${farm.farm_code}` : user.email} style={{ color: 'var(--menu-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {farm ? farm.name : user.email}
              </div>
            </div>
            <button type="button" className="menu-icon-button" onClick={onLogout} aria-label={tx.logout} title={tx.logout}>
              <LogOut size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      </div>
    </aside>
  );
}
