export enum ClaimFrequency {
  BROWSER_START = "browser_start",
  HOURLY = "hourly",
  EVERY_6_HOURS = "every_6_hours",
  EVERY_12_HOURS = "every_12_hours",
  DAILY = "daily"
}

export const ClaimFrequencyLabels: Record<ClaimFrequency, string> = {
  [ClaimFrequency.BROWSER_START]: "On Browser Start Only",
  [ClaimFrequency.HOURLY]: "Every Hour",
  [ClaimFrequency.EVERY_6_HOURS]: "Every 6 Hours",
  [ClaimFrequency.EVERY_12_HOURS]: "Every 12 Hours",
  [ClaimFrequency.DAILY]: "Once Daily"
};

export const ClaimFrequencyMinutes: Record<ClaimFrequency, number> = {
  [ClaimFrequency.BROWSER_START]: 0, // Not used for alarms, only onStartup
  [ClaimFrequency.HOURLY]: 60,
  [ClaimFrequency.EVERY_6_HOURS]: 360,
  [ClaimFrequency.EVERY_12_HOURS]: 720,
  [ClaimFrequency.DAILY]: 1440 // 24 hours
};

