// Per-turn agent trace: a capped in-memory ring buffer recording what the user
// asked, what the model produced, which actions were parsed and executed, and
// how long it took. This is the substrate for debugging AND the eval harness
// (F2). In the browser it is also exposed on window.__agentTraces for
// inspection during a session.

const MAX_TRACES = 200;
const traces = [];
let echo = false;

/** Toggle console echo of each recorded turn (dev debugging). */
export const setTraceEcho = (on) => { echo = !!on; };

/**
 * Record one assistant turn.
 * @param {object} record { provider, threadId, kind, userText, systemState,
 *   reply, actions: [{tool, args, ok, message}], latencyMs }
 */
export const logTurn = (record) => {
  const entry = { ts: Date.now(), ...record };
  traces.push(entry);
  while (traces.length > MAX_TRACES) traces.shift();
  if (echo && typeof console !== 'undefined') console.debug('[agent-trace]', entry);
  return entry;
};

export const getTraces = () => traces.slice();
export const clearTraces = () => { traces.length = 0; };
export const exportTraces = () => JSON.stringify(traces, null, 2);

if (typeof window !== 'undefined') {
  window.__agentTraces = { get: getTraces, clear: clearTraces, export: exportTraces, setEcho: setTraceEcho };
}
