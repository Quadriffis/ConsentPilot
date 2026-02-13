/**
 * Consent Pilot - TCF API Handler
 * Handles consent rejection via the IAB TCF v2.0/v2.2 API.
 */
(function () {
  'use strict';

  var TCF_TIMEOUT_MS = 5000;

  /**
   * Safely call __tcfapi. Returns false if the API is not available.
   */
  function callTCF(command, version, callback, param) {
    if (typeof window.__tcfapi !== 'function') return false;
    try {
      window.__tcfapi(command, version, callback, param);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Detect which TCF version is supported (2.2 preferred, fallback to 2.0).
   */
  function detectTCFVersion() {
    return new Promise(function (resolve) {
      var done = false;

      function finish(version) {
        if (done) return;
        done = true;
        resolve(version);
      }

      // Try v2.2 first via ping
      var called = callTCF('ping', 2, function (pingData) {
        if (pingData && pingData.cmpLoaded) {
          var ver = pingData.tcfPolicyVersion || pingData.gvlVersion;
          finish(ver >= 4 ? 2.2 : 2);
        }
      });

      if (!called) {
        finish(0);
        return;
      }

      // Fallback timeout
      setTimeout(function () { finish(2); }, 1000);
    });
  }

  /**
   * Wait for the CMP UI to be shown or TC data to be loaded.
   * Resolves with the tcData when ready, or null on timeout.
   */
  function waitForCMPReady() {
    return new Promise(function (resolve) {
      var done = false;
      var listenerId = null;

      function finish(value) {
        if (done) return;
        done = true;
        // Remove the event listener if we got one
        if (listenerId != null) {
          callTCF('removeEventListener', 2, function () {}, listenerId);
        }
        resolve(value);
      }

      var timeout = setTimeout(function () { finish(null); }, TCF_TIMEOUT_MS);

      var called = callTCF('addEventListener', 2, function (tcData, success) {
        if (!success) {
          clearTimeout(timeout);
          finish(null);
          return;
        }

        if (tcData.listenerId != null) {
          listenerId = tcData.listenerId;
        }

        var status = tcData.eventStatus;
        if (status === 'cmpuishown' || status === 'tcloaded' || status === 'useractioncomplete') {
          clearTimeout(timeout);
          finish(tcData);
        }
      });

      if (!called) {
        clearTimeout(timeout);
        finish(null);
      }
    });
  }

  /**
   * Build a TC consent object with all purposes/vendors rejected.
   */
  function buildRejectAllConsent() {
    var purposes = {};
    var specialFeatures = {};
    var vendorConsents = {};
    var vendorLegitimateInterests = {};
    var purposeLegitimateInterests = {};

    // TCF v2.2 has purposes 1-11, v2.0 has 1-10. Set all to false.
    for (var i = 1; i <= 11; i++) {
      purposes[i] = false;
      purposeLegitimateInterests[i] = false;
    }

    for (var j = 1; j <= 2; j++) {
      specialFeatures[j] = false;
    }

    return {
      purpose: {
        consents: purposes,
        legitimateInterests: purposeLegitimateInterests,
      },
      specialFeatureOptins: specialFeatures,
      vendor: {
        consents: vendorConsents,
        legitimateInterests: vendorLegitimateInterests,
      },
    };
  }

  /**
   * Attempt to reject consent using the TCF setConsent command.
   */
  function trySetConsent(rejectData) {
    return new Promise(function (resolve) {
      var done = false;

      function finish(success) {
        if (done) return;
        done = true;
        resolve(success);
      }

      var timeout = setTimeout(function () { finish(false); }, 3000);

      // Try setConsent (standard in some CMPs)
      var called = callTCF('setConsent', 2, function (result, success) {
        clearTimeout(timeout);
        finish(!!success);
      }, rejectData);

      if (!called) {
        clearTimeout(timeout);
        finish(false);
      }
    });
  }

  /**
   * Attempt to reject consent using postCustomConsent (used by some CMPs).
   */
  function tryPostCustomConsent() {
    return new Promise(function (resolve) {
      var done = false;

      function finish(success) {
        if (done) return;
        done = true;
        resolve(success);
      }

      var timeout = setTimeout(function () { finish(false); }, 3000);

      // postCustomConsent with empty arrays = reject all
      var called = callTCF('postCustomConsent', 2, function (result, success) {
        clearTimeout(timeout);
        finish(!!success);
      }, { consentedPurposes: [], consentedVendors: [], consentedLegitimateInterests: [] });

      if (!called) {
        clearTimeout(timeout);
        finish(false);
      }
    });
  }

  /**
   * Verify that consent was actually rejected by querying getTCData.
   * Returns true if all purpose consents are false.
   */
  function verifyRejection() {
    return new Promise(function (resolve) {
      var done = false;

      function finish(success) {
        if (done) return;
        done = true;
        resolve(success);
      }

      var timeout = setTimeout(function () { finish(false); }, 3000);

      var called = callTCF('getTCData', 2, function (tcData, success) {
        clearTimeout(timeout);

        if (!success || !tcData || !tcData.purpose) {
          finish(false);
          return;
        }

        var consents = tcData.purpose.consents || {};
        var allRejected = true;

        // Check purposes 1-11
        for (var i = 1; i <= 11; i++) {
          if (consents[i] === true) {
            allRejected = false;
            break;
          }
        }

        finish(allRejected);
      });

      if (!called) {
        clearTimeout(timeout);
        finish(false);
      }
    });
  }

  /**
   * Main entry point. Attempts to reject all consent via TCF API.
   * Returns a Promise<boolean>: true if successfully rejected, false otherwise.
   */
  function tryTCFReject() {
    return new Promise(function (resolve) {
      // Quick check: is __tcfapi even available?
      if (typeof window.__tcfapi !== 'function') {
        resolve(false);
        return;
      }

      detectTCFVersion().then(function (version) {
        if (version === 0) {
          resolve(false);
          return;
        }

        return waitForCMPReady();
      }).then(function (tcData) {
        if (tcData === undefined) return; // already resolved from version check
        if (!tcData) {
          resolve(false);
          return;
        }

        var rejectData = buildRejectAllConsent();

        // Try setConsent first
        return trySetConsent(rejectData).then(function (success) {
          if (success) return true;
          // Fallback to postCustomConsent
          return tryPostCustomConsent();
        });
      }).then(function (setResult) {
        if (setResult === undefined) return; // already resolved
        if (!setResult) {
          // CMP has __tcfapi but we can't set consent programmatically
          resolve(false);
          return;
        }

        // Verify the rejection actually took effect
        return verifyRejection();
      }).then(function (verified) {
        if (verified === undefined) return; // already resolved
        resolve(!!verified);
      }).catch(function () {
        resolve(false);
      });
    });
  }

  // Expose on shared namespace
  window.ConsentPilot = window.ConsentPilot || {};
  window.ConsentPilot.tryTCFReject = tryTCFReject;
})();
