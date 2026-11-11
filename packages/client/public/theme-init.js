// Sets the colour theme before the first paint so a dark page never flashes light.
// Loaded as a plain script from index.html (the Content-Security-Policy blocks inline scripts).
// Mirrors parseChoice and resolveTheme in src/theme.ts.
(function () {
  var choice = 'system';
  try {
    var stored = window.localStorage.getItem('tandem-theme');
    if (stored === 'light' || stored === 'dark') choice = stored;
  } catch (error) {
    void error; // Storage unavailable: follow the system.
  }
  var dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var theme = dark ? 'dark' : 'light';
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f1d22' : '#edf1ee');
})();
