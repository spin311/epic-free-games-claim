import { describe, it, expect } from 'vitest';
import { buildMicrosoftRedeemUrl, MICROSOFT_REDEEM_URL } from '@/entrypoints/utils/microsoftRedeem.ts';
import { REDEEM_CODE_PARAM } from '@/entrypoints/utils/redeemCode.ts';

describe('buildMicrosoftRedeemUrl', () => {
    it('appends the code as the shared extCode param', () => {
        const url = new URL(buildMicrosoftRedeemUrl('ABC123'));

        expect(url.origin + url.pathname).toBe(MICROSOFT_REDEEM_URL);
        expect(url.searchParams.get(REDEEM_CODE_PARAM)).toBe('ABC123');
    });
});
