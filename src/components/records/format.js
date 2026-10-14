/** An amount of money in US dollars, for a farm in the United States, in the person's language. */
export function formatMoney(amount, lang) {
  return new Intl.NumberFormat(lang === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/** A number for people to read (an area, say): thousands separated, at most three decimals, nothing for what is not a number. */
export function formatNumber(value, lang) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return new Intl.NumberFormat(lang === 'es' ? 'es-US' : 'en-US', { maximumFractionDigits: 3 }).format(number);
}
