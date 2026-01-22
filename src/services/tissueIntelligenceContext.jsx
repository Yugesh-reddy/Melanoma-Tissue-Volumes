// Tissue Intelligence: a single, app-wide, summonable AI surface.
//
// Any component opens it with a context *descriptor* describing what to ground
// on. The provider keeps one floating window plus a map of per-context threads
// (each box, the orientation view, the graph view) so switching contexts never
// loses a conversation. Grounding strings are built from the deterministic
// engines so the LLM only ever explains computed numbers.

import React, { createContext, useContext, useReducer, useRef, useCallback, useMemo, useEffect } from 'react';
import { isConfigured } from './llmConfig';
import {
  streamAnalysis,
  streamChat,
  composeChatSystem,
  buildRegionGrounding,
  buildOrientationGrounding,
  buildGraphGrounding
} from './llmClient';
import { extractActions } from './actionParser.js';
import { useAgentActions } from './agentActions.jsx';
import { isToolAllowed, isDestructive, validateToolCall } from './agentTools.js';
import { logTurn } from './agentTrace.js';
import { getConfig } from './llmConfig';

const TissueIntelligenceContext = createContext(null);

export const useTissueIntelligence = () => {
  const ctx = useContext(TissueIntelligenceContext);
  if (!ctx) throw new Error('useTissueIntelligence must be used within <TissueIntelligenceProvider>');
  return ctx;
};

// Build the LLM grounding string for a context kind from its resolved data.
const groundingFor = (kind, data) => {
  if (kind === 'general') {
    return 'No specific region or view is in focus. You are the app-wide assistant for a 3D ' +
      'multiplexed-imaging melanoma viewer: help the user explore the data, answer questions, and ' +
      'take actions on their behalf (channels, regions, camera, panels) using the available tools.';
  }
  if (kind === 'orientation') return buildOrientationGrounding(data.dirStats || []);
  if (kind === 'graph') return buildGraphGrounding(data.summary);
  return buildRegionGrounding(data.summary, data.engine);
};

const defaultRect = () => {
  const w = 440;
  const h = 540;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  return { x: Math.max(16, vw - w - 28), y: 84, w, h };
};

const initialState = {
  isOpen: false,
  windowRect: defaultRect(),
  activeContextId: null,
  threads: {} // id -> thread
};

function reducer(state, action) {
  switch (action.type) {
    case 'OPEN':
      return { ...state, isOpen: true };
    case 'CLOSE':
      return { ...state, isOpen: false };
    case 'SET_ACTIVE':
      return { ...state, activeContextId: action.id };
    case 'SET_RECT':
      return { ...state, windowRect: { ...state.windowRect, ...action.rect } };
    case 'UPSERT_THREAD':
      return { ...state, threads: { ...state.threads, [action.thread.id]: action.thread } };
    case 'PATCH_THREAD': {
      const prev = state.threads[action.id];
      if (!prev) return state;
      return { ...state, threads: { ...state.threads, [action.id]: { ...prev, ...action.patch } } };
    }
    case 'APPEND_NARRATIVE': {
      const prev = state.threads[action.id];
      if (!prev) return state;
      return {
        ...state,
        threads: { ...state.threads, [action.id]: { ...prev, narrative: (prev.narrative || '') + action.token } }
      };
    }
    case 'ADD_MESSAGE': {
      const prev = state.threads[action.id];
      if (!prev) return state;
      return {
        ...state,
        threads: { ...state.threads, [action.id]: { ...prev, messages: [...prev.messages, action.message] } }
      };
    }
    case 'APPEND_LAST_ASSISTANT': {
      const prev = state.threads[action.id];
      if (!prev || prev.messages.length === 0) return state;
      const messages = prev.messages.slice();
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, content: last.content + action.token };
      return { ...state, threads: { ...state.threads, [action.id]: { ...prev, messages } } };
    }
    case 'REMOVE_THREAD': {
      const threads = { ...state.threads };
      delete threads[action.id];
      return { ...state, threads };
    }
    case 'FINALIZE_ASSISTANT': {
      const prev = state.threads[action.id];
      if (!prev || prev.messages.length === 0) return state;
      const messages = prev.messages.slice();
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, content: action.content, actions: action.actions };
      return { ...state, threads: { ...state.threads, [action.id]: { ...prev, messages } } };
    }
    case 'PATCH_ACTION': {
      const prev = state.threads[action.id];
      if (!prev) return state;
      const messages = prev.messages.map((m) => {
        if (!Array.isArray(m.actions) || !m.actions.some((a) => a.confirmId === action.confirmId)) return m;
        return { ...m, actions: m.actions.map((a) => (a.confirmId === action.confirmId ? { ...a, ...action.patch } : a)) };
      });
      return { ...state, threads: { ...state.threads, [action.id]: { ...prev, messages } } };
    }
    default:
      return state;
  }
}

export function TissueIntelligenceProvider({ openSettings, children }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ ...initialState }));
  const streamsRef = useRef({}); // threadId -> AbortController
  const { runAction, getSystemState } = useAgentActions();
  const undoStoreRef = useRef({}); // undoId -> () => void
  const pendingStoreRef = useRef({}); // confirmId -> { threadId, tool, args }
  const threadsRef = useRef(state.threads);
  useEffect(() => { threadsRef.current = state.threads; }, [state.threads]);

  const abortThread = useCallback((id) => {
    const c = streamsRef.current[id];
    if (c) {
      c.abort();
      delete streamsRef.current[id];
    }
  }, []);

  // Stream the initial sectioned analysis for a freshly-resolved thread.
  const runAnalysis = useCallback((id, kind, grounding) => {
    if (!isConfigured()) {
      dispatch({ type: 'PATCH_THREAD', id, patch: { status: 'ready' } });
      return;
    }
    const controller = new AbortController();
    streamsRef.current[id] = controller;
    dispatch({ type: 'PATCH_THREAD', id, patch: { status: 'analyzing', narrative: '', error: null } });
    streamAnalysis({
      kind,
      grounding,
      signal: controller.signal,
      onToken: (t) => dispatch({ type: 'APPEND_NARRATIVE', id, token: t })
    })
      .then(() => dispatch({ type: 'PATCH_THREAD', id, patch: { status: 'ready' } }))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        dispatch({ type: 'PATCH_THREAD', id, patch: { status: 'ready', error: err.message } });
      })
      .finally(() => {
        if (streamsRef.current[id] === controller) delete streamsRef.current[id];
      });
  }, []);

  const open = useCallback(
    (descriptor) => {
      const { id, kind, title, resolve } = descriptor;
      dispatch({ type: 'OPEN' });
      dispatch({ type: 'SET_ACTIVE', id });

      // Re-opening an existing thread just focuses it.
      if (state.threads[id]) return;

      dispatch({
        type: 'UPSERT_THREAD',
        thread: { id, kind, title, status: 'resolving', data: null, grounding: '', narrative: '', messages: [], error: null }
      });

      Promise.resolve()
        .then(() => resolve())
        .then((data) => {
          const grounding = groundingFor(kind, data);
          dispatch({ type: 'PATCH_THREAD', id, patch: { data, grounding } });
          // The general assistant has no deterministic report to stream — it just
          // opens ready to chat / act. Grounded contexts auto-run their analysis.
          if (kind === 'general') {
            dispatch({ type: 'PATCH_THREAD', id, patch: { status: 'ready' } });
          } else {
            runAnalysis(id, kind, grounding);
          }
        })
        .catch((err) => {
          dispatch({ type: 'PATCH_THREAD', id, patch: { status: 'ready', error: err.message } });
        });
    },
    [state.threads, runAnalysis]
  );

  // Open the general, app-wide assistant (not tied to a region/box/view).
  const openGeneral = useCallback(() => {
    open({ id: 'general', kind: 'general', title: 'Tissue Intelligence', resolve: async () => ({}) });
  }, [open]);

  const close = useCallback(() => dispatch({ type: 'CLOSE' }), []);
  const setActive = useCallback((id) => dispatch({ type: 'SET_ACTIVE', id }), []);
  const setRect = useCallback((rect) => dispatch({ type: 'SET_RECT', rect }), []);

  const removeThread = useCallback(
    (id) => {
      abortThread(id);
      dispatch({ type: 'REMOVE_THREAD', id });
    },
    [abortThread]
  );

  const sendMessage = useCallback(
    (id, text) => {
      const thread = state.threads[id];
      if (!thread || !text.trim() || !isConfigured()) return;

      abortThread(id);
      const userMsg = { role: 'user', content: text.trim() };
      dispatch({ type: 'ADD_MESSAGE', id, message: userMsg });

      // Make every other resolved thread available for cross-region comparison.
      const peers = Object.values(state.threads)
        .filter((t) => t.id !== id && t.grounding)
        .map((t) => ({ title: t.title, kind: t.kind, grounding: t.grounding }));

      const controller = new AbortController();
      streamsRef.current[id] = controller;
      dispatch({ type: 'PATCH_THREAD', id, patch: { busy: true, error: null } });

      // C1: bounded plan→act→observe loop. The model may end a step with the
      // [[continue]] marker to receive tool results + refreshed app state and act
      // again, up to MAX_STEPS. Single-action requests omit the marker and finish
      // in one step (no extra round-trip).
      const MAX_STEPS = 4;
      const CONTINUE = /\[\[continue\]\]/i;

      const runStep = async (modelMessages, step) => {
        dispatch({ type: 'ADD_MESSAGE', id, message: { role: 'assistant', content: '' } });

        // Live, full-app awareness, re-read each step (state may have changed).
        const systemState = getSystemState ? getSystemState() : '';
        const startedAt = Date.now();

        await streamChat({
          kind: thread.kind,
          title: thread.title,
          grounding: thread.grounding,
          peers,
          systemState,
          messages: modelMessages,
          signal: controller.signal,
          onToken: (t) => dispatch({ type: 'APPEND_LAST_ASSISTANT', id, token: t })
        });

        const t = threadsRef.current[id];
        const last = t?.messages?.[t.messages.length - 1];
        const fullText = last?.content || '';
        const wantsContinue = CONTINUE.test(fullText);
        const { cleanText, actions } = extractActions(fullText.replace(CONTINUE, '').trim());

        const ran = [];
        for (const a of actions) {
          if (a.error || !a.tool) {
            ran.push({ ok: false, message: 'Could not parse an action.', undoId: null });
            continue;
          }
          // Per-context allowlist: a box/orientation/graph thread may not run
          // app-wide destructive tools.
          if (!isToolAllowed(thread.kind, a.tool)) {
            ran.push({ ok: false, tool: a.tool, undoId: null,
              message: `"${a.tool}" isn't allowed in this ${thread.kind} context — use the general assistant for app-wide actions.` });
            continue;
          }
          // Destructive tools require explicit confirmation before executing.
          if (isDestructive(a.tool)) {
            const v = validateToolCall(a.tool, a.args);
            if (!v.ok) {
              ran.push({ ok: false, tool: a.tool, undoId: null, message: `Rejected ${a.tool}: ${v.errors.join('; ')}` });
              continue;
            }
            const confirmId = `${id}-${Date.now()}-${ran.length}`;
            pendingStoreRef.current[confirmId] = { threadId: id, tool: a.tool, args: v.args };
            ran.push({ ok: true, pending: true, confirmId, tool: a.tool, undoId: null,
              message: `Confirm: ${a.tool}${v.args && Object.keys(v.args).length ? ' ' + JSON.stringify(v.args) : ''}` });
            continue;
          }
          const res = await runAction(a.tool, a.args);
          let undoId = null;
          if (res.undo) {
            undoId = `${id}-${Date.now()}-${ran.length}`;
            undoStoreRef.current[undoId] = res.undo;
          }
          ran.push({ ok: res.ok, message: res.message, undoId, tool: a.tool, detail: res.detail || null });
        }

        dispatch({ type: 'FINALIZE_ASSISTANT', id, content: cleanText, actions: ran });

        let provider = 'unknown';
        try { provider = getConfig().provider; } catch { /* config may be unset */ }
        logTurn({
          provider, threadId: id, kind: thread?.kind, step,
          userText: step === 0 ? text.trim() : '(continued)',
          systemState,
          prompt: composeChatSystem({ kind: thread.kind, title: thread.title, grounding: thread.grounding, peers, systemState }),
          reply: cleanText,
          actions: ran.map((r) => ({ tool: r.tool || null, ok: r.ok, message: r.message, undoId: r.undoId || null, confirmId: r.confirmId || null })),
          latencyMs: Date.now() - startedAt
        });

        // Observe → continue only if the model asked to, we're under the cap, and
        // nothing is awaiting the user's confirmation.
        if (wantsContinue && step + 1 < MAX_STEPS && !ran.some((r) => r.pending)) {
          const results = ran.length
            ? ran.map((r) => `- ${r.tool || 'action'}: ${r.ok ? 'OK' : 'FAILED'} — ${r.detail || r.message}`).join('\n')
            : '(no actions taken)';
          const observation =
            `=== TOOL RESULTS ===\n${results}\n\n` +
            `=== UPDATED APP STATE ===\n${getSystemState ? getSystemState() : ''}\n\n` +
            `If the user's request is now fully satisfied, reply with a brief confirmation and NO action block. Otherwise take the next step.`;
          const nextMessages = [
            ...modelMessages,
            { role: 'assistant', content: cleanText || '(took actions)' },
            { role: 'user', content: observation }
          ];
          await runStep(nextMessages, step + 1);
        }
      };

      runStep([...thread.messages, userMsg], 0)
        .then(() => dispatch({ type: 'PATCH_THREAD', id, patch: { busy: false } }))
        .catch((err) => {
          if (err.name === 'AbortError') return;
          dispatch({ type: 'APPEND_LAST_ASSISTANT', id, token: `\n\n_${err.message}_` });
          dispatch({ type: 'PATCH_THREAD', id, patch: { busy: false, error: err.message } });
        })
        .finally(() => {
          if (streamsRef.current[id] === controller) delete streamsRef.current[id];
        });
    },
    [state.threads, abortThread, runAction, getSystemState]
  );

  const retryAnalysis = useCallback(
    (id) => {
      const thread = state.threads[id];
      if (thread && thread.grounding) runAnalysis(id, thread.kind, thread.grounding);
    },
    [state.threads, runAnalysis]
  );

  const undoAction = useCallback((undoId) => {
    const fn = undoStoreRef.current[undoId];
    if (fn) { fn(); delete undoStoreRef.current[undoId]; }
  }, []);

  // Confirm a pending destructive action: run it now and replace the chip.
  const confirmAction = useCallback(async (confirmId) => {
    const p = pendingStoreRef.current[confirmId];
    if (!p) return;
    delete pendingStoreRef.current[confirmId];
    const res = await runAction(p.tool, p.args);
    let undoId = null;
    if (res.undo) {
      undoId = `undo-${confirmId}`;
      undoStoreRef.current[undoId] = res.undo;
    }
    dispatch({ type: 'PATCH_ACTION', id: p.threadId, confirmId,
      patch: { pending: false, ok: res.ok, message: res.message, undoId } });
  }, [runAction]);

  const cancelAction = useCallback((confirmId) => {
    const p = pendingStoreRef.current[confirmId];
    if (!p) return;
    delete pendingStoreRef.current[confirmId];
    dispatch({ type: 'PATCH_ACTION', id: p.threadId, confirmId,
      patch: { pending: false, ok: false, cancelled: true, message: 'Cancelled' } });
  }, []);

  const value = useMemo(
    () => ({
      isOpen: state.isOpen,
      windowRect: state.windowRect,
      activeContextId: state.activeContextId,
      threads: state.threads,
      threadOrder: Object.keys(state.threads),
      activeThread: state.activeContextId ? state.threads[state.activeContextId] : null,
      open,
      openGeneral,
      close,
      setActive,
      setRect,
      removeThread,
      sendMessage,
      retryAnalysis,
      undoAction,
      confirmAction,
      cancelAction,
      openSettings: openSettings || (() => {})
    }),
    [state, open, openGeneral, close, setActive, setRect, removeThread, sendMessage, retryAnalysis, undoAction, confirmAction, cancelAction, openSettings]
  );

  return (
    <TissueIntelligenceContext.Provider value={value}>
      {children}
    </TissueIntelligenceContext.Provider>
  );
}
