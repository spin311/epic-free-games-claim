import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { appendRedeemParams } from "@/entrypoints/utils/redeemCode.ts";

// GOG's own store client (productcard bundle_min.js) resolves exactly these two
// endpoints for its giveaway button, so we talk to them directly instead of
// scraping the homepage — the homepage is an Angular shell whose markup never
// contains the giveaway banner in the served HTML.
export const GOG_HOME_URL = "https://www.gog.com/";
export const GOG_STATUS_URL = "https://www.gog.com/giveaway/status";
export const GOG_CLAIM_URL = "https://www.gog.com/giveaway/claim";
export const GOG_REDEEM_URL = "https://www.gog.com/redeem";
// Confirmed live: same-origin, answers {"owned": number[]} for the signed-in
// account — the one positive signal that a redeem actually landed.
export const GOG_OWNED_GAMES_URL = "https://www.gog.com/user/data/games";

// The extCode handoff (appended here, read back out by gog.content.ts) is
// shared with microsoft.content.ts's redeem flow — see redeemCode.ts.
export { extractRedeemCodeParam } from "@/entrypoints/utils/redeemCode.ts";

export function buildRedeemUrl(code: string, title?: string): string {
    return appendRedeemParams(GOG_REDEEM_URL, code, title);
}

const FALLBACK_IMAGE = "/icon/128.png";
const FALLBACK_TITLE = "GOG Giveaway";

export type GiveawayLookup = {
    // Callers must interpret this themselves: from the background service worker
    // a 401 is ambiguous (the session cookie may simply not have been attached),
    // while from a gog.com page it definitively means "signed out".
    unauthorized: boolean;
    game: FreeGame | null;
};

export type ClaimOutcome = "claimed" | "already-claimed" | "unauthorized" | "failed";

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

// "knytt_classic" -> "Knytt Classic". Only used when the payload gives us a slug
// but no title, so the popup still shows something a human recognises.
export function titleFromSlug(slug: string): string {
    return slug
        .split(/[_-]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

// The success shape of /giveaway/status could not be observed directly — it needs
// both a signed-in GOG session and a live giveaway. So this reads defensively:
// it accepts the field names GOG uses elsewhere in its catalog API, and treats
// *any* payload carrying an identifier as claimable. Failing to recognise a
// running giveaway is the costlier mistake, since giveaways expire.
export function parseGiveawayStatus(payload: unknown): FreeGame | null {
    const outer = asRecord(payload);
    if (!outer) return null;

    const source = asRecord(outer.giveaway) ?? asRecord(outer.data) ?? outer;
    const product = asRecord(source.product) ?? asRecord(source.game);

    const id = readString(source, ["id", "productId", "giveawayId"]);
    const slug = readString(source, ["slug", "productSlug"]) ||
        (product ? readString(product, ["slug"]) : "");
    const title = readString(source, ["title", "name", "productTitle"]) ||
        (product ? readString(product, ["title", "name"]) : "");

    // Nothing identifiable — an empty body ("no giveaway running") or a bare
    // error envelope such as {"message":"Unauthorized"}.
    if (!id && !slug && !title) return null;

    const storeLink = readString(source, ["storeLink", "url", "link"]) ||
        (product ? readString(product, ["storeLink", "url"]) : "");
    const image = readString(source, ["coverHorizontal", "image", "img", "logo"]) ||
        (product ? readString(product, ["coverHorizontal", "image"]) : "");
    // Same "unverified shape" caveat as the rest of this function — description
    // is optional on FreeGame and GameCard only renders it when present, so a
    // wrong guess here just means no description shows, same as today.
    const description = readString(source, ["description", "summary", "shortDescription"]) ||
        (product ? readString(product, ["description", "summary", "shortDescription"]) : "");

    return {
        title: title || (slug ? titleFromSlug(slug) : FALLBACK_TITLE),
        platform: Platforms.GOG,
        link: storeLink || (slug ? `https://www.gog.com/en/game/${slug}` : GOG_HOME_URL),
        img: image || FALLBACK_IMAGE,
        ...(description ? { description } : {}),
    };
}

function parseJsonBody(body: string): unknown {
    const trimmed = body.trim();
    if (!trimmed) return {};
    return JSON.parse(trimmed);
}

// Reads the currently running giveaway. Throws on transport/server failures so
// the background can fall back to driving a real gog.com tab; a 401/403 is
// reported rather than thrown because it is an expected, actionable state.
// Confirmed live: a 404 is GOG's normal "no giveaway running right now"
// response (not an auth problem, not a broken endpoint) — reported the same
// way as an empty 200 body rather than thrown.
export async function fetchGiveaway(fetchImpl: typeof fetch = fetch): Promise<GiveawayLookup> {
    const response = await fetchImpl(GOG_STATUS_URL, {
        credentials: "include",
        headers: { Accept: "application/json" },
    });

    if (response.status === 401 || response.status === 403) {
        return { unauthorized: true, game: null };
    }
    if (response.status === 404) {
        return { unauthorized: false, game: null };
    }
    if (!response.ok) {
        throw new Error(`GOG giveaway status responded ${response.status}`);
    }

    return { unauthorized: false, game: parseGiveawayStatus(parseJsonBody(await response.text())) };
}

// Claims via GET: GOG answers POST with 403 (its CSRF guard rejects a token-less
// request before auth), while GET reaches the auth check and is the path a plain
// browser navigation to /giveaway/claim takes. Never throws — a failed claim must
// not abort the surrounding claim run.
export async function claimGiveaway(fetchImpl: typeof fetch = fetch): Promise<ClaimOutcome> {
    try {
        const response = await fetchImpl(GOG_CLAIM_URL, {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
        });

        if (response.status === 401 || response.status === 403) return "unauthorized";
        if (!response.ok) {
            console.error(`[gog] claim responded ${response.status}`);
            return "failed";
        }

        const body = parseJsonBody(await response.text());
        const record = asRecord(body);
        // A successful claim returns an empty object.
        if (!record || Object.keys(record).length === 0) return "claimed";

        const message = readString(record, ["message"]);
        if (/already\s+claimed/i.test(message)) return "already-claimed";

        console.warn(`[gog] unexpected claim response: ${message || JSON.stringify(record)}`);
        return "failed";
    } catch (error: unknown) {
        console.error("[gog] claim request failed:", error);
        return "failed";
    }
}

// Never throws: null means "couldn't tell" (signed out, transport error, or an
// unexpected payload), which callers must treat as unverified, not as owned.
export async function fetchOwnedGameIds(fetchImpl: typeof fetch = fetch): Promise<Set<number> | null> {
    try {
        const response = await fetchImpl(GOG_OWNED_GAMES_URL, {
            credentials: "include",
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            console.warn(`[gog] owned-games lookup responded ${response.status}`);
            return null;
        }
        const owned = asRecord(parseJsonBody(await response.text()))?.owned;
        if (!Array.isArray(owned)) return null;
        return new Set(owned.filter((id): id is number => typeof id === "number"));
    } catch (error: unknown) {
        console.warn("[gog] owned-games lookup failed:", error);
        return null;
    }
}

// Confirmed live (redeem bundle + rendered page): GOG's success step renders
// a .success-message header ("Code redeemed successfully!"). Matched by
// markup rather than text so it works whatever the account's UI language.
export function hasRedeemSuccessScreen(root: Document | HTMLElement): boolean {
    return root.querySelector(".success-message") !== null;
}

// Confirmed live: neither the "Continue" button vanishing nor the URL change
// means anything was redeemed — both happen on the way to a second "Redeem"
// step. So success needs a positive signal: GOG's own success screen, or the
// library gaining a product it didn't have before (a fallback for a success
// screen we fail to recognise). The library alone isn't enough: GOG redeems
// asynchronously and warns it "might take a little longer to appear".
export async function waitForRedeemConfirmation(
    before: ReadonlySet<number> | null,
    fetchOwned: () => Promise<Set<number> | null>,
    isSuccessShown: () => boolean,
    waitFn: (ms: number) => Promise<void>,
    timeoutMs = 15000,
    pollIntervalMs = 1500
): Promise<boolean> {
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (isSuccessShown()) return true;
        // No baseline means a diff can't tell new from already-owned.
        if (before) {
            const owned = await fetchOwned();
            if (owned && [...owned].some((id) => !before.has(id))) return true;
        }
        if (attempt < maxAttempts - 1) await waitFn(pollIntervalMs);
    }
    return false;
}
