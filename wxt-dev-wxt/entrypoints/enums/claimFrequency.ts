import type { MessageKey } from "@/entrypoints/utils/i18n.ts";

export enum ClaimFrequency {
  BROWSER_START = "browser_start",
  HOURLY = "hourly",
  EVERY_6_HOURS = "every_6_hours",
  EVERY_12_HOURS = "every_12_hours",
  DAILY = "daily"
}

// The dropdown's labels, as message keys (see utils/i18n.ts).
export const ClaimFrequencyLabelKeys: Record<ClaimFrequency, MessageKey> = {
  [ClaimFrequency.BROWSER_START]: "frequencyBrowserStart",
  [ClaimFrequency.HOURLY]: "frequencyHourly",
  [ClaimFrequency.EVERY_6_HOURS]: "frequencyEvery6Hours",
  [ClaimFrequency.EVERY_12_HOURS]: "frequencyEvery12Hours",
  [ClaimFrequency.DAILY]: "frequencyDaily"
};

export const ClaimFrequencyMinutes: Record<ClaimFrequency, number> = {
  [ClaimFrequency.BROWSER_START]: 0, // Not used for alarms, only onStartup
  [ClaimFrequency.HOURLY]: 60,
  [ClaimFrequency.EVERY_6_HOURS]: 360,
  [ClaimFrequency.EVERY_12_HOURS]: 720,
  [ClaimFrequency.DAILY]: 1440 // 24 hours
};

