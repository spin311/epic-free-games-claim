import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { getStorageItem, setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { NetworkError, SignedOutError } from "@/entrypoints/utils/network.ts";
import type { MessageKey } from "@/entrypoints/utils/i18n.ts";

// What went wrong on a store's last check, as the popup shows it:
// - "network": the store couldn't be reached, even after retries
// - "changed": it answered, but not in the shape the extension expects
//   (a page or API change, like Epic's 2026 redesign) and needs an update
// - "captcha": a claim is waiting for the user to solve one
// - "unfinished": a claim tab didn't get to the end (could be a slow page as
//   much as a change; it's retried, and only a lasting one needs a report)
export type HealthProblem = "network" | "changed" | "captcha" | "unfinished";

// Kept apart: a store's list check working (e.g. Epic's API) says nothing
// about its claim flow (the part Epic's redesign broke), so it must not clear
// a claim tab's report, and vice versa.
export type HealthStage = "check" | "claim";

// What a claim tab can give as its explanation, as message keys: the popup
// translates one when it shows it, so nothing is stored in whatever language
// the tab happened to run in. Stored, so a key here must not be renamed: see
// entrypoints/tests/storedMessageKeys.test.ts.
export const HEALTH_DETAIL_KEYS = [
    "healthEpicGetButtonMissing",
    "healthEpicCheckoutUnfinished",
    "healthEpicCaptcha",
] as const satisfies readonly MessageKey[];

export type HealthDetailKey = (typeof HEALTH_DETAIL_KEYS)[number];

// Checked where a claim tab's message comes in; anything else is dropped.
export function parseHealthDetailKey(value: unknown): HealthDetailKey | undefined {
    return HEALTH_DETAIL_KEYS.find((key) => key === value);
}

export interface HealthError {
    problem: HealthProblem;
    // A diagnostic (an error's message, in English); empty when detailKey
    // gives the explanation instead.
    detail: string;
    detailKey?: HealthDetailKey;
    at: string;
}

// A diagnostic, or an explanation the popup translates.
export type HealthDetail = string | { key: HealthDetailKey };

// Both kept, so a later success clears the warning by being newer, without
// losing what the last failure was.
export interface PlatformHealth {
    lastOkAt: string | null;
    lastError: HealthError | null;
}

// The list check's records; healthKey gives either stage's.
export const HEALTH_KEYS: Record<Platforms, string> = {
    [Platforms.Epic]: "epicHealth",
    [Platforms.Steam]: "steamHealth",
    [Platforms.GOG]: "gogHealth",
    [Platforms.IndieGala]: "indieGalaHealth",
    [Platforms.PrimeGaming]: "primeGamingHealth",
};

export function healthKey(platform: Platforms, stage: HealthStage = "check"): string {
    return stage === "check" ? HEALTH_KEYS[platform] : HEALTH_KEYS[platform].replace(/Health$/, "ClaimHealth");
}

// Anything that isn't a dropped request or a sign-out (an unexpected status,
// a missing field, a parse failure) means the store no longer matches what
// the extension expects.
export function classifyFailure(error: unknown): HealthProblem | null {
    if (error instanceof SignedOutError) return null;
    if (error instanceof NetworkError || isDroppedResponse(error)) return "network";
    return "changed";
}

// What a response whose body read died mid-way (TypeError), or a caller's
// own timeout (AbortSignal.timeout), throws after fetchWithRetry returned.
function isDroppedResponse(error: unknown): boolean {
    if (error instanceof DOMException) return error.name === "TimeoutError" || error.name === "AbortError";
    return error instanceof TypeError && /network|fetch/i.test(error.message);
}

export function activeProblem(health: PlatformHealth | null | undefined): HealthError | null {
    const error = health?.lastError;
    if (!error) return null;
    const lastOkAt = health?.lastOkAt;
    // A success recorded at the same moment counts as newer.
    return lastOkAt && lastOkAt >= error.at ? null : error;
}

async function readHealth(key: string): Promise<PlatformHealth> {
    return (await getStorageItem<PlatformHealth>(key)) ?? { lastOkAt: null, lastError: null };
}

export async function recordHealthOk(
    platform: Platforms,
    now: Date = new Date(),
    stage: HealthStage = "check"
): Promise<void> {
    const key = healthKey(platform, stage);
    await setStorageItem(key, { ...(await readHealth(key)), lastOkAt: now.toISOString() });
}

export async function recordHealthError(
    platform: Platforms,
    problem: HealthProblem,
    detail: HealthDetail,
    now: Date = new Date(),
    stage: HealthStage = "check"
): Promise<void> {
    const key = healthKey(platform, stage);
    const described = typeof detail === "string" ? { detail } : { detail: "", detailKey: detail.key };
    const lastError: HealthError = { problem, ...described, at: now.toISOString() };
    await setStorageItem(key, { ...(await readHealth(key)), lastError });
}
