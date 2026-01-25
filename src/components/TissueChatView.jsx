// Shared chat body for Tissue Intelligence — rendered by the floating window
// and (in future) by a docked sidebar. Reads all state from the context directly.

import React, { useState, useEffect } from 'react';
import { useTissueIntelligence } from '../services/tissueIntelligenceContext';
import { isConfigured } from '../services/llmConfig';
import RegionFindings from './RegionFindings';
import MarkdownLite from './MarkdownLite';

// ---------------------------------------------------------------------------
// Local helpers (chat-body only)
// ---------------------------------------------------------------------------

const Skeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    {[92, 78, 85, 60].map((w, i) => (
      <div key={i} style={{ height: '10px', width: `${w}%`, borderRadius: '4px', background: 'linear-gradient(90deg, #14161d 25%, #1e2230 50%, #14161d 75%)', backgroundSize: '200% 100%', animation: 'mtv-shimmer 1.2s ease-in-out infinite' }} />
    ))}
  </div>
);

// Compact card showing the resolved grounding for non-region contexts.
const ContextCard = ({ thread }) => {
  if (thread.kind === 'orientation') {
    const stats = thread.data?.dirStats || [];
    return (
      <div style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-lg)', padding: '11px 12px', background: 'var(--bg-2)' }}>
        <div style={{ fontSize: '9.5px', letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600, marginBottom: '9px' }}>
          Per-marker orientation
        </div>
        {stats.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: '11px' }}>No visible channels with enough signal to compute a direction.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {stats.map((s) => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px' }}>
                <span style={{ flex: 1, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span className="mono" style={{ color: 'var(--text-3)', fontSize: '10px' }}>axis {s.dominantAxis}</span>
                <span style={{ width: '64px', height: '6px', background: 'var(--bg-3)', borderRadius: '3px', overflow: 'hidden', flexShrink: 0 }}>
                  <span style={{ display: 'block', width: `${Math.max(2, s.coherence * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #1C7DFF, #9168C0)', borderRadius: '3px' }} />
                </span>
                <span className="mono" style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: '11px', width: '34px', textAlign: 'right' }}>{s.coherence.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '9px', lineHeight: 1.4 }}>
          Coherence 0–1: 1 = strongly aligned, 0 = isotropic.
        </div>
      </div>
    );
  }

  // graph kind
  const markers = thread.data?.summary?.markers || [];
  return (
    <div style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-lg)', padding: '11px 12px', background: 'var(--bg-2)' }}>
      <div style={{ fontSize: '9.5px', letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600, marginBottom: '9px' }}>
        Marker intensity distribution
      </div>
      {markers.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: '11px' }}>No marker data for the charted region.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {markers.slice(0, 14).map((m) => (
            <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px' }}>
              <span style={{ flex: 1, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <span style={{ width: '72px', height: '6px', background: 'var(--bg-3)', borderRadius: '3px', overflow: 'hidden', flexShrink: 0 }}>
                <span style={{ display: 'block', width: `${Math.max(2, (m.relativeExpression || 0) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), #9168C0)', borderRadius: '3px' }} />
              </span>
              <span className="mono" style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: '11px', width: '34px', textAlign: 'right' }}>{(m.relativeExpression || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Quick-start prompts shown above the composer until the user sends their first
// message. A deliberate mix of agentic actions (the AI executes them) and
// questions, tailored to each context kind.
const SUGGESTIONS = {
  general: [
    'Select tumor + immune regions',
    'Add the CD8a channel',
    'Switch to two-region mode',
    'Maximize the Direction View',
    'What markers am I currently viewing?'
  ],
  region: [
    'Is this region tumor or immune?',
    'Add the PDL1 channel',
    'Compare this with another box',
    'Summarize the key findings'
  ],
  orientation: [
    'Which markers are most aligned?',
    'Show the top view',
    'Reset the camera',
    'What do these directions suggest?'
  ],
  graph: [
    'Which markers are most variable?',
    'What stands out in these distributions?',
    'Add a checkpoint marker'
  ]
};

// ---------------------------------------------------------------------------
// TissueChatView
// ---------------------------------------------------------------------------

const TissueChatView = ({ style, onSelectContext }) => {
  const {
    threads, threadOrder, activeThread, activeContextId,
    setActive, removeThread, sendMessage, retryAnalysis, openSettings, undoAction,
    confirmAction, cancelAction
  } = useTissueIntelligence();

  // In the expanded dock, selecting a context also shifts the maximized panel;
  // elsewhere (the floating window) it just switches the active thread.
  const selectContext = onSelectContext || setActive;
  const configured = isConfigured();
  const [draft, setDraft] = useState('');

  // Reset the draft when switching contexts.
  useEffect(() => { setDraft(''); }, [activeContextId]);

  const handleSend = () => {
    if (!draft.trim() || !activeThread || activeThread.busy) return;
    sendMessage(activeThread.id, draft);
    setDraft('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, ...style }}>

      {/* Context switcher */}
      {threadOrder.length > 0 && (
        <div className="mtv-no-scrollbar" data-no-drag style={{ display: 'flex', gap: '5px', padding: '6px 8px', overflowX: 'auto', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
          {threadOrder.map((id) => {
            const t = threads[id];
            const active = id === activeContextId;
            return (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                <button
                  type="button"
                  className="mtv-press"
                  onClick={() => selectContext(id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '3px 8px', fontSize: '11px', fontWeight: active ? 600 : 500,
                    color: active ? 'var(--text-1)' : 'var(--text-3)',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >
                  {t.title}
                  <span
                    onClick={(e) => { e.stopPropagation(); removeThread(id); }}
                    title="Close thread"
                    style={{ color: 'var(--text-3)', fontSize: '12px', lineHeight: 1, cursor: 'pointer' }}
                  >
                    ×
                  </span>
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {!activeThread ? (
          <div style={{ color: 'var(--text-3)', fontSize: '12px' }}>Open a context to begin.</div>
        ) : (
          <>
            {activeThread.status === 'resolving' && <Skeleton />}

            {activeThread.kind === 'general' && activeThread.messages.length === 0 && (
              <div style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.5 }}>
                Hi — I'm your Tissue Intelligence assistant. Ask me anything about the data, or tell me
                to do something (add a channel, select regions, change the view). Try a suggestion below.
              </div>
            )}

            {activeThread.kind === 'region' && activeThread.data?.engine && (
              <RegionFindings engine={activeThread.data.engine} />
            )}
            {(activeThread.kind === 'orientation' || activeThread.kind === 'graph') && activeThread.data && (
              <ContextCard thread={activeThread} />
            )}

            {/* Streamed narrative */}
            {activeThread.narrative ? (
              <div style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.5 }}>
                <MarkdownLite text={activeThread.narrative} />
              </div>
            ) : activeThread.status === 'analyzing' ? (
              <div style={{ color: 'var(--text-3)', fontSize: '11px' }}>Analyzing…</div>
            ) : null}

            {activeThread.error && (
              <div style={{ fontSize: '11px', color: 'var(--tme-hot)', lineHeight: 1.4 }}>
                {activeThread.error}{' '}
                {configured && activeThread.data && (
                  <button type="button" data-no-drag onClick={() => retryAnalysis(activeThread.id)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}>retry</button>
                )}
              </div>
            )}

            {/* Chat turns */}
            {activeThread.messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: m.role === 'user' ? 'var(--accent)' : 'var(--text-3)' }}>
                  {m.role === 'user' ? 'You' : 'Tissue Intelligence'}
                </span>
                <div style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.5 }}>
                  {m.role === 'assistant' ? (
                    <>
                      <MarkdownLite text={m.content || '…'} />
                      {Array.isArray(m.actions) && m.actions.map((a, ai) => {
                        const pending = a.pending;
                        const accent = pending ? 'rgba(250,204,21,0.5)' : a.ok ? 'rgba(74,222,128,0.4)' : 'rgba(255,100,100,0.4)';
                        const bg = pending ? 'rgba(250,204,21,0.12)' : a.ok ? 'rgba(74,222,128,0.12)' : 'rgba(255,100,100,0.12)';
                        return (
                          <div key={ai} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            marginTop: '6px', padding: '4px 8px', borderRadius: '6px',
                            fontSize: '11px', background: bg, border: `1px solid ${accent}`, color: 'var(--text-1)'
                          }}>
                            <span>{pending ? '⚠' : a.ok ? '✓' : '⚠'} {a.message}</span>
                            {pending && (
                              <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                                <button onClick={() => confirmAction(a.confirmId)} style={{ cursor: 'pointer', fontSize: '11px', color: '#fff', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '4px', padding: '1px 8px' }}>Proceed</button>
                                <button onClick={() => cancelAction(a.confirmId)} style={{ cursor: 'pointer', fontSize: '11px', color: 'var(--text-2)', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', padding: '1px 8px' }}>Cancel</button>
                              </span>
                            )}
                            {!pending && a.undoId && (
                              <button
                                onClick={() => undoAction(a.undoId)}
                                style={{
                                  marginLeft: 'auto', cursor: 'pointer', fontSize: '11px',
                                  background: 'transparent', color: 'var(--accent)',
                                  border: '1px solid var(--border)', borderRadius: '4px',
                                  padding: '1px 8px'
                                }}
                              >
                                Undo
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </>
                  ) : m.content}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Suggested actions — until the user sends their first message */}
      {configured && activeThread && !activeThread.messages.some((m) => m.role === 'user') && (
        <div data-no-drag style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 8px 0', flexShrink: 0 }}>
          {(SUGGESTIONS[activeThread.kind] || SUGGESTIONS.general).map((s) => (
            <button
              key={s}
              type="button"
              className="mtv-press"
              onClick={() => { if (!activeThread.busy) sendMessage(activeThread.id, s); }}
              disabled={activeThread.busy}
              style={{
                fontSize: '11px', lineHeight: 1.2, textAlign: 'left',
                padding: '5px 9px', borderRadius: '999px', cursor: activeThread.busy ? 'default' : 'pointer',
                color: 'var(--text-2)', background: 'var(--bg-1)',
                border: '1px solid var(--border)'
              }}
              onMouseEnter={(e) => { if (!activeThread.busy) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-1)'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)'; }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div data-no-drag style={{ borderTop: '1px solid var(--border)', padding: '8px', flexShrink: 0, background: 'var(--bg-2)' }}>
        {configured ? (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={activeThread ? 'Ask about this context…' : 'Open a context first'}
              disabled={!activeThread || activeThread.busy}
              rows={1}
              style={{
                flex: 1, resize: 'none', maxHeight: '90px', padding: '7px 9px', fontSize: '12px',
                fontFamily: 'var(--font-body)', color: 'var(--text-1)', background: 'var(--bg-1)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', outline: 'none'
              }}
            />
            <button
              type="button"
              className="mtv-press"
              onClick={handleSend}
              disabled={!draft.trim() || !activeThread || activeThread.busy}
              style={{
                padding: '7px 13px', fontSize: '12px', fontWeight: 600,
                color: '#fff', background: draft.trim() && activeThread && !activeThread.busy ? 'var(--accent)' : 'var(--bg-3)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                cursor: draft.trim() && activeThread && !activeThread.busy ? 'pointer' : 'not-allowed'
              }}
            >
              {activeThread?.busy ? '…' : 'Send'}
            </button>
          </div>
        ) : (
          <button type="button" className="mtv-press" onClick={openSettings} style={{ width: '100%', padding: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-1)', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
            Configure a model in Settings to chat
          </button>
        )}
      </div>

    </div>
  );
};

export default TissueChatView;
