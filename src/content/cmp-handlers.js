/**
 * Consent Pilot — CMP-Specific Cookie Rejection Handlers
 *
 * Each handler targets a specific Cookie Management Platform's DOM and/or JS API
 * to reject all non-essential cookies. Handlers are tried in priority order based
 * on the detection result from detector.js.
 *
 * All handlers return Promise<boolean> — true if rejection succeeded, false otherwise.
 */

/* global OneTrust, Cookiebot, Didomi, klaro, orejime */

(function () {
  'use strict';

  const TAG = '[Consent Pilot]';

  // ---------------------------------------------------------------------------
  // Utility helpers
  // ---------------------------------------------------------------------------

  /**
   * Wait for an element matching `selector` to appear in the DOM (or within a root).
   * Resolves with the element, or null after timeout.
   */
  function waitForElement(selector, root, timeoutMs) {
    root = root || document;
    timeoutMs = timeoutMs || 3000;
    return new Promise(function (resolve) {
      var existing = root.querySelector(selector);
      if (existing) return resolve(existing);

      var resolved = false;
      var observer = new MutationObserver(function () {
        var el = root.querySelector(selector);
        if (el && !resolved) {
          resolved = true;
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(root === document ? document.body : root, {
        childList: true,
        subtree: true,
      });

      setTimeout(function () {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  /**
   * Click a DOM element, dispatching a real click event if .click() is overridden.
   */
  function safeClick(el) {
    if (!el) return false;
    try {
      el.click();
      return true;
    } catch (_) {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      } catch (__) {
        return false;
      }
    }
  }

  /**
   * Small delay helper — many CMPs animate between steps.
   */
  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms || 300);
    });
  }

  /**
   * Find a button by its text content (case-insensitive, trimmed) within a root.
   */
  function findButtonByText(root, texts) {
    root = root || document;
    var buttons = root.querySelectorAll('button, a[role="button"], [role="button"]');
    for (var i = 0; i < buttons.length; i++) {
      var btnText = (buttons[i].textContent || '').trim().toLowerCase();
      for (var j = 0; j < texts.length; j++) {
        if (btnText.indexOf(texts[j].toLowerCase()) !== -1) {
          return buttons[i];
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 1. OneTrust
  // ---------------------------------------------------------------------------

  async function handleOneTrust() {
    console.log(TAG, 'Attempting OneTrust reject-all');
    try {
      // Fastest path: JS API
      if (typeof OneTrust !== 'undefined' && typeof OneTrust.RejectAll === 'function') {
        OneTrust.RejectAll();
        console.log(TAG, 'OneTrust.RejectAll() succeeded');
        return true;
      }

      // Direct reject button (OneTrust v6+)
      var rejectBtn = document.querySelector('#onetrust-reject-all-handler');
      if (rejectBtn) {
        safeClick(rejectBtn);
        console.log(TAG, 'OneTrust reject button clicked');
        return true;
      }

      // Fallback: open preferences and uncheck all optional categories
      var prefsBtn = document.querySelector('#onetrust-pc-btn-handler');
      if (!prefsBtn) {
        console.warn(TAG, 'OneTrust: no reject or preferences button found');
        return false;
      }
      safeClick(prefsBtn);
      await delay(500);

      // Wait for preferences panel
      var panel = await waitForElement('#onetrust-pc-sdk', document, 3000);
      if (!panel) {
        console.warn(TAG, 'OneTrust: preferences panel did not open');
        return false;
      }

      // Check for reject-all inside the preferences panel (some variants have it)
      var panelReject = panel.querySelector('.ot-pc-refuse-all-handler');
      if (panelReject) {
        safeClick(panelReject);
        console.log(TAG, 'OneTrust panel reject-all clicked');
        return true;
      }

      // Uncheck all optional toggle switches
      var toggles = panel.querySelectorAll('.ot-switch input[type="checkbox"]:checked');
      for (var i = 0; i < toggles.length; i++) {
        var toggle = toggles[i];
        // Skip if it is the strictly-necessary category (usually disabled)
        if (toggle.disabled) continue;
        var label = toggle.closest('.ot-switch');
        if (label) safeClick(label.querySelector('.ot-switch-nob') || label);
      }

      await delay(200);

      // Save preferences
      var saveBtn = panel.querySelector('.save-preference-btn-handler');
      if (saveBtn) {
        safeClick(saveBtn);
        console.log(TAG, 'OneTrust preferences saved (all optional unchecked)');
        return true;
      }

      console.warn(TAG, 'OneTrust: could not find save button');
      return false;
    } catch (err) {
      console.error(TAG, 'OneTrust handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Cookiebot
  // ---------------------------------------------------------------------------

  async function handleCookiebot() {
    console.log(TAG, 'Attempting Cookiebot reject');
    try {
      // JS API
      if (typeof Cookiebot !== 'undefined' && typeof Cookiebot.decline === 'function') {
        Cookiebot.decline();
        console.log(TAG, 'Cookiebot.decline() succeeded');
        return true;
      }

      // Direct decline button
      var declineBtn = document.querySelector('#CybotCookiebotDialogBodyButtonDecline');
      if (declineBtn) {
        safeClick(declineBtn);
        console.log(TAG, 'Cookiebot decline button clicked');
        return true;
      }

      // Some Cookiebot themes use "Deny" or "Only necessary" in details view
      var denyBtn = document.querySelector(
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll'
      );
      if (denyBtn) {
        safeClick(denyBtn);
        console.log(TAG, 'Cookiebot deny-all button clicked');
        return true;
      }

      // Fallback: find button by text in Cookiebot dialog
      var dialog = document.querySelector('#CybotCookiebotDialog');
      if (dialog) {
        var btn = findButtonByText(dialog, ['decline', 'deny', 'reject', 'only necessary']);
        if (btn) {
          safeClick(btn);
          console.log(TAG, 'Cookiebot reject button found by text');
          return true;
        }
      }

      console.warn(TAG, 'Cookiebot: no decline mechanism found');
      return false;
    } catch (err) {
      console.error(TAG, 'Cookiebot handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Didomi
  // ---------------------------------------------------------------------------

  async function handleDidomi() {
    console.log(TAG, 'Attempting Didomi reject');
    try {
      // JS API
      if (typeof Didomi !== 'undefined' && typeof Didomi.setUserDisagreeToAll === 'function') {
        Didomi.setUserDisagreeToAll();
        console.log(TAG, 'Didomi.setUserDisagreeToAll() succeeded');
        return true;
      }

      // "Continue without agreeing" link
      var continueBtn = document.querySelector('.didomi-continue-without-agreeing');
      if (continueBtn) {
        safeClick(continueBtn);
        console.log(TAG, 'Didomi continue-without-agreeing clicked');
        return true;
      }

      // Disagree button
      var disagreeBtn = document.querySelector('#didomi-notice-disagree-button');
      if (disagreeBtn) {
        safeClick(disagreeBtn);
        console.log(TAG, 'Didomi disagree button clicked');
        return true;
      }

      // Fallback: search by text
      var notice = document.querySelector('#didomi-notice, .didomi-popup-notice');
      if (notice) {
        var btn = findButtonByText(notice, ['disagree', 'reject', 'refuse', 'deny']);
        if (btn) {
          safeClick(btn);
          console.log(TAG, 'Didomi reject button found by text');
          return true;
        }
      }

      console.warn(TAG, 'Didomi: no reject mechanism found');
      return false;
    } catch (err) {
      console.error(TAG, 'Didomi handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. TrustArc (Evidon)
  // ---------------------------------------------------------------------------

  async function handleTrustArc() {
    console.log(TAG, 'Attempting TrustArc reject');
    try {
      // Main banner — click preferences/manage
      var consentTrack = document.querySelector('#truste-consent-track');
      if (!consentTrack) {
        console.warn(TAG, 'TrustArc: #truste-consent-track not found');
        return false;
      }

      // Some TrustArc banners show a direct reject/decline button
      var rejectBtn = findButtonByText(consentTrack, [
        'reject', 'decline', 'required only', 'deny',
      ]);
      if (rejectBtn) {
        safeClick(rejectBtn);
        console.log(TAG, 'TrustArc direct reject clicked');
        return true;
      }

      // Click the preferences / manage button to open the preferences iframe
      var prefsBtn = consentTrack.querySelector('#truste-show-consent, .truste-consent-button');
      if (!prefsBtn) {
        prefsBtn = findButtonByText(consentTrack, ['preferences', 'manage', 'settings', 'cookie settings']);
      }
      if (!prefsBtn) {
        console.warn(TAG, 'TrustArc: no preferences button found');
        return false;
      }

      safeClick(prefsBtn);
      await delay(1000);

      // TrustArc loads preferences in an iframe
      var iframe = await waitForElement('#truste-consent-content iframe, .truste-iframe', document, 4000);
      if (!iframe) {
        console.warn(TAG, 'TrustArc: preferences iframe did not load');
        return false;
      }

      try {
        var iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

        // Look for "required only" or "reject all" in the iframe
        var iframeReject = findButtonByText(iframeDoc, [
          'required only', 'reject all', 'off for all', 'decline all',
        ]);
        if (iframeReject) {
          safeClick(iframeReject);
          await delay(300);
        } else {
          // Uncheck all optional categories
          var checkboxes = iframeDoc.querySelectorAll(
            'input[type="checkbox"]:checked:not([disabled])'
          );
          for (var i = 0; i < checkboxes.length; i++) {
            safeClick(checkboxes[i]);
          }
        }

        // Click submit/confirm
        await delay(300);
        var submitBtn = findButtonByText(iframeDoc, ['submit', 'confirm', 'save']);
        if (submitBtn) {
          safeClick(submitBtn);
          console.log(TAG, 'TrustArc preferences submitted');
          return true;
        }

        // Fallback — click .submit in the iframe
        var submitEl = iframeDoc.querySelector('.submit, .confirmBtn, [type="submit"]');
        if (submitEl) {
          safeClick(submitEl);
          console.log(TAG, 'TrustArc fallback submit clicked');
          return true;
        }
      } catch (_crossOrigin) {
        // Cross-origin iframe — can't access contents
        console.warn(TAG, 'TrustArc: preferences iframe is cross-origin, cannot interact');
        return false;
      }

      console.warn(TAG, 'TrustArc: could not complete rejection in preferences');
      return false;
    } catch (err) {
      console.error(TAG, 'TrustArc handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Quantcast Choice
  // ---------------------------------------------------------------------------

  async function handleQuantcast() {
    console.log(TAG, 'Attempting Quantcast Choice reject');
    try {
      // Quantcast CMP v2 — secondary button is the reject/manage button
      var rejectBtn = document.querySelector(
        '.qc-cmp2-summary-buttons button[mode="secondary"]'
      );
      if (rejectBtn) {
        safeClick(rejectBtn);
        console.log(TAG, 'Quantcast reject/manage button clicked');

        // After clicking "manage", a second screen may appear — look for "Reject All"
        await delay(500);
        var rejectAll = document.querySelector(
          '.qc-cmp2-buttons button[mode="secondary"], .qc-cmp2-header-links button'
        );
        if (rejectAll) {
          // Check if it says reject/disagree
          var text = (rejectAll.textContent || '').toLowerCase();
          if (text.indexOf('reject') !== -1 || text.indexOf('disagree') !== -1 ||
              text.indexOf('deny') !== -1 || text.indexOf('object') !== -1) {
            safeClick(rejectAll);
            console.log(TAG, 'Quantcast reject-all confirmed');
          }
        }
        return true;
      }

      // Fallback: look for Disagree / Reject text buttons
      var qcContainer = document.querySelector('.qc-cmp2-container, [data-cmp-container]');
      if (qcContainer) {
        var btn = findButtonByText(qcContainer, ['disagree', 'reject', 'deny', 'do not agree']);
        if (btn) {
          safeClick(btn);
          console.log(TAG, 'Quantcast reject button found by text');
          return true;
        }
      }

      // Quantcast JS API fallback
      if (typeof window.__tcfapi === 'function') {
        // We don't handle TCF API here — that's tcf-handler.js territory
        console.log(TAG, 'Quantcast: deferring to TCF handler');
      }

      console.warn(TAG, 'Quantcast: no reject mechanism found');
      return false;
    } catch (err) {
      console.error(TAG, 'Quantcast handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Usercentrics
  // ---------------------------------------------------------------------------

  async function handleUsercentrics() {
    console.log(TAG, 'Attempting Usercentrics reject');
    try {
      var host = document.querySelector('#usercentrics-root');
      if (!host) {
        console.warn(TAG, 'Usercentrics: #usercentrics-root not found');
        return false;
      }

      // Usercentrics uses Shadow DOM
      var shadowRoot = host.shadowRoot;
      if (!shadowRoot) {
        // Some browsers or polyfills expose it differently
        console.warn(TAG, 'Usercentrics: cannot access shadow DOM');
        return false;
      }

      // v2: look for the deny button by data-testid
      var denyBtn = shadowRoot.querySelector('[data-testid="uc-deny-all-button"]');
      if (denyBtn) {
        safeClick(denyBtn);
        console.log(TAG, 'Usercentrics deny-all button clicked (v2)');
        return true;
      }

      // v1/v2 fallback: find by text content inside shadow DOM
      var buttons = shadowRoot.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].textContent || '').trim().toLowerCase();
        if (
          text.indexOf('deny') !== -1 ||
          text.indexOf('reject') !== -1 ||
          text.indexOf('ablehnen') !== -1 || // German
          text.indexOf('refuser') !== -1 ||   // French
          text.indexOf('rifiuta') !== -1       // Italian
        ) {
          safeClick(buttons[i]);
          console.log(TAG, 'Usercentrics reject button clicked:', text);
          return true;
        }
      }

      // Deeper search: some Usercentrics v2 layouts nest inside another shadow root
      var innerShadows = shadowRoot.querySelectorAll('[id*="uc"]');
      for (var j = 0; j < innerShadows.length; j++) {
        if (innerShadows[j].shadowRoot) {
          var innerDeny = innerShadows[j].shadowRoot.querySelector(
            '[data-testid="uc-deny-all-button"]'
          );
          if (innerDeny) {
            safeClick(innerDeny);
            console.log(TAG, 'Usercentrics inner shadow deny-all clicked');
            return true;
          }
        }
      }

      console.warn(TAG, 'Usercentrics: no deny button found in shadow DOM');
      return false;
    } catch (err) {
      console.error(TAG, 'Usercentrics handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Civic Cookie Control
  // ---------------------------------------------------------------------------

  async function handleCivic() {
    console.log(TAG, 'Attempting Civic Cookie Control reject');
    try {
      var module = document.querySelector('#ccc-module, #ccc');
      if (!module) {
        console.warn(TAG, 'Civic: #ccc-module not found');
        return false;
      }

      // Direct reject / necessary-only button
      var rejectBtn = module.querySelector(
        '.ccc-reject-button, #ccc-reject-settings, .ccc-notify-button[data-ccc-action="reject"]'
      );
      if (rejectBtn) {
        safeClick(rejectBtn);
        console.log(TAG, 'Civic reject button clicked');
        return true;
      }

      // Fallback: find by text
      var btn = findButtonByText(module, [
        'reject', 'necessary only', 'decline', 'only necessary',
      ]);
      if (btn) {
        safeClick(btn);
        console.log(TAG, 'Civic reject button found by text');
        return true;
      }

      // Turn off all toggles
      var toggles = module.querySelectorAll(
        'input[type="checkbox"]:checked:not([disabled])'
      );
      if (toggles.length > 0) {
        for (var i = 0; i < toggles.length; i++) {
          safeClick(toggles[i]);
        }
        var saveBtn = findButtonByText(module, ['save', 'accept', 'confirm']);
        if (saveBtn) {
          safeClick(saveBtn);
          console.log(TAG, 'Civic toggles disabled and saved');
          return true;
        }
      }

      console.warn(TAG, 'Civic: no reject mechanism found');
      return false;
    } catch (err) {
      console.error(TAG, 'Civic handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Klaro
  // ---------------------------------------------------------------------------

  async function handleKlaro() {
    console.log(TAG, 'Attempting Klaro reject');
    try {
      // JS API
      if (typeof klaro !== 'undefined' && typeof klaro.getManager === 'function') {
        var manager = klaro.getManager();
        if (manager && typeof manager.changeAll === 'function') {
          manager.changeAll(false);
          if (typeof manager.saveAndApplyConsents === 'function') {
            manager.saveAndApplyConsents();
          } else if (typeof manager.saveConsents === 'function') {
            manager.saveConsents();
          }
          console.log(TAG, 'Klaro API: rejected all via manager');
          return true;
        }
      }

      // Fallback: UI button
      var klaroModal = document.querySelector(
        '.klaro .cookie-modal, .klaro .cookie-notice, .klaro'
      );
      if (!klaroModal) {
        console.warn(TAG, 'Klaro: modal not found');
        return false;
      }

      var declineBtn = klaroModal.querySelector('.cm-btn-decline, .cn-decline');
      if (declineBtn) {
        safeClick(declineBtn);
        console.log(TAG, 'Klaro decline button clicked');
        return true;
      }

      var btn = findButtonByText(klaroModal, ['decline', 'reject', 'deny', 'ablehnen']);
      if (btn) {
        safeClick(btn);
        console.log(TAG, 'Klaro reject button found by text');
        return true;
      }

      console.warn(TAG, 'Klaro: no reject mechanism found');
      return false;
    } catch (err) {
      console.error(TAG, 'Klaro handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Borlabs Cookie (WordPress)
  // ---------------------------------------------------------------------------

  async function handleBorlabs() {
    console.log(TAG, 'Attempting Borlabs Cookie reject');
    try {
      var box = document.querySelector('#BorlabsCookieBox');
      if (!box) {
        console.warn(TAG, 'Borlabs: #BorlabsCookieBox not found');
        return false;
      }

      // Direct "essential only" / reject button
      var essentialBtn = box.querySelector(
        'a._brlbs-refuse-btn, a[data-cookie-refuse], .cookie-preference a._brlbs-btn[data-borlabs-cookie-unselect]'
      );
      if (essentialBtn) {
        safeClick(essentialBtn);
        console.log(TAG, 'Borlabs essential-only button clicked');
        return true;
      }

      // Fallback: find by text
      var btn = findButtonByText(box, [
        'essential', 'reject', 'decline', 'only necessary', 'refuse',
        'nur essenzielle', 'ablehnen', // German
      ]);
      if (btn) {
        safeClick(btn);
        console.log(TAG, 'Borlabs reject button found by text');
        return true;
      }

      // Last resort: uncheck all optional checkboxes
      var checkboxes = box.querySelectorAll(
        'input[type="checkbox"]:checked:not([disabled])'
      );
      if (checkboxes.length > 0) {
        for (var i = 0; i < checkboxes.length; i++) {
          // Skip if this is the essential/necessary checkbox
          var label = checkboxes[i].closest('label, .cookie-group');
          var labelText = label ? (label.textContent || '').toLowerCase() : '';
          if (
            labelText.indexOf('essential') !== -1 ||
            labelText.indexOf('necessary') !== -1 ||
            labelText.indexOf('notwendig') !== -1 ||
            labelText.indexOf('essenzielle') !== -1
          ) {
            continue;
          }
          safeClick(checkboxes[i]);
        }
        var saveBtn = findButtonByText(box, ['save', 'speichern', 'confirm']);
        if (saveBtn) {
          safeClick(saveBtn);
          console.log(TAG, 'Borlabs: unchecked optional and saved');
          return true;
        }
      }

      console.warn(TAG, 'Borlabs: no reject mechanism found');
      return false;
    } catch (err) {
      console.error(TAG, 'Borlabs handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 10. OREJIME
  // ---------------------------------------------------------------------------

  async function handleOrejime() {
    console.log(TAG, 'Attempting OREJIME reject');
    try {
      // JS API
      if (
        typeof orejime !== 'undefined' &&
        orejime.internals &&
        orejime.internals.manager &&
        typeof orejime.internals.manager.declineAll === 'function'
      ) {
        orejime.internals.manager.declineAll();
        console.log(TAG, 'OREJIME API: declineAll() succeeded');
        return true;
      }

      // Fallback: UI button
      var modal = document.querySelector(
        '.orejime-Notice, .orejime-Modal, [class*="orejime"]'
      );
      if (!modal) {
        console.warn(TAG, 'OREJIME: modal not found');
        return false;
      }

      var declineBtn = modal.querySelector(
        '.orejime-Notice-declineButton, .orejime-Button--decline, button[class*="decline"]'
      );
      if (declineBtn) {
        safeClick(declineBtn);
        console.log(TAG, 'OREJIME decline button clicked');
        return true;
      }

      var btn = findButtonByText(modal, ['decline', 'reject', 'deny', 'refuse']);
      if (btn) {
        safeClick(btn);
        console.log(TAG, 'OREJIME reject button found by text');
        return true;
      }

      console.warn(TAG, 'OREJIME: no reject mechanism found');
      return false;
    } catch (err) {
      console.error(TAG, 'OREJIME handler error:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Handler registry and dispatcher
  // ---------------------------------------------------------------------------

  var handlers = {
    onetrust: handleOneTrust,
    cookiebot: handleCookiebot,
    didomi: handleDidomi,
    trustarc: handleTrustArc,
    quantcast: handleQuantcast,
    usercentrics: handleUsercentrics,
    civic: handleCivic,
    klaro: handleKlaro,
    borlabs: handleBorlabs,
    orejime: handleOrejime,
  };

  /**
   * Main dispatch function. Takes a detection result from detector.js and
   * runs the appropriate CMP handler.
   *
   * @param {object} detectionResult - { type: string, element?: Element, confidence?: number }
   * @returns {Promise<boolean>} true if cookies were rejected, false otherwise
   */
  async function tryCMPHandler(detectionResult) {
    if (!detectionResult || !detectionResult.type) {
      console.log(TAG, 'tryCMPHandler: no detection result or type');
      return false;
    }

    var type = detectionResult.type.toLowerCase();
    var handler = handlers[type];

    if (!handler) {
      console.log(TAG, 'tryCMPHandler: no handler for type "' + type + '"');
      return false;
    }

    console.log(TAG, 'Dispatching to CMP handler:', type);
    try {
      var result = await handler(detectionResult.element);
      console.log(TAG, 'CMP handler "' + type + '" result:', result);
      return result;
    } catch (err) {
      console.error(TAG, 'CMP handler "' + type + '" threw:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Expose on shared namespace
  // ---------------------------------------------------------------------------

  window.ConsentPilot = window.ConsentPilot || {};
  window.ConsentPilot.tryCMPHandler = tryCMPHandler;
  window.ConsentPilot.handleOneTrust = handleOneTrust;
  window.ConsentPilot.handleCookiebot = handleCookiebot;
  window.ConsentPilot.handleDidomi = handleDidomi;
  window.ConsentPilot.handleTrustArc = handleTrustArc;
  window.ConsentPilot.handleQuantcast = handleQuantcast;
  window.ConsentPilot.handleUsercentrics = handleUsercentrics;
  window.ConsentPilot.handleCivic = handleCivic;
  window.ConsentPilot.handleKlaro = handleKlaro;
  window.ConsentPilot.handleBorlabs = handleBorlabs;
  window.ConsentPilot.handleOrejime = handleOrejime;
})();
