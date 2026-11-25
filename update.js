// Auto-update: checks for a newer version of the app and reloads when it's safe.
(function () {
  var meta = document.querySelector('meta[name="bbl-version"]');
  var mine = meta ? meta.content : 'dev';
  if (mine === 'dev') return; // local copy, nothing to compare
  function busy() {
    if (typeof window.bblSafeToReload === 'function' && !window.bblSafeToReload()) return true;
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    var f = document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea');
    for (var i = 0; i < f.length; i++) if (f[i].value && f[i].offsetParent !== null && !f[i].readOnly && f[i].type !== 'search') return true;
    return false;
  }
  function check() {
    fetch('version.txt?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (v) {
        v = (v || '').trim();
        if (!v || v === mine || busy()) return;
        try { if (sessionStorage.getItem('bblTried') === v) return; sessionStorage.setItem('bblTried', v); } catch (e) {}
        var u = new URL(location.href);
        u.searchParams.set('_v', v);
        location.replace(u.toString());
      })
      .catch(function () {});
  }
  setInterval(check, 2 * 60000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
  setTimeout(check, 5000);
})();
