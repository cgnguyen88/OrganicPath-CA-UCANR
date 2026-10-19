import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx|ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('the browser bundle', () => {
  it('reads build settings by name only: `import.meta.env` as a whole would put every VITE_ variable in the bundle', () => {
    const offenders = sourceFiles(SRC).filter((file) => /import\.meta\.env(?!\.[A-Z_][A-Z0-9_]*)/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never reads an API key or other server secret', () => {
    const secret = /import\.meta\.env\.VITE_[A-Z0-9_]*(SECRET|SERVICE_ROLE|ANTHROPIC|OPENROUTER|API_KEY|TOKEN)/;
    const offenders = sourceFiles(SRC).filter((file) => secret.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
