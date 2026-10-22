import { appendRedeemParams } from "@/entrypoints/utils/redeemCode.ts";

// A Legacy-Games-published Prime Gaming offer (claim slug "-legacy") reveals
// a one-time code on Amazon, redeemed on a per-game Legacy Games promo page
// that asks for the code plus an email address. Everything below was
// confirmed live (Oct 2026) on promo.legacygames.com/the-da-vinci-cryptex-luna/.

export const LEGACY_EMAIL_STORAGE_KEY = "primeGamingLegacyEmail";
// The code survives the form's POST + redirect only through storage. A list,
// since one claim run can submit several Legacy offers at once.
export const LEGACY_SUBMISSION_STORAGE_KEY = "pendingLegacyRedeemSubmissions";
// Long enough for a slow POST + redirect, short enough that a stale entry
// can't claim some unrelated later visit to Legacy Games as its outcome.
export const LEGACY_SUBMISSION_MAX_AGE_MS = 5 * 60 * 1000;

const LEGACY_PROMO_ORIGIN = "https://promo.legacygames.com";
// Confirmed live: a successful submit 302s to a per-game page on
// legacygames.com (e.g. /amazon-luna-x-legacy-games-the-da-vinci-cryptex/)
// whose heading reads exactly this.
const REDEEM_SUCCESS_TEXT = /thanks for redeeming your amazon luna code/i;
const FALLBACK_ERROR_MESSAGE = "Legacy Games rejected the code";
// Deliberately loose: the promo page's own type="email" input validates too.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LegacySubmission {
    code: string;
    title: string;
    redeemUrl: string;
    submittedAt: string;
}

export interface LegacyRedeemForm {
    form: HTMLFormElement;
    code: HTMLInputElement;
    email: HTMLInputElement;
    emailConfirm: HTMLInputElement;
    newsletter: HTMLInputElement | null;
}

export type LegacyRedeemResult =
    | { result: "redeemed" }
    | { result: "rejected"; message: string }
    | { result: "unconfirmed" };

export function normalizeEmail(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const email = value.trim();
    return EMAIL_PATTERN.test(email) ? email : null;
}

// Confirmed live: the offer page's "Click here to enter your redemption
// code" step links straight to the game's promo page. The slug-derived
// fallback (".../{game}-legacy/dp/..." -> promo.legacygames.com/{game}-luna/)
// matches the one live example and is only used if that link is missing.
export function findLegacyRedeemUrl(doc: Document, claimPageUrl: string): string | null {
    const link = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .map((a) => a.href)
        .find((href) => href.startsWith(`${LEGACY_PROMO_ORIGIN}/`) && new URL(href).pathname !== "/");
    if (link) return link;

    const slug = new URL(claimPageUrl).pathname.split("/claims/")[1]?.split("/dp/")[0] ?? "";
    if (!slug.endsWith("-legacy")) return null;
    return `${LEGACY_PROMO_ORIGIN}/${slug.slice(0, -"-legacy".length)}-luna/`;
}

export function buildLegacyRedeemUrl(promoUrl: string, code: string, title?: string): string {
    return appendRedeemParams(promoUrl, code, title);
}

export function findLegacyRedeemForm(doc: Document): LegacyRedeemForm | null {
    const code = doc.querySelector<HTMLInputElement>('input[name="coupon_code"]');
    const email = doc.querySelector<HTMLInputElement>('input[name="email"]');
    const emailConfirm = doc.querySelector<HTMLInputElement>('input[name="email_validate"]');
    const form = code?.form;
    if (!code || !email || !emailConfirm || !form) return null;
    return {
        form,
        code,
        email,
        emailConfirm,
        newsletter: doc.querySelector<HTMLInputElement>('input[name="newsletter_sub"]'),
    };
}

// The newsletter box comes pre-checked; it's always cleared — signing the
// user up for marketing is never part of claiming a game. A plain
// (non-framework) form, so assigning .value is enough.
export function fillLegacyRedeemForm(fields: LegacyRedeemForm, code: string, email: string | null): void {
    fields.code.value = code;
    if (fields.newsletter) fields.newsletter.checked = false;
    if (!email) return;
    fields.email.value = email;
    fields.emailConfirm.value = email;
}

// Confirmed live: a failed redeem redirects back with ?error=<base64 message>,
// which the page's own script decodes with atob(). URLSearchParams turns a
// raw '+' into a space, so that's undone before decoding.
export function readLegacyRedeemError(search: string): string | null {
    const raw = new URLSearchParams(search).get("error");
    if (raw === null) return null;
    try {
        return atob(raw.replace(/ /g, "+")).trim() || FALLBACK_ERROR_MESSAGE;
    } catch {
        return FALLBACK_ERROR_MESSAGE;
    }
}

// Never infers success from the absence of an error: anything not
// positively recognized stays "unconfirmed", so the code is kept pending.
export function readLegacyRedeemResult(url: string, doc: Document): LegacyRedeemResult {
    const error = readLegacyRedeemError(new URL(url).search);
    if (error) return { result: "rejected", message: error };
    if (findLegacyRedeemForm(doc)) return { result: "rejected", message: FALLBACK_ERROR_MESSAGE };
    const headings = Array.from(doc.querySelectorAll("h1, h2, h3")).map((h) => h.textContent ?? "");
    if (headings.some((text) => REDEEM_SUCCESS_TEXT.test(text))) return { result: "redeemed" };
    return { result: "unconfirmed" };
}

// The promo page is "/{game}-luna/" (an error redirects back there);
// confirmed live, success lands on "/amazon-luna-x-legacy-games-{game}/".
function gameSlugOf(redeemUrl: string): string | null {
    try {
        return new URL(redeemUrl).pathname.match(/^\/([^/]+)-luna\/?$/)?.[1] ?? null;
    } catch {
        return null;
    }
}

function isLandingPageFor(path: string, slug: string): boolean {
    const trimmed = path.replace(/\/$/, "");
    return trimmed === `/${slug}-luna` || trimmed.endsWith(`-${slug}`);
}

// Matched by the game named in the landing URL, so overlapping redeems can't
// resolve each other's outcome. With no game named, only an unambiguous
// single pending submission is matched.
export function matchLegacySubmission(
    submissions: readonly LegacySubmission[],
    landingUrl: string,
): LegacySubmission | null {
    const path = new URL(landingUrl).pathname;
    const named = submissions.filter((submission) => {
        const slug = gameSlugOf(submission.redeemUrl);
        return slug !== null && isLandingPageFor(path, slug);
    });
    if (named.length > 0) return named[named.length - 1];
    return submissions.length === 1 ? submissions[0] : null;
}

export function isFreshLegacySubmission(submission: Pick<LegacySubmission, "submittedAt">, now: Date): boolean {
    const submittedAt = new Date(submission.submittedAt).getTime();
    if (Number.isNaN(submittedAt)) return false;
    const age = now.getTime() - submittedAt;
    return age >= 0 && age <= LEGACY_SUBMISSION_MAX_AGE_MS;
}
