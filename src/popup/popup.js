'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// DOM references
const dom = {
  popup: $('.popup'),
  globalToggle: $('#globalToggle'),
  siteToggle: $('#siteToggle'),
  statusDot: $('#statusDot'),
  siteDomain: $('#siteDomain'),
  statusMessage: $('#statusMessage'),
  statusTimestamp: $('#statusTimestamp'),
  whitelistHint: $('#whitelistHint'),
  statBanners: $('#statBanners'),
  statRejected: $('#statRejected'),
  barTcf: $('#barTcf'),
  barCmp: $('#barCmp'),
  barHeuristic: $('#barHeuristic'),
  barAi: $('#barAi'),
  reportBtn: $('#reportBtn'),
  settingsLink: $('#settingsLink'),
  versionNumber: $('#versionNumber'),
};

let currentDomain = null;
let currentPeriod = 'allTime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n) {
  return (n || 0).toLocaleString('en-US');
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Chrome storage helpers
// ---------------------------------------------------------------------------

async function getSettings() {
  const data = await chrome.storage.local.get({
    enabled: true,
    whitelist: [],
    settings: null,
    stats: null,
    siteLog: {},
  });
  // Merge nested settings if present
  if (data.settings) {
    data.enabled = data.settings.enabled ?? data.enabled;
    data.whitelist = data.settings.whitelist ?? data.whitelist;
  }
  return data;
}

async function saveSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// ---------------------------------------------------------------------------
// UI Updates
// ---------------------------------------------------------------------------

function renderStats(stats) {
  if (!stats) {
    dom.statBanners.textContent = '0';
    dom.statRejected.textContent = '0';
    dom.barTcf.style.width = dom.barCmp.style.width = dom.barHeuristic.style.width = dom.barAi.style.width = '0%';
    return;
  }

  // Service worker stats format: { totalBannersHandled, totalCookiesRejected, handledByMethod, dailyStats }
  if (currentPeriod === 'month') {
    // Sum current month's daily stats
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let monthHandled = 0;
    let monthFailed = 0;
    for (const [day, counts] of Object.entries(stats.dailyStats || {})) {
      if (day.startsWith(prefix)) {
        monthHandled += counts.handled || 0;
        monthFailed += counts.failed || 0;
      }
    }
    dom.statBanners.textContent = formatNumber(monthHandled);
    dom.statRejected.textContent = formatNumber(monthHandled); // each handled banner = rejected cookies
  } else {
    dom.statBanners.textContent = formatNumber(stats.totalBannersHandled);
    dom.statRejected.textContent = formatNumber(stats.totalCookiesRejected);
  }

  // Breakdown bar (always uses all-time method counts)
  const m = stats.handledByMethod || {};
  const total = (m.tcf || 0) + (m.cmp || 0) + (m.heuristic || 0) + (m.ai || 0);
  if (total > 0) {
    dom.barTcf.style.width = `${(m.tcf / total) * 100}%`;
    dom.barCmp.style.width = `${(m.cmp / total) * 100}%`;
    dom.barHeuristic.style.width = `${(m.heuristic / total) * 100}%`;
    dom.barAi.style.width = `${(m.ai / total) * 100}%`;
  } else {
    dom.barTcf.style.width = dom.barCmp.style.width = dom.barHeuristic.style.width = dom.barAi.style.width = '0%';
  }
}

function renderSiteStatus(settings) {
  if (!currentDomain) {
    dom.siteDomain.textContent = 'No site detected';
    dom.statusDot.className = 'status-dot';
    dom.statusMessage.textContent = 'Open a website to see its status.';
    dom.statusTimestamp.textContent = '';
    return;
  }

  dom.siteDomain.textContent = currentDomain;

  const isWhitelisted = (settings.whitelist || []).includes(currentDomain);
  const siteEntry = settings[`cache_${currentDomain}`] || null;

  dom.siteToggle.checked = !isWhitelisted;
  dom.whitelistHint.textContent = isWhitelisted ? 'Site is whitelisted' : 'Toggle off to whitelist';

  if (isWhitelisted) {
    dom.statusDot.className = 'status-dot whitelisted';
    dom.statusMessage.textContent = 'Site whitelisted — banners will not be touched.';
    dom.statusTimestamp.textContent = '';
  } else if (siteEntry) {
    dom.statusDot.className = 'status-dot active';
    dom.statusMessage.textContent = `Cookies rejected via ${siteEntry.method || 'auto-detection'}`;
    dom.statusTimestamp.textContent = relativeTime(siteEntry.timestamp);
  } else {
    dom.statusDot.className = 'status-dot';
    dom.statusMessage.textContent = 'No cookie banner detected on this site.';
    dom.statusTimestamp.textContent = '';
  }
}

function renderGlobalState(enabled) {
  dom.globalToggle.checked = enabled;
  dom.popup.classList.toggle('disabled', !enabled);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentDomain = tab?.url ? extractDomain(tab.url) : null;

  // Load settings + site-specific cache
  const cacheKey = currentDomain ? `cache_${currentDomain}` : null;
  const settings = await getSettings();
  if (cacheKey) {
    const cached = await chrome.storage.local.get(cacheKey);
    settings[cacheKey] = cached[cacheKey] || null;
  }

  // Render
  renderGlobalState(settings.enabled);
  renderSiteStatus(settings);

  // Set version from manifest
  const manifest = chrome.runtime.getManifest();
  dom.versionNumber.textContent = manifest.version;

  // Get live stats from service worker (it returns the stats object directly)
  try {
    const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    renderStats(stats);
  } catch {
    // Service worker not available — use stored stats
    renderStats(settings.stats);
  }
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

dom.globalToggle.addEventListener('change', async () => {
  const enabled = dom.globalToggle.checked;
  await saveSetting('enabled', enabled);
  renderGlobalState(enabled);
});

dom.siteToggle.addEventListener('change', async () => {
  if (!currentDomain) return;

  const settings = await getSettings();
  let whitelist = settings.whitelist || [];

  if (dom.siteToggle.checked) {
    whitelist = whitelist.filter((d) => d !== currentDomain);
  } else {
    if (!whitelist.includes(currentDomain)) {
      whitelist.push(currentDomain);
    }
  }

  await saveSetting('whitelist', whitelist);
  settings.whitelist = whitelist;
  renderSiteStatus(settings);
});

// Stats period toggle
$$('.period-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    $$('.period-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;
    try {
      const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
      renderStats(stats);
    } catch {
      renderStats(null);
    }
  });
});

// Report missed banner
dom.reportBtn.addEventListener('click', () => {
  const title = encodeURIComponent(`Missed banner on ${currentDomain || 'unknown site'}`);
  const body = encodeURIComponent(
    `## Missed Cookie Banner Report\n\n` +
    `- **Domain**: ${currentDomain || 'N/A'}\n` +
    `- **Browser**: ${navigator.userAgent}\n` +
    `- **Extension version**: ${chrome.runtime.getManifest().version}\n\n` +
    `### Description\n\n` +
    `A cookie consent banner was not detected or handled on this site.\n\n` +
    `### Steps to reproduce\n\n1. Visit ${currentDomain || 'the site'}\n2. ...\n`
  );
  chrome.tabs.create({
    url: `https://github.com/user/consent-pilot/issues/new?title=${title}&body=${body}`,
  });
});

// Settings link
dom.settingsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage?.() || chrome.tabs.create({ url: 'chrome://extensions' });
});

// ---------------------------------------------------------------------------
// AI Model Management
// ---------------------------------------------------------------------------

const aiDom = {
  card: $('#aiCard'),
  status: $('#aiStatus'),
  actionBtn: $('#aiActionBtn'),
  progressWrap: $('#aiProgressWrap'),
  progressFill: $('#aiProgressFill'),
  progressText: $('#aiProgressText'),
};

async function checkAIStatus() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'AI_GET_STATUS' });
    renderAIStatus(result);
  } catch {
    renderAIStatus({ status: 'idle', hasModel: false });
  }
}

function renderAIStatus(state) {
  const { status, progress } = state || {};

  switch (status) {
    case 'ready':
      aiDom.status.textContent = 'Ready (SmolLM2-360M, local)';
      aiDom.actionBtn.textContent = 'Unload';
      aiDom.actionBtn.className = 'btn-sm btn-danger';
      aiDom.actionBtn.disabled = false;
      aiDom.progressWrap.hidden = true;
      break;

    case 'loading_lib':
      aiDom.status.textContent = 'Loading AI engine...';
      aiDom.actionBtn.textContent = 'Loading...';
      aiDom.actionBtn.disabled = true;
      aiDom.progressWrap.hidden = true;
      break;

    case 'loading_model':
    case 'downloading':
      aiDom.status.textContent = 'Downloading model (one-time, ~200MB)...';
      aiDom.actionBtn.textContent = 'Loading...';
      aiDom.actionBtn.disabled = true;
      aiDom.progressWrap.hidden = false;
      aiDom.progressFill.style.width = `${progress || 0}%`;
      aiDom.progressText.textContent = `${progress || 0}%`;
      break;

    case 'error':
      aiDom.status.textContent = 'Failed to load — click to retry';
      aiDom.actionBtn.textContent = 'Retry';
      aiDom.actionBtn.className = 'btn-sm btn-accent';
      aiDom.actionBtn.disabled = false;
      aiDom.progressWrap.hidden = true;
      break;

    default: // idle
      aiDom.status.textContent = 'Auto-loads when needed';
      aiDom.actionBtn.textContent = 'Pre-load';
      aiDom.actionBtn.className = 'btn-sm btn-accent';
      aiDom.actionBtn.disabled = false;
      aiDom.progressWrap.hidden = true;
  }
}

aiDom.actionBtn.addEventListener('click', async () => {
  const btnText = aiDom.actionBtn.textContent;

  if (btnText === 'Unload') {
    await chrome.runtime.sendMessage({ type: 'AI_UNLOAD_MODEL' });
    renderAIStatus({ status: 'idle' });
  } else {
    renderAIStatus({ status: 'loading', progress: 0 });
    const result = await chrome.runtime.sendMessage({ type: 'AI_LOAD_MODEL' });
    renderAIStatus(result);
  }
});

// Listen for progress updates from the offscreen document
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'AI_MODEL_PROGRESS') {
    renderAIStatus({
      status: message.status === 'ready' ? 'ready' : 'loading',
      progress: message.progress,
      hasModel: message.status === 'ready',
    });
  }
});

// Initialize
init();
checkAIStatus();
