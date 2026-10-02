import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getStorageItem } from '@/entrypoints/hooks/useStorage.ts';
import {
    addPendingRedemption,
    copyToClipboardBestEffort,
    PENDING_REDEMPTIONS_STORAGE_KEY,
    PendingRedemption,
    recordRedeemFallback,
    removePendingRedemption,
} from './pendingRedemptions.ts';

function makeEntry(overrides: Partial<PendingRedemption> = {}): PendingRedemption {
    return {
        code: 'ABC123',
        platform: 'GOG',
        title: 'Some Game',
        redeemUrl: 'https://www.gog.com/redeem?extCode=ABC123',
        addedAt: '2026-09-22T00:00:00.000Z',
        ...overrides,
    };
}

beforeEach(() => {
    fakeBrowser.reset();
});

describe('addPendingRedemption / removePendingRedemption', () => {
    it('persists a new entry', async () => {
        const entry = makeEntry();
        await addPendingRedemption(entry);

        const stored = await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY);
        expect(stored).toEqual([entry]);
    });

    it('appends to existing entries rather than overwriting them', async () => {
        await addPendingRedemption(makeEntry({ code: 'AAA' }));
        await addPendingRedemption(makeEntry({ code: 'BBB' }));

        const stored = await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY);
        expect(stored?.map((e) => e.code)).toEqual(['AAA', 'BBB']);
    });

    it('replaces rather than duplicates an entry for the same code', async () => {
        await addPendingRedemption(makeEntry({ code: 'ABC123', title: 'First attempt' }));
        await addPendingRedemption(makeEntry({ code: 'ABC123', title: 'Second attempt' }));

        const stored = await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY);
        expect(stored).toHaveLength(1);
        expect(stored?.[0].title).toBe('Second attempt');
    });

    it('removes only the matching entry', async () => {
        await addPendingRedemption(makeEntry({ code: 'AAA' }));
        await addPendingRedemption(makeEntry({ code: 'BBB' }));

        await removePendingRedemption('AAA');

        const stored = await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY);
        expect(stored?.map((e) => e.code)).toEqual(['BBB']);
    });

    it('removing a code that was never added is a safe no-op', async () => {
        await expect(removePendingRedemption('NEVER-ADDED')).resolves.toBeUndefined();
    });
});

describe('copyToClipboardBestEffort', () => {
    it('returns true when the clipboard write succeeds', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        await expect(copyToClipboardBestEffort('ABC123')).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith('ABC123');

        vi.unstubAllGlobals();
    });

    it('returns false (never throws) when the clipboard write is denied', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        await expect(copyToClipboardBestEffort('ABC123')).resolves.toBe(false);

        vi.unstubAllGlobals();
    });
});

describe('copyToClipboardBestEffort timeout', () => {
    // Confirmed live: from a content script's isolated world the write can
    // stay pending indefinitely instead of rejecting.
    it('returns false once the clipboard write has not settled within the timeout', async () => {
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => new Promise(() => {})) } });

        await expect(copyToClipboardBestEffort('ABC123', 10)).resolves.toBe(false);

        vi.unstubAllGlobals();
    });
});

describe('recordRedeemFallback', () => {
    it('persists the pending entry even when the clipboard write never settles', async () => {
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => new Promise(() => {})) } });

        void recordRedeemFallback('NEVER1', 'GOG', 'DOOM', 'https://www.gog.com/redeem?extCode=NEVER1');
        await vi.waitFor(async () => {
            const stored = await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY);
            expect(stored?.map((entry) => entry.code)).toEqual(['NEVER1']);
        });

        vi.unstubAllGlobals();
    });

    it('copies the code and persists a pending entry, and never throws even if the clipboard is denied', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('denied'));
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        await expect(
            recordRedeemFallback('XYZ789', 'Windows', 'DOOM Eternal', 'https://account.microsoft.com/billing/redeem')
        ).resolves.toBeUndefined();

        const stored = await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY);
        expect(stored).toHaveLength(1);
        expect(stored?.[0]).toMatchObject({
            code: 'XYZ789',
            platform: 'Windows',
            title: 'DOOM Eternal',
            redeemUrl: 'https://account.microsoft.com/billing/redeem',
        });
        expect(writeText).toHaveBeenCalledWith('XYZ789');

        vi.unstubAllGlobals();
    });
});
