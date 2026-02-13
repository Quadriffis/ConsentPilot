/**
 * Consent Pilot — Shared Constants
 *
 * Used by service worker (via ES module import) and content scripts (via
 * importScripts or inline copy).  Content scripts in Manifest V3 cannot
 * use ES module syntax, so this file is also loaded as a plain script that
 * attaches everything to `globalThis.ConsentPilot`.
 */

const CONSTANTS = Object.freeze({

  // ── Extension metadata ──────────────────────────────────────────────
  VERSION: '0.1.0',

  // ── Message types (content script <-> service worker) ───────────────
  MSG: Object.freeze({
    CONSENT_HANDLED: 'CONSENT_HANDLED',
    CONSENT_FAILED:  'CONSENT_FAILED',
    GET_SETTINGS:    'GET_SETTINGS',
    GET_STATS:       'GET_STATS',
  }),

  // ── CMP types ───────────────────────────────────────────────────────
  CMP: Object.freeze({
    TCF:        'tcf',
    ONETRUST:   'onetrust',
    COOKIEBOT:  'cookiebot',
    DIDOMI:     'didomi',
    QUANTCAST:  'quantcast',
    TRUSTARC:   'trustarc',
    USERCENTRICS: 'usercentrics',
    HEURISTIC:  'heuristic',
    AI:         'ai',
    UNKNOWN:    'unknown',
  }),

  // ── Handler methods (for stats) ─────────────────────────────────────
  METHOD: Object.freeze({
    TCF:       'tcf',
    CMP:       'cmp',
    HEURISTIC: 'heuristic',
    AI:        'ai',
  }),

  // ── Default user settings ───────────────────────────────────────────
  DEFAULT_SETTINGS: Object.freeze({
    enabled:           true,
    whitelist:         [],
    showNotifications: true,
    autoReject:        true,
  }),

  // ── Cache TTL: 30 days in milliseconds ──────────────────────────────
  CACHE_TTL: 30 * 24 * 60 * 60 * 1000,

  // ── Supported UI languages for button text matching ─────────────────
  SUPPORTED_LANGUAGES: Object.freeze([
    'en', 'nl', 'de', 'fr', 'it', 'es', 'pt', 'pl',
  ]),
});

// ── Export for ES‑module consumers (service worker) ───────────────────
// `typeof exports` guard keeps this safe when loaded as a plain script.
if (typeof globalThis !== 'undefined') {
  globalThis.ConsentPilot = globalThis.ConsentPilot || {};
  Object.assign(globalThis.ConsentPilot, CONSTANTS);
}

// ES module export (service worker uses `type: module`)
export default CONSTANTS;
export const {
  VERSION,
  MSG,
  CMP,
  METHOD,
  DEFAULT_SETTINGS,
  CACHE_TTL,
  SUPPORTED_LANGUAGES,
} = CONSTANTS;
