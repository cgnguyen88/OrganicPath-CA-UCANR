const MAX_BADGE = 99;

/**
 * One row of the side menu. Styling lives in the global `.nav-item` rules (hover, keyboard focus and
 * the current-page marker all come from there), so this stays a plain button with an accessible state.
 */
/** `indent`: true for a first-level sub-item (lines up with the labels), 2 for one level deeper. `wrap`: let a long label use two lines instead of being cut off. */
const INDENT_PX = { 1: 38, 2: 50 };

export default function NavItem({ icon: Icon, label, active = false, onClick, badge = 0, indent = 0, trailing = null, expanded, wrap = false }) {
  const level = indent === true ? 1 : indent;
  return (
    <button
      type="button"
      className="nav-item"
      onClick={onClick}
      title={label}
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded}
      style={level ? { paddingLeft: INDENT_PX[level] ?? INDENT_PX[1] } : undefined}
    >
      {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
      <span style={wrap ? { flex: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' } : { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {badge > 0 && (
        <span style={{ minWidth: 18, padding: '2px 6px', borderRadius: 9, background: 'rgba(251,191,36,0.18)', color: '#fbbf24', fontSize: 10.5, fontWeight: 700, lineHeight: 1, textAlign: 'center' }}>
          {badge > MAX_BADGE ? `${MAX_BADGE}+` : badge}
        </span>
      )}
      {trailing}
    </button>
  );
}
