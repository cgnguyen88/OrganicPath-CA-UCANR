import { describe, it, expect } from 'vitest';
import { dropLeadingAssistantTurns, describeChatError } from './chatMessages.js';

describe('dropLeadingAssistantTurns', () => {
  it('removes the UI greeting so the conversation starts with the user (the API rejects an assistant-first conversation)', () => {
    const messages = [
      { role: 'assistant', content: 'Hi, I am Jimmy' },
      { role: 'user', content: 'Question' },
    ];
    expect(dropLeadingAssistantTurns(messages)).toEqual([{ role: 'user', content: 'Question' }]);
  });

  it('keeps later assistant turns', () => {
    const messages = [
      { role: 'assistant', content: 'greeting' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    expect(dropLeadingAssistantTurns(messages).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('removes several leading assistant turns', () => {
    expect(dropLeadingAssistantTurns([{ role: 'assistant' }, { role: 'assistant' }, { role: 'user' }])).toEqual([{ role: 'user' }]);
  });

  it('leaves a user-first conversation untouched and does not mutate its input', () => {
    const input = [{ role: 'user', content: 'q' }];
    const output = dropLeadingAssistantTurns(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });

  it('returns an empty list when there is no user turn at all', () => {
    expect(dropLeadingAssistantTurns([{ role: 'assistant', content: 'hi' }])).toEqual([]);
  });
});

describe('describeChatError', () => {
  const notSignedIn = Object.assign(new Error('x'), { code: 'not_signed_in' });
  const http = (status) => Object.assign(new Error(`API error: ${status}`), { status });

  it.each([
    ['not signed in (no session)', notSignedIn],
    ['401 from the server', http(401)],
  ])('tells the user to sign in again for %s, in both languages', (_label, err) => {
    expect(describeChatError(err, 'en')).toMatch(/sign in/i);
    expect(describeChatError(err, 'es')).toMatch(/inicia sesión/i);
  });

  it('asks the user to slow down on 429', () => {
    expect(describeChatError(http(429), 'en')).toMatch(/too many|slow/i);
    expect(describeChatError(http(429), 'es')).toMatch(/demasiad|espera/i);
  });

  it('says the request is too large on 413 or 400', () => {
    expect(describeChatError(http(413), 'en')).toMatch(/too large|shorter/i);
    expect(describeChatError(http(400), 'en')).toMatch(/too large|shorter|rejected/i);
  });

  it.each([[http(500)], [http(502)], [http(503)], [new Error('network down')], [undefined]])(
    'falls back to the generic try-again message for %j',
    (err) => {
      expect(describeChatError(err, 'en')).toMatch(/error connecting to jimmy/i);
      expect(describeChatError(err, 'es')).toMatch(/error conectando con jimmy/i);
    },
  );

  it('defaults to English for an unknown language', () => {
    expect(describeChatError(http(500), 'fr')).toMatch(/error connecting to jimmy/i);
  });
});
