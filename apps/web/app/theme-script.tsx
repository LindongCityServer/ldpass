const themeScript = `
(function () {
  var appearance = localStorage.getItem('ldpass.appearance') || 'system';
  var accent = localStorage.getItem('ldpass.accent') || 'auto';
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
  root.style.colorScheme = resolvedAppearance;
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
