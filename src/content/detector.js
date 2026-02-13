/**
 * Consent Pilot - Banner Detection Engine
 * Detects cookie consent banners and identifies the CMP in use.
 */
(function () {
  'use strict';

  // Known CMP selectors mapped to their type
  const CMP_SELECTORS = {
    onetrust: [
      '#onetrust-banner-sdk',
      '#onetrust-consent-sdk',
      '.onetrust-pc-dark-filter',
    ],
    cookiebot: [
      '#CybotCookiebotDialog',
      '#CybotCookiebotDialogBody',
      '.cookiebot',
    ],
    didomi: [
      '#didomi-host',
      '#didomi-popup',
      '.didomi-popup-container',
    ],
    trustArc: [
      '#truste-consent-track',
      '#truste-consent-content',
      '#consent_blackbar',
    ],
    quantcast: [
      '.qc-cmp2-container',
      '.qc-cmp-ui-container',
      '#qc-cmp2-main',
    ],
    usercentrics: [
      '#usercentrics-root',
      '[data-usercentrics]',
    ],
  };

  // Cookie/consent keywords in multiple languages
  const CONSENT_KEYWORDS = [
    // EN
    'cookie', 'consent', 'privacy', 'gdpr',
    // NL
    'koekje', 'toestemming', 'privacybeleid',
    // DE
    'datenschutz', 'einwilligung', 'zustimmung',
    // FR
    'consentement', 'confidentialit\u00e9', 'donn\u00e9es personnelles',
    // IT
    'consenso', 'informativa', 'dati personali',
    // ES
    'consentimiento', 'privacidad', 'datos personales',
    // PT
    'consentimento', 'privacidade', 'dados pessoais',
    // PL
    'zgoda', 'prywatno\u015b\u0107', 'ciasteczka',
  ];

  const KEYWORD_PATTERN = new RegExp(CONSENT_KEYWORDS.join('|'), 'i');

  const MAX_OBSERVE_MS = 10000;

  /**
   * Check if an element is visible and positioned like a banner
   * (fixed, sticky, or absolute with high z-index).
   */
  function isBannerLike(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const position = style.position;
    return position === 'fixed' || position === 'sticky' ||
      (position === 'absolute' && parseInt(style.zIndex, 10) > 100);
  }

  /**
   * Check if an element's text content contains consent keywords.
   */
  function hasConsentText(el) {
    const text = (el.textContent || '').slice(0, 3000);
    return KEYWORD_PATTERN.test(text);
  }

  /**
   * Strategy 1: Look for known CMP containers by selector.
   */
  function detectKnownCMP() {
    for (const [type, selectors] of Object.entries(CMP_SELECTORS)) {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          return { type, element: el, confidence: 0.95, shadowRoot: null };
        }
      }
    }
    return null;
  }

  /**
   * Strategy 2: Look for dialog/banner ARIA roles with consent text.
   */
  function detectAriaDialogs() {
    const candidates = document.querySelectorAll(
      '[role="dialog"], [role="banner"], [role="alertdialog"], [aria-modal="true"]'
    );
    for (const el of candidates) {
      if (hasConsentText(el)) {
        return { type: 'generic', element: el, confidence: 0.7, shadowRoot: null };
      }
    }
    return null;
  }

  /**
   * Strategy 3: Look for fixed/sticky elements with consent keywords.
   */
  function detectPositionedBanners() {
    const candidates = document.querySelectorAll(
      'div, section, aside, footer, [class*="banner"], [class*="consent"], [class*="cookie"], [id*="cookie"], [id*="consent"]'
    );
    for (const el of candidates) {
      if (isBannerLike(el) && hasConsentText(el)) {
        return { type: 'generic', element: el, confidence: 0.5, shadowRoot: null };
      }
    }
    return null;
  }

  /**
   * Strategy 4: Check shadow DOM roots for consent banners.
   */
  function detectShadowDOM() {
    const hosts = document.querySelectorAll('*');
    for (const host of hosts) {
      const shadow = host.shadowRoot;
      if (!shadow) continue;
      // Check for known CMP selectors inside the shadow root
      for (const [type, selectors] of Object.entries(CMP_SELECTORS)) {
        for (const selector of selectors) {
          const el = shadow.querySelector(selector);
          if (el) {
            return { type, element: host, confidence: 0.9, shadowRoot: shadow };
          }
        }
      }
      // Check for consent text in the shadow root
      if (hasConsentText(shadow)) {
        const dialog = shadow.querySelector('[role="dialog"], [role="banner"]');
        if (dialog) {
          return { type: 'generic', element: host, confidence: 0.6, shadowRoot: shadow };
        }
      }
    }
    return null;
  }

  /**
   * Strategy 5: Check same-origin iframes for consent content.
   */
  function detectIframes() {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (!doc) continue;
        for (const [type, selectors] of Object.entries(CMP_SELECTORS)) {
          for (const selector of selectors) {
            const el = doc.querySelector(selector);
            if (el) {
              return { type, element: iframe, confidence: 0.85, shadowRoot: null };
            }
          }
        }
      } catch (_) {
        // Cross-origin iframe, skip
      }
    }
    return null;
  }

  /**
   * Also check for TCF API presence as a signal.
   */
  function detectTCF() {
    if (typeof window.__tcfapi === 'function') {
      // TCF is present but we don't have a banner element yet.
      // Return a marker so the caller knows TCF is available.
      return { type: 'tcf', element: null, confidence: 0.8, shadowRoot: null };
    }
    return null;
  }

  /**
   * Run all detection strategies in priority order.
   * Returns the first match or null.
   */
  function runDetection() {
    return detectKnownCMP()
      || detectAriaDialogs()
      || detectPositionedBanners()
      || detectShadowDOM()
      || detectIframes()
      || detectTCF()
      || null;
  }

  /**
   * Main entry point. Returns a Promise that resolves with the detection
   * result or null if no banner is found within the timeout.
   */
  function detectBanner() {
    return new Promise(function (resolve) {
      // First, try an immediate scan
      var result = runDetection();
      if (result) {
        resolve(result);
        return;
      }

      // If nothing found yet, observe DOM mutations for late-loading banners
      var resolved = false;
      var observer = null;

      function finish(value) {
        if (resolved) return;
        resolved = true;
        if (observer) observer.disconnect();
        resolve(value);
      }

      // Set a hard timeout
      var timeout = setTimeout(function () {
        finish(null);
      }, MAX_OBSERVE_MS);

      function checkForBanner() {
        var r = runDetection();
        if (r) {
          clearTimeout(timeout);
          finish(r);
        }
      }

      observer = new MutationObserver(function () {
        // Use requestIdleCallback to avoid blocking the main thread
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(checkForBanner);
        } else {
          setTimeout(checkForBanner, 0);
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  }

  // Expose on shared namespace
  window.ConsentPilot = window.ConsentPilot || {};
  window.ConsentPilot.detectBanner = detectBanner;
  window.ConsentPilot.CMP_SELECTORS = CMP_SELECTORS;
})();
