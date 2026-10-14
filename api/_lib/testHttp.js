/** Minimal request/response doubles shared by the endpoint tests. */
export function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    writableEnded: false,
    listeners: {},
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    getHeader(k) { return res.headers[k.toLowerCase()]; },
    write(c) { res.chunks.push(c); return true; },
    end(c) { if (c) res.chunks.push(c); res.ended = true; res.writableEnded = true; },
    on(evt, fn) { res.listeners[evt] = fn; },
    get body() { return res.chunks.join(''); },
    get json() { return JSON.parse(res.body); },
  };
  return res;
}

export function makeReq({ method = 'POST', body, headers = {} } = {}) {
  return { method, body, headers: { authorization: 'Bearer good-token', ...headers } };
}
