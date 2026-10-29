import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertStoreOk, fetchWithRetry, NetworkError, StoreChangedError } from './network';

describe('fetchWithRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(...outcomes: (number | Error)[]) {
    const mock = vi.fn(async () => {
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return new Response('body', { status: outcome });
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  function recordWaits() {
    const waits: number[] = [];
    return { waits, waitFn: async (ms: number) => { waits.push(ms); } };
  }

  // Regression (3.0 report: "getEpicGamesList failed: TypeError: Failed to
  // fetch"): one dropped request, e.g. right after browser start, lost the
  // whole day's Epic check.
  it('retries a request that never got an answer and returns the later success', async () => {
    const fetchMock = stubFetch(new TypeError('Failed to fetch'), 200);
    const { waits, waitFn } = recordWaits();

    const response = await fetchWithRetry('https://example.com', undefined, [10, 20], waitFn);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([10]);
  });

  it('retries a server error or rate limit', async () => {
    stubFetch(503, 429, 200);
    const { waitFn } = recordWaits();

    const response = await fetchWithRetry('https://example.com', undefined, [10, 20], waitFn);

    expect(response.status).toBe(200);
  });

  // A 401 or 404 is the store's real answer (signed out, no giveaway), not a
  // hiccup, and callers rely on seeing it.
  it('returns any other status straight away', async () => {
    const fetchMock = stubFetch(401);
    const { waits, waitFn } = recordWaits();

    const response = await fetchWithRetry('https://example.com', undefined, [10, 20], waitFn);

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('gives up after the last retry with a NetworkError', async () => {
    const fetchMock = stubFetch(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'), new TypeError('Failed to fetch'));
    const { waitFn } = recordWaits();

    await expect(fetchWithRetry('https://example.com', undefined, [10, 20], waitFn)).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns the last server error once retries run out', async () => {
    stubFetch(503, 503);
    const { waitFn } = recordWaits();

    const response = await fetchWithRetry('https://example.com', undefined, [10], waitFn);

    expect(response.status).toBe(503);
  });
});

describe('assertStoreOk', () => {
  it('passes an OK response through', () => {
    const response = new Response('ok', { status: 200 });
    expect(assertStoreOk(response, 'Store')).toBe(response);
  });

  // An overloaded store is not a changed one.
  it('reads a 429 or 5xx left after the retries as the store being unreachable', () => {
    expect(() => assertStoreOk(new Response('', { status: 503 }), 'GOG')).toThrow(NetworkError);
    expect(() => assertStoreOk(new Response('', { status: 429 }), 'GOG')).toThrow(NetworkError);
  });

  it('reads any other failure status as the store having changed', () => {
    expect(() => assertStoreOk(new Response('', { status: 410 }), 'GOG')).toThrow(StoreChangedError);
  });
});
