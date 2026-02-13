/**
 * Consent Pilot — Offscreen AI Engine (Transformers.js)
 *
 * Runs a small language model entirely in the browser for cookie banner analysis.
 * Everything is automatic:
 *   1. Transformers.js library loads from CDN on first use (~2MB, cached by browser)
 *   2. AI model downloads from Hugging Face on first use (~200MB, cached in IndexedDB)
 *   3. Subsequent uses are instant — everything comes from cache
 *
 * No manual setup, no API keys, no data leaves the device after initial download.
 */

const DEFAULT_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';
const MAX_NEW_TOKENS = 256;

let transformers = null;   // Loaded from bundled library
let generator = null;      // The text-generation pipeline
let modelStatus = 'idle';  // 'idle' | 'loading_lib' | 'loading_model' | 'ready' | 'error'
let loadProgress = 0;

// ── Load Transformers.js from CDN ────────────────────────────────────────

async function ensureTransformers() {
  if (transformers) return transformers;

  modelStatus = 'loading_lib';
  notifyProgress(0, 'loading_lib');

  try {
    // Import from bundled library (888KB, included in extension)
    transformers = await import('./transformers.min.js');

    // Configure
    transformers.env.allowLocalModels = false;
    transformers.env.useBrowserCache = true;

    return transformers;
  } catch (err) {
    modelStatus = 'error';
    notifyProgress(0, 'error', 'Failed to load Transformers.js: ' + err.message);
    throw err;
  }
}

// ── Model Management ─────────────────────────────────────────────────────

async function loadModel(modelId) {
  if (modelStatus === 'loading_lib' || modelStatus === 'loading_model') return;
  if (modelStatus === 'ready' && generator) return;

  try {
    const tf = await ensureTransformers();

    modelStatus = 'loading_model';
    loadProgress = 0;
    notifyProgress(0, 'downloading');

    // Try WebGPU first (fastest), fall back to WASM
    const devices = ['webgpu', 'wasm'];

    for (const device of devices) {
      try {
        generator = await tf.pipeline('text-generation', modelId || DEFAULT_MODEL, {
          dtype: 'q4',
          device,
          progress_callback: (progress) => {
            if (progress.status === 'progress' && progress.total) {
              loadProgress = Math.round((progress.loaded / progress.total) * 100);
              notifyProgress(loadProgress, 'downloading');
            }
          },
        });

        modelStatus = 'ready';
        notifyProgress(100, 'ready');
        return;
      } catch (deviceErr) {
        if (device === 'wasm') throw deviceErr; // Both failed
        // WebGPU failed, try WASM
      }
    }
  } catch (err) {
    modelStatus = 'error';
    generator = null;
    notifyProgress(0, 'error', err.message);
  }
}

async function unloadModel() {
  generator = null;
  modelStatus = 'idle';
  loadProgress = 0;
}

// ── Inference ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a browser extension that rejects cookie consent banners. ' +
  'Given the HTML of a cookie banner, return a JSON array of steps to reject all non-essential cookies. ' +
  'Each step: {"action":"click","selector":"<CSS selector>"}. ' +
  'NEVER include selectors for accept/agree/allow buttons. ' +
  'Return ONLY the JSON array.';

async function analyzeBanner(bannerHtml) {
  // Auto-load model if not ready — this is the "just works" magic
  if (modelStatus !== 'ready' || !generator) {
    await loadModel();
    if (modelStatus !== 'ready') {
      return { success: false, error: 'Model not available: ' + modelStatus };
    }
  }

  try {
    const output = await generator(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Banner HTML:\n' + bannerHtml },
      ],
      {
        max_new_tokens: MAX_NEW_TOKENS,
        temperature: 0.1,
        do_sample: false,
        return_full_text: false,
      }
    );

    const responseText = output[0]?.generated_text?.trim() || '';
    const steps = parseSteps(responseText);

    return { success: steps.length > 0, steps, rawResponse: responseText };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function parseSteps(text) {
  const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.filter((s) => s?.action === 'click' && typeof s.selector === 'string');
    }
  } catch {
    // Try to extract array from mixed text
    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr)) {
          return arr.filter((s) => s?.action === 'click' && typeof s.selector === 'string');
        }
      } catch {
        // Give up
      }
    }
  }
  return [];
}

// ── Communication ────────────────────────────────────────────────────────

function notifyProgress(progress, status, error) {
  chrome.runtime.sendMessage({
    type: 'AI_MODEL_PROGRESS',
    progress,
    status,
    error: error || null,
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'AI_LOAD_MODEL':
      loadModel(message.modelId).then(() => {
        sendResponse({ status: modelStatus, progress: loadProgress });
      });
      return true;

    case 'AI_UNLOAD_MODEL':
      unloadModel();
      sendResponse({ status: 'idle' });
      break;

    case 'AI_ANALYZE_BANNER':
      analyzeBanner(message.html).then((result) => {
        sendResponse(result);
      });
      return true;

    case 'AI_GET_STATUS':
      sendResponse({ status: modelStatus, progress: loadProgress });
      break;
  }
});
