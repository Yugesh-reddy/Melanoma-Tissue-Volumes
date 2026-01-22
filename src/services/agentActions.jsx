// Holds one app-wide action registry. Components register/unregister their
// executors; the AI layer calls runAction. No business logic lives here.

import React, { createContext, useContext, useRef, useMemo } from 'react';
import { createActionRegistry } from './actionRegistry.js';
import { validateToolCall } from './agentTools.js';

const AgentActionsContext = createContext(null);

export const useAgentActions = () => {
  const ctx = useContext(AgentActionsContext);
  if (!ctx) throw new Error('useAgentActions must be used within <AgentActionsProvider>');
  return ctx;
};

export function AgentActionsProvider({ children }) {
  const registryRef = useRef(null);
  if (!registryRef.current) registryRef.current = createActionRegistry();

  // State registry: components register a named getter returning a short string
  // describing their live state. getSystemState() aggregates them so the LLM has
  // full, current awareness of the app before it answers or acts.
  const stateRef = useRef({}); // key -> () => string

  const value = useMemo(() => {
    const reg = registryRef.current;
    return {
      registerActions: (map) => reg.register(map),
      unregisterActions: (names) => reg.unregister(names),
      // Validate + coerce args against the catalog schema BEFORE dispatch. This
      // is the central defense layer: unknown tools and bad/injected args are
      // rejected here and never reach an executor.
      runAction: (tool, args) => {
        const { ok, errors, args: safeArgs } = validateToolCall(tool, args);
        if (!ok) {
          return Promise.resolve({ ok: false, message: `Rejected ${tool}: ${errors.join('; ')}`, undo: null });
        }
        return reg.run(tool, safeArgs);
      },
      hasAction: (tool) => reg.has(tool),
      registerState: (key, getter) => { stateRef.current[key] = getter; },
      unregisterState: (key) => { delete stateRef.current[key]; },
      getSystemState: () => {
        const lines = [];
        Object.values(stateRef.current).forEach((getter) => {
          try {
            const line = getter();
            if (line) lines.push(line);
          } catch {
            // a getter throwing must not break a chat turn
          }
        });
        return lines.join('\n');
      }
    };
  }, []);

  return (
    <AgentActionsContext.Provider value={value}>
      {children}
    </AgentActionsContext.Provider>
  );
}
