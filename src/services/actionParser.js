// Pulls fenced ```action {json} ``` blocks out of an assistant reply.
// Returns the display text with blocks removed plus the parsed actions
// (in document order). Malformed JSON is flagged, never thrown.

const ACTION_BLOCK = /```action\s*([\s\S]*?)```/g;

export const extractActions = (text = '') => {
  const actions = [];
  let cleanText = text.replace(ACTION_BLOCK, (_, body) => {
    const raw = body.trim();
    try {
      const parsed = JSON.parse(raw);
      actions.push({
        tool: typeof parsed.tool === 'string' ? parsed.tool : null,
        args: parsed.args && typeof parsed.args === 'object' ? parsed.args : {},
        raw,
        error: typeof parsed.tool !== 'string'
      });
    } catch {
      actions.push({ tool: null, args: {}, raw, error: true });
    }
    return '';
  });
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
  return { cleanText, actions };
};
