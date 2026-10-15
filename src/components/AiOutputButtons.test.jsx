// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AiOutputButtons from './AiOutputButtons.jsx';

afterEach(cleanup);

const actions = (extra = {}) => ({ copied: false, copyFailed: false, downloadFailed: false, downloading: false, copy: vi.fn(), download: vi.fn(), ...extra });

describe('AiOutputButtons', () => {
  it('has a Copy and a Download Word button that act, and are plain buttons (never submit a form)', async () => {
    const a = actions();
    render(<form onSubmit={(e) => e.preventDefault()}><AiOutputButtons actions={a} /></form>);
    const copy = screen.getByRole('button', { name: 'Copy' });
    const download = screen.getByRole('button', { name: /Download Word/ });
    expect(copy.getAttribute('type')).toBe('button');
    expect(download.getAttribute('type')).toBe('button');
    await userEvent.click(copy);
    await userEvent.click(download);
    expect(a.copy).toHaveBeenCalledTimes(1);
    expect(a.download).toHaveBeenCalledTimes(1);
  });

  it('says Copied, and tells screen readers politely', () => {
    render(<AiOutputButtons actions={actions({ copied: true })} />);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Copied');
  });

  it('keeps the live message empty until something is copied', () => {
    render(<AiOutputButtons actions={actions()} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows a failed copy and a failed download as alerts', () => {
    const { rerender } = render(<AiOutputButtons actions={actions({ copyFailed: true })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Could not copy/);
    rerender(<AiOutputButtons actions={actions({ downloadFailed: true })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Could not create the Word file/);
  });

  it('shows no alert when nothing failed', () => {
    render(<AiOutputButtons actions={actions()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cannot be used while the text is still being written, or while a file is being made', async () => {
    const a = actions();
    const { rerender } = render(<AiOutputButtons actions={a} disabled />);
    expect(screen.getByRole('button', { name: 'Copy' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Download Word/ }).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(a.copy).not.toHaveBeenCalled();
    rerender(<AiOutputButtons actions={actions({ downloading: true })} />);
    expect(screen.getByRole('button', { name: 'Copy' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /Download Word/ }).disabled).toBe(true);
  });

  it('uses the labels it is given, so a Spanish screen reads Spanish', () => {
    const labels = { copy: 'Copiar', copied: 'Copiado', download: 'Descargar Word', copyFailed: 'No se pudo copiar.', downloadFailed: 'No se pudo crear el archivo.' };
    render(<AiOutputButtons actions={actions({ downloadFailed: true })} labels={labels} />);
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descargar Word' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('No se pudo crear el archivo.');
  });

  it('keeps English for a label that was not given', () => {
    render(<AiOutputButtons actions={actions()} labels={{ download: 'Descargar Word' }} />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('can leave out Copy, and give the download button a colour', () => {
    render(<AiOutputButtons actions={actions()} showCopy={false} accent="#7c3aed" />);
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.getByRole('button', { name: /Download Word/ }).style.background).toBe('rgb(124, 58, 237)');
  });
});
