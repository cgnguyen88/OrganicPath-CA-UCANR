import { markdownToPlainText } from './plain.js';

/**
 * Copies AI-written markdown to the clipboard as clean text, so what is pasted into an email or a
 * form has no markup in it. Never throws.
 *
 * @param {unknown} markdown
 * @returns {Promise<boolean>} true when the text was copied
 */
export async function copyAiText(markdown) {
  try {
    const text = markdownToPlainText(markdown);
    if (!text) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
