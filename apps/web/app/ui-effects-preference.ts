export type MaterialMode = 'performance' | 'balanced' | 'advanced';
export type MotionMode = 'system' | 'full' | 'reduced';

export interface UiEffectsPreference {
  materialMode: MaterialMode;
  materialThickness: number;
  motionMode: MotionMode;
}

export interface UiEffectsPreferenceChangedPayload {
  preference: UiEffectsPreference;
  source: 'local' | 'storage';
}

interface StoredUiEffectsPreference {
  materialMode?: unknown;
  materialThickness?: unknown;
  motionMode?: unknown;
}

export const uiEffectsPreferenceStorageKey = 'ldpass.uiEffects.v1';
export const uiEffectsPreferenceChangedEventName = 'ldpass:ui-effects-preference-changed';

export const defaultUiEffectsPreference: UiEffectsPreference = {
  materialMode: 'balanced',
  materialThickness: 50,
  motionMode: 'system',
};

export function readUiEffectsPreference(): UiEffectsPreference {
  if (typeof window === 'undefined') {
    return defaultUiEffectsPreference;
  }

  const source = window.localStorage.getItem(uiEffectsPreferenceStorageKey);
  if (!source) {
    return defaultUiEffectsPreference;
  }

  try {
    return normalizeUiEffectsPreference(JSON.parse(source) as StoredUiEffectsPreference);
  } catch {
    return defaultUiEffectsPreference;
  }
}

export function updateUiEffectsPreference(preference: UiEffectsPreference): UiEffectsPreference {
  const normalized = normalizeUiEffectsPreference(preference);
  window.localStorage.setItem(uiEffectsPreferenceStorageKey, JSON.stringify(normalized));
  publishUiEffectsPreferenceChanged({ preference: normalized, source: 'local' });
  return normalized;
}

export function applyUiEffectsPreference(preference: UiEffectsPreference): void {
  const root = document.documentElement;
  const amount = preference.materialThickness / 100;
  const blur = 2 + Math.pow(amount, 2) * 30;
  const saturation = 1.55 - amount * 0.15;
  const reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;

  root.dataset.materialMode = reducedTransparency ? 'performance' : preference.materialMode;
  root.dataset.motion = preference.motionMode;
  if (reducedTransparency) {
    root.dataset.reducedTransparency = '';
  } else {
    delete root.dataset.reducedTransparency;
  }

  root.style.setProperty('--ldpass-material-blur', `${blur}px`);
  root.style.setProperty('--ldpass-material-blur-strong', `${blur * 1.35}px`);
  root.style.setProperty('--ldpass-material-blur-medium', `${blur * 0.8}px`);
  root.style.setProperty('--ldpass-material-blur-soft', `${blur * 0.35}px`);
  root.style.setProperty('--ldpass-material-brightness-light', String(1.38 - amount * 0.32));
  root.style.setProperty('--ldpass-material-brightness-dark', String(0.68 + amount * 0.26));
  root.style.setProperty('--ldpass-material-contrast', String(1.24 - amount * 0.2));
  root.style.setProperty('--ldpass-material-saturation', String(saturation));
  root.style.setProperty('--ldpass-material-floating-surface', `${36 + amount * 58}%`);
  root.style.setProperty('--ldpass-material-action-surface', `${48 + amount * 49}%`);
  root.style.setProperty('--ldpass-material-title-surface', `${34 + amount * 62}%`);
  root.style.setProperty('--ldpass-material-title-mid-surface', `${4 + amount * 58}%`);
  root.style.setProperty('--ldpass-material-text-shadow-strength', `${68 - amount * 44}%`);
}

export function publishUiEffectsPreferenceChanged(
  payload: UiEffectsPreferenceChangedPayload,
): void {
  window.dispatchEvent(
    new CustomEvent<UiEffectsPreferenceChangedPayload>(uiEffectsPreferenceChangedEventName, {
      detail: payload,
    }),
  );
}

export function subscribeUiEffectsPreferenceChanged(
  listener: (payload: UiEffectsPreferenceChangedPayload) => void,
): () => void {
  const handlePreferenceChanged = (event: Event) => {
    listener((event as CustomEvent<UiEffectsPreferenceChangedPayload>).detail);
  };
  window.addEventListener(uiEffectsPreferenceChangedEventName, handlePreferenceChanged);
  return () =>
    window.removeEventListener(uiEffectsPreferenceChangedEventName, handlePreferenceChanged);
}

function normalizeUiEffectsPreference(preference: StoredUiEffectsPreference): UiEffectsPreference {
  const materialMode = isMaterialMode(preference.materialMode)
    ? preference.materialMode
    : defaultUiEffectsPreference.materialMode;
  const materialThickness =
    typeof preference.materialThickness === 'number' &&
    Number.isFinite(preference.materialThickness)
      ? Math.min(100, Math.max(0, Math.round(preference.materialThickness)))
      : defaultUiEffectsPreference.materialThickness;
  const motionMode = isMotionMode(preference.motionMode)
    ? preference.motionMode
    : defaultUiEffectsPreference.motionMode;

  return { materialMode, materialThickness, motionMode };
}

function isMaterialMode(value: unknown): value is MaterialMode {
  return value === 'performance' || value === 'balanced' || value === 'advanced';
}

function isMotionMode(value: unknown): value is MotionMode {
  return value === 'system' || value === 'full' || value === 'reduced';
}
