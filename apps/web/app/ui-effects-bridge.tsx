'use client';

import { useEffect } from 'react';
import {
  applyUiEffectsPreference,
  publishUiEffectsPreferenceChanged,
  readUiEffectsPreference,
  subscribeUiEffectsPreferenceChanged,
  uiEffectsPreferenceStorageKey,
} from './ui-effects-preference';

export function UiEffectsBridge() {
  useEffect(() => {
    applyUiEffectsPreference(readUiEffectsPreference());

    const unsubscribe = subscribeUiEffectsPreferenceChanged(({ preference }) =>
      applyUiEffectsPreference(preference),
    );
    const handleStorage = (event: StorageEvent) => {
      if (event.key === uiEffectsPreferenceStorageKey) {
        publishUiEffectsPreferenceChanged({
          preference: readUiEffectsPreference(),
          source: 'storage',
        });
      }
    };
    const reducedTransparencyQuery = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const handleReducedTransparencyChanged = () =>
      applyUiEffectsPreference(readUiEffectsPreference());

    window.addEventListener('storage', handleStorage);
    reducedTransparencyQuery.addEventListener('change', handleReducedTransparencyChanged);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleStorage);
      reducedTransparencyQuery.removeEventListener('change', handleReducedTransparencyChanged);
    };
  }, []);

  return null;
}
