// Holds one app-wide action registry. Components register/unregister their
// executors; the AI layer calls runAction. No business logic lives here.

import React, { createContext, useContext, useRef, useMemo } from 'react';
import { createActionRegistry } from './actionRegistry.js';

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
      runAction: (tool, args) => reg.run(tool, args),
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
