const themeScript = `
(function () {
  var appearance = localStorage.getItem('ldpass.appearance') || 'system';
  var accent = localStorage.getItem('ldpass.accent') || 'auto';
  var font = localStorage.getItem('ldpass.font') || 'harmony';
  if (font !== 'harmony' && font !== 'system') {
    font = 'harmony';
  }
  var materialMode = 'balanced';
  var materialThickness = 50;
  var motionMode = 'system';
  try {
    var uiEffects = JSON.parse(localStorage.getItem('ldpass.uiEffects.v1') || 'null');
    if (uiEffects) {
      if (
        uiEffects.materialMode === 'performance' ||
        uiEffects.materialMode === 'balanced' ||
        uiEffects.materialMode === 'advanced'
      ) {
        materialMode = uiEffects.materialMode;
      }
      if (typeof uiEffects.materialThickness === 'number' && Number.isFinite(uiEffects.materialThickness)) {
        materialThickness = Math.min(100, Math.max(0, Math.round(uiEffects.materialThickness)));
      }
      if (
        uiEffects.motionMode === 'system' ||
        uiEffects.motionMode === 'full' ||
        uiEffects.motionMode === 'reduced'
      ) {
        motionMode = uiEffects.motionMode;
      }
    }
  } catch (error) {
    materialMode = 'balanced';
    materialThickness = 50;
    motionMode = 'system';
  }
  var resolvedAppearance = appearance === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : appearance;
  var now = new Date();
  var nowTime = now.getTime();
  var autoSchedule = [
    { effectiveAt: '1970-01-01T00:00:00.000Z', tone: 'teal' }
  ];
  try {
    var cachedConfig = JSON.parse(localStorage.getItem('ldpass.platformThemeConfig') || 'null');
    if (cachedConfig && Array.isArray(cachedConfig.accentSchedule) && cachedConfig.accentSchedule.length > 0) {
      autoSchedule = [];
      for (var j = 0; j < cachedConfig.accentSchedule.length; j += 1) {
        var cachedEntry = cachedConfig.accentSchedule[j];
        var cachedEffectiveAt = cachedEntry && typeof cachedEntry.effectiveAt === 'string'
          ? Date.parse(cachedEntry.effectiveAt)
          : NaN;
        if (
          cachedEntry &&
          !Number.isNaN(cachedEffectiveAt) &&
          (cachedEntry.tone === 'teal' || cachedEntry.tone === 'red' || cachedEntry.tone === 'gray')
        ) {
          autoSchedule.push({ effectiveAt: cachedEntry.effectiveAt, tone: cachedEntry.tone });
        }
      }
      if (autoSchedule.length === 0) {
        autoSchedule = [{ effectiveAt: '1970-01-01T00:00:00.000Z', tone: 'teal' }];
      }
    }
  } catch (error) {
    autoSchedule = [{ effectiveAt: '1970-01-01T00:00:00.000Z', tone: 'teal' }];
  }
  autoSchedule.sort(function (left, right) {
    return Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt);
  });
  var autoTone = 'teal';
  for (var i = 0; i < autoSchedule.length; i += 1) {
    if (Date.parse(autoSchedule[i].effectiveAt) <= nowTime) {
      autoTone = autoSchedule[i].tone;
    }
  }
  var resolvedAccent = accent === 'auto' ? autoTone : accent;
  var root = document.documentElement;
  root.dataset.appearance = appearance;
  root.dataset.resolvedAppearance = resolvedAppearance;
  root.dataset.accent = accent;
  root.dataset.resolvedAccent = resolvedAccent;
  root.dataset.fontFamily = font;
  var reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
  root.dataset.materialMode = reducedTransparency ? 'performance' : materialMode;
  root.dataset.motion = motionMode;
  if (reducedTransparency) {
    root.dataset.reducedTransparency = '';
  }
  var materialAmount = materialThickness / 100;
  var materialBlur = 2 + Math.pow(materialAmount, 2) * 30;
  var materialSaturation = 1.55 - materialAmount * 0.15;
  root.style.setProperty('--ldpass-material-blur', materialBlur + 'px');
  root.style.setProperty('--ldpass-material-blur-strong', materialBlur * 1.35 + 'px');
  root.style.setProperty('--ldpass-material-blur-medium', materialBlur * 0.8 + 'px');
  root.style.setProperty('--ldpass-material-blur-soft', materialBlur * 0.35 + 'px');
  root.style.setProperty('--ldpass-material-brightness-light', String(1.38 - materialAmount * 0.32));
  root.style.setProperty('--ldpass-material-brightness-dark', String(0.68 + materialAmount * 0.26));
  root.style.setProperty('--ldpass-material-contrast', String(1.24 - materialAmount * 0.2));
  root.style.setProperty('--ldpass-material-saturation', String(materialSaturation));
  root.style.setProperty('--ldpass-material-floating-surface', 36 + materialAmount * 58 + '%');
  root.style.setProperty('--ldpass-material-action-surface', 48 + materialAmount * 49 + '%');
  root.style.setProperty('--ldpass-material-title-surface', 34 + materialAmount * 62 + '%');
  root.style.setProperty('--ldpass-material-title-mid-surface', 4 + materialAmount * 58 + '%');
  root.style.setProperty('--ldpass-material-text-shadow-strength', 68 - materialAmount * 44 + '%');
  root.style.colorScheme = resolvedAppearance;
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
