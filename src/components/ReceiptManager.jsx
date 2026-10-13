import { useState, useEffect, useRef } from 'react';
import { RECEIPT_FILE_ACCEPT, validateReceiptFile } from '../lib/receiptFiles.js';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Receipt, Trash2, Download, Search, Plus, FileText, DollarSign, Calendar } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import {
  getReceipts as dbGetReceipts,
  addReceipt as dbAddReceipt,
  deleteReceipt as dbDeleteReceipt,
  uploadReceiptFile,
  deleteReceiptFile,
} from '../lib/db.js';

// Map Supabase snake_case row → component camelCase shape
const FILE_ERRORS = {
  type: {
    en: 'File type not allowed. Use JPG, PNG, WEBP, HEIC or PDF.',
    es: 'Tipo de archivo no permitido. Usa JPG, PNG, WEBP, HEIC o PDF.',
  },
  size: { en: 'That file is larger than 10 MB.', es: 'El archivo supera los 10 MB.' },
  upload: {
    en: "Couldn't upload the file. Check your connection and try again. The receipt was not saved.",
    es: 'No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo. El recibo no se guardó.',
  },
};
const fileErrorMessage = (code, lang) => FILE_ERRORS[code][lang === 'es' ? 'es' : 'en'];

function toLocal(row) {
  return {
    id: row.id,
    date: row.date,
    supplier: row.supplier,
    product: row.product,
    category: row.category,
    omriListed: row.omri_listed,
    quantity: row.quantity,
    unit: row.unit,
    totalCost: row.total_cost,
    invoiceNumber: row.invoice_number,
    notes: row.notes,
    fileName: row.file_name,
    filePath: row.file_path,
    addedAt: row.added_at,
  };
}

const CATEGORIES = {
  en: ['Fertilizer', 'Pesticide/Herbicide', 'Seed/Transplant', 'Soil Amendment', 'Cover Crop', 'Equipment', 'Livestock Feed', 'Other Input'],
  es: ['Fertilizante', 'Pesticida/Herbicida', 'Semilla/Trasplante', 'Enmienda del Suelo', 'Cultivo de Cobertura', 'Equipo', 'Alimento para Ganado', 'Otro Insumo'],
};

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString();
}

function formatCurrency(val) {
  const n = parseFloat(val);
  return isNaN(n) ? '-' : `$${n.toFixed(2)}`;
}

const EMPTY_FORM = {
  date: new Date().toISOString().split('T')[0],
  supplier: '', product: '', category: '', omriListed: '',
  quantity: '', unit: '', totalCost: '', invoiceNumber: '', notes: '', fileName: '',
};

export default function ReceiptManager({ userId }) {
  const { lang } = useLanguage();

  const [receipts, setReceipts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [filePreview, setFilePreview] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const fileRef = useRef();

  // Load receipts from Supabase on mount
  useEffect(() => {
    if (!userId) return;
    dbGetReceipts(userId).then(rows => setReceipts(rows.map(toLocal)));
  }, [userId]);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const check = validateReceiptFile(file);
    if (!check.ok) {
      e.target.value = '';
      setSaveError(fileErrorMessage(check.code, lang));
      return;
    }
    setSaveError('');
    setPendingFile(file);
    setForm(f => ({ ...f, fileName: file.name }));
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setFilePreview(ev.target.result);
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  };

  const addReceipt = async () => {
    if (!form.supplier || !form.product || !userId) return;
    setSaving(true);
    let filePath = null;
    let fileName = form.fileName;
    setSaveError('');
    if (pendingFile) {
      const result = await uploadReceiptFile(userId, pendingFile);
      if (!result) {
        // Keep the form open: saving the receipt without its file would silently lose the attachment.
        setSaveError(fileErrorMessage('upload', lang));
        setSaving(false);
        return;
      }
      filePath = result.path;
      fileName = pendingFile.name;
    }
    const row = await dbAddReceipt(userId, { ...form, fileName, filePath });
    if (row) setReceipts(prev => [toLocal(row), ...prev]);
    else if (filePath) await deleteReceiptFile(filePath); // don't leave an orphaned upload
    setForm(EMPTY_FORM);
    setFilePreview(null);
    setPendingFile(null);
    setShowForm(false);
    setSaving(false);
  };

  const deleteReceipt = async (id) => {
    if (await dbDeleteReceipt(id)) setReceipts(prev => prev.filter(r => r.id !== id));
  };

  const exportCSV = () => {
    const headers = ['Date', 'Supplier', 'Product', 'Category', 'OMRI Listed', 'Quantity', 'Unit', 'Total Cost', 'Invoice #', 'Notes', 'File'];
    const rows = receipts.map(r => [
      r.date, r.supplier, r.product, r.category, r.omriListed,
      r.quantity, r.unit, r.totalCost, r.invoiceNumber, r.notes, r.fileName,
    ].map(v => `"${(v || '').replace(/"/g, '""')}"`));
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `input-receipts-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const filtered = receipts.filter(r => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || r.supplier.toLowerCase().includes(q) || r.product.toLowerCase().includes(q) || r.invoiceNumber?.toLowerCase().includes(q);
    const matchCat = !filterCat || r.category === filterCat;
    return matchSearch && matchCat;
  });

  const totalSpent = receipts.reduce((sum, r) => sum + (parseFloat(r.totalCost) || 0), 0);

  const cats = CATEGORIES[lang];

  const tx = {
    title: lang === 'es' ? 'Gestor de Recibos de Insumos' : 'Input Receipt Manager',
    subtitle: lang === 'es'
      ? 'Guarda y organiza los recibos de todas tus compras de insumos orgánicos (requisito NOP §205.103)'
      : 'Save and organize receipts for all organic input purchases (NOP §205.103 requirement)',
    addBtn: lang === 'es' ? 'Agregar Recibo' : 'Add Receipt',
    exportBtn: lang === 'es' ? 'Exportar CSV' : 'Export CSV',
    supplier: lang === 'es' ? 'Proveedor' : 'Supplier',
    product: lang === 'es' ? 'Producto / Insumo' : 'Product / Input',
    category: lang === 'es' ? 'Categoría' : 'Category',
    omri: lang === 'es' ? 'Listado en OMRI' : 'OMRI Listed',
    quantity: lang === 'es' ? 'Cantidad' : 'Quantity',
    unit: lang === 'es' ? 'Unidad' : 'Unit',
    cost: lang === 'es' ? 'Costo Total ($)' : 'Total Cost ($)',
    invoice: lang === 'es' ? 'N° de Factura' : 'Invoice #',
    notes: lang === 'es' ? 'Notas' : 'Notes',
    attachFile: lang === 'es' ? 'Adjuntar Archivo (foto/PDF)' : 'Attach File (photo/PDF)',
    saveBtn: lang === 'es' ? 'Guardar Recibo' : 'Save Receipt',
    cancel: lang === 'es' ? 'Cancelar' : 'Cancel',
    search: lang === 'es' ? 'Buscar recibos...' : 'Search receipts...',
    allCats: lang === 'es' ? 'Todas las categorías' : 'All categories',
    noReceipts: lang === 'es' ? 'No hay recibos guardados. Agrega tu primer recibo.' : 'No receipts saved yet. Add your first receipt.',
    totalSpent: lang === 'es' ? 'Total Gastado' : 'Total Spent',
    recordCount: lang === 'es' ? 'Registros' : 'Records',
    date: lang === 'es' ? 'Fecha' : 'Date',
    yes: lang === 'es' ? 'Sí' : 'Yes',
    no: lang === 'es' ? 'No' : 'No',
    unknown: lang === 'es' ? 'Desconocido' : 'Unknown',
  };

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: '1.5px solid #e2e8f0', fontSize: 13,
    fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--u-navy)', fontFamily: 'Lora, serif', marginBottom: 6 }}>
            {tx.title}
          </h1>
          <p style={{ color: '#64748b', fontSize: 14 }}>{tx.subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {receipts.length > 0 && (
            <button onClick={exportCSV} style={{
              padding: '9px 16px', borderRadius: 9, border: '1.5px solid #e2e8f0',
              background: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 7, color: '#475569',
            }}>
              <Download size={14} /> {tx.exportBtn}
            </button>
          )}
          <button onClick={() => setShowForm(true)} style={{
            padding: '9px 16px', borderRadius: 9, border: 'none',
            background: 'var(--u-navy)', color: 'white', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <Plus size={14} /> {tx.addBtn}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { icon: Receipt, label: tx.recordCount, value: receipts.length, color: '#3AA8E4' },
          { icon: DollarSign, label: tx.totalSpent, value: `$${totalSpent.toFixed(2)}`, color: '#1B6B2E' },
          { icon: Calendar, label: lang === 'es' ? 'Último Registro' : 'Latest Entry', value: receipts[0] ? formatDate(receipts[0].date) : '-', color: '#FDBD10' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} style={{ background: 'white', borderRadius: 12, padding: '16px 20px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={18} color={color} />
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{label}</p>
              <p style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Add Receipt Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ marginBottom: 24, overflow: 'hidden' }}
          >
            <div style={{ background: 'white', borderRadius: 14, padding: 24, border: '1.5px solid var(--u-navy)', boxShadow: '0 4px 20px rgba(0,45,84,0.1)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--u-navy)', marginBottom: 18 }}>{tx.addBtn}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.date}</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.supplier} *</label>
                  <input type="text" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.product} *</label>
                  <input type="text" value={form.product} onChange={e => setForm(f => ({ ...f, product: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.category}</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                    <option value="">{tx.allCats}</option>
                    {cats.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.omri}</label>
                  <select value={form.omriListed} onChange={e => setForm(f => ({ ...f, omriListed: e.target.value }))} style={inputStyle}>
                    <option value="">{tx.unknown}</option>
                    <option value="yes">{tx.yes}</option>
                    <option value="no">{tx.no}</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.invoice}</label>
                  <input type="text" value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.quantity}</label>
                  <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.unit}</label>
                  <input type="text" placeholder="lbs, gal, bags..." value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.cost}</label>
                  <input type="number" step="0.01" value={form.totalCost} onChange={e => setForm(f => ({ ...f, totalCost: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.notes}</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tx.attachFile}</label>
                  <div
                    onClick={() => fileRef.current?.click()}
                    style={{
                      border: '2px dashed #cbd5e1', borderRadius: 10, padding: 20, textAlign: 'center',
                      cursor: 'pointer', background: '#f8fafc', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--u-navy)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#cbd5e1'}
                  >
                    {filePreview ? (
                      <img src={filePreview} alt="preview" style={{ maxHeight: 120, borderRadius: 8 }} />
                    ) : form.fileName ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#475569' }}>
                        <FileText size={18} /> {form.fileName}
                      </div>
                    ) : (
                      <div style={{ color: '#94a3b8', fontSize: 13 }}>
                        <Upload size={20} style={{ margin: '0 auto 6px' }} />
                        <p>{lang === 'es' ? 'Haz clic para subir foto o PDF del recibo' : 'Click to upload receipt photo or PDF'}</p>
                        <p style={{ fontSize: 11, marginTop: 2 }}>JPG, PNG, WEBP, HEIC, PDF · max 10 MB</p>
                      </div>
                    )}
                    <input ref={fileRef} type="file" accept={RECEIPT_FILE_ACCEPT} onChange={handleFile} style={{ display: 'none' }} />
                  </div>
                </div>
              </div>
              {saveError && (
                <div role="alert" style={{ marginTop: 14, padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13 }}>
                  {saveError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowForm(false); setFilePreview(null); setSaveError(''); }} style={{
                  padding: '9px 18px', borderRadius: 9, border: '1.5px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#475569',
                }}>{tx.cancel}</button>
                <button onClick={addReceipt} disabled={!form.supplier || !form.product || saving} style={{
                  padding: '9px 18px', borderRadius: 9, border: 'none',
                  background: form.supplier && form.product && !saving ? 'var(--u-navy)' : '#e2e8f0',
                  color: form.supplier && form.product && !saving ? 'white' : '#94a3b8',
                  cursor: form.supplier && form.product && !saving ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600,
                }}>{saving ? '...' : tx.saveBtn}</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search & filter */}
      {receipts.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder={tx.search}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ ...inputStyle, paddingLeft: 32, width: '100%' }}
            />
          </div>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: 160 }}>
            <option value="">{tx.allCats}</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {/* Receipts table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8', background: 'white', borderRadius: 14, border: '1px solid #e2e8f0' }}>
          <Receipt size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <p>{receipts.length === 0 ? tx.noReceipts : (lang === 'es' ? 'No se encontraron resultados.' : 'No results found.')}</p>
        </div>
      ) : (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                {[tx.date, tx.supplier, tx.product, tx.category, tx.omri, tx.quantity, tx.cost, tx.invoice, ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {filtered.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                  >
                    <td style={{ padding: '10px 14px', color: '#475569' }}>{formatDate(r.date)}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1e293b' }}>{r.supplier}</td>
                    <td style={{ padding: '10px 14px', color: '#1e293b' }}>
                      {r.product}
                      {r.fileName && <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}><FileText size={10} style={{ display: 'inline', marginRight: 3 }} />{r.fileName}</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {r.category && <span style={{ padding: '2px 8px', borderRadius: 12, background: '#f1f5f9', fontSize: 11, color: '#475569' }}>{r.category}</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {r.omriListed === 'yes' && <span style={{ padding: '2px 8px', borderRadius: 12, background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 600 }}>{tx.yes}</span>}
                      {r.omriListed === 'no' && <span style={{ padding: '2px 8px', borderRadius: 12, background: '#fef2f2', color: '#991b1b', fontSize: 11 }}>{tx.no}</span>}
                      {!r.omriListed && <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#475569' }}>{r.quantity ? `${r.quantity} ${r.unit || ''}` : '—'}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1B6B2E' }}>{formatCurrency(r.totalCost)}</td>
                    <td style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 12 }}>{r.invoiceNumber || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <button
                        onClick={() => deleteReceipt(r.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', padding: 4 }}
                        title={lang === 'es' ? 'Eliminar' : 'Delete'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      {/* NOP reminder */}
      <div style={{ marginTop: 18, padding: '10px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, fontSize: 12, color: '#92400e' }}>
        <strong>NOP §205.103:</strong> {lang === 'es'
          ? 'Debes conservar todos los registros de compra de insumos por un mínimo de 5 años. Estos registros son revisados durante las inspecciones anuales.'
          : 'You must retain all input purchase records for a minimum of 5 years. These records are reviewed during annual inspections.'}
      </div>
    </div>
  );
}
