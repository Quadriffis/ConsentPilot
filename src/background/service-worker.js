/**
 * Consent Pilot — Service Worker (Manifest V3)
 *
 * Coordinates the extension: handles messages from content scripts,
 * manages the action badge, tracks statistics, and persists settings.
 */

import { MSG, METHOD, DEFAULT_SETTINGS } from '../shared/constants.js';

// ─── Badge colours ────────────────────────────────────────────────────
const BADGE = Object.freeze({
  SUCCESS: { text: '\u2713', color: '#22c55e' }, // green
  PARTIAL: { text: '!',     color: '#f59e0b' }, // orange
  FAILURE: { text: '\u2717', color: '#ef4444' }, // red
});

// ─── Helpers ──────────────────────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function setStorage(data) {
  return chrome.storage.local.set(data);
}

// ─── Badge management ─────────────────────────────────────────────────

async function setBadge(tabId, type) {
  const { text, color } = BADGE[type] || {};
  if (!text) return;
  try {
    await chrome.action.setBadgeText({ text, tabId });
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
  } catch {
    // Tab may have been closed; ignore.
  }
}

async function clearBadge(tabId) {
  try {
    await chrome.action.setBadgeText({ text: '', tabId });
  } catch {
    // Tab may have been closed; ignore.
  }
}

// ─── Statistics helpers ───────────────────────────────────────────────

function emptyStats() {
  return {
    totalBannersHandled: 0,
    totalCookiesRejected: 0,
    handledByMethod: { tcf: 0, cmp: 0, heuristic: 0, ai: 0 },
    failedDomains: [],
    dailyStats: {},
  };
}

async function getStats() {
  const { stats } = await getStorage('stats');
  return stats || emptyStats();
}

async function recordSuccess(method, domain) {
  const stats = await getStats();
  stats.totalBannersHandled += 1;
  stats.totalCookiesRejected += 1;

  const key = method in stats.handledByMethod ? method : METHOD.HEURISTIC;
  stats.handledByMethod[key] += 1;

  const day = todayKey();
  stats.dailyStats[day] = stats.dailyStats[day] || { handled: 0, failed: 0 };
  stats.dailyStats[day].handled += 1;

  // Remove from failed list if previously recorded
  stats.failedDomains = stats.failedDomains.filter((d) => d.domain !== domain);

  await setStorage({ stats });
}

async function recordFailure(domain, bannerType) {
  const stats = await getStats();

  const day = todayKey();
  stats.dailyStats[day] = stats.dailyStats[day] || { handled: 0, failed: 0 };
  stats.dailyStats[day].failed += 1;

  // Upsert in failedDomains (keep max 200 entries)
  const existing = stats.failedDomains.find((d) => d.domain === domain);
  if (existing) {
    existing.lastAttempt = Date.now();
    existing.bannerType = bannerType;
  } else {
    stats.failedDomains.push({
      domain,
      lastAttempt: Date.now(),
      bannerType: bannerType || 'unknown',
    });
    if (stats.failedDomains.length > 200) {
      stats.failedDomains.shift();
    }
  }

  await setStorage({ stats });
}

// ─── Settings helpers ─────────────────────────────────────────────────

async function getSettings() {
  const { settings } = await getStorage('settings');
  return settings || { ...DEFAULT_SETTINGS };
}

// ─── Offscreen document management (Transformers.js AI) ──────────────

let offscreenCreating = null;

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existingContexts.length > 0) return;

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: 'src/ai/offscreen.html',
    reasons: ['LOCAL_STORAGE'],  // We need IndexedDB for model caching
    justification: 'Running Transformers.js AI model for cookie banner analysis',
  });

  await offscreenCreating;
  offscreenCreating = null;
}

async function relayToOffscreen(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage(message);
}

// ─── Message handler ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const url = sender.tab?.url || sender.url || '';

  switch (message.type) {
    case MSG.CONSENT_HANDLED: {
      const domain = domainFromUrl(url);
      const method = message.method || METHOD.HEURISTIC;
      recordSuccess(method, domain).then(() => {
        if (tabId != null) setBadge(tabId, 'SUCCESS');
      });
      sendResponse({ ok: true });
      break;
    }

    case MSG.CONSENT_FAILED: {
      const domain = domainFromUrl(url);
      const bannerType = message.bannerType || 'unknown';
      recordFailure(domain, bannerType).then(() => {
        if (tabId != null) setBadge(tabId, 'FAILURE');
      });
      sendResponse({ ok: true });
      break;
    }

    case MSG.GET_SETTINGS: {
      getSettings().then((settings) => sendResponse(settings));
      return true;
    }

    case MSG.GET_STATS: {
      getStats().then((stats) => sendResponse(stats));
      return true;
    }

    // Transformers.js AI messages — relay to offscreen document
    case 'AI_ANALYZE_BANNER':
    case 'AI_LOAD_MODEL':
    case 'AI_UNLOAD_MODEL':
    case 'AI_GET_STATUS': {
      relayToOffscreen(message)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // Progress updates from offscreen (pass-through, no response needed)
    case 'AI_MODEL_PROGRESS':
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }
});

// ─── Tab navigation — reset badge ────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearBadge(tabId);
  }
});

// ─── Install / update handler ─────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await setStorage({
      settings: { ...DEFAULT_SETTINGS },
      stats: emptyStats(),
    });
  }
});
