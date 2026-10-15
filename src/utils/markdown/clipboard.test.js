// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./plain.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, markdownToPlainText: vi.fn(real.markdownToPlainText) };
});
const { markdownToPlainText } = await import('./plain.js');
const { copyAiText } = await import('./clipboard.js');

afterEach(() => vi.unstubAllGlobals());

const withClipboard = (writeText) => vi.stubGlobal('navigator', { clipboard: { writeText } });

describe('copyAiText', () => {
  it('copies the text without markdown marks, and says it worked', async () => {
    const writeText = vi.fn().mockResolvedValue();
    withClipboard(writeText);
    await expect(copyAiText('## Plan\n\n- **one**\n- two')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('Plan\n\n• one\n• two');
  });

  it('says it did not work when the browser refuses, instead of throwing', async () => {
    withClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    await expect(copyAiText('x')).resolves.toBe(false);
  });

  it('says it did not work when there is no clipboard at all', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyAiText('x')).resolves.toBe(false);
  });

  it('does not copy nothing: empty text is not a success', async () => {
    const writeText = vi.fn().mockResolvedValue();
    withClipboard(writeText);
    await expect(copyAiText('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says it did not work, instead of throwing, when the text cannot be converted', async () => {
    withClipboard(vi.fn().mockResolvedValue());
    markdownToPlainText.mockImplementationOnce(() => { throw new Error('boom'); });
    await expect(copyAiText('x')).resolves.toBe(false);
  });
});

