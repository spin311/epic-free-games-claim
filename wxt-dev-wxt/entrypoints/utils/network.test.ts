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

  describe('when the caller\'s own time limit ends the retries', () => {
    // What AbortSignal.timeout's signal carries in Chrome.
    const timeout = () => new DOMException('signal timed out', 'TimeoutError');

    // Like the real fetch: an aborted signal fails the request at once.
    function stubFetchHonouringSignal(outcome: () => number | Error) {
      const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal?.aborted) throw init.signal.reason;
        const next = outcome();
        if (next instanceof Error) throw next;
        return new Response('body', { status: next });
      });
      vi.stubGlobal('fetch', mock);
      return mock;
    }

    // The time limit runs out during the first retry wait.
    function abortDuringWait(controller: AbortController) {
      return async () => { controller.abort(timeout()); };
    }

    // Regression (3.3.0 report: "Can't reach store (signal timed out)"):
    // Prime Gaming's 15s limit is shorter than the retry waits (2+5+10s), so
    // any failure that kept repeating was reported as the timeout itself.
    it('reports the failure that kept it retrying, not the timeout', async () => {
      const fetchMock = stubFetchHonouringSignal(() => new TypeError('Failed to fetch'));
      const controller = new AbortController();

      const error = await fetchWithRetry(
          'https://luna.amazon.com/claims/home', { signal: controller.signal }, [10, 20], abortDuringWait(controller)
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NetworkError);
      expect((error as Error).message).toContain('Failed to fetch');
      expect((error as Error).message).not.toContain('signal timed out');
      // No request is sent once the time limit is gone: it could only fail.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports the earlier failure when a retry runs out of time mid-request', async () => {
      const controller = new AbortController();
      const outcomes: (() => Error)[] = [
        () => new TypeError('Failed to fetch'),
        () => { controller.abort(timeout()); return timeout(); },
      ];
      const fetchMock = stubFetchHonouringSignal(() => outcomes.shift()!());

      const error = await fetchWithRetry(
          'https://luna.amazon.com/claims/home', { signal: controller.signal }, [10, 20], async () => {}
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NetworkError);
      expect((error as Error).message).toBe('Failed to fetch (retried until the time limit)');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('names an overloaded store\'s answer', async () => {
      stubFetchHonouringSignal(() => 503);
      const controller = new AbortController();

      const error = await fetchWithRetry(
          'https://luna.amazon.com/claims/home', { signal: controller.signal }, [10, 20], abortDuringWait(controller)
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NetworkError);
      expect((error as Error).message).toContain('luna.amazon.com/claims/home answered 503');
    });

    // Nothing failed before, so the timeout is the real story: the store
    // never answered.
    it('reports the timeout when the first request ran out of time', async () => {
      const controller = new AbortController();
      stubFetchHonouringSignal(() => {
        controller.abort(timeout());
        return timeout();
      });

      const error = await fetchWithRetry(
          'https://luna.amazon.com/claims/home', { signal: controller.signal }, [10, 20], async () => {}
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NetworkError);
      expect((error as Error).message).toBe('signal timed out');
    });
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
