import { wait } from "@/entrypoints/utils/helpers.ts";

// Delays between attempts. Kept short in total: a check can run right after
// browser start, before the network is up, and an MV3 service worker is shut
// down after ~30s without extension activity.
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

// The request never got an answer (offline, DNS, connection reset), even
// after the retries. Separate from a store's real answer so the health status
// can say "can't reach the store" rather than "the store changed".
export class NetworkError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "NetworkError";
    }
}

// The store answered in a shape the extension doesn't recognise: a page or
// API change the extension needs an update for (see health.ts).
export class StoreChangedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StoreChangedError";
    }
}

// The store said the account is signed out: proof it's reachable, and not a
// health problem (the popup's login status already shows it).
export class SignedOutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SignedOutError";
    }
}

// Overloaded or failing: worth another try. Anything else (200, 401, 404,
// ...) is the store's real answer and goes straight back to the caller.
function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

// fetch() with retries for what's usually transient. Matches fetch's
// signature, so it can stand in wherever a `fetchImpl` is accepted.
export async function fetchWithRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
    delays: readonly number[] = RETRY_DELAYS_MS,
    waitFn: (ms: number) => Promise<void> = wait,
): Promise<Response> {
    // Why the last attempt failed. A caller's time limit (one signal for all
    // attempts) can run out mid-retry, and its timeout error says nothing
    // about why the retries were needed: this does.
    let lastFailure: string | null = null;
    for (let attempt = 0; ; attempt++) {
        try {
            const response = await fetch(input, init);
            if (!isRetryableStatus(response.status) || attempt >= delays.length) return response;
            // Unread, it would hold its connection until garbage collection.
            await response.body?.cancel().catch(() => undefined);
            lastFailure = `${describeUrl(input)} answered ${response.status}`;
        } catch (error: unknown) {
            // Retrying with the same, already aborted signal would only fail again.
            if (init?.signal?.aborted) throw stoppedByCaller(error, lastFailure);
            if (attempt >= delays.length) throw new NetworkError(messageOf(error), { cause: error });
            lastFailure = messageOf(error);
        }
        await waitFn(delays[attempt]);
        if (init?.signal?.aborted) throw stoppedByCaller(init.signal.reason, lastFailure);
    }
}

function stoppedByCaller(abortError: unknown, lastFailure: string | null): NetworkError {
    // Nothing failed before: the store never answered in time, and the
    // timeout is the whole story.
    const message = lastFailure ? `${lastFailure} (retried until the time limit)` : messageOf(abortError);
    return new NetworkError(message, { cause: abortError });
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Host and path only: a query string can be long and say little.
function describeUrl(input: RequestInfo | URL): string {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try {
        const url = new URL(href);
        return `${url.host}${url.pathname}`;
    } catch {
        return href;
    }
}

// A non-OK answer, after fetchWithRetry's retries: 429/5xx means the store
// is struggling (reported like an unreachable one); anything else, that it
// changed.
export function assertStoreOk(response: Response, what: string): Response {
    if (response.ok) return response;
    const message = `${what} answered ${response.status}`;
    throw isRetryableStatus(response.status) ? new NetworkError(message) : new StoreChangedError(message);
}
