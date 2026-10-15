import { authedFetch } from '../lib/apiClient.js';
import { dropLeadingAssistantTurns, describeChatError } from '../lib/chatMessages.js';
import AiText from './AiText.jsx';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, ChevronDown, Carrot, Paperclip, FileText, Image, File, AlertCircle } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import t from '../data/translations.js';

// Accepted file types
const ACCEPTED_TYPES = {
  'application/pdf': { label: 'PDF', icon: FileText, color: '#dc2626' },
  'image/jpeg': { label: 'Image', icon: Image, color: '#0284c7' },
  'image/png': { label: 'Image', icon: Image, color: '#0284c7' },
  'image/webp': { label: 'Image', icon: Image, color: '#0284c7' },
  'image/gif': { label: 'Image', icon: Image, color: '#0284c7' },
  'text/plain': { label: 'Text', icon: FileText, color: '#059669' },
  'text/markdown': { label: 'Text', icon: FileText, color: '#059669' },
  'text/csv': { label: 'CSV', icon: FileText, color: '#7c3aed' },
};
const ACCEPT_ATTR = Object.keys(ACCEPTED_TYPES).join(',') + ',.md,.txt,.csv';
const MAX_SIZE_MB = 15;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:mime/type;base64,XXXXX" — strip prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function callClaude(messages, onChunk, lang) {
  try {
    const res = await authedFetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        mode: 'chat',
        lang,
        stream: true,
      }),
    });

    if (!res.ok) throw Object.assign(new Error(`API error: ${res.status}`), { status: res.status });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data);
            const text = json.choices?.[0]?.delta?.content
              || json.delta?.text
              || json.content?.[0]?.text
              || '';
            if (text) onChunk(text);
          } catch {}
        }
      }
    }
  } catch (err) {
    onChunk(`\n\n[${describeChatError(err, lang)}]`);
  }
}

// Build the API-formatted message content from display message
function toApiContent(msg) {
  if (!msg.attachment) return msg.content;
  const { mimeType, data, isText, textContent } = msg.attachment;

  if (isText) {
    return `[Attached file: ${msg.attachment.name}]\n\n${textContent}\n\n${msg.content}`.trim();
  }
  if (mimeType === 'application/pdf') {
    return [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
      { type: 'text', text: msg.content || 'Please analyze this document.' },
    ];
  }
  // images
  return [
    { type: 'image', source: { type: 'base64', media_type: mimeType, data } },
    { type: 'text', text: msg.content || 'Please analyze this image.' },
  ];
}

function AttachmentBadge({ attachment, onRemove }) {
  const meta = ACCEPTED_TYPES[attachment.mimeType] || { label: 'File', icon: File, color: '#64748b' };
  const Icon = meta.icon;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '6px 10px', borderRadius: 8,
      background: meta.color + '12', border: `1px solid ${meta.color}30`,
      maxWidth: '100%',
    }}>
      {attachment.preview
        ? <img src={attachment.preview} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
        : <Icon size={16} color={meta.color} style={{ flexShrink: 0 }} />
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {attachment.name}
        </p>
        <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>{meta.label} · {formatSize(attachment.size)}</p>
      </div>
      {onRemove && (
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#94a3b8', flexShrink: 0 }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export default function ExpandableChat({ profile }) {
  const { lang } = useLanguage();
  const tx = t[lang].chat;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: 'assistant', content: tx.welcome }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [attachment, setAttachment] = useState(null); // pending file
  const [fileError, setFileError] = useState('');

  const messagesEndRef = useRef(null);
  const scrollAreaRef = useRef(null);
  const pendingRef = useRef('');
  const fileInputRef = useRef(null);

  // Auto-open after 2s on first visit
  useEffect(() => {
    const alreadySeen = sessionStorage.getItem('jimmy_opened');
    if (alreadySeen) return;
    const timer = setTimeout(() => {
      setOpen(true);
      sessionStorage.setItem('jimmy_opened', '1');
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Reset welcome on lang change
  useEffect(() => {
    setMessages([{ role: 'assistant', content: t[lang].chat.welcome }]);
  }, [lang]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => {
    if (open) setTimeout(scrollToBottom, 50);
  }, [open, messages.length]);

  const handleScroll = () => {
    if (!scrollAreaRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollAreaRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 60);
  };

  const handleFileSelect = async (e) => {
    setFileError('');
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    if (!file) return;

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setFileError(`File too large. Maximum size is ${MAX_SIZE_MB} MB.`);
      return;
    }

    const mimeType = file.type || 'application/octet-stream';
    if (!ACCEPTED_TYPES[mimeType] && !file.name.match(/\.(txt|md|csv)$/i)) {
      setFileError('Unsupported file type. Upload a PDF, image, or text file.');
      return;
    }

    const isText = mimeType.startsWith('text/') || file.name.match(/\.(txt|md|csv)$/i);
    const isImage = mimeType.startsWith('image/');

    try {
      if (isText) {
        const textContent = await readFileAsText(file);
        setAttachment({ name: file.name, size: file.size, mimeType: mimeType || 'text/plain', isText: true, textContent });
      } else {
        const data = await readFileAsBase64(file);
        const preview = isImage ? URL.createObjectURL(file) : null;
        setAttachment({ name: file.name, size: file.size, mimeType, isText: false, data, preview });
      }
    } catch {
      setFileError('Could not read file. Please try again.');
    }
  };

  const clearAttachment = () => {
    if (attachment?.preview) URL.revokeObjectURL(attachment.preview);
    setAttachment(null);
    setFileError('');
  };

  const sendMessage = async (text) => {
    if ((!text.trim() && !attachment) || loading) return;

    const displayContent = text.trim() || (attachment
      ? (lang === 'es' ? 'Por favor analiza este archivo.' : 'Please analyze this file.')
      : '');

    const userMsg = { role: 'user', content: displayContent, attachment: attachment || undefined };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setAttachment(null);
    setLoading(true);
    pendingRef.current = '';

    const contextMsg = profile?.operationName
      ? `[Context: User's operation is "${profile.operationName}", type: ${profile.operationType || 'unknown'}, crops: ${profile.crops || 'unknown'}, county: ${profile.county || 'California'}]\n\n`
      : '';

    const apiMessages = dropLeadingAssistantTurns(newMessages).map((m, i) => {
      const apiContent = toApiContent(m);
      if (i === 0 && m.role === 'user') {
        return { role: m.role, content: typeof apiContent === 'string' ? contextMsg + apiContent : apiContent };
      }
      return { role: m.role, content: apiContent };
    });

    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    await callClaude(apiMessages, (chunk) => {
      pendingRef.current += chunk;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: pendingRef.current };
        return updated;
      });
      scrollToBottom();
    }, lang);

    setLoading(false);
  };

  const canSend = (input.trim() || attachment) && !loading;

  return (
    <>
      {/* Floating toggle button */}
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.93 }}
        style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 999,
          width: 58, height: 58, borderRadius: '50%',
          background: open
            ? 'linear-gradient(135deg, #374151, #1f2937)'
            : '#FDC101',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: open
            ? '0 4px 20px rgba(0,0,0,0.3)'
            : '0 8px 30px rgba(253,193,1,0.4)',
          color: 'white',
          fontSize: 28,
        }}
        className="chat-toggle no-print"
        aria-label={lang === 'es' ? (open ? 'Cerrar el chat con Jimmy' : 'Chatear con Jimmy') : (open ? 'Close chat with Jimmy' : 'Chat with Jimmy')}
        aria-expanded={open}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={open ? 'close' : 'open'}
            initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
            transition={{ duration: 0.15 }}
          >
            {open ? <X size={24} /> : '🍓'}
          </motion.div>
        </AnimatePresence>
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed', bottom: 96, right: 28, zIndex: 998,
              width: 390, height: 560,
              background: 'white',
              borderRadius: 18,
              boxShadow: '0 16px 60px rgba(0,0,0,0.2)',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              border: '1px solid #e2e8f0',
            }}
            className="chat-panel no-print"
          >
            {/* Header */}
            <div style={{
              padding: '16px 24px',
              background: '#0D3E70',
              display: 'flex', alignItems: 'center', gap: 14,
              borderBottom: '1px solid rgba(255,255,255,0.1)',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: '#FDC101',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                fontSize: 22,
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)',
              }}>
                🍓
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: 'white', fontWeight: 800, fontSize: 18, margin: 0, lineHeight: 1.2 }}>{tx.name}</p>
                <p style={{ color: '#FDC101', fontSize: 10, fontWeight: 800, margin: '2px 0 0', letterSpacing: '0.05em' }}>{tx.tagline}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.15)',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', transition: 'background 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              >
                <X size={18} strokeWidth={2.5} />
              </button>
            </div>

            {/* Quick chips (redesigned to footer-style suggestions) */}
            <div style={{
              padding: '12px 16px',
              display: 'flex', flexWrap: 'wrap', gap: 8,
              background: 'white',
              borderTop: '1px solid #edf2f7',
            }}>
              {tx.chips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => sendMessage(chip)}
                  style={{
                    padding: '6px 14px', borderRadius: '100px',
                    border: '1.5px solid #0D3E70', background: 'transparent',
                    color: '#0D3E70', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#0D3E70'; e.currentTarget.style.color = 'white'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#0D3E70'; }}
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div
              ref={scrollAreaRef}
              onScroll={handleScroll}
              style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20, background: '#F9FBFC' }}
            >
              {messages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-start' }}>
                  {msg.role === 'assistant' && (
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: '#FDC101', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, fontSize: 14, marginTop: 4,
                      boxShadow: '0 2px 6px rgba(253,193,1,0.3)'
                    }}>
                      🍓
                    </div>
                  )}
                  <div style={{
                    maxWidth: i === 0 && msg.role === 'assistant' ? '100%' : '80%',
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    {/* Attachment preview in bubble */}
                    {msg.attachment && (
                      <div style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <AttachmentBadge attachment={msg.attachment} />
                      </div>
                    )}
                    {/* Message text */}
                    {msg.content && (
                      <div style={{
                        padding: i === 0 && msg.role === 'assistant' ? '20px' : '12px 16px',
                        borderRadius: i === 0 && msg.role === 'assistant' ? '24px' : (msg.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px'),
                        background: msg.role === 'user' ? '#0D3E70' : 'white',
                        color: msg.role === 'user' ? 'white' : '#2D3748',
                        fontSize: 14,
                        lineHeight: 1.6,
                        boxShadow: msg.role === 'assistant' ? '0 4px 15px rgba(0,0,0,0.06)' : 'none',
                        border: msg.role === 'assistant' ? '1px solid #edf2f7' : 'none',
                        position: 'relative',
                      }}>
                        {msg.role === 'assistant' && msg.content === '' && loading ? (
                          <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
                            {[0, 1, 2].map(j => (
                              <div key={j} style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: '#cbd5e1',
                                animation: `bounce 1.4s infinite ease-in-out`,
                                animationDelay: `${j * 0.16}s`,
                              }} />
                            ))}
                          </div>
                        ) : (
                          msg.role === 'assistant'
                            ? <AiText text={msg.content} variant="chat" />
                            : <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>{msg.content}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Scroll to bottom button */}
            {showScrollBtn && (
              <button
                onClick={scrollToBottom}
                style={{
                  position: 'absolute', bottom: 70, right: 16,
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--u-navy)', border: 'none',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <ChevronDown size={14} color="white" />
              </button>
            )}

            {/* Input area */}
            <div style={{ borderTop: '1px solid #f1f5f9' }}>
              {/* Attachment preview + error */}
              <AnimatePresence>
                {(attachment || fileError) && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ padding: '8px 14px 0', overflow: 'hidden' }}
                  >
                    {fileError && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 4 }}>
                        <AlertCircle size={13} color="#dc2626" />
                        <span style={{ fontSize: 12, color: '#dc2626' }}>{fileError}</span>
                        <button onClick={() => setFileError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}><X size={12} /></button>
                      </div>
                    )}
                    {attachment && (
                      <AttachmentBadge attachment={attachment} onRemove={clearAttachment} />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <div style={{ padding: '10px 14px 12px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_ATTR}
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />

                {/* Attach button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  title={lang === 'es' ? 'Adjuntar archivo (PDF, imagen, texto)' : 'Attach file (PDF, image, text)'}
                  style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: attachment ? '#f97316' : '#f1f5f9',
                    border: attachment ? '2px solid #f97316' : '1.5px solid #e2e8f0',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s',
                    opacity: loading ? 0.5 : 1,
                  }}
                >
                  <Paperclip size={15} color={attachment ? 'white' : '#64748b'} />
                </button>

                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(input);
                    }
                  }}
                  placeholder={attachment
                    ? (lang === 'es' ? 'Añade un mensaje o envía solo el archivo…' : 'Add a message or just send the file…')
                    : tx.placeholder
                  }
                  rows={1}
                  style={{
                    flex: 1, padding: '9px 13px',
                    border: '1.5px solid #e2e8f0', borderRadius: 10,
                    fontSize: 13, fontFamily: 'Inter, sans-serif',
                    resize: 'none', outline: 'none',
                    maxHeight: 100, overflowY: 'auto',
                    lineHeight: 1.5,
                  }}
                />

                <button
                  onClick={() => sendMessage(input)}
                  disabled={!canSend}
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: canSend ? 'var(--u-navy)' : '#e2e8f0',
                    border: 'none', cursor: canSend ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'background 0.15s',
                  }}
                >
                  <Send size={15} color={canSend ? 'white' : '#94a3b8'} />
                </button>
              </div>

              {/* Upload hint */}
              <p style={{ textAlign: 'center', fontSize: 10, color: '#94a3b8', paddingBottom: 6, margin: 0 }}>
                {lang === 'es'
                  ? 'Sube OSP, formularios de certificadores, PDFs o imágenes'
                  : 'Upload OSP templates, certifier forms, PDFs or images'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
