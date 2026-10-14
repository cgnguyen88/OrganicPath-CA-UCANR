import { authedFetch } from '../../lib/apiClient.js';

/**
 * Asks the server to write a compliance document, and hands over the text as it is written.
 * Never throws: a failure is reported through `onError` with a message fit to show.
 *
 * @param {string} prompt what to write (the server owns the system prompt for this mode)
 * @param {(text: string) => void} onChunk
 * @param {(message: string) => void} onError
 */
export default async function streamClaude(prompt, onChunk, onError) {
  try {
    const response = await authedFetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], mode: 'record_generator', stream: true }),
    });
    if (!response.ok) throw new Error(`API ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        const text = textOf(data);
        if (text) onChunk(text);
      }
    }
  } catch (error) {
    onError(error.message);
  }
}

/** The text in one stream event, or '' for an event that has none (or that is not JSON). */
function textOf(data) {
  try {
    const json = JSON.parse(data);
    return json.choices?.[0]?.delta?.content || json.delta?.text || '';
  } catch {
    return ''; // a keep-alive or a half-formed event: nothing to show
  }
}
