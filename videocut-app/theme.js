// Тема до першого малювання (без спалаху) і службові налаштування. Підключається звичайним скриптом у <head>.
window.__ccFontsReady = true; // шрифти для субтитрів лежать у fonts/, чекати на них не треба
(function () {
  try {
    var t = localStorage.getItem('edvault-theme') || 'dark';
    var dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) { document.documentElement.setAttribute('data-theme', 'dark'); }
  // старий редактор реєстрував service worker для FFmpeg — він більше не потрібен
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(function (rs) {
    rs.forEach(function (r) { var w = r.active || r.waiting || r.installing; if (w && /coi-serviceworker/.test(w.scriptURL)) r.unregister(); });
  }).catch(function () {});
})();
