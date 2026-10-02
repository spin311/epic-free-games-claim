import { getStorageItem, setStorageItem } from "@/entrypoints/hooks/useStorage.ts";

export type RedeemPlatform = "GOG" | "Windows";

export interface PendingRedemption {
    code: string;
    platform: RedeemPlatform;
    title: string;
    redeemUrl: string;
    addedAt: string;
}

export const PENDING_REDEMPTIONS_STORAGE_KEY = "pendingRedemptions";

// Best-effort: clipboard access from a backgrounded/unfocused claim tab can
// be denied by the browser regardless of permissions, so a failure here must
// never be treated as the fallback itself failing — the storage record (and
// the tab staying open) is what actually preserves the code either way.
// Confirmed live: from a content script's isolated world the write can stay
// pending forever instead of rejecting, so it's bounded by a timeout.
const CLIPBOARD_TIMEOUT_MS = 2000;

export async function copyToClipboardBestEffort(text: string, timeoutMs = CLIPBOARD_TIMEOUT_MS): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`clipboard write timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
        await Promise.race([navigator.clipboard.writeText(text), timedOut]);
        return true;
    } catch (error: unknown) {
        console.warn("[pendingRedemptions] clipboard copy failed:", error);
        return false;
    } finally {
        clearTimeout(timer);
    }
}

// Never throws: this is itself the last-resort fallback for when auto-redeem
// didn't go through (not signed in, captcha, unrecognized markup, an
// unexpected exception, ...), so it must never become a second failure that
// loses the code entirely.
export async function addPendingRedemption(entry: PendingRedemption): Promise<void> {
    try {
        const existing = (await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY)) ?? [];
        // Replace rather than duplicate if this exact code is already pending
        // (e.g. a retried claim run hitting the same still-unredeemed code).
        const deduped = existing.filter((item) => item.code !== entry.code);
        await setStorageItem(PENDING_REDEMPTIONS_STORAGE_KEY, [...deduped, entry]);
    } catch (error: unknown) {
        console.error("[pendingRedemptions] failed to persist a pending redemption:", error);
    }
}

export async function removePendingRedemption(code: string): Promise<void> {
    try {
        const existing = (await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY)) ?? [];
        await setStorageItem(
            PENDING_REDEMPTIONS_STORAGE_KEY,
            existing.filter((item) => item.code !== code),
        );
    } catch (error: unknown) {
        console.error("[pendingRedemptions] failed to remove a pending redemption:", error);
    }
}

// Single entry point gog.content.ts / microsoft.content.ts call whenever
// auto-redeem doesn't complete, for any reason — composed entirely of
// operations that already swallow their own errors, so this itself can never
// throw and never needs its own try/catch at the call site.
export async function recordRedeemFallback(
    code: string,
    platform: RedeemPlatform,
    title: string,
    redeemUrl: string,
): Promise<void> {
    // Stored first: the record is what actually preserves the code; the
    // clipboard copy is a convenience that must never be able to block it.
    await addPendingRedemption({ code, platform, title, redeemUrl, addedAt: new Date().toISOString() });
    await copyToClipboardBestEffort(code);
}
