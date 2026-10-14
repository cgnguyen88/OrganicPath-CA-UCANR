import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig().agent', () => {
  it('has safe defaults: Opus 5.5, medium effort, non-strict tools', () => {
    const { agent } = loadConfig({});
    expect(agent.model).toBe('claude-opus-5-5');
    expect(agent.effort).toBe('medium');
    expect(agent.timeZone).toBe('America/Los_Angeles');
    expect(agent.strictTools).toBe(false);
    expect(agent.maxTokens).toBeGreaterThan(0);
    expect(agent.requestTimeoutMs).toBeGreaterThan(0);
    expect(agent.limits.maxTextChars).toBe(8000);
    expect(agent.limits.maxAttachments).toBe(3);
    // Own attachment caps, sized under Vercel's ~4.5 MB request body limit (not the legacy 20 MB ones).
    expect(agent.limits.maxAttachmentChars).toBeLessThanOrEqual(4_000_000);
    expect(agent.limits.maxTotalAttachmentChars).toBeLessThanOrEqual(4_200_000);
    expect(agent.limits.maxAttachmentChars).toBeLessThanOrEqual(agent.limits.maxTotalAttachmentChars);
    expect(agent.rate.perMinute).toBeLessThan(loadConfig({}).rate.perMinute);
    expect(agent.rate.globalPerDay).toBeGreaterThan(agent.rate.perDay); // a cap on everyone combined

  });

  it('is independent of the legacy proxy model setting', () => {
    expect(loadConfig({ ANTHROPIC_MODEL: 'claude-sonnet-4-6' }).agent.model).toBe('claude-opus-5-5');
  });

  it('reads overrides', () => {
    const { agent } = loadConfig({ AGENT_MODEL: 'claude-sonnet-5-5', AGENT_EFFORT: 'high', AGENT_MAX_TOKENS: '2000', AGENT_STRICT_TOOLS: 'true', AGENT_RATE_LIMIT_PER_MIN: '2', AGENT_RATE_LIMIT_GLOBAL_PER_DAY: '50' });
    expect(agent).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high', maxTokens: 2000, strictTools: true });
    expect(agent.rate.perMinute).toBe(2);
    expect(agent.rate.globalPerDay).toBe(50);
  });

  it.each([['ultra'], [''], ['HIGH ']])('ignores an unknown effort level %j', (bad) => {
    expect(loadConfig({ AGENT_EFFORT: bad }).agent.effort).toBe(bad === 'HIGH ' ? 'high' : 'medium');
  });

  it('clamps max tokens to a hard ceiling', () => {
    expect(loadConfig({ AGENT_MAX_TOKENS: '999999' }).agent.maxTokens).toBe(16_000);
  });

  it('is deeply frozen so a request can never change it', () => {
    const { agent } = loadConfig({});
    expect(Object.isFrozen(agent)).toBe(true);
    expect(Object.isFrozen(agent.limits)).toBe(true);
    expect(Object.isFrozen(agent.rate)).toBe(true);
  });
});
