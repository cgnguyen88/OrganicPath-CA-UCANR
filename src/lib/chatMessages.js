/**
 * The Messages API requires a conversation to start with a user turn, but the
 * chat UI opens with an assistant greeting. Drop leading assistant turns before
 * sending; the greeting carries no information the model needs.
 *
 * @template {{ role: string }} T
 * @param {T[]} messages
 * @returns {T[]} a new array
 */
export function dropLeadingAssistantTurns(messages) {
  const firstUser = messages.findIndex((m) => m.role === 'user');
  return firstUser === -1 ? [] : messages.slice(firstUser);
}

const CHAT_ERRORS = {
  signIn: {
    en: 'Your session has expired or you are not signed in. Please sign in again to chat with Jimmy.',
    es: 'Tu sesión ha expirado o no has iniciado sesión. Inicia sesión de nuevo para hablar con Jimmy.',
  },
  slowDown: {
    en: 'Too many requests. Please wait a moment and try again.',
    es: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
  },
  tooLarge: {
    en: 'That message or attachment is too large. Try a shorter message or a smaller file.',
    es: 'El mensaje o el archivo es demasiado grande. Prueba con un mensaje más corto o un archivo más pequeño.',
  },
  generic: {
    en: 'Error connecting to Jimmy. Please try again.',
    es: 'Error conectando con Jimmy. Por favor intenta de nuevo.',
  },
};

/**
 * A user-facing explanation for a failed chat request, so "not signed in" is not
 * reported as a generic connection problem.
 *
 * @param {{ code?: string, status?: number } | undefined} err
 * @param {string} lang 'en' | 'es' (anything else falls back to English)
 * @returns {string}
 */
export function describeChatError(err, lang) {
  let key = 'generic';
  if (err?.code === 'not_signed_in' || err?.status === 401) key = 'signIn';
  else if (err?.status === 429) key = 'slowDown';
  else if (err?.status === 413 || err?.status === 400) key = 'tooLarge';
  return CHAT_ERRORS[key][lang === 'es' ? 'es' : 'en'];
}
