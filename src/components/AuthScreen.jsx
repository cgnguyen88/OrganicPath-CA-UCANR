import { useState } from 'react';
import { Leaf, Mail, Lock, User } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import t from '../data/translations.js';
import { supabase } from '../lib/supabase.js';
import { buildSignUpPayload, interpretSignUp, FARM_NAME_MAX } from '../lib/registration.js';

function registrationError({ field, code }, lang) {
  if (field === 'farmName' && code === 'too_long') {
    return lang === 'es'
      ? `El nombre de la finca debe tener ${FARM_NAME_MAX} caracteres o menos.`
      : `Farm name must be ${FARM_NAME_MAX} characters or fewer.`;
  }
  return lang === 'es' ? 'Todos los campos son obligatorios.' : 'All fields are required.';
}

export default function AuthScreen({ onLogin }) {
  const { lang } = useLanguage();
  const tx = t[lang].auth;
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', farmName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      if (mode === 'register') {
        const built = buildSignUpPayload(form);
        if (!built.ok) {
          setError(registrationError(built, lang));
          return;
        }
        const { data, error: signUpError } = await supabase.auth.signUp(built.payload);
        if (signUpError) throw signUpError;
        const outcome = interpretSignUp(data);
        if (outcome.kind === 'confirm-email') {
          // No session yet: do NOT act signed in. They must click the emailed link first.
          setNotice(lang === 'es'
            ? `Cuenta creada. Revisa ${outcome.email} y haz clic en el enlace de confirmación; luego inicia sesión.`
            : `Account created. Check ${outcome.email} and click the confirmation link, then sign in.`);
          setMode('login');
          setForm({ name: '', farmName: '', email: form.email, password: '' });
        } else if (outcome.kind === 'signed-in') {
          onLogin({ id: data.user.id, name: built.payload.options.data.name, email: data.user.email, session: data.session, isNew: true });
        } else {
          setError(lang === 'es' ? 'No se pudo crear la cuenta. Inténtalo de nuevo.' : 'Could not create the account. Please try again.');
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (signInError) throw signInError;
        const name = data.user.user_metadata?.name || data.user.email.split('@')[0];
        onLogin({ id: data.user.id, name, email: data.user.email, session: data.session });
      }
    } catch (err) {
      const msg = err.message || 'Something went wrong. Please try again.';
      if (msg.includes('Failed to fetch') || msg.includes('fetch')) {
        setError('Cannot connect to the server. If you are the site owner, please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your Vercel environment variables and redeploy.');
      } else if (msg.includes('already registered')) {
        setError('An account with this email already exists.');
      } else if (msg.includes('Invalid login')) {
        setError('Invalid email or password.');
      } else if (msg.includes('Password should')) {
        setError('Password must be at least 6 characters.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: 'linear-gradient(135deg, var(--u-navy-d) 0%, var(--u-navy) 50%, var(--u-navy-l) 100%)',
    }}>
      {/* Left Panel — Branding */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '48px', color: 'white',
      }} className="no-print">
        <div style={{ marginBottom: 24 }}>
          <div style={{
            width: 80, height: 80, background: 'var(--u-gold)',
            borderRadius: '50%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', marginBottom: 20,
          }}>
            <Leaf size={40} color="var(--u-navy)" />
          </div>
          <h1 style={{ fontFamily: 'Lora, serif', fontSize: 36, fontWeight: 700, marginBottom: 8 }}>
            {t[lang].appName}
          </h1>
          <p style={{ fontSize: 16, opacity: 0.85, maxWidth: 320, textAlign: 'center', lineHeight: 1.7 }}>
            {t[lang].appTagline}
          </p>
        </div>

        <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 320, width: '100%' }}>
          {[
            { icon: '✅', en: 'AI-guided 7-step certification wizard', es: 'Asistente de certificación de 7 pasos con IA' },
            { icon: '🌿', en: 'CDFA & CDPH eligibility checker', es: 'Verificador de elegibilidad CDFA y CDPH' },
            { icon: '📋', en: 'Full compliance tracker', es: 'Rastreador de cumplimiento completo' },
            { icon: '📄', en: 'Organic System Plan (OSP) generator', es: 'Generador de Plan de Sistema Orgánico' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: 0.9 }}>
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              <span style={{ fontSize: 14 }}>{lang === 'en' ? item.en : item.es}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel — Auth Form */}
      <div style={{
        width: 440, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '48px 40px', background: 'white',
      }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <h2 style={{ fontFamily: 'Lora, serif', fontSize: 26, color: 'var(--u-navy)', marginBottom: 8 }}>
            {mode === 'login' ? tx.login : tx.register}
          </h2>
          <p style={{ color: '#666', fontSize: 14, marginBottom: 32 }}>
            {tx.subtitle}
          </p>

          {notice && (
            <div role="status" style={{
              background: '#f0fdf4', border: '1px solid #bbf7d0',
              color: '#166534', borderRadius: 8, padding: '10px 14px',
              fontSize: 14, marginBottom: 20,
            }}>
              {notice}
            </div>
          )}

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              color: '#dc2626', borderRadius: 8, padding: '10px 14px',
              fontSize: 14, marginBottom: 20,
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {mode === 'register' && (
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-navy)', display: 'block', marginBottom: 6 }}>{tx.name}</label>
                <div style={{ position: 'relative' }}>
                  <User size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
                  <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} placeholder={tx.name} />
                </div>
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-navy)', display: 'block', marginBottom: 6 }}>{tx.farmName}</label>
                <div style={{ position: 'relative' }}>
                  <Leaf size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
                  <input type="text" value={form.farmName} maxLength={FARM_NAME_MAX} onChange={e => setForm({ ...form, farmName: e.target.value })} style={inputStyle} placeholder={tx.farmName} />
                </div>
              </div>
            )}

            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-navy)', display: 'block', marginBottom: 6 }}>{tx.email}</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={inputStyle} placeholder={tx.email} />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-navy)', display: 'block', marginBottom: 6 }}>{tx.password}</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} style={inputStyle} placeholder={tx.password} />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                background: loading ? '#94a3b8' : 'var(--u-navy)', color: 'white',
                border: 'none', borderRadius: 8, padding: '13px',
                fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s', marginTop: 8,
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--u-navy-l)'; }}
              onMouseLeave={e => { if (!loading) e.currentTarget.style.background = 'var(--u-navy)'; }}
            >
              {loading ? '...' : (mode === 'login' ? tx.signIn : tx.signUp)}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 14, color: '#666', marginTop: 24 }}>
            {mode === 'login' ? tx.noAccount : tx.hasAccount}{' '}
            <button
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
              style={{ color: 'var(--u-sky)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              {mode === 'login' ? tx.signUp : tx.signIn}
            </button>
          </p>

        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '11px 12px 11px 36px',
  border: '1.5px solid #e2e8f0', borderRadius: 8,
  fontSize: 14, outline: 'none', transition: 'border-color 0.2s',
  fontFamily: 'Inter, sans-serif',
};
