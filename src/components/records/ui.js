/** Shared inline styles for the records screens (the app styles with inline objects and CSS variables). */

export const page = { padding: '28px 32px', maxWidth: 1100, margin: '0 auto' };
export const h1 = { fontSize: 26, fontWeight: 700, color: 'var(--u-navy)', fontFamily: 'Lora, serif', marginBottom: 6 };
export const subtitle = { color: '#64748b', fontSize: 14 };
export const card = { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0' };

export const input = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1.5px solid #e2e8f0', fontSize: 13,
  fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box', background: 'white',
};
export const inputError = { ...input, borderColor: '#fca5a5' };

const button = { padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'Inter, sans-serif' };
export const buttonPrimary = { ...button, border: 'none', background: 'var(--u-navy)', color: 'white' };
export const buttonSecondary = { ...button, border: '1.5px solid #e2e8f0', background: 'white', color: '#475569' };
export const buttonSuccess = { ...button, border: 'none', background: '#16a34a', color: 'white' };
export const buttonDanger = { ...button, border: '1.5px solid #fecaca', background: '#fef2f2', color: '#b91c1c' };
export const buttonDisabled = { opacity: 0.5, cursor: 'not-allowed' };

export const TONES = {
  neutral: { background: '#f1f5f9', color: '#475569' },
  warning: { background: '#fef3c7', color: '#92400e' },
  success: { background: '#dcfce7', color: '#166534' },
  danger: { background: '#fee2e2', color: '#991b1b' },
  muted: { background: '#e2e8f0', color: '#64748b' },
};

export const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto', zIndex: 50 };
export const modal = { ...card, borderRadius: 14, width: '100%', maxWidth: 640, padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' };
