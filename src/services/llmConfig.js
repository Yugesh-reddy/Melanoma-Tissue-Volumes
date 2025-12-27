// Model-provider configuration for Tissue Intelligence.
//
// There is no backend. The user configures either Google Gemini (cloud, with
// their own API key) or a local OpenAI-compatible endpoint (Ollama, LM Studio,
// llama.cpp server, vLLM, LocalAI...). Config is persisted in localStorage.
// Keys are visible to anyone with access to the browser — the Settings UI
// surfaces that caveat.

const STORAGE = 'mtv_llm_config_v1';

// Legacy single-purpose keys from the old gemini-only client, migrated on read.
const LEGACY_KEY = 'mtv_gemini_api_key';
const LEGACY_MODEL = 'mtv_gemini_model';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
export const AVAILABLE_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-flash'
];

export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';

const defaults = () => ({
  provider: 'gemini',
  gemini: { apiKey: '', model: DEFAULT_GEMINI_MODEL },
  local: { baseUrl: DEFAULT_LOCAL_BASE_URL, model: '', apiKey: '' }
});

const readLegacy = () => {
  try {
    const apiKey = localStorage.getItem(LEGACY_KEY) || '';
    const model = localStorage.getItem(LEGACY_MODEL) || DEFAULT_GEMINI_MODEL;
    if (!apiKey) return null;
    return { ...defaults(), gemini: { apiKey, model } };
  } catch {
    return null;
  }
};

export const getConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) {
      // First run on the new system — pick up any pre-existing gemini key.
      const legacy = readLegacy();
      if (legacy) {
        setConfig(legacy);
        return legacy;
      }
      return defaults();
    }
    const parsed = JSON.parse(raw);
    const base = defaults();
    return {
      provider: parsed.provider === 'local' ? 'local' : 'gemini',
      gemini: { ...base.gemini, ...(parsed.gemini || {}) },
      local: { ...base.local, ...(parsed.local || {}) }
    };
  } catch {
    return defaults();
  }
};

export const setConfig = (cfg) => {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(cfg));
  } catch {
    // storage unavailable (private mode); config simply won't persist
  }
};

export const getProvider = () => getConfig().provider;

export const setProvider = (provider) => {
  setConfig({ ...getConfig(), provider: provider === 'local' ? 'local' : 'gemini' });
};

/**
 * Is the *active* provider fully configured enough to make a request?
 * Gemini needs an API key + model; local needs a base URL + model name.
 */
export const isConfigured = (cfg = getConfig()) => {
  if (cfg.provider === 'local') {
    return Boolean(cfg.local.baseUrl && cfg.local.model);
  }
  return Boolean(cfg.gemini.apiKey && cfg.gemini.model);
};
