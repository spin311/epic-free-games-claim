import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

// GOG's own store client (productcard bundle_min.js) resolves exactly these two
// endpoints for its giveaway button, so we talk to them directly instead of
// scraping the homepage — the homepage is an Angular shell whose markup never
// contains the giveaway banner in the served HTML.
export const GOG_HOME_URL = "https://www.gog.com/";
export const GOG_STATUS_URL = "https://www.gog.com/giveaway/status";
export const GOG_CLAIM_URL = "https://www.gog.com/giveaway/claim";

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

    return {
        title: title || (slug ? titleFromSlug(slug) : FALLBACK_TITLE),
        platform: Platforms.GOG,
        link: storeLink || (slug ? `https://www.gog.com/en/game/${slug}` : GOG_HOME_URL),
        img: image || FALLBACK_IMAGE,
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
export async function fetchGiveaway(fetchImpl: typeof fetch = fetch): Promise<GiveawayLookup> {
    const response = await fetchImpl(GOG_STATUS_URL, {
        credentials: "include",
        headers: { Accept: "application/json" },
    });

    if (response.status === 401 || response.status === 403) {
        return { unauthorized: true, game: null };
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
