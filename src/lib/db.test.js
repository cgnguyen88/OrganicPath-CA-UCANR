import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage = { upload: vi.fn(), createSignedUrl: vi.fn(), getPublicUrl: vi.fn(), remove: vi.fn() };
const rpc = vi.fn();
const from = vi.fn();
const bucketsUsed = [];
vi.mock('./supabase.js', () => ({
  supabase: { storage: { from: (bucket) => { bucketsUsed.push(bucket); return storage; } }, rpc: (...args) => rpc(...args), from: (...args) => from(...args) },
}));

const { uploadReceiptFile, getReceiptFileUrl, getRecordFileUrl, RECORD_URL_TTL_SECONDS, addReceipt, deleteReceipt, deleteReceiptFile, ensureMyFarm, getFarm, RECEIPT_URL_TTL_SECONDS } = await import('./db.js');

beforeEach(() => {
  bucketsUsed.length = 0;
  Object.values(storage).forEach((fn) => fn.mockReset());
  rpc.mockReset();
  from.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('uploadReceiptFile', () => {
  it('uploads to the user’s own folder and returns only the storage path (no URL is minted or stored)', async () => {
    storage.upload.mockResolvedValue({ error: null });
    const result = await uploadReceiptFile('user-1', { name: 'invoice.PNG' });

    const [path, , options] = storage.upload.mock.calls[0];
    expect(path).toMatch(/^user-1\/\d+-[a-z0-9]+\.png$/);
    expect(options).toMatchObject({ upsert: false });
    expect(result).toEqual({ path });
    expect(storage.getPublicUrl).not.toHaveBeenCalled();
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['a.b/../../c', 'c'],
    ['noextension', 'bin'],
    ['weird.<script>', 'script'],
    ['x.' + 'z'.repeat(40), 'z'.repeat(8)],
  ])('sanitizes the file extension of %j so it cannot alter the storage path', async (name, ext) => {
    storage.upload.mockResolvedValue({ error: null });
    const { path } = await uploadReceiptFile('user-1', { name });
    expect(path.startsWith('user-1/')).toBe(true);
    expect(path.slice('user-1/'.length)).not.toMatch(/[/\\<>]/);
    expect(path.endsWith(`.${ext}`)).toBe(true);
  });

  it('returns null and logs when the upload fails', async () => {
    storage.upload.mockResolvedValue({ error: { message: 'nope' } });
    await expect(uploadReceiptFile('user-1', { name: 'a.png' })).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('getReceiptFileUrl', () => {
  it('mints a short-lived signed URL (minutes, not a year)', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null });
    await expect(getReceiptFileUrl('user-1/a.png')).resolves.toBe('https://signed');
    expect(storage.createSignedUrl).toHaveBeenCalledWith('user-1/a.png', RECEIPT_URL_TTL_SECONDS);
    expect(RECEIPT_URL_TTL_SECONDS).toBeLessThanOrEqual(900);
  });

  it('returns null without calling storage when there is no path', async () => {
    await expect(getReceiptFileUrl('')).resolves.toBeNull();
    await expect(getReceiptFileUrl(null)).resolves.toBeNull();
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns null and logs when signing fails', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(getReceiptFileUrl('user-1/a.png')).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('getRecordFileUrl', () => {
  it('mints a short-lived signed URL from the private record-files bucket', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed-record' }, error: null });
    await expect(getRecordFileUrl('farm/hash/0.jpg')).resolves.toBe('https://signed-record');
    expect(bucketsUsed).toEqual(['record-files']);
    expect(storage.createSignedUrl).toHaveBeenCalledWith('farm/hash/0.jpg', RECORD_URL_TTL_SECONDS);
    expect(RECORD_URL_TTL_SECONDS).toBeLessThanOrEqual(900);
  });

  it('returns null without calling storage when there is no path', async () => {
    await expect(getRecordFileUrl('')).resolves.toBeNull();
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns null and logs when signing fails (for example the file belongs to another farm)', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    await expect(getRecordFileUrl('other/hash/0.jpg')).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('addReceipt', () => {
  function stubInsert(result = { data: { id: 'r1' }, error: null }) {
    const single = vi.fn(async () => result);
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });
    return insert;
  }

  it('stores the storage path in file_path and never a URL for new uploads', async () => {
    const insert = stubInsert();
    await addReceipt('user-1', { supplier: 'Acme', product: 'Compost', fileName: 'a.png', filePath: 'user-1/a.png' });
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ user_id: 'user-1', supplier: 'Acme', product: 'Compost', file_name: 'a.png', file_path: 'user-1/a.png' });
    expect(row.file_url).toBeNull();
  });

  it('does not send farm_id: the database assigns it from the caller’s membership', async () => {
    const insert = stubInsert();
    await addReceipt('user-1', { supplier: 'Acme', product: 'Compost', farmId: 'attacker-farm' });
    expect(insert.mock.calls[0][0]).not.toHaveProperty('farm_id');
  });
});

describe('addReceipt self-healing', () => {
  const row = { supplier: 'Acme', product: 'Compost' };

  function stubInserts(...results) {
    const single = vi.fn();
    results.forEach((r) => single.mockResolvedValueOnce(r));
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    from.mockReturnValue({ insert });
    return { insert, single };
  }

  it('repairs a missing farm and retries once when the insert is rejected by row-level security', async () => {
    const { insert } = stubInserts({ data: null, error: { code: '42501', message: 'rls' } }, { data: { id: 'r1' }, error: null });
    rpc.mockResolvedValue({ data: 'farm-1', error: null });

    await expect(addReceipt('user-1', row)).resolves.toEqual({ id: 'r1' });
    expect(rpc).toHaveBeenCalledWith('ensure_my_farm');
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('retries at most once', async () => {
    const { insert } = stubInserts({ data: null, error: { code: '42501' } }, { data: null, error: { code: '42501' } });
    rpc.mockResolvedValue({ data: 'farm-1', error: null });

    await expect(addReceipt('user-1', row)).resolves.toBeNull();
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('does not retry for unrelated errors', async () => {
    const { insert } = stubInserts({ data: null, error: { code: '23505', message: 'dup' } });
    await expect(addReceipt('user-1', row)).resolves.toBeNull();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not retry when the farm cannot be repaired', async () => {
    const { insert } = stubInserts({ data: null, error: { code: '42501' } });
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(addReceipt('user-1', row)).resolves.toBeNull();
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('deleteReceipt', () => {
  const stubDelete = (result) => {
    const select = vi.fn(async () => result);
    const eq = vi.fn(() => ({ select }));
    from.mockReturnValue({ delete: () => ({ eq }) });
  };

  it('reports success only when a row was actually deleted', async () => {
    stubDelete({ data: [{ id: 'r1' }], error: null });
    await expect(deleteReceipt('r1')).resolves.toBe(true);
  });

  it('reports failure when row-level security silently matched zero rows (e.g. crew trying to delete)', async () => {
    stubDelete({ data: [], error: null });
    await expect(deleteReceipt('r1')).resolves.toBe(false);
  });

  it('reports failure and logs on an error', async () => {
    stubDelete({ data: null, error: { message: 'nope' } });
    await expect(deleteReceipt('r1')).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('deleteReceiptFile', () => {
  it('removes an orphaned upload from the private bucket', async () => {
    storage.remove.mockResolvedValue({ error: null });
    await expect(deleteReceiptFile('user-1/a.png')).resolves.toBe(true);
    expect(storage.remove).toHaveBeenCalledWith(['user-1/a.png']);
  });

  it('is a no-op without a path and returns false on failure', async () => {
    await expect(deleteReceiptFile('')).resolves.toBe(false);
    expect(storage.remove).not.toHaveBeenCalled();
    storage.remove.mockResolvedValue({ error: { message: 'x' } });
    await expect(deleteReceiptFile('user-1/a.png')).resolves.toBe(false);
  });
});

describe('farm helpers', () => {
  it('ensureMyFarm calls the self-heal RPC and returns the farm id', async () => {
    rpc.mockResolvedValue({ data: 'farm-1', error: null });
    await expect(ensureMyFarm()).resolves.toBe('farm-1');
    expect(rpc).toHaveBeenCalledWith('ensure_my_farm');
  });

  it('ensureMyFarm returns null and logs on failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(ensureMyFarm()).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('getFarm reads the farm by id', async () => {
    const maybeSingle = vi.fn(async () => ({ data: { id: 'farm-1', name: 'Sunny', farm_code: 'F-ABC234' }, error: null }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    from.mockReturnValue({ select });

    await expect(getFarm('farm-1')).resolves.toEqual({ id: 'farm-1', name: 'Sunny', farm_code: 'F-ABC234' });
    expect(from).toHaveBeenCalledWith('farms');
    expect(select.mock.calls[0][0]).toMatch(/season_start_month/); // seasons are computed from these
    expect(select.mock.calls[0][0]).toMatch(/season_start_day/);
    expect(eq).toHaveBeenCalledWith('id', 'farm-1');
  });

  it('getFarm returns null for a missing id without querying', async () => {
    await expect(getFarm(null)).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
