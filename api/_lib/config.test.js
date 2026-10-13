import { describe, it, expect } from 'vitest';
import { loadConfig, resolveAnthropicKey } from './config.js';

describe('loadConfig', () => {
  it('uses safe defaults', () => {
    const c = loadConfig({});
    expect(c.model).toBe('claude-sonnet-4-6');
    expect(c.maxOutputTokens).toBe(2048);
    expect(c.rate).toEqual({ perMinute: 20, perDay: 400 });
    expect(c.allowedOrigins).toEqual([]);
    expect(c.limits.maxTotalChars).toBe(200_000);
  });

  it('sizes attachment limits to the 15 MB UI cap (base64 is ~4/3 larger) and derives the body limit from them', () => {
    const c = loadConfig({});
    expect(c.limits.maxAttachmentChars).toBeGreaterThanOrEqual(Math.ceil((15 * 1024 * 1024 * 4) / 3));
    expect(c.limits.maxAttachments).toBeGreaterThan(0);
    expect(c.bodyLimitBytes).toBeGreaterThanOrEqual(c.limits.maxTotalAttachmentChars + c.limits.maxTotalChars);
  });

  it('reads overrides and trims the origin list', () => {
    const c = loadConfig({
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      AI_MAX_OUTPUT_TOKENS: '4096',
      AI_RATE_LIMIT_PER_MIN: '5',
      ALLOWED_ORIGINS: ' https://a.example , https://b.example ,',
    });
    expect(c.model).toBe('claude-sonnet-5-5');
    expect(c.maxOutputTokens).toBe(4096);
    expect(c.rate.perMinute).toBe(5);
    expect(c.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it.each([['abc'], ['-5'], ['0'], ['']])('falls back to the default for invalid number %j', (bad) => {
    expect(loadConfig({ AI_MAX_OUTPUT_TOKENS: bad }).maxOutputTokens).toBe(2048);
  });

  it('clamps max output tokens to a hard ceiling', () => {
    expect(loadConfig({ AI_MAX_OUTPUT_TOKENS: '999999' }).maxOutputTokens).toBe(16_000);
  });
});

describe('resolveAnthropicKey', () => {
  it('prefers ANTHROPIC_API_KEY', () => {
    expect(resolveAnthropicKey({ ANTHROPIC_API_KEY: 'a', CLAUDE_API_KEY: 'b' })).toMatchObject({ key: 'a' });
  });

  it('accepts the server-only CLAUDE_API_KEY alias', () => {
    expect(resolveAnthropicKey({ CLAUDE_API_KEY: 'b' })).toMatchObject({ key: 'b' });
  });

  it('refuses a key that only exists as VITE_ANTHROPIC_API_KEY (it ships to browsers) and says why', () => {
    const r = resolveAnthropicKey({ VITE_ANTHROPIC_API_KEY: 'sk-ant-exposed' });
    expect(r.key).toBeNull();
    expect(r.warning).toMatch(/VITE_ANTHROPIC_API_KEY/);
    expect(r.warning).toMatch(/rotate/i);
    expect(r.warning).not.toMatch(/sk-ant-exposed/);
  });

  it('warns even when a safe key is also present, because the exposed one must be rotated', () => {
    const r = resolveAnthropicKey({ ANTHROPIC_API_KEY: 'a', VITE_ANTHROPIC_API_KEY: 'x' });
    expect(r.key).toBe('a');
    expect(r.warning).toMatch(/rotate/i);
  });

  it('returns null with no warning when nothing is set', () => {
    expect(resolveAnthropicKey({})).toEqual({ key: null, warning: null });
  });
});
