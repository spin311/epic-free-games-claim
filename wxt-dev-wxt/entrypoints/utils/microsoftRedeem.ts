import { REDEEM_CODE_PARAM } from "@/entrypoints/utils/redeemCode.ts";

// Confirmed live: redeems a Windows Store/Xbox prepaid code without any
// captcha step on a normal signed-in browser session — same shape as GOG's
// redeem page, so it reuses the same extCode query-param handoff.
export const MICROSOFT_REDEEM_URL = "https://account.microsoft.com/billing/redeem";

export function buildMicrosoftRedeemUrl(code: string): string {
    const url = new URL(MICROSOFT_REDEEM_URL);
    url.searchParams.set(REDEEM_CODE_PARAM, code);
    return url.toString();
}
