var window = this;
var OUT = [];
var PASS = 0, FAIL = 0;
function log(s) { OUT.push(String(s)); }
function ok(name, cond, extra) {
  if (cond) { PASS++; }
  else { FAIL++; log('FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function close(name, a, b, tol) {
  ok(name, a != null && Math.abs(a - b) <= (tol || 0.01), a + ' vs ' + b);
}
var _ls = {};
window.localStorage = {
  getItem: function (k) { return k in _ls ? _ls[k] : null; },
  setItem: function (k, v) { _ls[k] = String(v); },
  removeItem: function (k) { delete _ls[k]; }
};
window.console = { log: log, warn: log, error: log };
window.isSecureContext = true;
window.location = { protocol: 'https:', hostname: 'example.com' };
window.navigator = {};
window.alert = function (m) { log('ALERT: ' + m); };
window.fetch = function () { return { then: function () { return this; }, catch: function () { return this; } }; };
// JavaScriptCore via osascript has no timers; run callbacks inline.
window.setTimeout = function (fn) { if (typeof fn === 'function') fn(); return 0; };
window.clearTimeout = function () {};
window.setInterval = function () { return 0; };
window.clearInterval = function () {};
