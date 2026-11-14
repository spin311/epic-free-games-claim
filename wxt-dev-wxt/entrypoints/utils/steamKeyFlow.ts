import { getStorageItem, setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { incrementCounter } from "@/entrypoints/utils/helpers.ts";
import {
  fetchGameplayGifts,
  GiftKey,
  INDIEGALA_LIBRARY_URL,
  IndieGalaGift,
  isSteamKeyPrize,
} from "@/entrypoints/utils/indieGalaGifts.ts";
import { addPendingRedemption, PendingReasonKey, removePendingRedemption } from "@/entrypoints/utils/pendingRedemptions.ts";
import {
  englishSteamActivationUrl,
  isSteamKeyDone,
  pendingReasonKey,
  SteamKeyOutcome,
  steamActivationUrl,
} from "@/entrypoints/utils/steamKeyActivation.ts";

// State for taking a Steam key won on IndieGala's wheel to Steam: which
// G. Giveaway gifts were already there (so only a new one is opened), and
// the last key that made it onto the account (shown in the popup).
export const KNOWN_GIFTS_KEY = "indieGalaKnownGifts";
export const LAST_STEAM_KEY_KEY = "indieGalaLastSteamKey";

export type SteamKeyRecord = {
  title: string;
  outcome: SteamKeyOutcome;
  at: string;
};

export async function rememberGifts(gifts: IndieGalaGift[]): Promise<void> {
  await setStorageItem(KNOWN_GIFTS_KEY, [...new Set(gifts.map((gift) => gift.url))]);
}

// Each new gift is returned once: it's remembered as it's handed out, so a
// failed key read isn't retried by opening the gift again (a pending entry
// keeps it instead). With nothing remembered there's nothing to compare
// with, and every gift there is remembered without being taken.
export async function takeNewGifts(gifts: IndieGalaGift[]): Promise<IndieGalaGift[]> {
  const known = await getStorageItem<string[]>(KNOWN_GIFTS_KEY);
  await rememberGifts([...gifts, ...(known ?? []).map((url) => ({ url, password: null }))]);
  if (!known) return [];
  return gifts.filter((gift) => !known.includes(gift.url));
}

export type SteamKeyReport = {
  key: string;
  title: string;
  outcome: SteamKeyOutcome;
  products: string[];
  message: string;
};

const OUTCOMES: readonly SteamKeyOutcome[] = [
  "activated", "owned", "invalid", "used", "rate-limited", "region", "needs-base-game", "signed-out", "failed",
];

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

// What steam.content.ts reports, checked at the message boundary: no key, no
// report; anything unexpected reads as a failure, which keeps the key.
export function parseSteamKeyReport(data: unknown): SteamKeyReport | null {
  const raw = (data ?? {}) as Record<string, unknown>;
  const key = asText(raw.key).trim();
  if (!key) return null;
  const outcome = OUTCOMES.find((known) => known === raw.outcome) ?? "failed";
  const products = Array.isArray(raw.products) ? raw.products.filter((p): p is string => typeof p === "string") : [];
  return { key, title: asText(raw.title), outcome, products, message: asText(raw.message) };
}

// What a gift page reports (see revealGiftKey), checked at the boundary.
export function parseGiftKeys(data: unknown): GiftKey[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const isWellFormed = typeof raw.title === "string"
        && (raw.key === null || typeof raw.key === "string")
        && typeof raw.isSteam === "boolean";
    return isWellFormed ? [{ title: raw.title as string, key: (raw.key as string | null) || null, isSteam: raw.isSteam as boolean }] : [];
  });
}

export function isIndieGalaGiftUrl(url: string | undefined): boolean {
  return !!url && url.startsWith("https://www.indiegala.com/gift-bundle/");
}

// "done" once the game is on the account; otherwise the key is kept in the
// pending list with Steam's activation link and the reason.
export async function recordSteamKeyResult(report: SteamKeyReport): Promise<"done" | "pending"> {
  const title = report.products.join(", ") || report.title || "Steam key";
  if (isSteamKeyDone(report.outcome)) {
    const record: SteamKeyRecord = { title, outcome: report.outcome, at: new Date().toISOString() };
    await setStorageItem(LAST_STEAM_KEY_KEY, record);
    await removePendingRedemption(report.key);
    if (report.outcome === "activated") await incrementCounter();
    return "done";
  }
  await addPendingRedemption({
    code: report.key,
    platform: "Steam",
    title,
    redeemUrl: steamActivationUrl(report.key),
    addedAt: new Date().toISOString(),
    reasonKey: pendingReasonKey(report.outcome),
  });
  return "pending";
}

// Not taken to Steam: the entry keeps the IndieGala page the key is on, and
// the key itself when there is one (e.g. a key for another store).
export async function recordUnreadGiftKey(title: string, pageUrl: string, reasonKey: PendingReasonKey, code: string = ""): Promise<void> {
  await addPendingRedemption({
    code,
    platform: "IndieGala",
    title,
    redeemUrl: pageUrl,
    addedAt: new Date().toISOString(),
    reasonKey,
  });
}

// What the background lends the flow below, so tests can stand in for tabs,
// the network and the waits.
export type KeyFlowDeps = {
  openTab: (url: string, action: string, data?: unknown) => Promise<void>;
  fetchImpl: typeof fetch;
  wait: (ms: number) => Promise<unknown>;
};

const WHEEL_KEY_TITLE = "Steam key (IndieGala Wheel of Fortune)";
// The gift can show up a moment after the spin.
const GIFT_LOOKUPS = 3;
const GIFT_LOOKUP_INTERVAL_MS = 5_000;

async function readGifts(fetchImpl: typeof fetch): Promise<IndieGalaGift[] | null> {
  try {
    const gifts = await fetchGameplayGifts(fetchImpl);
    if (!gifts) console.warn("[steamKey] IndieGala's library has no G. Giveaway tab (signed out, or it changed)");
    return gifts;
  } catch (error: unknown) {
    console.warn("[steamKey] IndieGala's library couldn't be read:", error);
    return null;
  }
}

// Before a spin: whatever is there now wasn't won by it.
export async function snapshotGifts(fetchImpl: typeof fetch): Promise<void> {
  const gifts = await readGifts(fetchImpl);
  if (!gifts) return;
  const known = (await getStorageItem<string[]>(KNOWN_GIFTS_KEY)) ?? [];
  await rememberGifts([...gifts, ...known.map((url) => ({ url, password: null }))]);
}

// After a spin: a gift that wasn't there before is the prize, and its page
// is opened to read the key (see revealGiftKey in indiegalaWheel.content.ts).
// Any prize is checked once; a Steam key prize keeps looking for a while, and
// is kept as a pointer to the library if its gift never shows up.
export async function collectWonSteamKeys(prizeLabel: string, deps: KeyFlowDeps): Promise<"opened" | "pending" | "none"> {
  for (let attempt = 0; attempt < GIFT_LOOKUPS; attempt++) {
    if (attempt > 0) await deps.wait(GIFT_LOOKUP_INTERVAL_MS);
    const gifts = await readGifts(deps.fetchImpl);
    const fresh = gifts ? await takeNewGifts(gifts) : [];
    if (fresh.length > 0) {
      for (const gift of fresh) await openGift(gift, deps);
      return "opened";
    }
    if (!isSteamKeyPrize(prizeLabel)) return "none";
  }
  await recordUnreadGiftKey(WHEEL_KEY_TITLE, INDIEGALA_LIBRARY_URL, "pendingReasonGiftNotShown");
  return "pending";
}

async function openGift(gift: IndieGalaGift, deps: KeyFlowDeps): Promise<void> {
  try {
    await deps.openTab(gift.url, "revealGiftKey", { password: gift.password });
  } catch (error: unknown) {
    console.error("[steamKey] couldn't open the gift page:", error);
    await recordUnreadGiftKey(WHEEL_KEY_TITLE, gift.url, "pendingReasonGiftPageNotOpened");
  }
}

// The keys a gift page showed: each Steam key goes to Steam's activation
// page (see activateSteamKey in steam.content.ts); anything else is kept.
// True when something was kept for the user.
export async function handleGiftKeys(giftUrl: string, keys: GiftKey[], deps: KeyFlowDeps): Promise<boolean> {
  if (keys.length === 0) {
    await recordUnreadGiftKey(WHEEL_KEY_TITLE, giftUrl, "pendingReasonGiftNoKey");
    return true;
  }
  let isAnyKept = false;
  for (const giftKey of keys) {
    const title = giftKey.title || WHEEL_KEY_TITLE;
    if (!giftKey.key || !giftKey.isSteam) {
      const reasonKey = giftKey.key ? "pendingReasonNotSteamKey" : "pendingReasonKeyNotShown";
      await recordUnreadGiftKey(title, giftUrl, reasonKey, giftKey.key ?? "");
      isAnyKept = true;
      continue;
    }
    // Kept before Steam's page even opens: that tab can die before it reports
    // (closed, crashed, worker restart). Its report replaces this entry, or
    // clears it once the game is on the account.
    await addPendingRedemption({
      code: giftKey.key,
      platform: "Steam",
      title,
      redeemUrl: steamActivationUrl(giftKey.key),
      addedAt: new Date().toISOString(),
      reasonKey: "pendingReasonSteamUnfinished",
    });
    try {
      await deps.openTab(englishSteamActivationUrl(giftKey.key), "activateSteamKey", { title });
    } catch (error: unknown) {
      console.error("[steamKey] couldn't open Steam's activation page:", error);
      await recordSteamKeyResult({ key: giftKey.key, title, outcome: "failed", products: [], message: String(error) });
      isAnyKept = true;
    }
  }
  return isAnyKept;
}
