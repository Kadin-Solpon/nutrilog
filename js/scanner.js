/* scanner.js — camera barcode scanning.
   Two paths: the native BarcodeDetector API where it exists (Chrome/Android),
   and a lazily-loaded ZXing decoder everywhere else, which is what iOS Safari
   actually takes. Either way the camera needs a secure context (https or
   localhost), so that gets checked up front and reported plainly. */
(function (NL) {
  'use strict';

  var ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  var FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf', 'codabar'];
  var zxingPromise = null;

  function secure() {
    return window.isSecureContext ||
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';
  }

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function loadZXing() {
    if (zxingPromise) return zxingPromise;
    zxingPromise = new Promise(function (resolve, reject) {
      if (window.ZXing) return resolve(window.ZXing);
      var s = document.createElement('script');
      s.src = ZXING_URL;
      s.async = true;
      s.onload = function () {
        window.ZXing ? resolve(window.ZXing)
                     : reject(new Error('Barcode decoder failed to initialise.'));
      };
      s.onerror = function () {
        zxingPromise = null;
        reject(new Error('Could not download the barcode decoder. ' +
          'Check your connection, or type the number in by hand.'));
      };
      document.head.appendChild(s);
    });
    return zxingPromise;
  }

  function friendlyError(e) {
    var name = e && e.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Camera access was blocked. In Safari, tap the "aA" or address bar, ' +
        'choose Website Settings, and allow Camera — then reload.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No camera was found on this device.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'The camera is busy in another app. Close it and try again.';
    }
    return (e && e.message) || 'The camera could not be started.';
  }

  /* start(videoEl, onDetect, onError) -> stop()
     onDetect gets the raw barcode digits. It is called at most once per
     `cooldown`, and a code must be seen twice to count, which kills nearly all
     misreads from a shaky hand. */
  function start(videoEl, onDetect, onError) {
    if (!secure()) {
      onError(new Error('The camera only works over https. Open the app from ' +
        'its https:// address (or localhost) and try again.'));
      return function () {};
    }
    if (!supported()) {
      onError(new Error('This browser cannot open the camera.'));
      return function () {};
    }

    var stopped = false, stream = null, reader = null, rafId = null;
    var lastCode = null, lastSeen = 0, confirmed = {};

    function report(code) {
      if (stopped || !code) return;
      var now = Date.now();
      code = String(code).replace(/\D/g, '');
      if (code.length < 8) return;
      if (code === lastCode && now - lastSeen < 2500) return;   // cooldown
      confirmed[code] = (confirmed[code] || 0) + 1;
      if (confirmed[code] < 2) return;                          // need 2 reads
      lastCode = code; lastSeen = now; confirmed = {};
      onDetect(code);
    }

    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 }, height: { ideal: 720 }
      }
    }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      videoEl.srcObject = s;
      videoEl.setAttribute('playsinline', '');
      videoEl.muted = true;
      return videoEl.play().then(function () { return s; });
    }).then(function (s) {
      if (stopped || !s) return;

      if (window.BarcodeDetector) {
        return window.BarcodeDetector.getSupportedFormats()
          .then(function (avail) {
            var use = FORMATS.filter(function (f) { return avail.indexOf(f) >= 0; });
            if (!use.length) throw new Error('fallback');
            var det = new window.BarcodeDetector({ formats: use });
            (function loop() {
              if (stopped) return;
              det.detect(videoEl)
                .then(function (codes) { if (codes && codes[0]) report(codes[0].rawValue); })
                .catch(function () {})
                .then(function () { rafId = requestAnimationFrame(loop); });
            })();
          })
          .catch(function () { return useZXing(); });
      }
      return useZXing();
    }).catch(function (e) {
      if (!stopped) onError(new Error(friendlyError(e)));
    });

    function useZXing() {
      return loadZXing().then(function (ZXing) {
        if (stopped) return;
        var hints = new Map();
        var F = ZXing.BarcodeFormat;
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.ITF, F.CODABAR
        ]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        reader = new ZXing.BrowserMultiFormatReader(hints, 250);
        reader.decodeFromStream(stream, videoEl, function (result, err) {
          if (stopped) return;
          if (result) report(result.getText());
        }).catch(function (e) {
          if (!stopped) onError(new Error(friendlyError(e)));
        });
      }).catch(function (e) {
        if (!stopped) onError(e);
      });
    }

    return function stop() {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (reader) { try { reader.reset(); } catch (e) {} }
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      if (videoEl) { try { videoEl.pause(); videoEl.srcObject = null; } catch (e) {} }
    };
  }

  /* UPC-A / EAN-13 check digit, so a mistyped number fails fast instead of
     coming back as "product not found". */
  function validChecksum(code) {
    var d = String(code).replace(/\D/g, '');
    if (d.length !== 12 && d.length !== 13 && d.length !== 8) return true; // don't judge
    var sum = 0, digits = d.split('').map(Number);
    var check = digits.pop();
    digits.reverse().forEach(function (n, i) { sum += i % 2 === 0 ? n * 3 : n; });
    return (10 - (sum % 10)) % 10 === check;
  }

  NL.scanner = { start: start, supported: supported, secure: secure,
    validChecksum: validChecksum };
})(window.NL = window.NL || {});
