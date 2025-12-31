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
  buildRegionGrounding,
  buildOrientationGrounding,
  buildGraphGrounding
} from './llmClient';
import { extractActions } from './actionParser.js';
import { useAgentActions } from './agentActions.jsx';

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
    default:
      return state;
  }
}

export function TissueIntelligenceProvider({ openSettings, children }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ ...initialState }));
  const streamsRef = useRef({}); // threadId -> AbortController
  const { runAction, getSystemState } = useAgentActions();
  const undoStoreRef = useRef({}); // undoId -> () => void
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
      const priorTurns = [...thread.messages, userMsg];
      dispatch({ type: 'ADD_MESSAGE', id, message: userMsg });
      dispatch({ type: 'ADD_MESSAGE', id, message: { role: 'assistant', content: '' } });

      // Make every other resolved thread available for cross-region comparison
      // (e.g. asking Box 2's thread to contrast it with Box 1).
      const peers = Object.values(state.threads)
        .filter((t) => t.id !== id && t.grounding)
        .map((t) => ({ title: t.title, kind: t.kind, grounding: t.grounding }));

      // Live, full-app awareness (visible channels, selected regions, maximized
      // panel, active box, graph view) so the assistant reasons over real state.
      const systemState = getSystemState ? getSystemState() : '';

      const controller = new AbortController();
      streamsRef.current[id] = controller;
      dispatch({ type: 'PATCH_THREAD', id, patch: { busy: true, error: null } });

      streamChat({
        kind: thread.kind,
        grounding: thread.grounding,
        peers,
        systemState,
        messages: priorTurns,
        signal: controller.signal,
        onToken: (t) => dispatch({ type: 'APPEND_LAST_ASSISTANT', id, token: t })
      })
        .then(async () => {
          const thread = threadsRef.current[id];
          const last = thread?.messages?.[thread.messages.length - 1];
          const fullText = last?.content || '';
          const { cleanText, actions } = extractActions(fullText);

          const ran = [];
          for (const a of actions) {
            if (a.error || !a.tool) {
              ran.push({ ok: false, message: 'Could not parse an action.', undoId: null });
              continue;
            }
            const res = await runAction(a.tool, a.args);
            let undoId = null;
            if (res.undo) {
              undoId = `${id}-${Date.now()}-${ran.length}`;
              undoStoreRef.current[undoId] = res.undo;
            }
            ran.push({ ok: res.ok, message: res.message, undoId });
          }

          dispatch({ type: 'FINALIZE_ASSISTANT', id, content: cleanText, actions: ran });
          dispatch({ type: 'PATCH_THREAD', id, patch: { busy: false } });
        })
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
      openSettings: openSettings || (() => {})
    }),
    [state, open, openGeneral, close, setActive, setRect, removeThread, sendMessage, retryAnalysis, undoAction, openSettings]
  );

  return (
    <TissueIntelligenceContext.Provider value={value}>
      {children}
    </TissueIntelligenceContext.Provider>
  );
}
