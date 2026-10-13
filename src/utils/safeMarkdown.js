const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape text for safe insertion into HTML. Model output and user uploads are
 * untrusted: always escape BEFORE adding any markup of our own.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Escape, then apply the **bold** / *italic* subset of markdown. */
function renderInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

/**
 * Chat message → HTML safe for dangerouslySetInnerHTML.
 * @param {string} text
 * @returns {string}
 */
export function renderChatMarkdown(text) {
  return renderInline(text).replace(/\n/g, '<br/>');
}

/**
 * One OSP line → HTML safe for dangerouslySetInnerHTML, with the
 * [NEEDS OPERATOR INPUT: …] marker shown as a highlighted badge.
 * @param {string} text
 * @returns {string}
 */
export function renderOspInline(text) {
  return renderInline(text).replace(
    /\[NEEDS OPERATOR INPUT:(.*?)\]/g,
    '<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-size:12px;font-weight:600">⚠ NEEDS INPUT:$1</span>',
  );
}
