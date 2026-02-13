/**
 * Consent Pilot — Heuristic Handler + AI Fallback
 *
 * Fallback handler for when no known CMP/TCF API is detected.
 * Uses multi-language text matching, button scoring, a "manage preferences"
 * flow, and optionally Chrome's built-in Prompt API as a last resort.
 *
 * Content scripts cannot use ES module syntax in Manifest V3, so this
 * file uses an IIFE and attaches its export to `globalThis.ConsentPilot`.
 */

(function () {
  'use strict';

  // ── Multi-language reject button labels ─────────────────────────────
  // Grouped by confidence: "reject all" phrases first, then "only necessary".
  const REJECT_PATTERNS = [
    // English
    'reject all', 'decline all', 'deny all', 'refuse all',
    'only necessary', 'only essential', 'necessary only',
    'necessary cookies only', 'essential cookies only',
    // Dutch
    'alles weigeren', 'alles afwijzen', 'alleen noodzakelijk',
    'enkel noodzakelijke', 'alles weigeren en sluiten',
    // German
    'alle ablehnen', 'alles ablehnen', 'nur notwendige',
    'nur erforderliche', 'alle cookies ablehnen',
    // French
    'tout refuser', 'tout rejeter', 'refuser tout',
    'uniquement nécessaires', 'continuer sans accepter',
    'refuser et fermer',
    // Italian
    'rifiuta tutto', 'rifiuta tutti', 'solo necessari',
    // Spanish
    'rechazar todo', 'rechazar todas', 'solo necesarias',
    'rechazar cookies',
    // Portuguese
    'rejeitar tudo', 'rejeitar todos', 'apenas necessários',
    // Polish
    'odrzuć wszystko', 'odrzuć wszystkie', 'tylko niezbędne',
  ];

  // Labels that indicate "accept" — we must NEVER click these.
  const ACCEPT_PATTERNS = [
    'accept all', 'accept cookies', 'allow all', 'agree',
    'i agree', 'got it', 'ok', 'okay',
    'alles accepteren', 'alles toestaan', 'akkoord',
    'alle akzeptieren', 'allen zustimmen', 'einverstanden',
    'tout accepter', 'accepter tout', 'j\'accepte',
    'accetta tutto', 'accetta tutti',
    'aceptar todo', 'aceptar todas',
    'aceitar tudo', 'aceitar todos',
    'zaakceptuj wszystko', 'akceptuję',
  ];

  // Manage-preferences trigger labels
  const MANAGE_PATTERNS = [
    'manage', 'settings', 'preferences', 'customize', 'customise',
    'more options', 'cookie settings', 'show purposes',
    'manage cookies', 'manage preferences', 'manage settings',
    'beheren', 'instellingen', 'voorkeuren', 'aanpassen',
    'einstellungen', 'anpassen', 'verwalten',
    'gérer', 'paramètres', 'préférences', 'personnaliser',
    'gestisci', 'impostazioni', 'personalizza',
    'gestionar', 'configurar', 'ajustes',
    'gerenciar', 'configurações',
    'zarządzaj', 'ustawienia',
  ];

  // Labels for "necessary/essential" category (do NOT uncheck these)
  const NECESSARY_LABELS = [
    'necessary', 'essential', 'required', 'strictly necessary',
    'always active', 'always on',
    'functioneel', 'noodzakelijk', 'strikt noodzakelijk',
    'erforderlich', 'unbedingt erforderlich', 'notwendig',
    'nécessaires', 'strictement nécessaires',
    'necessari', 'strettamente necessari',
    'necesarias', 'estrictamente necesarias',
    'necessários', 'estritamente necessários',
    'niezbędne', 'ściśle niezbędne',
  ];

  // Save/confirm button labels (for manage preferences flow)
  const SAVE_PATTERNS = [
    'save', 'confirm', 'save preferences', 'save settings',
    'save my choices', 'confirm choices', 'confirm my choices',
    'opslaan', 'bevestigen', 'voorkeuren opslaan',
    'speichern', 'bestätigen', 'auswahl bestätigen',
    'enregistrer', 'confirmer', 'sauvegarder',
    'salva', 'conferma',
    'guardar', 'confirmar',
    'salvar', 'confirmar',
    'zapisz', 'potwierdź',
  ];

  // ── Utilities ───────────────────────────────────────────────────────

  function normalizeText(el) {
    return (el.textContent || el.innerText || el.value || el.getAttribute('aria-label') || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function getVisibleText(el) {
    return (el.textContent || el.innerText || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           parseFloat(style.opacity) > 0;
  }

  function matchesAny(text, patterns) {
    return patterns.some((p) => text.includes(p));
  }

  function bestMatch(text, patterns) {
    let best = null;
    let bestScore = 0;
    for (const p of patterns) {
      if (text === p) return { pattern: p, score: 1.0 };
      if (text.includes(p)) {
        // Partial match — longer pattern = higher quality match
        const score = p.length / Math.max(text.length, 1);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    return best ? { pattern: best, score: bestScore } : null;
  }

  /** Return all clickable elements inside a root element. */
  function getClickables(root) {
    const selectors = 'button, a, [role="button"], input[type="button"], input[type="submit"], [tabindex], [onclick]';
    const elements = Array.from(root.querySelectorAll(selectors));
    // Also check the root itself
    if (root.matches && root.matches(selectors)) {
      elements.unshift(root);
    }
    return elements.filter(isVisible);
  }

  // ── Button scoring ─────────────────────────────────────────────────

  /**
   * Score a candidate element as a potential "reject" button.
   * Higher score = more likely to be the reject button.
   * Returns 0 if the element looks like an "accept" button.
   */
  function scoreRejectCandidate(el) {
    const text = normalizeText(el);

    // Hard veto: if it matches accept patterns, return 0
    if (matchesAny(text, ACCEPT_PATTERNS)) return 0;

    const match = bestMatch(text, REJECT_PATTERNS);
    if (!match) return 0;

    let score = match.score * 50; // base: 0‑50 from text match

    // Dark-pattern heuristic: reject buttons are often LESS prominent.
    // A secondary/outline/ghost button is more likely to be "reject".
    const style = getComputedStyle(el);
    const bg = style.backgroundColor;
    const border = style.border || style.borderStyle;

    // Outline / ghost buttons (transparent or white bg) get a bonus
    if (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)' || bg === 'rgb(255, 255, 255)') {
      score += 10;
    }

    // If it has a visible border but no strong background, it's likely secondary
    if (border && border !== 'none' && !bg.includes('rgb(')) {
      score += 5;
    }

    // Smaller font size is a dark-pattern signal for reject
    const fontSize = parseFloat(style.fontSize);
    if (fontSize && fontSize < 15) {
      score += 3;
    }

    // "reject all" exact match gets a big bonus
    if (match.score === 1.0) {
      score += 20;
    }

    return score;
  }

  // ── Part 1: Find & click reject button ──────────────────────────────

  function findRejectButton(bannerElement) {
    const clickables = getClickables(bannerElement);
    let bestEl = null;
    let bestScore = 0;

    for (const el of clickables) {
      const score = scoreRejectCandidate(el);
      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    // Require a minimum confidence threshold
    if (bestEl && bestScore >= 15) {
      return { element: bestEl, score: bestScore, text: normalizeText(bestEl) };
    }
    return null;
  }

  // ── Part 1b: Manage preferences flow ────────────────────────────────

  function findManageButton(bannerElement) {
    const clickables = getClickables(bannerElement);
    for (const el of clickables) {
      const text = normalizeText(el);
      // Skip if it looks like accept or reject
      if (matchesAny(text, ACCEPT_PATTERNS)) continue;
      if (matchesAny(text, REJECT_PATTERNS)) continue;
      if (matchesAny(text, MANAGE_PATTERNS)) {
        return el;
      }
    }
    return null;
  }

  /** Wait for a new panel/modal to appear after clicking manage. */
  function waitForPreferencesPanel(timeout = 3000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      // Check if a new panel is already visible
      const check = () => {
        // Look for newly visible overlays, modals, panels
        const candidates = document.querySelectorAll(
          '[class*="preference"], [class*="settings"], [class*="detail"], ' +
          '[class*="purpose"], [class*="category"], [class*="vendor"], ' +
          '[id*="preference"], [id*="settings"], [id*="detail"], ' +
          '[role="dialog"], [role="tabpanel"], ' +
          '[class*="modal"], [class*="panel"], [class*="layer"]'
        );
        for (const c of candidates) {
          if (isVisible(c)) {
            // Must contain toggles or checkboxes
            const toggles = c.querySelectorAll(
              'input[type="checkbox"], [role="checkbox"], [role="switch"], ' +
              '[class*="toggle"], [class*="switch"]'
            );
            if (toggles.length > 0) return c;
          }
        }
        return null;
      };

      const existing = check();
      if (existing) { resolve(existing); return; }

      const observer = new MutationObserver(() => {
        const panel = check();
        if (panel) {
          observer.disconnect();
          resolve(panel);
        } else if (Date.now() - startTime > timeout) {
          observer.disconnect();
          resolve(null);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      });

      // Fallback timeout
      setTimeout(() => {
        observer.disconnect();
        resolve(check());
      }, timeout);
    });
  }

  /** Determine if a toggle label indicates a "necessary" category. */
  function isNecessaryCategory(toggleEl) {
    // Walk up to the nearest container and get its text
    let container = toggleEl.closest(
      '[class*="category"], [class*="purpose"], [class*="group"], ' +
      'li, tr, div[class], section, fieldset, label'
    ) || toggleEl.parentElement;

    if (!container) return false;

    const text = getVisibleText(container);
    return matchesAny(text, NECESSARY_LABELS);
  }

  /** Get all toggle/checkbox elements inside a panel. */
  function getToggles(panel) {
    return Array.from(panel.querySelectorAll(
      'input[type="checkbox"], [role="checkbox"], [role="switch"]'
    )).filter(isVisible);
  }

  /** Check whether a toggle is currently "on" (checked). */
  function isToggleOn(toggle) {
    if (toggle.type === 'checkbox') return toggle.checked;
    const ariaChecked = toggle.getAttribute('aria-checked');
    if (ariaChecked) return ariaChecked === 'true';
    // Heuristic: look at class names
    const cls = toggle.className || '';
    if (/\b(active|checked|on|enabled)\b/i.test(cls)) return true;
    return false;
  }

  /** Turn a toggle off. */
  function turnOff(toggle) {
    if (!isToggleOn(toggle)) return; // already off

    if (toggle.type === 'checkbox') {
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      toggle.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // For role="checkbox" / role="switch", click it
      toggle.click();
    }
  }

  function findSaveButton(panel) {
    // Search both the panel and its ancestors (save button may be outside)
    const searchRoots = [panel];
    const dialog = panel.closest('[role="dialog"], [class*="modal"], [class*="overlay"]');
    if (dialog) searchRoots.push(dialog);
    searchRoots.push(document.body);

    for (const root of searchRoots) {
      const clickables = getClickables(root);
      for (const el of clickables) {
        const text = normalizeText(el);
        if (matchesAny(text, ACCEPT_PATTERNS)) continue;
        if (matchesAny(text, SAVE_PATTERNS)) {
          return el;
        }
      }
    }
    return null;
  }

  /**
   * Execute the "manage preferences" flow:
   * 1. Click manage button
   * 2. Wait for panel
   * 3. Uncheck all non-necessary toggles
   * 4. Click save
   */
  async function tryManagePreferences(bannerElement) {
    const manageBtn = findManageButton(bannerElement);
    if (!manageBtn) return null;

    manageBtn.click();

    const panel = await waitForPreferencesPanel(3000);
    if (!panel) return null;

    // Small delay to let any animations finish
    await new Promise((r) => setTimeout(r, 300));

    const toggles = getToggles(panel);
    if (toggles.length === 0) return null;

    let unchecked = 0;
    for (const toggle of toggles) {
      if (isNecessaryCategory(toggle)) continue; // leave necessary ON
      if (toggle.disabled) continue; // necessary toggles are often disabled

      turnOff(toggle);
      unchecked++;
    }

    // Also check: sometimes there's a reject-all button inside the preferences panel
    const rejectInPanel = findRejectButton(panel);
    if (rejectInPanel && rejectInPanel.score >= 15) {
      rejectInPanel.element.click();
      return { success: true, method: 'preferences', details: 'Found reject button inside preferences panel' };
    }

    // Find and click save
    const saveBtn = findSaveButton(panel);
    if (saveBtn) {
      saveBtn.click();
      return {
        success: true,
        method: 'preferences',
        details: `Unchecked ${unchecked} toggle(s) and saved preferences`,
      };
    }

    return null;
  }

  // ── Part 2: AI Fallback (Chrome built-in Prompt API) ────────────────

  function cleanBannerHtml(bannerElement) {
    const clone = bannerElement.cloneNode(true);
    // Strip scripts and styles
    clone.querySelectorAll('script, style, svg, img, video, iframe').forEach((el) => el.remove());
    // Remove event handler attributes
    clone.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('on') || attr.name === 'style') {
          el.removeAttribute(attr.name);
        }
      }
    });
    let html = clone.innerHTML.replace(/\s+/g, ' ').trim();
    if (html.length > 2000) {
      html = html.slice(0, 2000);
    }
    return html;
  }

  function parseAIResponse(response) {
    // Expect the AI to return CSS selectors or text descriptions of what to click.
    // Format: a JSON array of steps, e.g. [{"action":"click","selector":"#reject-btn"}]
    try {
      const parsed = JSON.parse(response);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON — try to extract selector-like patterns
    }

    // Fallback: look for quoted selectors or descriptions
    const steps = [];
    const selectorRegex = /["']([^"']+)["']/g;
    let m;
    while ((m = selectorRegex.exec(response)) !== null) {
      steps.push({ action: 'click', selector: m[1] });
    }
    return steps;
  }

  async function executeAISteps(steps) {
    for (const step of steps) {
      if (step.action !== 'click' || !step.selector) continue;

      let target = null;
      try {
        target = document.querySelector(step.selector);
      } catch {
        // Invalid selector; skip
      }

      if (!target || !isVisible(target)) continue;

      // Safety: never click something that looks like accept
      const text = normalizeText(target);
      if (matchesAny(text, ACCEPT_PATTERNS)) continue;

      target.click();

      // Wait a moment between steps
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // ── AI Strategy 1: Chrome Built-in AI (Gemini Nano) ──────────────────

  async function tryChromeBuiltInAI(bannerElement) {
    const aiNamespace = (typeof self !== 'undefined' && self.ai) ||
                        (typeof window !== 'undefined' && window.ai);
    if (!aiNamespace || typeof aiNamespace.languageModel?.create !== 'function') {
      return null;
    }

    const html = cleanBannerHtml(bannerElement);
    if (!html) return null;

    const prompt =
      'You are a browser extension that rejects cookie consent banners. ' +
      'Given the following HTML of a cookie banner, return a JSON array of steps to reject all non-essential cookies. ' +
      'Each step should be: {"action":"click","selector":"<CSS selector>"}. ' +
      'Only include selectors for buttons that REJECT or DECLINE cookies. ' +
      'NEVER include selectors for accept/agree buttons. ' +
      'Return ONLY the JSON array, no explanation.\n\n' +
      'Banner HTML:\n' + html;

    try {
      const session = await aiNamespace.languageModel.create();
      const response = await session.prompt(prompt);
      session.destroy();

      const steps = parseAIResponse(response);
      if (steps.length === 0) return null;

      await executeAISteps(steps);
      return {
        success: true,
        method: 'ai',
        details: `Chrome AI suggested ${steps.length} step(s)`,
      };
    } catch {
      return null;
    }
  }

  // ── AI Strategy 2: Transformers.js (via service worker + offscreen) ──

  async function tryTransformersAI(bannerElement) {
    // Check if chrome.runtime is available (content script context)
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return null;
    }

    const html = cleanBannerHtml(bannerElement);
    if (!html) return null;

    try {
      // Send banner HTML to service worker → offscreen document → Transformers.js
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'AI_ANALYZE_BANNER', html },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          }
        );
      });

      if (!result || !result.success || !result.steps || result.steps.length === 0) {
        return null;
      }

      await executeAISteps(result.steps);
      return {
        success: true,
        method: 'ai',
        details: `Transformers.js suggested ${result.steps.length} step(s)`,
      };
    } catch {
      return null;
    }
  }

  // ── Combined AI fallback: try Chrome AI first, then Transformers.js ──

  async function tryAIAnalysis(bannerElement) {
    // Strategy 1: Chrome's built-in AI (free, fast, no download needed)
    const chromeResult = await tryChromeBuiltInAI(bannerElement);
    if (chromeResult) return chromeResult;

    // Strategy 2: Transformers.js (cross-browser, needs model download)
    const transformersResult = await tryTransformersAI(bannerElement);
    if (transformersResult) return transformersResult;

    return null;
  }

  // ── Part 3: Main export ─────────────────────────────────────────────

  /**
   * Attempt to reject cookies on a banner using heuristics and AI.
   *
   * @param {Element} bannerElement — the detected cookie banner DOM element
   * @returns {Promise<{success: boolean, method: string, details: string}>}
   */
  async function tryHeuristicReject(bannerElement) {
    if (!bannerElement) {
      return { success: false, method: 'failed', details: 'No banner element provided' };
    }

    // Step 1: Try direct reject button with high confidence
    const reject = findRejectButton(bannerElement);
    if (reject && reject.score >= 15) {
      reject.element.click();
      return {
        success: true,
        method: 'button',
        details: `Clicked reject button: "${reject.text}" (score: ${reject.score.toFixed(1)})`,
      };
    }

    // Step 2: Try manage-preferences flow
    const prefResult = await tryManagePreferences(bannerElement);
    if (prefResult) return prefResult;

    // Step 3: AI fallback as last resort
    const aiResult = await tryAIAnalysis(bannerElement);
    if (aiResult) return aiResult;

    // Nothing worked
    return {
      success: false,
      method: 'failed',
      details: 'No reject button found, manage preferences flow failed, AI not available or unsuccessful',
    };
  }

  // ── Attach to globalThis for other content scripts ──────────────────
  globalThis.ConsentPilot = globalThis.ConsentPilot || {};
  globalThis.ConsentPilot.tryHeuristicReject = tryHeuristicReject;
  globalThis.ConsentPilot.findRejectButton = findRejectButton;
})();
