// Model-provider configuration for Tissue Intelligence.
//
// There is no backend and no cloud provider: the user configures a local
// OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, vLLM, LocalAI...).
// Config is persisted in localStorage. Any API key is visible to anyone with
// access to this browser — the Settings UI surfaces that caveat.

const STORAGE = 'mtv_llm_config_v1';

export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';

const defaults = () => ({
  provider: 'local',
  local: { baseUrl: DEFAULT_LOCAL_BASE_URL, model: '', apiKey: '' }
});

export const getConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    const base = defaults();
    return { provider: 'local', local: { ...base.local, ...(parsed.local || {}) } };
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

/**
 * Is the local provider configured enough to make a request?
 * Needs a base URL + model name.
 */
export const isConfigured = (cfg = getConfig()) =>
  Boolean(cfg.local && cfg.local.baseUrl && cfg.local.model);
