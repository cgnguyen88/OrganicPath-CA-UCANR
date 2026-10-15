import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, TextRun,
} from 'docx';
import { saveAs } from 'file-saver';
import { BULLET_NUMBERING, DOCX_STYLES, markdownToDocx } from './docx.js';

/**
 * A finished Word document from AI-written markdown: title, subtitle, the formatted text, and a
 * footer that says it is a draft to review. Used by every "download" button for AI text.
 */

const MAX_NAME_LENGTH = 80;
const FOOTER_NOTE = {
  en: 'AI-assisted draft prepared with OrganicPath CA. Review and verify before use.',
  es: 'Borrador preparado con OrganicPath CA (con ayuda de IA). Revísalo antes de usarlo.',
};
const PAGE_LABEL = { en: ['Page ', ' of '], es: ['Página ', ' de '] };

/** @param {unknown} name @returns {string} */
export function safeFileName(name) {
  const cleaned = String(name ?? '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/g, '');
  return cleaned || 'document';
}

function footerFor(lang) {
  const [page, of] = PAGE_LABEL[lang] ?? PAGE_LABEL.en;
  const small = { size: 17, color: '64748B' };
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1', space: 6 } },
        children: [
          new TextRun({ ...small, text: `${FOOTER_NOTE[lang] ?? FOOTER_NOTE.en}   ` }),
          new TextRun({ ...small, children: [page, PageNumber.CURRENT, of, PageNumber.TOTAL_PAGES] }),
        ],
      }),
    ],
  });
}

/**
 * @param {{ title: string, subtitle?: string, markdown?: unknown, lang?: 'en' | 'es' }} input
 * @returns {Document}
 */
export function buildAiDocument({ title, subtitle = '', markdown = '', lang = 'en' }) {
  const body = markdownToDocx(markdown);
  const heading = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title })] }),
    ...(subtitle ? [new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: subtitle, color: '64748B', size: 24 })] })] : []),
    ...(body.children.length ? [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } }, spacing: { after: 200 } })] : []),
  ];
  return new Document({
    creator: 'OrganicPath CA',
    title,
    styles: DOCX_STYLES,
    numbering: { config: [BULLET_NUMBERING, ...body.numbering] },
    sections: [{ footers: { default: footerFor(lang) }, children: [...heading, ...body.children] }],
  });
}

/**
 * Builds the document and offers it to the browser as a download.
 * @param {{ title: string, subtitle?: string, markdown?: unknown, lang?: 'en' | 'es', filename?: string }} input
 * @returns {Promise<void>}
 */
export async function downloadAiDocx({ filename, ...content }) {
  const blob = await Packer.toBlob(buildAiDocument(content));
  saveAs(blob, `${safeFileName(filename ?? content.title)}.docx`);
}
