// Global Settings dialog — the single home for AI model configuration.
// Replaces the old per-panel Gemini settings. Two providers:
//   - Gemini (cloud): API key + model
//   - Local (OpenAI-compatible): base URL + model + optional key

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getConfig, setConfig, AVAILABLE_MODELS, DEFAULT_LOCAL_BASE_URL } from '../services/llmConfig';

const fieldStyle = {
  width: '100%', padding: '8px 10px', fontSize: '12px', background: 'var(--bg-1)',
  color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  outline: 'none', fontFamily: 'var(--font-body)', boxSizing: 'border-box'
};
const labelStyle = { fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600, marginBottom: '5px', display: 'block' };

const SettingsModal = ({ open, onClose }) => {
  const [cfg, setCfg] = useState(getConfig());

  // Re-sync from storage each time the modal opens.
  useEffect(() => { if (open) setCfg(getConfig()); }, [open]);

  if (!open) return null;

  const provider = cfg.provider;
  const patch = (next) => setCfg((c) => ({ ...c, ...next }));
  const patchGemini = (next) => setCfg((c) => ({ ...c, gemini: { ...c.gemini, ...next } }));
  const patchLocal = (next) => setCfg((c) => ({ ...c, local: { ...c.local, ...next } }));

  const save = () => { setConfig(cfg); onClose(); };

  const providerTab = (value, label) => (
    <button
      type="button"
      className="mtv-press"
      onClick={() => patch({ provider: value })}
      style={{
        flex: 1, padding: '8px', fontSize: '12px', fontWeight: 600,
        color: provider === value ? 'var(--text-1)' : 'var(--text-3)',
        background: provider === value ? 'var(--accent-soft)' : 'transparent',
        border: `1px solid ${provider === value ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)', cursor: 'pointer'
      }}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      onPointerDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: '440px', maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto',
          background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)', padding: '18px',
          transformOrigin: 'center', animation: 'mtv-window-in 200ms var(--ease-out)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '17px', color: 'var(--text-1)', fontWeight: 600 }}>Settings</h2>
          <button type="button" className="mtv-press" onClick={onClose} title="Close" style={{ width: '26px', height: '26px', color: 'var(--text-2)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: 1.5 }}>
          Tissue Intelligence runs entirely in your browser. Choose a model provider below. Keys are stored in this browser's localStorage and are visible to anyone with access to it.
        </div>

        <span style={labelStyle}>Provider</span>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {providerTab('gemini', 'Gemini (cloud)')}
          {providerTab('local', 'Local model')}
        </div>

        {provider === 'gemini' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <span style={labelStyle}>Gemini API key</span>
              <input type="password" value={cfg.gemini.apiKey} onChange={(e) => patchGemini({ apiKey: e.target.value })} placeholder="AIza…" style={fieldStyle} />
            </div>
            <div>
              <span style={labelStyle}>Model</span>
              <select value={cfg.gemini.model} onChange={(e) => patchGemini({ model: e.target.value })} style={fieldStyle}>
                {AVAILABLE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-3)', lineHeight: 1.4 }}>
              Get a key at <span style={{ color: 'var(--accent)' }}>aistudio.google.com/apikey</span>.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <span style={labelStyle}>Base URL (OpenAI-compatible)</span>
              <input type="text" value={cfg.local.baseUrl} onChange={(e) => patchLocal({ baseUrl: e.target.value })} placeholder={DEFAULT_LOCAL_BASE_URL} style={fieldStyle} />
            </div>
            <div>
              <span style={labelStyle}>Model name</span>
              <input type="text" value={cfg.local.model} onChange={(e) => patchLocal({ model: e.target.value })} placeholder="llama3.1, qwen2.5, mistral…" style={fieldStyle} />
            </div>
            <div>
              <span style={labelStyle}>API key (optional)</span>
              <input type="password" value={cfg.local.apiKey} onChange={(e) => patchLocal({ apiKey: e.target.value })} placeholder="leave blank for Ollama / LM Studio" style={fieldStyle} />
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-3)', lineHeight: 1.4 }}>
              Works with Ollama (<span className="mono">…:11434/v1</span>), LM Studio (<span className="mono">…:1234/v1</span>), llama.cpp, vLLM, LocalAI. The server must allow CORS from this origin.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
          <button type="button" className="mtv-press" onClick={onClose} style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--text-2)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>Cancel</button>
          <button type="button" className="mtv-press" onClick={save} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, color: '#fff', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>Save</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsModal;
