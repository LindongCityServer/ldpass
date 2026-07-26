'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJson } from './api-client';
import {
  cachePlatformThemeConfig,
  fallbackPlatformThemeConfig,
  normalizePlatformThemeConfig,
  readCachedPlatformThemeConfig,
  resolveScheduledAccentTone,
  type PlatformThemeConfig,
  type PlatformThemeScheduleResponse,
} from './theme-config';
import {
  defaultUiEffectsPreference,
  readUiEffectsPreference,
  subscribeUiEffectsPreferenceChanged,
  updateUiEffectsPreference,
  type MaterialMode,
  type MotionMode,
  type UiEffectsPreference,
} from './ui-effects-preference';

export type AppearanceMode = 'light' | 'dark' | 'system';
export type AccentMode = 'teal' | 'red' | 'gray' | 'auto';
export type AccentTone = 'teal' | 'red' | 'gray';
export type FontMode = 'harmony' | 'system';

const appearanceModes: Array<{ value: AppearanceMode; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const accentModes: Array<{ value: AccentMode; label: string }> = [
  { value: 'teal', label: '青绿色' },
  { value: 'red', label: '红色' },
  { value: 'gray', label: '灰色' },
  { value: 'auto', label: '自动切换' },
];

const fontModes: Array<{ value: FontMode; label: string }> = [
  { value: 'harmony', label: 'HarmonyOS Sans' },
  { value: 'system', label: '系统字体' },
];

const materialModes: Array<{ value: MaterialMode; label: string }> = [
  { value: 'performance', label: '性能' },
  { value: 'balanced', label: '平衡' },
  { value: 'advanced', label: '高级' },
];

const motionModes: Array<{ value: MotionMode; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'full', label: '开启' },
  { value: 'reduced', label: '关闭' },
];

const storageKeys = {
  appearance: 'ldpass.appearance',
  accent: 'ldpass.accent',
  font: 'ldpass.font',
} as const;

function readStoredAppearance(): AppearanceMode {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const value = window.localStorage.getItem(storageKeys.appearance);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function readStoredAccent(): AccentMode {
  if (typeof window === 'undefined') {
    return 'auto';
  }

  const value = window.localStorage.getItem(storageKeys.accent);
  return value === 'teal' || value === 'red' || value === 'gray' || value === 'auto'
    ? value
    : 'auto';
}

function readStoredFont(): FontMode {
  if (typeof window === 'undefined') {
    return 'harmony';
  }

  const value = window.localStorage.getItem(storageKeys.font);
  return value === 'harmony' || value === 'system' ? value : 'harmony';
}

function resolveAppearance(appearance: AppearanceMode): 'light' | 'dark' {
  if (appearance !== 'system') {
    return appearance;
  }

  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveAccentTone(accent: AccentMode, autoTone: AccentTone): AccentTone {
  return accent === 'auto' ? autoTone : accent;
}

export function applyThemePreferences(
  appearance: AppearanceMode,
  accent: AccentMode,
  autoTone: AccentTone,
  font: FontMode,
): void {
  if (typeof document === 'undefined') {
    return;
  }

  const resolvedAppearance = resolveAppearance(appearance);
  const resolvedAccent = resolveAccentTone(accent, autoTone);
  const root = document.documentElement;

  root.dataset.appearance = appearance;
  root.dataset.resolvedAppearance = resolvedAppearance;
  root.dataset.accent = accent;
  root.dataset.resolvedAccent = resolvedAccent;
  root.dataset.fontFamily = font;
  root.style.colorScheme = resolvedAppearance;
}

interface ThemeSettingsProps {
  autoTone?: AccentTone;
}

export function ThemeSettings({ autoTone = 'teal' }: ThemeSettingsProps) {
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [appearance, setAppearance] = useState<AppearanceMode>('system');
  const [accent, setAccent] = useState<AccentMode>('auto');
  const [font, setFont] = useState<FontMode>('harmony');
  const [uiEffectsPreference, setUiEffectsPreference] = useState<UiEffectsPreference>(
    defaultUiEffectsPreference,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const [platformThemeConfig, setPlatformThemeConfig] = useState<PlatformThemeConfig>(
    fallbackPlatformThemeConfig,
  );
  const [scheduledAutoTone, setScheduledAutoTone] = useState<AccentTone>(autoTone);

  useEffect(() => {
    setAppearance(readStoredAppearance());
    setAccent(readStoredAccent());
    setFont(readStoredFont());
    setUiEffectsPreference(readUiEffectsPreference());
    setPlatformThemeConfig(readCachedPlatformThemeConfig());
  }, []);

  useEffect(
    () =>
      subscribeUiEffectsPreferenceChanged(({ preference }) => setUiEffectsPreference(preference)),
    [],
  );

  useEffect(() => {
    const syncScheduledTone = () => {
      setScheduledAutoTone(resolveScheduledAccentTone(platformThemeConfig));
    };

    syncScheduledTone();
    const timer = window.setInterval(syncScheduledTone, 60 * 1000);

    return () => window.clearInterval(timer);
  }, [platformThemeConfig]);

  useEffect(() => {
    let isMounted = true;

    getJson<PlatformThemeScheduleResponse>('/api/theme/schedule')
      .then((response) => {
        if (!isMounted) {
          return;
        }

        const nextConfig = normalizePlatformThemeConfig(response);
        cachePlatformThemeConfig(nextConfig);
        setPlatformThemeConfig(nextConfig);
        setScheduledAutoTone(resolveScheduledAccentTone(nextConfig));
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    applyThemePreferences(appearance, accent, scheduledAutoTone, font);
  }, [accent, appearance, font, scheduledAutoTone]);

  const updatePopoverPosition = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const trigger = settingsRef.current;
    if (!trigger) {
      return;
    }

    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const margin = 12;
    const gap = 10;
    const viewportBottom = viewportTop + viewportHeight;
    const availableWidth = Math.max(0, viewportWidth - margin * 2);
    const popoverWidth = Math.min(336, availableWidth);
    const triggerRect = trigger.getBoundingClientRect();
    const minLeft = viewportLeft + margin;
    const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - popoverWidth - margin);
    const left = Math.min(Math.max(minLeft, triggerRect.right - popoverWidth), maxLeft);
    const minTop = viewportTop + margin;
    const maxTop = Math.max(minTop, viewportBottom - margin - 120);
    const top = Math.min(Math.max(minTop, triggerRect.bottom + gap), maxTop);
    const maxHeight = Math.max(0, viewportBottom - top - margin);

    setPopoverStyle({
      left,
      maxHeight,
      top,
      width: popoverWidth,
    });
  }, []);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const closeWhenClickOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!settingsRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeWhenClickOutside, true);

    return () => document.removeEventListener('pointerdown', closeWhenClickOutside, true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return undefined;
    }

    updatePopoverPosition();

    const viewport = window.visualViewport;
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    viewport?.addEventListener('resize', updatePopoverPosition);
    viewport?.addEventListener('scroll', updatePopoverPosition);

    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
      viewport?.removeEventListener('resize', updatePopoverPosition);
      viewport?.removeEventListener('scroll', updatePopoverPosition);
    };
  }, [isOpen, updatePopoverPosition]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () =>
      applyThemePreferences(appearance, accent, scheduledAutoTone, font);
    media.addEventListener('change', syncSystemTheme);

    return () => media.removeEventListener('change', syncSystemTheme);
  }, [accent, appearance, font, scheduledAutoTone]);

  const setAppearancePreference = useCallback((nextAppearance: AppearanceMode) => {
    setAppearance(nextAppearance);
    window.localStorage.setItem(storageKeys.appearance, nextAppearance);
  }, []);

  const setAccentPreference = useCallback((nextAccent: AccentMode) => {
    setAccent(nextAccent);
    window.localStorage.setItem(storageKeys.accent, nextAccent);
  }, []);

  const setFontPreference = useCallback((nextFont: FontMode) => {
    setFont(nextFont);
    window.localStorage.setItem(storageKeys.font, nextFont);
  }, []);

  const setMaterialModePreference = useCallback(
    (materialMode: MaterialMode) => {
      const next = updateUiEffectsPreference({ ...uiEffectsPreference, materialMode });
      setUiEffectsPreference(next);
    },
    [uiEffectsPreference],
  );

  const setMaterialThicknessPreference = useCallback(
    (materialThickness: number) => {
      const next = updateUiEffectsPreference({ ...uiEffectsPreference, materialThickness });
      setUiEffectsPreference(next);
    },
    [uiEffectsPreference],
  );

  const setMotionModePreference = useCallback(
    (motionMode: MotionMode) => {
      const next = updateUiEffectsPreference({ ...uiEffectsPreference, motionMode });
      setUiEffectsPreference(next);
    },
    [uiEffectsPreference],
  );

  const resolvedAccentLabel = useMemo(() => {
    const tone = resolveAccentTone(accent, scheduledAutoTone);
    return accent === 'auto'
      ? `自动：${accentModes.find((mode) => mode.value === tone)?.label}`
      : '';
  }, [accent, scheduledAutoTone]);

  return (
    <div className="theme-settings" ref={settingsRef}>
      <button
        className={`icon-button${isOpen ? ' is-active' : ''}`}
        type="button"
        aria-label="主题设置"
        title="主题设置"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        <span className="material-symbols-rounded" aria-hidden="true">
          palette
        </span>
      </button>

      {isOpen ? (
        <section className="theme-popover" aria-label="主题设置" style={popoverStyle}>
          <div className="theme-group">
            <h2>外观</h2>
            <div className="segmented-control">
              {appearanceModes.map((mode) => (
                <button
                  className={appearance === mode.value ? 'is-selected' : ''}
                  type="button"
                  aria-pressed={appearance === mode.value}
                  key={mode.value}
                  onClick={() => setAppearancePreference(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="theme-group">
            <h2>材质</h2>
            <div className="segmented-control">
              {materialModes.map((mode) => (
                <button
                  className={uiEffectsPreference.materialMode === mode.value ? 'is-selected' : ''}
                  type="button"
                  aria-pressed={uiEffectsPreference.materialMode === mode.value}
                  key={mode.value}
                  onClick={() => setMaterialModePreference(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <label
              className={`theme-range-control${
                uiEffectsPreference.materialMode === 'advanced' ? '' : ' is-disabled'
              }`}
            >
              <span>
                <span>高级材质厚度</span>
                <output htmlFor="material-thickness">
                  {uiEffectsPreference.materialThickness}%
                </output>
              </span>
              <input
                id="material-thickness"
                type="range"
                min="0"
                max="100"
                step="1"
                value={uiEffectsPreference.materialThickness}
                disabled={uiEffectsPreference.materialMode !== 'advanced'}
                onChange={(event) =>
                  setMaterialThicknessPreference(Number(event.currentTarget.value))
                }
              />
            </label>
          </div>

          <div className="theme-group">
            <h2>动态效果</h2>
            <div className="segmented-control">
              {motionModes.map((mode) => (
                <button
                  className={uiEffectsPreference.motionMode === mode.value ? 'is-selected' : ''}
                  type="button"
                  aria-pressed={uiEffectsPreference.motionMode === mode.value}
                  key={mode.value}
                  onClick={() => setMotionModePreference(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="theme-group">
            <h2>主题色</h2>
            <div className="swatch-grid">
              {accentModes.map((mode) => (
                <button
                  className={`swatch-button swatch-${mode.value}${accent === mode.value ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={accent === mode.value}
                  key={mode.value}
                  onClick={() => setAccentPreference(mode.value)}
                >
                  <span aria-hidden="true" />
                  {mode.label}
                </button>
              ))}
            </div>
            {resolvedAccentLabel ? <p>{resolvedAccentLabel}</p> : null}
          </div>

          <div className="theme-group">
            <h2>字体</h2>
            <div className="segmented-control">
              {fontModes.map((mode) => (
                <button
                  className={font === mode.value ? 'is-selected' : ''}
                  type="button"
                  aria-pressed={font === mode.value}
                  key={mode.value}
                  onClick={() => setFontPreference(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
