# Agentic Tissue AI — Phase 1 (Agentic Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Tissue Intelligence assistant *act* — when the user types "add CD8a" or "select tumor + immune", the app actually changes channels/regions, shows a result chip, and offers Undo.

**Architecture:** The LLM emits fenced ` ```action {json} ``` ` blocks. A pure parser extracts them; a pure action registry dispatches each to an executor that mutates app state and returns an `undo()` closure. Channel/Region executors are registered by `ChannelSelection`/`Region_Selection` (where that state logic lives) into a React context. The chat view renders a result chip + Undo per executed action.

**Tech Stack:** React 18, Vite, plain JS ES modules, `node --test` for pure-module unit tests (no DOM test env — React wiring is verified manually).

**Scope:** Phase 1 = channels + regions only. Phase 2 (right-side dock, Direction/Local resize-&-fit, camera/panel-nav tools) is a separate follow-up plan. Spec: `docs/superpowers/specs/2026-06-14-agentic-tissue-ai-design.md`.

---

## File structure

New (pure, unit-tested):
- `src/services/actionParser.js` (+ `.test.js`) — extract action blocks from text
- `src/services/channelCatalog.js` (+ `.test.js`) — marker-name → channel index lookup
- `src/services/actionRegistry.js` (+ `.test.js`) — register / run / undo dispatch core
- `src/services/agentTools.js` (+ `.test.js`) — tool catalog + system-prompt builder

New (React):
- `src/services/agentActions.jsx` — context wrapping one registry instance

Modified:
- `src/services/llmClient.js` — compose chat system prompt with the tool catalog (refactor to a pure `composeChatSystem`)
- `src/services/tissueIntelligenceContext.jsx` — after a turn completes, run parsed actions, attach results+undo to the message
- `src/App.jsx` — wrap tree in `AgentActionsProvider`; expose `agentSetChannels`
- `src/components/ChannelSelection.jsx` — register channel actions
- `src/components/Region_Selection.jsx` — register region actions
- `src/components/TissueIntelligenceWindow.jsx` — render action result chips + Undo

---

## Task 1: Action parser

**Files:**
- Create: `src/services/actionParser.js`
- Test: `src/services/actionParser.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/services/actionParser.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractActions } from './actionParser.js';

test('extracts a single action block and strips it from text', () => {
  const input = 'Enabling immune markers.\n```action\n{"tool":"enableChannels","args":{"markers":["CD8a","CD4"]}}\n```\nDone.';
  const { cleanText, actions } = extractActions(input);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, 'enableChannels');
  assert.deepEqual(actions[0].args, { markers: ['CD8a', 'CD4'] });
  assert.ok(!cleanText.includes('```action'));
  assert.ok(cleanText.includes('Enabling immune markers.'));
  assert.ok(cleanText.includes('Done.'));
});

test('extracts multiple blocks in order', () => {
  const input = '```action\n{"tool":"addChannel","args":{"marker":"PDL1"}}\n```\n```action\n{"tool":"applyFilter","args":{}}\n```';
  const { actions } = extractActions(input);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].tool, 'addChannel');
  assert.equal(actions[1].tool, 'applyFilter');
});

test('malformed JSON is flagged, not thrown', () => {
  const input = '```action\n{not json}\n```';
  const { actions } = extractActions(input);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].error, true);
  assert.equal(actions[0].tool, null);
});

test('no blocks returns original text and empty actions', () => {
  const { cleanText, actions } = extractActions('just prose');
  assert.equal(cleanText, 'just prose');
  assert.deepEqual(actions, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/actionParser.test.js`
Expected: FAIL — `extractActions` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/actionParser.js
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
  // Collapse the blank lines left behind by removed blocks.
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
  return { cleanText, actions };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/actionParser.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/actionParser.js src/services/actionParser.test.js
git commit -m "feat: action block parser for agentic Tissue AI"
```

---

## Task 2: Channel catalog (marker → index)

**Files:**
- Create: `src/services/channelCatalog.js`
- Test: `src/services/channelCatalog.test.js`

Background: `src/channel_names.json` is an array of marker names indexed by channel index. Some entries are duplicated ("Hoechst") or suffixed ("PD1 (do not use)"). The lookup must be case-insensitive, ignore a trailing "(do not use)", and return the FIRST matching index.

- [ ] **Step 1: Write the failing test**

```js
// src/services/channelCatalog.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { findChannelIndex, normalizeMarker } from './channelCatalog.js';

test('finds an exact marker index', () => {
  assert.equal(findChannelIndex('MART1'), 3);
});

test('is case-insensitive', () => {
  assert.equal(findChannelIndex('sox10'), findChannelIndex('SOX10'));
  assert.ok(findChannelIndex('sox10') >= 0);
});

test('ignores a "(do not use)" suffix on the catalog side', () => {
  // 'PD1 (do not use)' exists in the catalog; asking for 'PD1' should find it.
  assert.ok(findChannelIndex('PD1') >= 0);
});

test('returns -1 for an unknown marker', () => {
  assert.equal(findChannelIndex('NOTAMARKER'), -1);
});

test('normalizeMarker strips suffix and lowercases', () => {
  assert.equal(normalizeMarker('PD1 (do not use)'), 'pd1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/channelCatalog.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/channelCatalog.js
// Maps a human marker name (as the AI or user would say it) to its channel
// index in channel_names.json. Tolerant of case and "(do not use)" suffixes.

import channelNames from '../channel_names.json';

export const normalizeMarker = (name = '') =>
  name.toLowerCase().replace(/\(do not use\)/g, '').trim();

export const findChannelIndex = (marker) => {
  const target = normalizeMarker(marker);
  if (!target) return -1;
  return channelNames.findIndex((n) => normalizeMarker(n) === target);
};

export const channelNameAt = (index) => channelNames[index] ?? `Channel ${index}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/channelCatalog.test.js`
Expected: PASS (5 tests).

> If `findChannelIndex('MART1')` is not `3`, update the test's expected index to match `channel_names.json` (the file is the source of truth) — do not change the lookup logic.

- [ ] **Step 5: Commit**

```bash
git add src/services/channelCatalog.js src/services/channelCatalog.test.js
git commit -m "feat: marker-name to channel-index catalog lookup"
```

---

## Task 3: Action registry core

**Files:**
- Create: `src/services/actionRegistry.js`
- Test: `src/services/actionRegistry.test.js`

The registry is a plain object factory (no React) so it is unit-testable. Executors return `{ message, undo }`. `run` snapshots nothing itself — each executor owns its undo.

- [ ] **Step 1: Write the failing test**

```js
// src/services/actionRegistry.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionRegistry } from './actionRegistry.js';

test('runs a registered tool and returns its result', async () => {
  const reg = createActionRegistry();
  let applied = null;
  reg.register({
    setColor: (args) => { applied = args.color; return { message: `color ${args.color}` }; }
  });
  const res = await reg.run('setColor', { color: 'cyan' });
  assert.equal(res.ok, true);
  assert.equal(res.message, 'color cyan');
  assert.equal(applied, 'cyan');
});

test('unknown tool returns a graceful error result', async () => {
  const reg = createActionRegistry();
  const res = await reg.run('nope', {});
  assert.equal(res.ok, false);
  assert.match(res.message, /not available/i);
});

test('executor throw is caught and reported', async () => {
  const reg = createActionRegistry();
  reg.register({ boom: () => { throw new Error('kaboom'); } });
  const res = await reg.run('boom', {});
  assert.equal(res.ok, false);
  assert.match(res.message, /kaboom/);
});

test('unregister removes tools', async () => {
  const reg = createActionRegistry();
  reg.register({ x: () => ({ message: 'x' }) });
  reg.unregister(['x']);
  const res = await reg.run('x', {});
  assert.equal(res.ok, false);
});

test('run carries the executor undo through', async () => {
  const reg = createActionRegistry();
  let undone = false;
  reg.register({ t: () => ({ message: 'ok', undo: () => { undone = true; } }) });
  const res = await reg.run('t', {});
  res.undo();
  assert.equal(undone, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/actionRegistry.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/actionRegistry.js
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
      return { ok: true, message: out.message || `Ran ${tool}.`, undo: out.undo || null };
    } catch (err) {
      return { ok: false, message: err.message || `Failed to run ${tool}.`, undo: null };
    }
  };

  const has = (tool) => tools.has(tool);

  return { register, unregister, run, has };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/actionRegistry.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/actionRegistry.js src/services/actionRegistry.test.js
git commit -m "feat: action registry dispatch core"
```

---

## Task 4: Tool catalog + prompt builder

**Files:**
- Create: `src/services/agentTools.js`
- Test: `src/services/agentTools.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/services/agentTools.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_CATALOG, buildToolCatalogPrompt } from './agentTools.js';

test('catalog lists the phase-1 channel and region tools', () => {
  const names = TOOL_CATALOG.map((t) => t.name);
  for (const n of ['enableChannels', 'disableChannels', 'addChannel', 'setThreshold',
                    'setChannelColor', 'applyFilter', 'selectRegions', 'deselectRegions',
                    'setRegionMode', 'resetRegions']) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
});

test('prompt documents the action block format and every tool', () => {
  const prompt = buildToolCatalogPrompt();
  assert.match(prompt, /```action/);
  assert.match(prompt, /enableChannels/);
  assert.match(prompt, /selectRegions/);
  // Region group names are listed so the model uses valid ones.
  assert.match(prompt, /Tumor \/ Epithelial/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/agentTools.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/agentTools.js
// Declarative catalog of the actions the agent may take, plus a prompt builder
// that teaches the model the exact tool names, argument shapes, and the action
// block format. Single source of truth for what the AI is allowed to do.

export const REGION_GROUP_NAMES = [
  'Tumor / Epithelial',
  'Immune (T/B/Myeloid)',
  'Stroma',
  'Stress / Metabolism',
  'Checkpoint / Crosstalk',
  'Proliferation / Cell State'
];

export const TOOL_CATALOG = [
  { name: 'enableChannels', args: '{ "markers": ["CD8a", "CD4"] }', description: 'Turn on (make visible) channels by marker name.' },
  { name: 'disableChannels', args: '{ "markers": ["MITF"] }', description: 'Hide channels by marker name.' },
  { name: 'addChannel', args: '{ "marker": "PDL1", "color": "#ff00ff" }', description: 'Add a channel by marker name (color optional hex).' },
  { name: 'setThreshold', args: '{ "marker": "SOX10", "min": 5000, "max": 30000 }', description: 'Set a channel intensity min/max threshold.' },
  { name: 'setChannelColor', args: '{ "marker": "MART1", "color": "#00ffff" }', description: 'Recolor a channel (hex).' },
  { name: 'applyFilter', args: '{}', description: 'Apply the current threshold settings to the view.' },
  { name: 'selectRegions', args: '{ "groups": ["Tumor / Epithelial", "Immune (T/B/Myeloid)"] }', description: 'Select one or more region groups (reloads panels).' },
  { name: 'deselectRegions', args: '{ "groups": ["Stroma"] }', description: 'Deselect region groups.' },
  { name: 'setRegionMode', args: '{ "mode": "two" }', description: 'Switch region mode: "single" | "two" | "three".' },
  { name: 'resetRegions', args: '{}', description: 'Clear all region selections.' }
];

export const buildToolCatalogPrompt = () => {
  const lines = [];
  lines.push('=== ACTIONS YOU CAN TAKE ===');
  lines.push('You can change the app, not just describe it. When the user asks you to do');
  lines.push('something you have a tool for, DO IT by emitting a fenced block exactly like:');
  lines.push('```action');
  lines.push('{"tool":"<toolName>","args":{ ... }}');
  lines.push('```');
  lines.push('Emit one block per action; put a short sentence of prose before the block(s).');
  lines.push('Only use the tools below with the argument shapes shown. Do not invent tools.');
  lines.push('');
  lines.push('Tools:');
  TOOL_CATALOG.forEach((t) => {
    lines.push(`- ${t.name} ${t.args} — ${t.description}`);
  });
  lines.push('');
  lines.push(`Valid region group names: ${REGION_GROUP_NAMES.join(', ')}.`);
  return lines.join('\n');
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/agentTools.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/agentTools.js src/services/agentTools.test.js
git commit -m "feat: agent tool catalog and prompt builder"
```

---

## Task 5: Inject the tool catalog into the chat system prompt

**Files:**
- Modify: `src/services/llmClient.js` (the `streamChat` export, currently builds `system` inline)
- Test: `src/services/llmClient.test.js` (add cases)

Refactor the inline system-prompt assembly in `streamChat` into an exported pure
function `composeChatSystem`, then have `streamChat` call it and append the tool catalog.

- [ ] **Step 1: Write the failing test (append to existing file)**

```js
// add to src/services/llmClient.test.js
import { composeChatSystem } from './llmClient.js';

test('composeChatSystem includes grounding, peers, and the tool catalog', () => {
  const out = composeChatSystem({
    kind: 'region',
    grounding: 'GROUND-X',
    peers: [{ title: 'Box 1', kind: 'region', grounding: 'PEER-1' }]
  });
  assert.match(out, /GROUND-X/);
  assert.match(out, /Box 1/);
  assert.match(out, /PEER-1/);
  assert.match(out, /```action/);          // catalog injected
  assert.match(out, /enableChannels/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/llmClient.test.js`
Expected: FAIL — `composeChatSystem` is not exported.

- [ ] **Step 3: Refactor `streamChat` to use an exported `composeChatSystem`**

In `src/services/llmClient.js`, add this import near the top (after the existing imports):

```js
import { buildToolCatalogPrompt } from './agentTools.js';
```

Replace the current `streamChat` body so the system assembly lives in a pure exported function:

```js
export const composeChatSystem = ({ kind, grounding, peers = [] }) => {
  let system =
    `${CHAT_SYSTEM[kind] || CHAT_SYSTEM.region}\n\n` +
    `=== GROUNDING DATA (the active context this thread is about) ===\n${grounding}`;

  if (peers.length > 0) {
    const peerBlocks = peers
      .map((p) => `--- ${p.title} (${p.kind}) ---\n${p.grounding}`)
      .join('\n\n');
    system +=
      `\n\n=== OTHER OPEN CONTEXTS (data from the user's other selected regions/views) ===\n` +
      `When the user asks to compare with another region by name (e.g. "Box 1"), use the matching context below. ` +
      `Only use these numbers — do not say the data is missing if a matching context is present.\n\n` +
      peerBlocks;
  }

  system += `\n\n${buildToolCatalogPrompt()}`;
  return system;
};

export const streamChat = ({ kind, grounding, peers = [], messages, onToken, signal }) =>
  streamCompletion({
    system: composeChatSystem({ kind, grounding, peers }),
    messages,
    onToken,
    signal
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/llmClient.test.js`
Expected: PASS (all existing + the new case).

- [ ] **Step 5: Commit**

```bash
git add src/services/llmClient.js src/services/llmClient.test.js
git commit -m "feat: inject agent tool catalog into chat system prompt"
```

---

## Task 6: Agent actions React context + wrap App

**Files:**
- Create: `src/services/agentActions.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Create the context provider**

```jsx
// src/services/agentActions.jsx
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

  const value = useMemo(() => {
    const reg = registryRef.current;
    return {
      registerActions: (map) => reg.register(map),
      unregisterActions: (names) => reg.unregister(names),
      runAction: (tool, args) => reg.run(tool, args),
      hasAction: (tool) => reg.has(tool)
    };
  }, []);

  return (
    <AgentActionsContext.Provider value={value}>
      {children}
    </AgentActionsContext.Provider>
  );
}
```

- [ ] **Step 2: Wrap the app tree**

In `src/App.jsx`, add the import:

```jsx
import { AgentActionsProvider } from './services/agentActions';
```

The render currently begins:

```jsx
  return (
    <TissueIntelligenceProvider openSettings={openSettings}>
```

Wrap `TissueIntelligenceProvider` with `AgentActionsProvider` (outermost so the TI provider can use it):

```jsx
  return (
    <AgentActionsProvider>
    <TissueIntelligenceProvider openSettings={openSettings}>
```

and add the matching closing tag where `</TissueIntelligenceProvider>` is (end of the component's return):

```jsx
    </TissueIntelligenceProvider>
    </AgentActionsProvider>
  );
```

- [ ] **Step 3: Add `agentSetChannels` helper in App and expose to ChannelSelection**

In `src/App.jsx`, just after `handleChannelsChange` (around line 80-83), add a helper that sets channels AND bumps `presetVersion` so `ChannelSelection` re-syncs its UI from the new channel array:

```jsx
  const agentSetChannels = useCallback((updater) => {
    setChannels((prev) => (typeof updater === 'function' ? updater(prev) : updater));
    setPresetVersion((v) => v + 1);
  }, []);
```

Pass it to `ChannelSelection` (in the JSX where `ChannelSelection` is rendered, alongside `onChannelsChange`):

```jsx
            <ChannelSelection
              onChannelsChange={handleChannelsChange}
              presetChannels={channels}
              presetVersion={presetVersion}
              agentSetChannels={agentSetChannels}
            />
```

- [ ] **Step 4: Verify the app still builds**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built` (the pre-existing `WebGLMultisampleRenderTarget` warnings are unrelated).

- [ ] **Step 5: Commit**

```bash
git add src/services/agentActions.jsx src/App.jsx
git commit -m "feat: agent actions context wired into App"
```

---

## Task 7: Channel action executors

**Files:**
- Modify: `src/components/ChannelSelection.jsx`

Channel objects have the shape `{ id, channelIndex, name, visible, color, thresholdMin, thresholdMax }` (see `normalizedChannels` near line 88). The executors compute a new channel array and push it up via the new `agentSetChannels` prop; each returns an `undo` that restores the previous array.

- [ ] **Step 1: Add imports and the registration effect**

At the top of `src/components/ChannelSelection.jsx` add:

```jsx
import { useEffect } from 'react';
import { useAgentActions } from '../services/agentActions';
import { findChannelIndex, channelNameAt } from '../services/channelCatalog';
```

(If `useEffect` is already imported in the existing `import React, { ... }` line, do not duplicate it.)

Change the component signature to accept the new prop:

```jsx
const ChannelSelection = ({ onChannelsChange, presetChannels = [], presetVersion = 0, agentSetChannels }) => {
```

- [ ] **Step 2: Register executors (add inside the component body, after state is declared)**

```jsx
  const { registerActions, unregisterActions } = useAgentActions();
  const channelsRef = useRef(channels);
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  useEffect(() => {
    if (!agentSetChannels) return;

    const snapshot = () => channelsRef.current.map((c) => ({ ...c }));
    const restore = (prev) => agentSetChannels(prev);

    const setVisibility = (markers, visible) => {
      const prev = snapshot();
      const wanted = new Set(markers.map((m) => findChannelIndex(m)).filter((i) => i >= 0));
      agentSetChannels(prev.map((c) =>
        wanted.has(c.channelIndex) ? { ...c, visible } : c
      ));
      const names = markers.join(', ');
      return { message: `${visible ? 'Enabled' : 'Hid'} ${names}`, undo: () => restore(prev) };
    };

    registerActions({
      enableChannels: ({ markers = [] }) => setVisibility(markers, true),
      disableChannels: ({ markers = [] }) => setVisibility(markers, false),

      addChannel: ({ marker, color }) => {
        const idx = findChannelIndex(marker);
        if (idx < 0) return { message: `Unknown marker "${marker}"` };
        const prev = snapshot();
        if (prev.some((c) => c.channelIndex === idx)) {
          return setVisibility([marker], true); // already present → just show it
        }
        const next = [...prev, {
          id: `agent-${idx}`,
          channelIndex: idx,
          name: channelNameAt(idx),
          visible: true,
          color: color || '#ffffff',
          thresholdMin: 0,
          thresholdMax: 0
        }];
        agentSetChannels(next);
        return { message: `Added ${channelNameAt(idx)}`, undo: () => restore(prev) };
      },

      setThreshold: ({ marker, min, max }) => {
        const idx = findChannelIndex(marker);
        const prev = snapshot();
        agentSetChannels(prev.map((c) =>
          c.channelIndex === idx ? { ...c, thresholdMin: min ?? c.thresholdMin, thresholdMax: max ?? c.thresholdMax } : c
        ));
        return { message: `Set ${marker} threshold ${min}–${max}`, undo: () => restore(prev) };
      },

      setChannelColor: ({ marker, color }) => {
        const idx = findChannelIndex(marker);
        const prev = snapshot();
        agentSetChannels(prev.map((c) => (c.channelIndex === idx ? { ...c, color } : c)));
        return { message: `Recolored ${marker}`, undo: () => restore(prev) };
      },

      applyFilter: () => {
        // Re-push the same channels with a version bump → ChannelSelection re-applies thresholds.
        agentSetChannels(channelsRef.current.map((c) => ({ ...c })));
        return { message: 'Applied filter' };
      }
    });

    return () => unregisterActions([
      'enableChannels', 'disableChannels', 'addChannel',
      'setThreshold', 'setChannelColor', 'applyFilter'
    ]);
  }, [agentSetChannels, registerActions, unregisterActions]);
```

(If `useRef` is not already imported in the existing React import line, add it.)

- [ ] **Step 3: Verify build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChannelSelection.jsx
git commit -m "feat: agent channel actions (enable/disable/add/threshold/color/apply)"
```

---

## Task 8: Region action executors

**Files:**
- Modify: `src/components/Region_Selection.jsx`

Region toggling goes through the existing `onToggleRegion({ regionPayload, shouldSelect })` and `buildRegionPayload(region)` already defined in this file. The `REGION_DEFINITIONS` array maps group `title` → `id`. The executors map a group name to its definition and call the existing toggle, mirroring the single-region path. Mode switching reuses the existing `activeTab` state setter.

- [ ] **Step 1: Add imports**

```jsx
import { useEffect } from 'react';
import { useAgentActions } from '../services/agentActions';
```

(Don't duplicate `useEffect`/`useMemo`/`useState` if already imported.)

- [ ] **Step 2: Register executors (inside the component body, after `activeTab` state and `buildRegionPayload` are defined)**

Find the existing region-mode state. It is the state behind the Single/Two/Three tabs (named `activeTab` with setter `setActiveTab`, values `'single' | 'two' | 'three'`). Add:

```jsx
  const { registerActions, unregisterActions } = useAgentActions();
  const selectedRegionsRef = useRef(selectedRegions);
  useEffect(() => { selectedRegionsRef.current = selectedRegions; }, [selectedRegions]);

  useEffect(() => {
    if (!onToggleRegion) return;

    const findDef = (group) => {
      const g = group.toLowerCase().trim();
      return REGION_DEFINITIONS.find(
        (r) => r.title.toLowerCase() === g || r.id === g
      );
    };

    const toggleGroups = (groups, shouldSelect) => {
      const matched = groups.map(findDef).filter(Boolean);
      matched.forEach((region) => {
        onToggleRegion({ regionPayload: buildRegionPayload(region), shouldSelect });
      });
      const titles = matched.map((r) => r.title).join(', ') || '(none matched)';
      return {
        message: `${shouldSelect ? 'Selected' : 'Deselected'} ${titles}`,
        undo: () => matched.forEach((region) =>
          onToggleRegion({ regionPayload: buildRegionPayload(region), shouldSelect: !shouldSelect })
        )
      };
    };

    registerActions({
      selectRegions: ({ groups = [] }) => toggleGroups(groups, true),
      deselectRegions: ({ groups = [] }) => toggleGroups(groups, false),
      setRegionMode: ({ mode }) => {
        const valid = ['single', 'two', 'three'];
        if (!valid.includes(mode)) return { message: `Unknown mode "${mode}"` };
        const prev = activeTab;
        setActiveTab(mode);
        return { message: `Switched to ${mode} region mode`, undo: () => setActiveTab(prev) };
      },
      resetRegions: () => {
        const prev = selectedRegionsRef.current;
        prev.forEach((region) => {
          const def = REGION_DEFINITIONS.find((r) => r.id === region.id) ||
            REGION_DEFINITIONS.find((r) => region.id?.startsWith(r.id));
          if (def) onToggleRegion({ regionPayload: buildRegionPayload(def), shouldSelect: false });
        });
        return { message: 'Cleared region selections' };
      }
    });

    return () => unregisterActions(['selectRegions', 'deselectRegions', 'setRegionMode', 'resetRegions']);
  }, [onToggleRegion, activeTab, registerActions, unregisterActions]);
```

> If the mode state is named differently than `activeTab`/`setActiveTab`, use the actual names found in the file (grep for `'single'` and `'two'` to locate it). Keep the rest identical.

- [ ] **Step 3: Verify build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Region_Selection.jsx
git commit -m "feat: agent region actions (select/deselect/mode/reset)"
```

---

## Task 9: Run actions on turn completion + store undo

**Files:**
- Modify: `src/services/tissueIntelligenceContext.jsx`

When an assistant chat turn finishes streaming, extract action blocks from the final
message, run each through the registry, replace the message content with the cleaned text,
and attach an `actions` array (`[{ message, ok, undoId }]`). Undo closures are kept in a
ref so the UI can call them by id.

- [ ] **Step 1: Add imports and an undo store**

At the top of `src/services/tissueIntelligenceContext.jsx` add:

```jsx
import { extractActions } from './actionParser.js';
import { useAgentActions } from './agentActions.jsx';
```

Inside `TissueIntelligenceProvider`, add near the other refs:

```jsx
  const { runAction } = useAgentActions();
  const undoStoreRef = useRef({}); // undoId -> () => void
```

- [ ] **Step 2: Add a reducer case to set message actions**

In the `reducer`, add a case that replaces the last assistant message's content and attaches actions:

```jsx
    case 'FINALIZE_ASSISTANT': {
      const prev = state.threads[action.id];
      if (!prev || prev.messages.length === 0) return state;
      const messages = prev.messages.slice();
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, content: action.content, actions: action.actions };
      return { ...state, threads: { ...state.threads, [action.id]: { ...prev, messages } } };
    }
```

- [ ] **Step 3: Run actions when the chat stream resolves**

In `sendMessage`, the streamChat `.then(() => dispatch({ type: 'PATCH_THREAD', id, patch: { busy: false } }))`
currently just clears busy. Replace that `.then` with one that finalizes actions. Because
`APPEND_LAST_ASSISTANT` has been accumulating the text, read it back from state via a ref.
Add a ref that always points at current threads:

```jsx
  const threadsRef = useRef(state.threads);
  useEffect(() => { threadsRef.current = state.threads; }, [state.threads]);
```

(Import `useEffect` from React if not already imported.)

Then change the `streamChat({...})` `.then`:

```jsx
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
```

- [ ] **Step 4: Expose an `undoAction` on the context value**

Add this function before the `value` useMemo:

```jsx
  const undoAction = useCallback((undoId) => {
    const fn = undoStoreRef.current[undoId];
    if (fn) { fn(); delete undoStoreRef.current[undoId]; }
  }, []);
```

Add `undoAction` to the `value` object and its dependency array.

- [ ] **Step 5: Verify build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/services/tissueIntelligenceContext.jsx
git commit -m "feat: execute parsed actions on chat turn completion with undo store"
```

---

## Task 10: Render action result chips + Undo in the chat

**Files:**
- Modify: `src/components/TissueIntelligenceWindow.jsx`

The assistant message now may carry `m.actions = [{ ok, message, undoId }]`. Render a chip
under the message text for each, with an Undo button when `undoId` is set.

- [ ] **Step 1: Pull `undoAction` from the context**

Where the component calls `useTissueIntelligence()`, add `undoAction` to the destructured values.

- [ ] **Step 2: Render chips under assistant messages**

Find the assistant message render (around line 280: `{m.role === 'assistant' ? <MarkdownLite text={m.content || '…'} /> : m.content}`). Replace it with:

```jsx
                    {m.role === 'assistant' ? (
                      <>
                        <MarkdownLite text={m.content || '…'} />
                        {Array.isArray(m.actions) && m.actions.map((a, ai) => (
                          <div key={ai} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            marginTop: '6px', padding: '4px 8px', borderRadius: '6px',
                            fontSize: '11px',
                            background: a.ok ? 'rgba(74,222,128,0.12)' : 'rgba(255,100,100,0.12)',
                            border: `1px solid ${a.ok ? 'rgba(74,222,128,0.4)' : 'rgba(255,100,100,0.4)'}`,
                            color: 'var(--text-1)'
                          }}>
                            <span>{a.ok ? '✓' : '⚠'} {a.message}</span>
                            {a.undoId && (
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
                        ))}
                      </>
                    ) : m.content}
```

- [ ] **Step 3: Verify build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/components/TissueIntelligenceWindow.jsx
git commit -m "feat: action result chips with Undo in Tissue Intelligence chat"
```

---

## Task 11: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `node --test`
Expected: the new suites (actionParser, channelCatalog, actionRegistry, agentTools) and the
extended llmClient suite all PASS. (The legacy root `test.js` failing on `document is not
defined` is pre-existing and unrelated.)

- [ ] **Step 2: Start the app**

Run: `npx vite --port 3001` and open http://localhost:3001/. Open Settings and confirm a
provider (Gemini key or local endpoint) is configured.

- [ ] **Step 3: Channel action**

Select a region so the Local View has data, click **Ask AI**, and type: `add the CD8a channel`.
Expected: the assistant replies, a `✓ Added CD8a` chip appears, CD8a shows up/enabled in
Channel Selection. Click **Undo** → it reverts.

- [ ] **Step 4: Region action**

In a chat, type: `select the tumor and immune regions`.
Expected: `✓ Selected Tumor / Epithelial, Immune (T/B/Myeloid)` chip; Region Selection
reflects the change and panels reload. **Undo** reverts.

- [ ] **Step 5: Negative case**

Type: `add the BANANA channel`.
Expected: a graceful `⚠ Unknown marker "BANANA"` chip; no crash.

- [ ] **Step 6: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "chore: phase-1 agentic Tissue AI verification fixes"
```

---

## Self-review notes

- **Spec coverage:** channels (Task 7) + regions (Task 8) executors; structured action
  protocol (Tasks 1,4,5); registry (Tasks 3,6); execute+undo (Tasks 7–10); tool catalog in
  prompt (Task 4); chips+undo UI (Task 10). Dock, camera, panel-nav, and Direction/Local
  resize-&-fit are intentionally deferred to the Phase 2 plan.
- **Naming consistency:** `agentSetChannels` (App→ChannelSelection), `runAction`/`registerActions`/
  `unregisterActions` (context), `extractActions` (parser), `findChannelIndex`/`channelNameAt`
  (catalog), `composeChatSystem` (llmClient), `FINALIZE_ASSISTANT`/`undoAction` (TI context)
  are used identically across tasks.
- **Verification:** pure modules are TDD; React wiring is verified via build + manual E2E
  (no DOM test env in this repo).
