import { describe, it, expect, vi, beforeEach } from 'vitest';

const saveAs = vi.fn();
vi.mock('file-saver', () => ({ saveAs: (...a) => saveAs(...a) }));
const { downloadCsv } = await import('./reportCsv.js');

const bytesOf = async (blob) => new Uint8Array(await new Response(blob).arrayBuffer());
const textOf = async (blob) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await bytesOf(blob));

beforeEach(() => saveAs.mockReset());

describe('downloadCsv', () => {
  it('saves the rows as a CSV file under the name it is given', async () => {
    downloadCsv([['Fecha', 'Producto'], ['2026-07-01', 'Cobre']], 'registros.csv');
    expect(saveAs).toHaveBeenCalledTimes(1);
    const [blob, name] = saveAs.mock.calls[0];
    expect(name).toBe('registros.csv');
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(await textOf(blob)).toBe('﻿Fecha,Producto\r\n2026-07-01,Cobre\r\n');
  });

  it('starts the file with the byte-order mark, so Excel reads accents correctly', async () => {
    downloadCsv([['Aplicación']], 'a.csv');
    const bytes = await bytesOf(saveAs.mock.calls[0][0]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('defuses spreadsheet formulas on the way out', async () => {
    downloadCsv([['=1+1']], 'a.csv');
    expect(await textOf(saveAs.mock.calls[0][0])).toContain("'=1+1");
  });
});
