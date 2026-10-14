/**
 * The operation fields the OSP and wizard assistants may mention. The server picks the prompt (by
 * mode) and cleans these values again, so this only decides what is sent, not what is trusted.
 *
 * @param {Record<string, unknown> | null | undefined} formData
 * @returns {{ operationName?: string, operationType?: string, crops?: string, county?: string }}
 */
export function operationContext(formData) {
  const out = {};
  for (const key of ['operationName', 'operationType', 'crops', 'county']) {
    const value = formData?.[key];
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}
