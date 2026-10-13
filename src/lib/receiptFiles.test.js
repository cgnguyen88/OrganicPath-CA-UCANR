import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RECEIPT_FILE_MAX_BYTES, RECEIPT_FILE_TYPES, RECEIPT_FILE_ACCEPT, validateReceiptFile } from './receiptFiles.js';

const file = (type, size = 1000) => ({ type, size });

describe('validateReceiptFile', () => {
  it.each(RECEIPT_FILE_TYPES)('accepts %s', (type) => {
    expect(validateReceiptFile(file(type))).toEqual({ ok: true });
  });

  it.each(['image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/avif', 'text/html', 'application/zip', ''])(
    'rejects type %j (the bucket would refuse it, silently losing the attachment)',
    (type) => {
      expect(validateReceiptFile(file(type))).toEqual({ ok: false, code: 'type' });
    },
  );

  it('accepts a file of exactly the size limit and rejects one byte more', () => {
    expect(validateReceiptFile(file('application/pdf', RECEIPT_FILE_MAX_BYTES)).ok).toBe(true);
    expect(validateReceiptFile(file('application/pdf', RECEIPT_FILE_MAX_BYTES + 1))).toEqual({ ok: false, code: 'size' });
  });

  it('reports the type problem before the size problem', () => {
    expect(validateReceiptFile(file('image/gif', RECEIPT_FILE_MAX_BYTES + 1)).code).toBe('type');
  });

  it('builds the <input accept> list from the same types', () => {
    expect(RECEIPT_FILE_ACCEPT.split(',')).toEqual(RECEIPT_FILE_TYPES);
  });
});

describe('client and bucket agree', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/20261012000003_private_receipts_bucket.sql'), 'utf8');

  it('allows exactly the file types the private bucket allows', () => {
    const list = /allowed_mime_types[\s\S]*?array\[([^\]]+)\]/i.exec(sql.replace(/--.*$/gm, ''))?.[1] ?? '';
    const bucketTypes = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect([...RECEIPT_FILE_TYPES].sort()).toEqual(bucketTypes);
  });

  it('uses the same size limit as the bucket', () => {
    const limit = /file_size_limit[\s\S]*?(\d{6,})/i.exec(sql.replace(/--.*$/gm, ''))?.[1];
    expect(Number(limit)).toBe(RECEIPT_FILE_MAX_BYTES);
  });
});
