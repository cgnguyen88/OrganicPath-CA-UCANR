import { motion } from 'framer-motion';
import { ClipboardCheck, ListChecks, FileText, ExternalLink, ArrowRight, Leaf } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import t from '../data/translations.js';

const HERO_IMAGES = [
  'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80',
  'https://images.unsplash.com/photo-1500651230702-0e2d8a49d4ad?w=1200&q=80',
  'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80',
];

import { ShieldCheck, Footprints } from 'lucide-react';

export default function Dashboard({ user, onNavigate, profile }) {
  const { lang } = useLanguage();
  const tx = t[lang].dashboard;

  // Three tools for where the farm is: each appears once (the OSP Generator used to be added twice for
  // farms working toward certification).
  const FEATURES = profile?.certificationStatus === 'certified'
    ? [
        { id: 'maintenance', icon: ShieldCheck, color: '#1B6B2E', accent: '#e8f5e9' },
        { id: 'tracker',     icon: ListChecks,  color: '#002D54', accent: '#e5f0fa' },
        { id: 'osp',         icon: FileText,    color: '#FDBD10', accent: '#fff8e1', textColor: '#bd8e00' },
      ]
    : [
        { id: 'osp',         icon: FileText,       color: '#1B6B2E', accent: '#e8f5e9' },
        { id: 'eligibility', icon: ClipboardCheck, color: '#3AA8E4', accent: '#e5f4fd' },
        { id: 'tracker',     icon: ListChecks,     color: '#FDBD10', accent: '#fff8e1', textColor: '#bd8e00' },
      ];

  const hasProfile = profile && profile.operationName;

  return (
    <div className="page-bleed" style={{ minHeight: '100vh', paddingBottom: 80 }}>
      {/* Hero */}
      <div className="dashboard-hero" style={{
        position: 'relative',
        height: 340,
        background: `linear-gradient(to right, rgba(0,29,49,0.88), rgba(0,45,84,0.6)), url(${HERO_IMAGES[0]}) center/cover`,
        display: 'flex',
        alignItems: 'flex-end',
        padding: '0 40px 40px',
      }}>
        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Leaf size={20} color="var(--u-gold)" />
              <span style={{ color: 'var(--u-gold)', fontSize: 13, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                California State Organic Program
              </span>
            </div>
            <h1 style={{ fontFamily: 'Lora, serif', fontSize: 38, color: 'white', fontWeight: 700, marginBottom: 10 }}>
              {tx.welcome}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16, maxWidth: 540 }}>
              {tx.subtitle}
            </p>
          </motion.div>

          {hasProfile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              style={{
                marginTop: 20,
                background: 'rgba(253,189,16,0.15)',
                border: '1px solid rgba(253,189,16,0.4)',
                borderRadius: 8,
                padding: '8px 16px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ color: 'var(--u-gold)', fontSize: 13 }}>
                ✅ {lang === 'en' ? `Active operation: ${profile.operationName}` : `Operación activa: ${profile.operationName}`}
              </span>
            </motion.div>
          )}
        </div>
      </div>

      <div className="dashboard-body" style={{ padding: '40px 40px 0' }}>
        {/* Feature Cards */}
        <h2 style={{ fontFamily: 'Lora, serif', fontSize: 22, color: 'var(--u-navy)', marginBottom: 20 }}>
          {lang === 'en' ? 'Certification Tools' : 'Herramientas de Certificación'}
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 20,
          marginBottom: 48,
        }}>
          {FEATURES.map(({ id, icon: Icon, color, accent, textColor }, i) => {
            const title = tx[`${id}Title`];
            const desc = tx[`${id}Desc`];
            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                onClick={() => onNavigate(id)}
                className="glass"
                style={{
                  borderRadius: 'var(--card-radius)',
                  padding: '24px',
                  cursor: 'pointer',
                  border: '1px solid rgba(255,255,255,0.8)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  background: 'white',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                whileHover={{ y: -4, boxShadow: '0 12px 40px rgba(0,45,84,0.12)' }}
              >
                {/* Gradient accent bar */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 4,
                  background: `linear-gradient(90deg, ${color}, ${color}88)`,
                }} />

                <div style={{
                  width: 44, height: 44,
                  background: accent,
                  borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 16,
                }}>
                  <Icon size={22} color={textColor || color} />
                </div>

                <h3 style={{ fontFamily: 'Lora, serif', fontSize: 17, color: 'var(--u-navy)', marginBottom: 8 }}>
                  {title}
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 16 }}>
                  {desc}
                </p>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  color: color === '#FDBD10' ? '#bd8e00' : color,
                  fontSize: 13, fontWeight: 600,
                }}>
                  {tx.startBtn} <ArrowRight size={14} />
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Resources */}
        <div style={{
          background: 'white',
          borderRadius: 'var(--card-radius)',
          padding: '28px 32px',
          border: '1px solid #e2e8f0',
        }}>
          <h2 style={{ fontFamily: 'Lora, serif', fontSize: 20, color: 'var(--u-navy)', marginBottom: 20 }}>
            {tx.resourcesTitle}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {tx.resources.map(({ label, url }) => (
              <a
                key={label}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '9px 16px',
                  background: 'var(--g100)', borderRadius: 8,
                  color: 'var(--u-navy)', fontSize: 13, fontWeight: 500,
                  textDecoration: 'none',
                  border: '1px solid var(--g200)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--u-navy)'; e.currentTarget.style.color = 'white'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--g100)'; e.currentTarget.style.color = 'var(--u-navy)'; }}
              >
                {label} <ExternalLink size={12} />
              </a>
            ))}
          </div>

          {/* Disclaimer */}
          <div style={{
            marginTop: 24, padding: '14px 16px',
            background: '#fff8e1', borderRadius: 8,
            borderLeft: '4px solid var(--u-gold)',
            fontSize: 13, color: '#7a6200',
          }}>
            <strong>{lang === 'en' ? '⚠️ Disclaimer: ' : '⚠️ Aviso: '}</strong>
            {lang === 'en'
              ? 'This tool is for educational guidance only and does not constitute legal or regulatory advice. Always verify requirements with your certifier and the CDFA/CDPH directly.'
              : 'Esta herramienta es solo para orientación educativa y no constituye asesoramiento legal o regulatorio. Siempre verifica los requisitos con tu certificador y directamente con CDFA/CDPH.'}
          </div>
        </div>
      </div>
    </div>
  );
}
