import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The server owns every system prompt (api/_lib/modes.js). A screen that sends its own would be
// silently ignored today, but it signals someone is relying on a prompt that no longer applies.
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.jsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

describe('client code and system prompts', () => {
  const callers = sourceFiles(path.resolve(__dirname, '..')).filter((file) => fs.readFileSync(file, 'utf8').includes('/api/claude'));

  it('finds the screens that call the AI proxy', () => {
    expect(callers.length).toBeGreaterThanOrEqual(10);
  });

  it.each(callers.map((file) => [path.relative(path.resolve(__dirname, '..'), file), file]))('%s does not send a system prompt', (_name, file) => {
    const text = fs.readFileSync(file, 'utf8');
    const bodies = [...text.matchAll(/JSON\.stringify\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    for (const body of bodies) expect(body).not.toMatch(/(^|[\s,{])system\s*[:,]/);
    expect(text).not.toMatch(/JIMMY_SYSTEM/);
  });
});
