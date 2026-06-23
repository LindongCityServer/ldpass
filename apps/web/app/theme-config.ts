import type { AccentTone } from './theme-provider';

export interface PlatformAccentScheduleEntry {
  effectiveAt: string;
  tone: AccentTone;
}

export interface PlatformThemeConfig {
  accentSchedule: PlatformAccentScheduleEntry[];
}

export interface PlatformThemeScheduleResponse {
  entries: Array<{
    effectiveAt: string;
    tone: AccentTone;
    enabled: boolean;
    note?: string | null;
  }>;
}

export const fallbackPlatformThemeConfig: PlatformThemeConfig = {
  accentSchedule: [
    { effectiveAt: '1970-01-01T00:00:00.000Z', tone: 'teal' },
  ],
};

export const platformThemeConfigStorageKey = 'ldpass.platformThemeConfig';

export function normalizePlatformThemeConfig(response: PlatformThemeScheduleResponse): PlatformThemeConfig {
  const accentSchedule = response.entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      effectiveAt: entry.effectiveAt,
      tone: entry.tone,
    }))
    .filter((entry) => !Number.isNaN(Date.parse(entry.effectiveAt)))
    .sort((left, right) => Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt));

  return {
    accentSchedule: accentSchedule.length > 0 ? accentSchedule : fallbackPlatformThemeConfig.accentSchedule,
  };
}

export function readCachedPlatformThemeConfig(): PlatformThemeConfig {
  if (typeof window === 'undefined') {
    return fallbackPlatformThemeConfig;
  }

  const rawValue = window.localStorage.getItem(platformThemeConfigStorageKey);
  if (!rawValue) {
    return fallbackPlatformThemeConfig;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as PlatformThemeConfig;
    if (!Array.isArray(parsedValue.accentSchedule)) {
      return fallbackPlatformThemeConfig;
    }

    const accentSchedule = parsedValue.accentSchedule.filter((entry) => {
      return (
        typeof entry.effectiveAt === 'string' &&
        !Number.isNaN(Date.parse(entry.effectiveAt)) &&
        (entry.tone === 'teal' || entry.tone === 'red' || entry.tone === 'gray')
      );
    });

    return {
      accentSchedule: accentSchedule.length > 0 ? accentSchedule : fallbackPlatformThemeConfig.accentSchedule,
    };
  } catch {
    return fallbackPlatformThemeConfig;
  }
}

export function cachePlatformThemeConfig(config: PlatformThemeConfig): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(platformThemeConfigStorageKey, JSON.stringify(config));
}

export function resolveScheduledAccentTone(config: PlatformThemeConfig, date = new Date()): AccentTone {
  const schedule = [...config.accentSchedule].sort((left, right) => Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt));
  const now = date.getTime();
  let matched: PlatformAccentScheduleEntry | undefined;

  for (const entry of schedule) {
    if (Date.parse(entry.effectiveAt) <= now) {
      matched = entry;
    }
  }

  return matched?.tone ?? 'teal';
}
