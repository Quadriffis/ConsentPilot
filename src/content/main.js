/**
 * Consent Pilot - Main Content Script Orchestrator
 *
 * Coordinates the detection -> handling pipeline:
 *   1. Check whitelist / cache
 *   2. detectBanner()
 *   3. tryTCFReject()  -> tryCMPHandler()  -> tryHeuristicReject()
 *   4. Report result to service worker
 *   5. Show visual feedback toast
 */
(function () {
  'use strict';

  var CP = window.ConsentPilot || {};

  // ── Message types (mirror shared/constants.js) ─────────────────────
  var MSG_CONSENT_HANDLED = 'CONSENT_HANDLED';
  var MSG_CONSENT_FAILED  = 'CONSENT_FAILED';
  var MSG_GET_SETTINGS    = 'GET_SETTINGS';

  // ── Cache TTL: 30 days ─────────────────────────────────────────────
  var CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

  // ── Helpers ────────────────────────────────────────────────────────

  function getDomain() {
    return location.hostname;
  }

  function cacheKey(domain) {
    return 'cache_' + domain;
  }

  function sendMessage(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch (_) {
      // Extension context may be invalidated; ignore.
    }
  }

  function storageGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (result) {
        resolve(result || {});
      });
    });
  }

  function storageSet(data) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(data, resolve);
    });
  }

  // ── Settings / cache checks ────────────────────────────────────────

  function getSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: MSG_GET_SETTINGS }, function (settings) {
          if (chrome.runtime.lastError || !settings) {
            resolve({ enabled: true, whitelist: [], showNotifications: true });
          } else {
            resolve(settings);
          }
        });
      } catch (_) {
        resolve({ enabled: true, whitelist: [], showNotifications: true });
      }
    });
  }

  function isWhitelisted(settings, domain) {
    var list = settings.whitelist || [];
    for (var i = 0; i < list.length; i++) {
      if (domain === list[i] || domain.endsWith('.' + list[i])) {
        return true;
      }
    }
    return false;
  }

  function checkCache(domain) {
    var key = cacheKey(domain);
    return storageGet(key).then(function (result) {
      var entry = result[key];
      if (!entry) return false;
      if (Date.now() - entry.timestamp > CACHE_TTL) return false;
      return entry.handled === true;
    });
  }

  function setCache(domain, method) {
    var data = {};
    data[cacheKey(domain)] = {
      handled: true,
      method: method,
      timestamp: Date.now(),
    };
    return storageSet(data);
  }

  // ── Visual feedback ────────────────────────────────────────────────

  function showToast(type, text) {
    var icons = { success: '\u2713', partial: '!', none: '\u2014' };
    var toast = document.createElement('div');
    toast.className = 'consent-pilot-toast consent-pilot-toast--' + type;

    var icon = document.createElement('span');
    icon.className = 'consent-pilot-toast__icon';
    icon.textContent = icons[type] || '';

    var label = document.createElement('span');
    label.textContent = text;

    toast.appendChild(icon);
    toast.appendChild(label);
    document.body.appendChild(toast);

    // Remove element after animation completes (2s total)
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2200);
  }

  // ── Handler pipeline ───────────────────────────────────────────────

  function runPipeline(detection) {
    var bannerType = detection ? detection.type : 'unknown';

    // Step 1: Try TCF API (fastest, most reliable)
    return (CP.tryTCFReject ? CP.tryTCFReject() : Promise.resolve(false))
      .then(function (tcfSuccess) {
        if (tcfSuccess) return { success: true, method: 'tcf' };

        // Step 2: Try CMP-specific handler
        if (detection && CP.tryCMPHandler) {
          return CP.tryCMPHandler(detection).then(function (cmpSuccess) {
            if (cmpSuccess) return { success: true, method: 'cmp' };
            return null; // fall through
          });
        }
        return null;
      })
      .then(function (result) {
        if (result) return result;

        // Step 3: Try heuristic handler
        var el = detection ? detection.element : null;
        if (el && CP.tryHeuristicReject) {
          return CP.tryHeuristicReject(el).then(function (hResult) {
            if (hResult && hResult.success) {
              return { success: true, method: hResult.method || 'heuristic' };
            }
            return { success: false, method: null };
          });
        }
        return { success: false, method: null };
      })
      .then(function (result) {
        return { success: result.success, method: result.method, bannerType: bannerType };
      });
  }

  // ── Main entry ─────────────────────────────────────────────────────

  function main() {
    var domain = getDomain();

    getSettings().then(function (settings) {
      // Quick check: extension enabled?
      if (settings.enabled === false) return;

      // Quick check: whitelisted?
      if (isWhitelisted(settings, domain)) return;

      var showNotifications = settings.showNotifications !== false;

      // Quick check: already handled recently?
      return checkCache(domain).then(function (cached) {
        if (cached) return;

        // Run banner detection
        if (!CP.detectBanner) return;

        return CP.detectBanner().then(function (detection) {
          if (!detection) {
            // No banner found — nothing to do
            return;
          }

          return runPipeline(detection).then(function (result) {
            if (result.success) {
              // Report success
              sendMessage({
                type: MSG_CONSENT_HANDLED,
                domain: domain,
                method: result.method,
                success: true,
                timestamp: Date.now(),
              });

              // Cache the result
              setCache(domain, result.method);

              // Show feedback
              if (showNotifications) {
                showToast('success', 'Cookies rejected');
              }
            } else {
              // Report failure
              sendMessage({
                type: MSG_CONSENT_FAILED,
                domain: domain,
                bannerType: result.bannerType,
                timestamp: Date.now(),
              });

              // Show feedback
              if (showNotifications) {
                showToast('partial', 'Could not reject cookies');
              }
            }
          });
        });
      });
    }).catch(function () {
      // Silently fail — do not break the page
    });
  }

  // Kick off
  main();
})();
