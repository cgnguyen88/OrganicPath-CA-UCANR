import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage = { createSignedUrl: vi.fn() };
const rpc = vi.fn();
const from = vi.fn();
const bucketsUsed = [];
vi.mock('./supabase.js', () => ({
  supabase: { storage: { from: (bucket) => { bucketsUsed.push(bucket); return storage; } }, rpc: (...args) => rpc(...args), from: (...args) => from(...args) },
}));

const { getAttachmentUrl, RECORD_URL_TTL_SECONDS, ensureMyFarm, getFarm, RECEIPT_URL_TTL_SECONDS } = await import('./db.js');

beforeEach(() => {
  bucketsUsed.length = 0;
  Object.values(storage).forEach((fn) => fn.mockReset());
  rpc.mockReset();
  from.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getAttachmentUrl', () => {
  /** Signing works only for the buckets listed: a file is in one bucket, so the other cannot sign it. */
  const filesIn = (...buckets) =>
    storage.createSignedUrl.mockImplementation(async (path) =>
      buckets.includes(bucketsUsed.at(-1)) ? { data: { signedUrl: `https://signed/${bucketsUsed.at(-1)}/${path}` }, error: null } : { data: null, error: { message: 'Object not found' } });

  it('finds a file the assistant stored: in the record-files bucket, with a short-lived link', async () => {
    filesIn('record-files');
    await expect(getAttachmentUrl({ path: 'farm-1/h/0.jpg', name: 'a.jpg' })).resolves.toBe('https://signed/record-files/farm-1/h/0.jpg');
    expect(bucketsUsed).toEqual(['record-files']);
    expect(storage.createSignedUrl).toHaveBeenCalledWith('farm-1/h/0.jpg', RECORD_URL_TTL_SECONDS);
  });

  it('finds a file that came from the old Receipt Manager: in the receipts bucket', async () => {
    filesIn('receipts');
    await expect(getAttachmentUrl({ path: 'user-1/17-abc.png', name: 'invoice.png' })).resolves.toBe('https://signed/receipts/user-1/17-abc.png');
    expect(bucketsUsed).toEqual(['record-files', 'receipts']);
    expect(storage.createSignedUrl).toHaveBeenLastCalledWith('user-1/17-abc.png', RECEIPT_URL_TTL_SECONDS);
  });

  it('goes straight to the bucket the attachment names', async () => {
    filesIn('receipts');
    await getAttachmentUrl({ path: 'user-1/a.png', bucket: 'receipts' });
    expect(bucketsUsed).toEqual(['receipts']);
    bucketsUsed.length = 0;
    filesIn('record-files');
    await getAttachmentUrl({ path: 'farm-1/a.png', bucket: 'record-files' });
    expect(bucketsUsed).toEqual(['record-files']);
  });

  it('never signs from a bucket the attachment merely claims: only the two it knows about', async () => {
    filesIn('record-files', 'receipts');
    await getAttachmentUrl({ path: 'a/b.png', bucket: 'some-other-private-bucket' });
    expect(bucketsUsed).not.toContain('some-other-private-bucket');
    expect(bucketsUsed).toEqual(['record-files']);
  });

  it('does not look in the second bucket when the first has the file', async () => {
    filesIn('record-files', 'receipts');
    await getAttachmentUrl({ path: 'farm-1/h/0.jpg' });
    expect(bucketsUsed).toEqual(['record-files']);
  });

  it('gives nothing, and says so once, when neither bucket will sign it', async () => {
    filesIn();
    await expect(getAttachmentUrl({ path: 'x/y.png' })).resolves.toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('does not log anything when the second bucket finds it after the first did not', async () => {
    filesIn('receipts');
    await getAttachmentUrl({ path: 'user-1/a.png' });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined], [{}], [{ path: '' }], [{ path: 5 }], ['a/b.png']])('gives nothing, without asking storage, for %j', async (file) => {
    await expect(getAttachmentUrl(file)).resolves.toBeNull();
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
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
