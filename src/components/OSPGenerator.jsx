import { authedFetch } from '../lib/apiClient.js';
import { renderOspInline } from '../utils/safeMarkdown.js';
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, ArrowRight, ArrowLeft, FileText, CheckCircle, Sparkles,
  Library, Upload, X, Paperclip, AlertCircle, ChevronDown, ChevronRight,
  ExternalLink, BookOpen, Image, File, Pencil,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import t from '../data/translations.js';
import certifiers from '../data/certifiers.js';
import { SUBSTANCES, calculateStateFee, FEE_TIERS } from '../data/wizard-steps.js';
import { exportOSPtoWord } from '../utils/export.js';
import { saveToStorage, loadFromStorage } from '../utils/storage.js';
import { debouncedSync } from '../lib/db.js';
import { CERTIFIER_TEMPLATES } from '../data/ospTemplates.js';

// ─── Styles ───────────────────────────────────────────────────────────────────

const IS = {
  width: '100%', padding: '10px 13px',
  border: '1.5px solid #e2e8f0', borderRadius: 8,
  fontSize: 14, fontFamily: 'Inter, sans-serif',
  outline: 'none', background: 'white', boxSizing: 'border-box',
};
const TS = { ...IS, resize: 'vertical', minHeight: 110 };

// ─── File helpers ─────────────────────────────────────────────────────────────

const ACCEPTED_MIME = {
  'application/pdf': { label: 'PDF', color: '#dc2626', icon: FileText },
  'image/jpeg': { label: 'Image', color: '#0284c7', icon: Image },
  'image/png': { label: 'Image', color: '#0284c7', icon: Image },
  'image/webp': { label: 'Image', color: '#0284c7', icon: Image },
  'text/plain': { label: 'Text', color: '#059669', icon: FileText },
};
const ACCEPT_ATTR = Object.keys(ACCEPTED_MIME).join(',') + ',.txt,.md';

function readBase64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
}
function readText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
}
function fmtSz(b) { return b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`; }

// ─── AI helpers ───────────────────────────────────────────────────────────────

async function streamClaude(messages, onChunk, system) {
  const res = await authedFetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system, stream: true }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6).trim();
      if (d === '[DONE]') return;
      try { const j = JSON.parse(d); const txt = j.choices?.[0]?.delta?.content || j.delta?.text || ''; if (txt) onChunk(txt); } catch {}
    }
  }
}

async function callClaude(messages, system) {
  const res = await authedFetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system, stream: false }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text || data?.choices?.[0]?.message?.content || '';
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function inlineFmt(text) {
  const parts = []; const re = /(\*\*.*?\*\*|\*.*?\*)/g; let last = 0; let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const r = m[0];
    parts.push(r.startsWith('**')
      ? <strong key={m.index}>{r.slice(2, -2)}</strong>
      : <em key={m.index}>{r.slice(1, -1)}</em>);
    last = m.index + r.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

function MDView({ text }) {
  if (!text) return null;
  const lines = text.split('\n'); const els = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^##\s/.test(l)) { els.push(<h4 key={i} style={{ fontSize: 13, fontWeight: 700, color: 'var(--u-navy)', margin: '12px 0 4px' }}>{l.replace(/^##\s/, '')}</h4>); }
    else if (/^#\s/.test(l)) { els.push(<h3 key={i} style={{ fontSize: 14, fontWeight: 700, color: 'var(--u-navy)', margin: '14px 0 4px' }}>{l.replace(/^#\s/, '')}</h3>); }
    else if (/^[-*•]\s/.test(l)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i])) { items.push(<li key={i} style={{ marginBottom: 3 }}>{inlineFmt(lines[i].replace(/^[-*•]\s/, ''))}</li>); i++; }
      els.push(<ul key={`ul${i}`} style={{ paddingLeft: 20, margin: '4px 0' }}>{items}</ul>); continue;
    } else if (/^\d+\.\s/.test(l)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(<li key={i} style={{ marginBottom: 3 }}>{inlineFmt(lines[i].replace(/^\d+\.\s/, ''))}</li>); i++; }
      els.push(<ol key={`ol${i}`} style={{ paddingLeft: 20, margin: '4px 0' }}>{items}</ol>); continue;
    } else if (l.trim() === '') { els.push(<div key={i} style={{ height: 5 }} />); }
    else { els.push(<p key={i} style={{ margin: '3px 0', lineHeight: 1.7 }}>{inlineFmt(l)}</p>); }
    i++;
  }
  return <div style={{ fontSize: 13, color: '#374151' }}>{els}</div>;
}

// ─── Small shared UI ──────────────────────────────────────────────────────────

function FF({ label, children, required, hint }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--u-navy)', marginBottom: 5 }}>
        {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      {hint && <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{hint}</p>}
      {children}
    </div>
  );
}

function FileBadge({ file, onRemove }) {
  const meta = ACCEPTED_MIME[file.mimeType] || { label: 'File', color: '#64748b', icon: File };
  const Icon = meta.icon;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, background: meta.color + '12', border: `1px solid ${meta.color}30` }}>
      {file.preview ? <img src={file.preview} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} /> : <Icon size={15} color={meta.color} />}
      <div>
        <p style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', margin: 0 }}>{file.name}</p>
        <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>{meta.label} · {fmtSz(file.size)}</p>
      </div>
      {onRemove && <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2 }}><X size={12} /></button>}
    </div>
  );
}

// AI-assist textarea
function AIField({ label, fieldKey, value, onChange, onGenerate, generating, hint, required }) {
  const [editing, setEditing] = useState(!value);
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-navy)' }}>
          {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {value && !editing && (
            <button onClick={() => setEditing(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1.5px solid #e2e8f0', background: 'white', color: '#64748b', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              <Pencil size={10} /> Edit
            </button>
          )}
          <button
            onClick={() => { onGenerate(fieldKey); setEditing(false); }}
            disabled={generating}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 6, border: '1.5px solid var(--u-sky)', background: 'white', color: 'var(--u-sky)', fontSize: 11, fontWeight: 600, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.6 : 1 }}
          >
            <Sparkles size={11} /> {generating ? 'Generating…' : 'AI Suggest'}
          </button>
        </div>
      </div>
      {hint && <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{hint}</p>}
      {value && !editing ? (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '12px 16px', minHeight: 70 }}>
          <MDView text={value} />
          {generating && <span style={{ display: 'inline-block', width: 7, height: 13, background: 'var(--u-sky)', borderRadius: 2, marginLeft: 2, animation: 'osp-blink 0.8s step-end infinite' }} />}
        </div>
      ) : (
        <textarea
          style={{ ...TS, ...(editing ? { borderColor: 'var(--u-sky)' } : {}) }}
          value={value}
          onChange={e => onChange(fieldKey, e.target.value)}
          placeholder="Type here or use AI Suggest ↑"
        />
      )}
    </div>
  );
}

// ─── STEP 1 — Template Library ────────────────────────────────────────────────

function TemplateLibraryStep({ selected, customFile, onSelect, onClearFile, onFileSelect, fileInputRef, fileError, setFileError, onContinue }) {
  return (
    <div>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
        Select a certifier template. The form in the next step will be tailored to that certifier's exact section requirements.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: 24 }}>
        {CERTIFIER_TEMPLATES.map(tmpl => {
          const sel = selected?.id === tmpl.id && !customFile;
          return (
            <motion.button key={tmpl.id} onClick={() => { onSelect(tmpl); onClearFile(); }}
              whileHover={{ y: -3, boxShadow: `0 10px 24px ${tmpl.color}22` }}
              style={{ background: sel ? tmpl.color : 'white', border: `2px solid ${sel ? tmpl.color : '#e2e8f0'}`, borderRadius: 12, padding: '16px 14px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', position: 'relative' }}
            >
              {tmpl.badge && <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: sel ? 'rgba(255,255,255,0.25)' : tmpl.color + '20', color: sel ? 'white' : tmpl.color }}>{tmpl.badge}</span>}
              <div style={{ width: 36, height: 36, borderRadius: 8, marginBottom: 10, background: sel ? 'rgba(255,255,255,0.2)' : tmpl.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BookOpen size={18} color={sel ? 'white' : tmpl.color} />
              </div>
              <p style={{ fontSize: 14, fontWeight: 700, color: sel ? 'white' : '#1e293b', marginBottom: 2 }}>{tmpl.name}</p>
              <p style={{ fontSize: 11, color: sel ? 'rgba(255,255,255,0.75)' : '#64748b', lineHeight: 1.4 }}>{tmpl.tagline}</p>
            </motion.button>
          );
        })}
      </div>

      {/* Upload custom */}
      <div style={{ border: `2px dashed ${customFile ? '#0284c7' : '#cbd5e1'}`, borderRadius: 12, padding: '20px 24px', background: customFile ? '#e0f2fe20' : '#fafbff', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, background: customFile ? '#0284c720' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Upload size={18} color={customFile ? '#0284c7' : '#94a3b8'} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 3 }}>Upload Your Certifier's Template</h3>
            <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginBottom: 10 }}>Have your certifier's actual OSP form? Upload it and AI will follow its exact structure to fill it in.</p>
            {fileError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 7, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 8, fontSize: 12, color: '#dc2626' }}>
                <AlertCircle size={12} />{fileError}<button onClick={() => setFileError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}><X size={11} /></button>
              </div>
            )}
            {customFile
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><FileBadge file={customFile} onRemove={onClearFile} /><span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>✓ Will use as template guide</span></div>
              : <div>
                  <input ref={fileInputRef} type="file" accept={ACCEPT_ATTR} onChange={onFileSelect} style={{ display: 'none' }} />
                  <button onClick={() => fileInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 7, border: '1.5px solid #cbd5e1', background: 'white', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    <Paperclip size={13} /> Choose File
                  </button>
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>PDF, image, or .txt · Max 15 MB</span>
                </div>
            }
          </div>
        </div>
      </div>

      {/* Template sections preview */}
      {selected && !customFile && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          style={{ background: 'white', borderRadius: 12, border: `1px solid ${selected.color}30`, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 20px', background: selected.color + '0d', borderBottom: `1px solid ${selected.color}20` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: 0 }}>{selected.fullName}</p>
                <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>{selected.jurisdiction} · {selected.sections.length} sections</p>
              </div>
              <a href={`https://${selected.website}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: 11, color: selected.color, display: 'flex', alignItems: 'center', gap: 3 }}>
                <ExternalLink size={11} /> {selected.website}
              </a>
            </div>
            <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, marginTop: 8, marginBottom: 6 }}>{selected.description}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {selected.strengths.map(s => <span key={s} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 7, background: selected.color + '15', color: selected.color, fontWeight: 500 }}>✓ {s}</span>)}
            </div>
          </div>
          <div style={{ padding: '12px 20px' }}>
            {selected.sections.map(sec => (
              <div key={sec.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: selected.color, minWidth: 16, fontFamily: 'monospace' }}>{sec.num}</span>
                <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>{sec.title}</span>
                {sec.required ? <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 600 }}>Required</span> : <span style={{ fontSize: 10, color: '#94a3b8' }}>Optional</span>}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {(selected || customFile) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onContinue} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 24px', borderRadius: 8, border: 'none', background: 'var(--u-navy)', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Continue to Fill Details <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── STEP 2 — Fill In Details ─────────────────────────────────────────────────

// Map template section IDs → what kind of form to show
const SECTION_KIND = {
  operation_info: 'operation_info',
  operator_info: 'operation_info',
  field_history: 'land_transition',
  land_description: 'land_transition',
  crop_plan: 'crop_plan',
  production_plan: 'crop_plan',
  organic_plan: 'crop_plan',
  soil_fertility: 'soil_fertility',
  pest_management: 'pest_management',
  harvest_handling: 'harvest_handling',
  facility_handling: 'harvest_handling',
  input_list: 'input_list',
  inputs: 'input_list',
  seeds: 'seeds',
  seeds_propagation: 'seeds',
  buffers: 'buffers',
  recordkeeping: 'recordkeeping',
  records: 'recordkeeping',
  records_audit_trail: 'recordkeeping',
  sales: 'sales',
  ingredient_sourcing: 'supply_chain',
  product_formulation: 'product_formulation',
  food_safety_plan: 'food_safety',
  water: 'water',
  worker_wellbeing: 'worker_wellbeing',
  worker_hygiene: 'worker_wellbeing',
  nop_organic_core: 'nop_core',
  certification_info: 'certifier_pick',
};

function FillDetailsStep({ formData, update, updateMany, selectedTemplate, customFile, generating, onGenerate, onBack, onContinue, lang }) {
  const [openSec, setOpenSec] = useState(() => {
    const init = {};
    if (selectedTemplate) init[selectedTemplate.sections[0]?.id] = true;
    return init;
  });
  const toggleSec = (id) => setOpenSec(prev => ({ ...prev, [id]: !prev[id] }));

  const tmplColor = customFile ? '#0284c7' : (selectedTemplate?.color || 'var(--u-navy)');
  const sections = customFile ? CERTIFIER_TEMPLATES[0].sections : (selectedTemplate?.sections || []);

  // Always show: certifier picker + registration path (after template sections)
  const extraSections = [
    { id: '_certifier', num: '★', title: 'Certifying Agent', required: true },
    { id: '_registration', num: '★', title: 'Registration Path & Fees', required: true },
    { id: '_substances', num: '★', title: 'Substance Checklist (NOP §205.601-604)', required: false },
  ];

  const allSections = [...sections, ...extraSections];
  const color = tmplColor;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: customFile ? '#e0f2fe' : (selectedTemplate?.color + '0e' || '#f8fafc'), border: `1px solid ${color}25`, marginBottom: 20 }}>
        <BookOpen size={15} color={color} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
          {customFile ? `Custom template: ${customFile.name}` : `${selectedTemplate?.name} — ${selectedTemplate?.fullName}`}
        </span>
        <button onClick={onBack} style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>Change</button>
      </div>

      {allSections.map((sec) => {
        const kind = SECTION_KIND[sec.id] || 'generic';
        const tmplSec = selectedTemplate?.sections.find(s => s.id === sec.id);
        const isOpen = !!openSec[sec.id];

        return (
          <div key={sec.id} style={{ border: '1px solid #e2e8f0', borderLeft: `3px solid ${color}`, borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
            <button onClick={() => toggleSec(sec.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: isOpen ? '#fafbff' : 'white', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 20, fontFamily: 'monospace' }}>{sec.num}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{sec.title}</span>
              {sec.required
                ? <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 600, padding: '1px 6px', background: '#fef2f2', borderRadius: 4 }}>Required</span>
                : <span style={{ fontSize: 10, color: '#94a3b8', padding: '1px 6px', background: '#f1f5f9', borderRadius: 4 }}>Optional</span>}
              {isOpen ? <ChevronDown size={14} color="#94a3b8" /> : <ChevronRight size={14} color="#94a3b8" />}
            </button>

            {isOpen && (
              <div style={{ padding: '16px 20px', borderTop: '1px solid #f1f5f9', background: '#fafbff' }}>
                {tmplSec?.instructions && (
                  <div style={{ padding: '8px 12px', background: color + '0a', borderRadius: 7, border: `1px solid ${color}20`, marginBottom: 14, fontSize: 12, color: '#374151', lineHeight: 1.6 }}>
                    <strong style={{ color }}>Instructions: </strong>{tmplSec.instructions}
                  </div>
                )}
                {tmplSec?.ccofNote && (
                  <div style={{ padding: '7px 11px', background: '#fffbeb', borderRadius: 7, border: '1px solid #fde68a', marginBottom: 14, fontSize: 12, color: '#92400e' }}>
                    ✦ <strong>Certifier tip:</strong> {tmplSec.ccofNote}
                  </div>
                )}

                {/* Render section-specific form */}
                <SectionForm kind={kind} sec={sec} formData={formData} update={update} updateMany={updateMany} generating={generating} onGenerate={onGenerate} lang={lang} />
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: 'white', color: '#374151', fontSize: 14, cursor: 'pointer' }}>
          <ArrowLeft size={15} /> Back
        </button>
        <button onClick={onContinue} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 24px', borderRadius: 8, border: 'none', background: 'var(--u-navy)', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Generate OSP <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function SectionForm({ kind, sec, formData, update, updateMany, generating, onGenerate, lang }) {
  const isEs = lang === 'es';

  if (kind === 'operation_info') return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
        <FF label="Operation / Farm Name" required><input style={IS} value={formData.operationName || ''} onChange={e => update('operationName', e.target.value)} /></FF>
        <FF label="Owner / Operator Name" required><input style={IS} value={formData.ownerName || ''} onChange={e => update('ownerName', e.target.value)} /></FF>
        <FF label="Email"><input type="email" style={IS} value={formData.email || ''} onChange={e => update('email', e.target.value)} /></FF>
        <FF label="Phone"><input style={IS} value={formData.phone || ''} onChange={e => update('phone', e.target.value)} /></FF>
      </div>
      <FF label="Street Address"><input style={IS} value={formData.address || ''} onChange={e => update('address', e.target.value)} /></FF>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 18px' }}>
        <FF label="City"><input style={IS} value={formData.city || ''} onChange={e => update('city', e.target.value)} /></FF>
        <FF label="County"><input style={IS} value={formData.county || ''} onChange={e => update('county', e.target.value)} /></FF>
        <FF label="ZIP"><input style={IS} value={formData.zip || ''} onChange={e => update('zip', e.target.value)} /></FF>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 18px' }}>
        <FF label="Operation Type" required>
          <select style={{ ...IS, appearance: 'none', cursor: 'pointer' }} value={formData.operationType || ''} onChange={e => update('operationType', e.target.value)}>
            <option value="">— Select —</option>
            {['Crop Producer', 'Livestock / Dairy', 'Poultry', 'Food Handler / Processor', 'Wild Crop Harvester', 'Broker'].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </FF>
        <FF label="Total Acreage"><input style={IS} value={formData.acreage || ''} onChange={e => update('acreage', e.target.value)} placeholder="e.g. 45 acres" /></FF>
        <FF label="Organic Acreage"><input style={IS} value={formData.organicAcreage || ''} onChange={e => update('organicAcreage', e.target.value)} /></FF>
      </div>
      <FF label="Crops / Products to Certify" required hint="List all crops, livestock products, or processed items you wish to certify as organic.">
        <input style={IS} value={formData.crops || ''} onChange={e => update('crops', e.target.value)} placeholder="e.g. strawberries, tomatoes, mixed greens" />
      </FF>
      <FF label="Est. Gross Organic Sales ($)" hint="Used to calculate your California state registration fee.">
        <input type="number" style={IS} value={formData.grossSales || ''} onChange={e => update('grossSales', e.target.value)} placeholder="e.g. 45000" />
        {formData.grossSales && <p style={{ fontSize: 12, color: '#0284c7', marginTop: 5 }}>
          💰 Estimated CA state fee: <strong>${calculateStateFee(formData.grossSales)}/year</strong>
        </p>}
      </FF>
    </div>
  );

  if (kind === 'land_transition') return (
    <div>
      <FF label="Years free of prohibited substances" required>
        <select style={{ ...IS, appearance: 'none', cursor: 'pointer' }} value={formData.landFreeYears || ''} onChange={e => update('landFreeYears', e.target.value)}>
          <option value="">— Select —</option>
          <option value="less_than_1">Less than 1 year</option>
          <option value="1_2">1–2 years</option>
          <option value="2_3">2–3 years (approaching 36-month transition)</option>
          <option value="3_plus">3 or more years ✅ (eligible for certification)</option>
        </select>
      </FF>
      <FF label="Last prohibited substance applied (if any)" hint="Include product name, approximate date, and which fields. Leave blank if none.">
        <input style={IS} value={formData.lastProhibitedSubstance || ''} onChange={e => update('lastProhibitedSubstance', e.target.value)} placeholder="e.g. Roundup (glyphosate) — Spring 2021, Field A only" />
      </FF>
      <AIField label="Field History Narrative" fieldKey="fieldHistory" value={formData.fieldHistory || ''} onChange={update} onGenerate={onGenerate} generating={generating}
        hint="Describe each field's history — prior crops, land uses, and evidence of 3-year freedom from prohibited substances." />
      <div style={{ padding: '10px 14px', background: '#e8f5e9', borderRadius: 8, border: '1px solid #a7d7b2', fontSize: 12, color: '#1B6B2E', lineHeight: 1.7 }}>
        📅 <strong>Transition rule:</strong> 36 consecutive months free of prohibited substances before first organic harvest (NOP §205.202). Transition begins the day after the last prohibited substance was applied.
      </div>
    </div>
  );

  if (kind === 'crop_plan') return (
    <AIField label="Crop Plan & Rotation" fieldKey="cropRotation" value={formData.cropRotation || ''} onChange={update} onGenerate={onGenerate} generating={generating} required
      hint="List crops by field, your multi-year rotation schedule, cover crops, and fallow periods. Explain how your rotation maintains soil health and breaks pest cycles (NOP §205.205)." />
  );

  if (kind === 'soil_fertility') return (
    <AIField label="Soil Fertility & Nutrient Management" fieldKey="practices" value={formData.practices || ''} onChange={update} onGenerate={onGenerate} generating={generating} required
      hint="Describe soil amendments, composting, green manures, and cover crops. For manure: specify raw vs. composted and document the 90/120-day rule. List all products in the Input List section." />
  );

  if (kind === 'pest_management') return (
    <AIField label="Pest, Weed & Disease Management" fieldKey="pestManagement" value={formData.pestManagement || ''} onChange={update} onGenerate={onGenerate} generating={generating} required
      hint="Follow the NOP §205.206 hierarchy: (1) preventive cultural practices, (2) mechanical/physical controls, (3) biological controls, (4) allowed materials on the National List. Describe your specific practices for each major pest/weed." />
  );

  if (kind === 'harvest_handling') return (
    <AIField label="Harvest & Post-Harvest Handling" fieldKey="harvestHandling" value={formData.harvestHandling || ''} onChange={update} onGenerate={onGenerate} generating={generating} required
      hint="Describe equipment sanitation, containers, storage, commingling prevention, and post-harvest treatments. If you also handle non-organic products, detail how commingling is prevented." />
  );

  if (kind === 'input_list') return (
    <AIField label="Input Materials List" fieldKey="inputs" value={formData.inputs || ''} onChange={update} onGenerate={onGenerate} generating={generating} required
      hint="List every substance used: fertilizers, pest controls, cleaning agents, seed treatments, post-harvest treatments. For each: product name, manufacturer, OMRI listed (Y/N), NOP status, intended use, application rate." />
  );

  if (kind === 'seeds') return (
    <AIField label="Seeds & Planting Stock" fieldKey="seedSources" value={formData.seedSources || ''} onChange={update} onGenerate={onGenerate} generating={generating}
      hint="For each crop, specify organic seed source and supplier. If organic seed is commercially unavailable, document your search (date, suppliers contacted) and note that untreated conventional seed was used. Treated seed (fungicide-coated) is never allowed (NOP §205.204)." />
  );

  if (kind === 'buffers') return (
    <AIField label="Buffer Zones & Contamination Prevention" fieldKey="buffers" value={formData.buffers || ''} onChange={update} onGenerate={onGenerate} generating={generating} required
      hint="Describe adjacent land uses (N/S/E/W), potential contamination risks, and your physical buffers (hedgerows, roads, waterways). No minimum distance is federally required — demonstrate that contamination cannot occur." />
  );

  if (kind === 'recordkeeping') return (
    <AIField label="Recordkeeping System" fieldKey="monitoring" value={formData.monitoring || ''} onChange={update} onGenerate={onGenerate} generating={generating} required
      hint="Describe all records you maintain (purchase invoices, field logs, harvest records, sales records), where they are stored, how they are organized, and how they create a 5-year audit trail (NOP §205.103)." />
  );

  if (kind === 'sales') return (
    <div>
      <FF label="Primary Buyers / Markets" hint="Farmers markets, CSA, wholesale buyers, restaurants, distributors, etc.">
        <input style={IS} value={formData.salesInfo || ''} onChange={e => update('salesInfo', e.target.value)} placeholder="e.g. Farmers market (Tue/Sat), California Organics Wholesale, direct CSA 80 members" />
      </FF>
      <FF label="How Products Are Labeled" hint="Describe how the organic label is applied and how you ensure only certified products are labeled as organic.">
        <textarea style={{ ...TS, minHeight: 80 }} value={formData.labelingInfo || ''} onChange={e => update('labelingInfo', e.target.value)} />
      </FF>
    </div>
  );

  if (kind === 'supply_chain') return (
    <AIField label="Ingredient Sourcing & Supply Chain" fieldKey="supplyChain" value={formData.supplyChain || ''} onChange={update} onGenerate={onGenerate} generating={generating} required
      hint="For each ingredient: certifier name, certificate of organic operation on file, and supplier contact. For non-organic ingredients, cite §205.605 or §205.606 justification. Maintain current organic certificates from all organic suppliers." />
  );

  if (kind === 'product_formulation') return (
    <div>
      <AIField label="Product Formulations & Organic % Calculations" fieldKey="productFormulation" value={formData.productFormulation || ''} onChange={update} onGenerate={onGenerate} generating={generating} required
        hint="For each product: list all ingredients with weights, calculate organic %, determine label category (100%, 95%+, 70%+), and note which ingredients are excluded from organic calculation per §205.302." />
    </div>
  );

  if (kind === 'food_safety') return (
    <AIField label="Food Safety Management System" fieldKey="foodSafetyPlan" value={formData.foodSafetyPlan || ''} onChange={update} onGenerate={onGenerate} generating={generating}
      hint="Reference your HACCP or Preventive Controls plan. Note FSMA Produce Safety Rule compliance status. This supplements your NOP organic certification." />
  );

  if (kind === 'water') return (
    <AIField label="Agricultural Water Management" fieldKey="waterManagement" value={formData.waterManagement || ''} onChange={update} onGenerate={onGenerate} generating={generating}
      hint="Water sources (well, surface, municipal), irrigation methods, FSMA §112 water testing program and results, and how water management prevents pathogen risk and contamination of organic crops." />
  );

  if (kind === 'worker_wellbeing') return (
    <div>
      <FF label="Worker Training Records" hint="List types of training provided (food safety, pesticide handling, organic practices).">
        <textarea style={{ ...TS, minHeight: 80 }} value={formData.workerTraining || ''} onChange={e => update('workerTraining', e.target.value)} />
      </FF>
      <FF label="Worker Health & Hygiene Policies" hint="Sick worker policy, handwashing facilities, restrooms in fields, visitor policy.">
        <textarea style={{ ...TS, minHeight: 80 }} value={formData.workerHygiene || ''} onChange={e => update('workerHygiene', e.target.value)} />
      </FF>
    </div>
  );

  if (kind === 'nop_core') return (
    <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, color: '#374151' }}>
      For dual-certified operations, your NOP organic certifier handles the full OSP. Reference the relevant sections filled in above.
      <FF label="NOP Certifier Notes" hint="Any additional notes about your NOP organic certification." style={{ marginTop: 12 }}>
        <textarea style={{ ...TS, minHeight: 80 }} value={formData.nopCoreNotes || ''} onChange={e => update('nopCoreNotes', e.target.value)} />
      </FF>
    </div>
  );

  // _certifier — always shown
  if (sec.id === '_certifier') return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 16 }}>
        {certifiers.map(c => {
          const sel = formData.certifierId === c.id;
          return (
            <motion.div key={c.id} onClick={() => updateMany({ certifierId: c.id, certifierName: c.name, certifierContact: `${c.phone} | ${c.website}` })}
              whileHover={{ scale: sel ? 1 : 1.01 }}
              style={{ padding: '13px', borderRadius: 9, cursor: 'pointer', border: sel ? '2px solid var(--u-navy)' : '2px solid #e2e8f0', background: sel ? 'rgba(0,45,84,0.06)' : 'white', position: 'relative', overflow: 'hidden', transition: 'all 0.15s' }}>
              {sel && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--u-navy)' }} />}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: sel ? 3 : 0 }}>
                <p style={{ fontWeight: 700, fontSize: 13, color: sel ? 'var(--u-navy)' : '#1e293b', margin: 0 }}>{c.name}</p>
                {sel && <CheckCircle size={14} color="white" style={{ background: 'var(--u-navy)', borderRadius: '50%', padding: 2 }} />}
              </div>
              <p style={{ fontSize: 11, color: '#64748b', margin: '2px 0' }}>{c.location}</p>
              <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>{c.notes}</p>
            </motion.div>
          );
        })}
      </div>
      <FF label="Certifier contact / notes">
        <textarea style={{ ...TS, minHeight: 70 }} value={formData.certifierContact || ''} onChange={e => update('certifierContact', e.target.value)} placeholder="Phone, email, notes..." />
      </FF>
    </div>
  );

  // _registration
  if (sec.id === '_registration') return (
    <div>
      <FF label="Registration Path" required>
        <select style={{ ...IS, appearance: 'none', cursor: 'pointer' }} value={formData.registrationPath || ''} onChange={e => update('registrationPath', e.target.value)}>
          <option value="">— Select —</option>
          <option value="CDFA">CDFA (raw agricultural products / livestock / dairy)</option>
          <option value="CDPH">CDPH (processed foods / supplements / cosmetics)</option>
          <option value="Both">Both CDFA + CDPH</option>
          <option value="Exempt">Exempt (under $5,000 gross organic sales)</option>
        </select>
      </FF>
      <FF label="Additional registration notes">
        <textarea style={{ ...TS, minHeight: 80 }} value={formData.registrationNotes || ''} onChange={e => update('registrationNotes', e.target.value)} placeholder="Any special circumstances, questions for your certifier..." />
      </FF>
      {FEE_TIERS.length > 0 && (
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: 14, border: '1px solid #e2e8f0' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--u-navy)', marginBottom: 8 }}>📊 California State Fee Schedule</p>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#e5f0fa' }}>
              <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--u-navy)' }}>Gross Sales</th>
              <th style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--u-navy)' }}>Annual Fee</th>
            </tr></thead>
            <tbody>{FEE_TIERS.slice(0, 8).map((tier, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '5px 8px', color: '#374151' }}>{tier.label}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--u-navy)' }}>${tier.fee}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  // _substances
  if (sec.id === '_substances') return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <div>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: '#1B6B2E', marginBottom: 12 }}>✅ Allowed Substances I Use</h4>
        {SUBSTANCES.allowed.map((s, i) => (
          <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={formData.allowedChecked?.[s.en] || false}
              onChange={() => update('allowedChecked', { ...(formData.allowedChecked || {}), [s.en]: !(formData.allowedChecked?.[s.en]) })}
              style={{ marginTop: 2, accentColor: '#1B6B2E' }} />
            <span style={{ fontSize: 12, color: '#374151' }}>{lang === 'es' ? s.es : s.en}</span>
          </label>
        ))}
      </div>
      <div>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 12 }}>🚫 Prohibited Substances I Have Used</h4>
        {SUBSTANCES.prohibited.map((s, i) => (
          <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={formData.prohibitedChecked?.[s.en] || false}
              onChange={() => update('prohibitedChecked', { ...(formData.prohibitedChecked || {}), [s.en]: !(formData.prohibitedChecked?.[s.en]) })}
              style={{ marginTop: 2, accentColor: '#dc2626' }} />
            <span style={{ fontSize: 12, color: '#374151' }}>{lang === 'es' ? s.es : s.en}</span>
          </label>
        ))}
        <div style={{ padding: '8px 12px', background: '#fff0f0', borderRadius: 7, border: '1px solid #fecaca', marginTop: 8, fontSize: 11, color: '#dc2626' }}>
          ⚠️ Any prohibited substance must be disclosed to your certifier and resolved before certification.
        </div>
      </div>
    </div>
  );

  // generic fallback
  return (
    <FF label={sec.title}>
      <textarea style={TS} value={formData[sec.id] || ''} onChange={e => update(sec.id, e.target.value)} placeholder={`Enter ${sec.title.toLowerCase()} details…`} />
    </FF>
  );
}

// ─── STEP 3 — Generate & Export ───────────────────────────────────────────────

function GenerateStep({ formData, selectedTemplate, customFile, generating, generatedOSP, genError, onGenerate, onExport, exporting, exported, onBack, lang }) {
  const color = customFile ? '#0284c7' : (selectedTemplate?.color || 'var(--u-navy)');
  const canGenerate = !generating;

  return (
    <div>
      {/* Active template */}
      <div style={{ padding: '10px 14px', borderRadius: 8, background: color + '0d', border: `1px solid ${color}25`, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <BookOpen size={15} color={color} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
          {customFile ? `Custom: ${customFile.name}` : `${selectedTemplate?.name} — ${selectedTemplate?.fullName}`}
        </span>
        <button onClick={onBack} style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>← Edit Details</button>
      </div>

      {/* Profile summary */}
      <div style={{ background: 'white', borderRadius: 10, padding: '14px 18px', border: '1px solid #e2e8f0', marginBottom: 20 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Profile Data Summary</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {[
            ['Operation', formData.operationName], ['Owner', formData.ownerName],
            ['Type', formData.operationType], ['Crops', formData.crops],
            ['County', formData.county], ['Certifier', formData.certifierName],
            ['Acreage', formData.acreage], ['Sales', formData.grossSales ? `$${formData.grossSales}` : null],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ padding: '6px 10px', background: '#f8fafc', borderRadius: 6 }}>
              <p style={{ fontSize: 10, color: '#94a3b8', margin: 0, fontWeight: 600 }}>{k}</p>
              <p style={{ fontSize: 12, color: '#1e293b', margin: 0, fontWeight: 500 }}>{v}</p>
            </div>
          ))}
        </div>
        {!formData.operationName && (
          <p style={{ fontSize: 12, color: '#dc2626', marginTop: 8, margin: 0 }}>⚠ Fill in operation details in the previous step before generating.</p>
        )}
      </div>

      {genError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
          <AlertCircle size={14} />{genError}
        </div>
      )}

      {/* Generate button */}
      {!generatedOSP && (
        <motion.button onClick={onGenerate} disabled={!canGenerate} whileHover={{ scale: canGenerate ? 1.02 : 1 }} whileTap={{ scale: 0.98 }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 28px', borderRadius: 10, border: 'none', background: generating ? '#94a3b8' : 'linear-gradient(135deg, var(--u-navy), #1B6B2E)', color: 'white', fontSize: 15, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', boxShadow: generating ? 'none' : '0 4px 16px rgba(0,45,84,0.22)', marginBottom: 12 }}>
          {generating
            ? <><div style={{ width: 17, height: 17, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />{lang === 'en' ? 'Generating full OSP…' : 'Generando OSP…'}</>
            : <><Sparkles size={18} />{lang === 'en' ? (customFile ? 'Generate OSP from My Template' : selectedTemplate ? `Generate ${selectedTemplate.name} OSP with AI` : 'Generate OSP') : 'Generar OSP con IA'}</>
          }
        </motion.button>
      )}
      {generating && <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>This may take 20–40 seconds for a full OSP…</p>}

      {/* Preview */}
      {generatedOSP && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <motion.button onClick={onExport} disabled={exporting} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 8, border: 'none', background: exported ? '#1B6B2E' : exporting ? '#94a3b8' : 'var(--u-navy)', color: 'white', fontSize: 14, fontWeight: 700, cursor: exporting ? 'not-allowed' : 'pointer' }}>
              {exported ? <CheckCircle size={16} /> : <Download size={16} />}
              {exporting ? 'Exporting…' : exported ? '✅ Downloaded!' : 'Export as Word (.docx)'}
            </motion.button>
            <button onClick={onGenerate} style={{ fontSize: 13, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 16px', cursor: 'pointer' }}>
              Regenerate
            </button>
          </div>
          <div style={{ background: 'white', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,45,84,0.08)', border: '1px solid #e2e8f0' }}>
            <div style={{ background: 'var(--u-navy)', padding: '20px 28px' }}>
              <h2 style={{ fontFamily: 'Lora, serif', color: 'white', fontSize: 20, marginBottom: 4 }}>ORGANIC SYSTEM PLAN (OSP)</h2>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                {selectedTemplate ? `${selectedTemplate.name} Format · ` : ''}{formData.operationName || 'Your Operation'} · California
              </p>
            </div>
            <div style={{ padding: '28px 32px' }}><OSPRenderer text={generatedOSP} /></div>
          </div>
        </>
      )}

      {!generatedOSP && (
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 16 }}>
          <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: 'white', color: '#374151', fontSize: 14, cursor: 'pointer' }}>
            <ArrowLeft size={15} /> Back to Fill Details
          </button>
        </div>
      )}
    </div>
  );
}

function OSPRenderer({ text }) {
  const lines = text.split('\n');
  return (
    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1.75, color: '#1e293b' }}>
      {lines.map((line, i) => {
        if (/^##\s/.test(line)) return <h3 key={i} style={{ fontSize: 13, fontWeight: 700, color: 'var(--u-navy)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 28, marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid #e2e8f0' }}>{line.replace(/^##\s/, '')}</h3>;
        if (/^#\s/.test(line)) return <h2 key={i} style={{ fontFamily: 'Lora, serif', fontSize: 18, color: 'var(--u-navy)', marginTop: 32, marginBottom: 10 }}>{line.replace(/^#\s/, '')}</h2>;
        if (/^[-*]\s/.test(line)) return <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, paddingLeft: 10 }}><span style={{ color: '#94a3b8' }}>•</span><span dangerouslySetInnerHTML={{ __html: renderOspInline(line.replace(/^[-*]\s/, '')) }} /></div>;
        if (line.trim() === '') return <div key={i} style={{ height: 7 }} />;
        return <p key={i} style={{ margin: '0 0 5px' }} dangerouslySetInnerHTML={{ __html: renderOspInline(line) }} />;
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OSPGenerator({ profile, onUpdateProfile, onNavigate, userId }) {
  const { lang } = useLanguage();

  const [wizStep, setWizStep] = useState('template'); // 'template' | 'fill' | 'generate'
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [customFile, setCustomFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedOSP, setGeneratedOSP] = useState('');
  const [genError, setGenError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [isAIField, setIsAIField] = useState(false);
  const aiRef = useRef('');
  const fileInputRef = useRef(null);

  const [formData, setFormData] = useState(() => {
    const saved = loadFromStorage('orgpath_osp_form');
    return saved || {
      operationName: profile?.operationName || '', ownerName: profile?.ownerName || '',
      address: '', city: '', county: profile?.county || '', zip: '', phone: '', email: '',
      operationType: profile?.operationType || '', crops: profile?.crops || '',
      acreage: profile?.acreage || '', organicAcreage: '',
      grossSales: profile?.grossSales || '', registrationPath: profile?.registrationPath || '',
      landFreeYears: profile?.landFreeYears || '', lastProhibitedSubstance: profile?.lastProhibitedSubstance || '',
      fieldHistory: '', cropRotation: '', practices: profile?.practices || '',
      pestManagement: '', harvestHandling: '', inputs: profile?.inputs || '',
      seedSources: '', buffers: profile?.buffers || '', monitoring: profile?.monitoring || '',
      salesInfo: '', labelingInfo: '', supplyChain: '', productFormulation: '',
      foodSafetyPlan: '', waterManagement: '', workerTraining: '', workerHygiene: '',
      allowedChecked: profile?.allowedChecked || {}, prohibitedChecked: profile?.prohibitedChecked || {},
      certifierName: profile?.certifierName || '', certifierContact: profile?.certifierContact || '',
      certifierId: profile?.certifierId || '',
      registrationNotes: '', nopCoreNotes: '',
    };
  });

  const update = (key, val) => {
    const next = { ...formData, [key]: val };
    setFormData(next);
    saveToStorage('orgpath_osp_form', next);
    if (onUpdateProfile) onUpdateProfile(next);
    if (userId) debouncedSync(userId, 'operation_data', next);
  };

  const updateMany = (fields) => {
    const next = { ...formData, ...fields };
    setFormData(next);
    saveToStorage('orgpath_osp_form', next);
    if (onUpdateProfile) onUpdateProfile(next);
    if (userId) debouncedSync(userId, 'operation_data', next);
  };

  const AI_PROMPTS = {
    practices: `Suggest detailed soil fertility and nutrient management practices appropriate for this California organic operation. Be specific about amendments, composting, cover crops, and timing.`,
    pestManagement: `Suggest an organic pest, weed, and disease management plan following the NOP §205.206 hierarchy (prevention first, then mechanical, biological, then allowed materials) for this California operation.`,
    inputs: `Create a sample input materials list for this operation listing fertilizers, pest controls, and materials with their OMRI status and NOP compliance.`,
    monitoring: `Suggest a recordkeeping and monitoring system that creates a complete 5-year audit trail per NOP §205.103 for this operation.`,
    buffers: `Suggest physical buffer zone descriptions and contamination prevention measures appropriate for a California organic farm based on typical adjacent land uses.`,
    cropRotation: `Suggest a 3-4 year crop rotation plan for this operation that addresses soil health, pest management, and nutrient management per NOP §205.205.`,
    harvestHandling: `Describe harvest and post-harvest handling practices that prevent commingling and contamination for this organic operation.`,
    seedSources: `Describe an organic seed sourcing approach including suppliers and a commercial availability search documentation process per NOP §205.204.`,
    fieldHistory: `Describe field history documentation for organic transition — what records to provide to demonstrate 36 months free of prohibited substances.`,
    supplyChain: `Describe an ingredient sourcing and supply chain documentation system for an organic processed product operation under NOP and QAI/NSF requirements.`,
    productFormulation: `Provide guidance on calculating organic percentages for a processed organic product per NOP §205.302 and write a sample formulation documentation.`,
    foodSafetyPlan: `Describe a food safety management system for a dual-certified (NOP organic + Primus GFS) California produce operation.`,
    waterManagement: `Describe an agricultural water management program that addresses both NOP contamination prevention and FSMA Produce Safety Rule §112 water testing requirements.`,
  };

  const onGenerate = async (fieldKey) => {
    if (isAIField) return;
    setIsAIField(true);
    aiRef.current = '';
    const system = `You are a California organic certification expert. The user is completing their Organic System Plan. Provide practical, specific, submission-ready content in ${lang === 'es' ? 'Spanish' : 'English'}.
Operation: ${formData.operationName || 'Unknown'}, Type: ${formData.operationType || 'crop'}, Crops: ${formData.crops || 'various'}, County: ${formData.county || 'California'}`;
    setFormData(prev => ({ ...prev, [fieldKey]: '' }));
    try {
      await streamClaude(
        [{ role: 'user', content: AI_PROMPTS[fieldKey] || `Provide guidance for ${fieldKey} in an organic system plan.` }],
        (chunk) => {
          aiRef.current += chunk;
          setFormData(prev => ({ ...prev, [fieldKey]: aiRef.current }));
        },
        system
      );
      const final = aiRef.current;
      setFormData(prev => {
        const next = { ...prev, [fieldKey]: final };
        saveToStorage('orgpath_osp_form', next);
        if (onUpdateProfile) onUpdateProfile(next);
        return next;
      });
    } catch { /* ignore */ }
    setIsAIField(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError('');
    setGeneratedOSP('');
    try {
      const system = `You are an expert organic certification consultant. Generate a complete, professional, submission-ready Organic System Plan (OSP) for a California operation. Write in first-person voice. Be specific — vague language triggers inspector follow-up. Include NOP section citations. Mark missing data as [NEEDS OPERATOR INPUT: description]. Respond in ${lang === 'es' ? 'Spanish' : 'English'}.`;

      let userContent;
      if (customFile) {
        const textInstr = `Fill out this certifier's OSP template completely using the operator profile data below.\n\n${JSON.stringify(formData, null, 2)}`;
        if (customFile.isText) {
          userContent = `${textInstr}\n\nTEMPLATE:\n${customFile.textContent}`;
        } else if (customFile.mimeType === 'application/pdf') {
          userContent = [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: customFile.data } },
            { type: 'text', text: textInstr },
          ];
        } else {
          userContent = [
            { type: 'image', source: { type: 'base64', media_type: customFile.mimeType, data: customFile.data } },
            { type: 'text', text: textInstr },
          ];
        }
      } else {
        const tmpl = selectedTemplate;
        const secs = tmpl ? tmpl.sections.map(s => `Section ${s.num}: ${s.title}\n${s.instructions}`).join('\n\n') : '';
        userContent = `Generate a complete ${tmpl ? tmpl.name + ' format' : 'NOP-compliant'} OSP.

${tmpl ? `CERTIFIER GUIDANCE: ${tmpl.aiPromptHints}\n\nSECTIONS:\n${secs}\n\n` : ''}OPERATOR DATA:
${JSON.stringify(formData, null, 2)}

Use markdown: ## for section headings, **bold** for field labels, bullet lists for items. Write complete, submission-ready content for every section.`;
      }

      const text = await callClaude([{ role: 'user', content: userContent }], system);
      setGeneratedOSP(text);
    } catch (err) {
      setGenError('Could not generate OSP. Check your connection and try again.');
    }
    setGenerating(false);
  };

  const handleFileSelect = async (e) => {
    setFileError('');
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setFileError('File too large — max 15 MB.'); return; }
    const mimeType = file.type || 'application/octet-stream';
    const isText = mimeType.startsWith('text/') || /\.(txt|md)$/i.test(file.name);
    const isImage = mimeType.startsWith('image/');
    try {
      if (isText) { const textContent = await readText(file); setCustomFile({ name: file.name, size: file.size, mimeType: mimeType || 'text/plain', isText: true, textContent }); }
      else { const data = await readBase64(file); const preview = isImage ? URL.createObjectURL(file) : null; setCustomFile({ name: file.name, size: file.size, mimeType, isText: false, data, preview }); }
      setSelectedTemplate(null);
    } catch { setFileError('Could not read file.'); }
  };

  const clearFile = () => { if (customFile?.preview) URL.revokeObjectURL(customFile.preview); setCustomFile(null); setFileError(''); };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportOSPtoWord({ ...formData, practices: generatedOSP || formData.practices }, lang);
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (err) { console.error(err); }
    setExporting(false);
  };

  const STEPS = ['template', 'fill', 'generate'];
  const STEP_LABELS = ['Choose Template', 'Fill Details', 'Generate & Export'];

  return (
    <div style={{ padding: '32px 28px', maxWidth: 960, margin: '0 auto', paddingBottom: 80 }}>
      <style>{`@keyframes osp-blink{0%,100%{opacity:1}50%{opacity:0}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'Lora, serif', fontSize: 28, color: 'var(--u-navy)', marginBottom: 6 }}>
          OSP Generator
        </h1>
        <p style={{ color: '#64748b', fontSize: 14 }}>Choose your certifier's format, fill in your farm details, and generate a submission-ready Organic System Plan.</p>
      </div>

      {/* Step progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 20, background: wizStep === s ? 'var(--u-navy)' : STEPS.indexOf(wizStep) > i ? '#e8f5e9' : '#f1f5f9', cursor: STEPS.indexOf(wizStep) > i ? 'pointer' : 'default' }}
              onClick={() => { if (STEPS.indexOf(wizStep) > i) setWizStep(s); }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: wizStep === s ? 'rgba(255,255,255,0.2)' : STEPS.indexOf(wizStep) > i ? '#1B6B2E' : '#cbd5e1', fontSize: 11, fontWeight: 700, color: wizStep === s ? 'white' : STEPS.indexOf(wizStep) > i ? 'white' : '#64748b' }}>
                {STEPS.indexOf(wizStep) > i ? '✓' : i + 1}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: wizStep === s ? 'white' : STEPS.indexOf(wizStep) > i ? '#1B6B2E' : '#94a3b8' }}>{STEP_LABELS[i]}</span>
            </div>
            {i < STEPS.length - 1 && <div style={{ width: 24, height: 2, background: STEPS.indexOf(wizStep) > i ? '#1B6B2E' : '#e2e8f0' }} />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div key={wizStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }}>
          {wizStep === 'template' && (
            <TemplateLibraryStep
              selected={selectedTemplate} customFile={customFile}
              onSelect={setSelectedTemplate} onClearFile={clearFile}
              onFileSelect={handleFileSelect} fileInputRef={fileInputRef}
              fileError={fileError} setFileError={setFileError}
              onContinue={() => setWizStep('fill')}
            />
          )}
          {wizStep === 'fill' && (
            <FillDetailsStep
              formData={formData} update={update} updateMany={updateMany}
              selectedTemplate={selectedTemplate} customFile={customFile}
              generating={isAIField} onGenerate={onGenerate}
              onBack={() => setWizStep('template')}
              onContinue={() => setWizStep('generate')}
              lang={lang}
            />
          )}
          {wizStep === 'generate' && (
            <GenerateStep
              formData={formData} selectedTemplate={selectedTemplate} customFile={customFile}
              generating={generating} generatedOSP={generatedOSP}
              genError={genError} onGenerate={handleGenerate}
              onExport={handleExport} exporting={exporting} exported={exported}
              onBack={() => setWizStep('fill')} lang={lang}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
