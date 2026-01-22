// Tiny tool dispatcher. Executors are functions (args) => { message, undo? }
// (sync or async). run() never throws — it returns a uniform result object.

export const createActionRegistry = () => {
  const tools = new Map();

  const register = (map) => {
    Object.entries(map).forEach(([name, fn]) => tools.set(name, fn));
  };

  const unregister = (names) => {
    names.forEach((name) => tools.delete(name));
  };

  const run = async (tool, args = {}) => {
    const fn = tools.get(tool);
    if (!fn) {
      return { ok: false, message: `"${tool}" is not available here.`, undo: null };
    }
    try {
      const out = (await fn(args)) || {};
      // `detail` carries rich read-tool output to the model (via the agent loop's
      // observation) without bloating the short UI chip in `message`.
      return { ok: true, message: out.message || `Ran ${tool}.`, undo: out.undo || null, detail: out.detail || null };
    } catch (err) {
      return { ok: false, message: err.message || `Failed to run ${tool}.`, undo: null, detail: null };
    }
  };

  const has = (tool) => tools.has(tool);

  return { register, unregister, run, has };
};
