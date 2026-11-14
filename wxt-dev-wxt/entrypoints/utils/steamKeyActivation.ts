// Steam's "Activate a Product" page (account/registerkey), confirmed live in
// Nov 2026: ?key= fills the key in, and the page's own RegisterProductKey()
// posts it once the subscriber agreement box is ticked. Success shows
// #receipt_form; a refusal shows a message in #error_display, one per
// purchase result code (texts from Steam's registerkey.js).

import type { PendingReasonKey } from "@/entrypoints/utils/pendingRedemptions.ts";

export const STEAM_ACTIVATION_PAGE = "https://store.steampowered.com/account/registerkey";

export function steamActivationUrl(key: string): string {
  return `${STEAM_ACTIVATION_PAGE}?key=${encodeURIComponent(key)}`;
}

export type SteamKeyOutcome =
    | "activated"
    | "owned"
    | "invalid"
    | "used"
    | "rate-limited"
    | "region"
    | "needs-base-game"
    | "signed-out"
    | "failed";

export type SteamKeyResult = {
  outcome: SteamKeyOutcome;
  products: string[];
  message: string;
};

const ERROR_OUTCOMES: [RegExp, SteamKeyOutcome][] = [
  [/already owns/i, "owned"],
  [/already been activated by a different/i, "used"],
  [/not valid or is not a product code/i, "invalid"],
  [/too many recent activation attempts/i, "rate-limited"],
  [/not available for purchase in this country/i, "region"],
  [/requires ownership of another product/i, "needs-base-game"],
];

export function classifySteamKeyError(message: string): SteamKeyOutcome {
  return ERROR_OUTCOMES.find(([pattern]) => pattern.test(message))?.[1] ?? "failed";
}

function isShown(el: HTMLElement | null): el is HTMLElement {
  return el !== null && el.style.display !== "none";
}

// Null while Steam hasn't answered yet.
export function readSteamKeyResult(doc: Document): SteamKeyResult | null {
  const receipt = doc.getElementById("receipt_form");
  if (isShown(receipt)) {
    const products = Array.from(doc.querySelectorAll(".registerkey_lineitem"))
        .map((item) => (item.textContent ?? "").trim())
        .filter(Boolean);
    return { outcome: "activated", products, message: "" };
  }
  const error = doc.getElementById("error_display");
  const message = (error?.textContent ?? "").trim();
  if (isShown(error) && message) return { outcome: classifySteamKeyError(message), products: [], message };
  return null;
}

export type DoneSteamKeyOutcome = "activated" | "owned";
export type PendingSteamKeyOutcome = Exclude<SteamKeyOutcome, DoneSteamKeyOutcome>;

// Owned already: the game is on the account, which is all the key was for.
export function isSteamKeyDone(outcome: SteamKeyOutcome): outcome is DoneSteamKeyOutcome {
  return outcome === "activated" || outcome === "owned";
}

// Why a key is still pending, as a message key: the popup translates it
// when it shows the pending list.
const OUTCOME_REASON_KEYS: Record<PendingSteamKeyOutcome, PendingReasonKey> = {
  invalid: "pendingReasonSteamInvalid",
  used: "pendingReasonSteamUsed",
  "rate-limited": "pendingReasonSteamRateLimited",
  region: "pendingReasonSteamRegion",
  "needs-base-game": "pendingReasonSteamNeedsBaseGame",
  "signed-out": "pendingReasonSteamSignedOut",
  failed: "pendingReasonSteamFailed",
};

export function pendingReasonKey(outcome: PendingSteamKeyOutcome): PendingReasonKey {
  return OUTCOME_REASON_KEYS[outcome];
}

// Runs in the page's MAIN world via scripting.executeScript (Steam's button
// is a javascript: link, which a content script's click can't run), so it is
// serialised and must stay self-contained.
export function registerKeyInMainWorld(): boolean {
  const agree = document.getElementById("accept_ssa") as HTMLInputElement | null;
  const register = (window as unknown as { RegisterProductKey?: () => void }).RegisterProductKey;
  if (!agree || typeof register !== "function") return false;
  agree.checked = true;
  register();
  return true;
}
