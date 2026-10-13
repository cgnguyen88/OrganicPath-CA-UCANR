import { render } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext.jsx';

/** Render a component inside the app's language context; `rerender` keeps the context in place. */
export function renderWithLang(ui, lang = 'en') {
  const wrap = (node) => <LanguageContext.Provider value={{ lang, toggleLang: () => {} }}>{node}</LanguageContext.Provider>;
  const result = render(wrap(ui));
  return { ...result, rerender: (next) => result.rerender(wrap(next)) };
}
