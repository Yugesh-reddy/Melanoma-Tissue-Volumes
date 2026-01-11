# Agentic Tissue AI — Design

**Date:** 2026-06-14
**Branch:** ui-consistency-overhaul
**Status:** Approved (brainstorm), pending implementation plan

## Context

The dashboard already has a "Tissue Intelligence" assistant: a floating window with
per-context threads (region / orientation / graph) that **summarizes** deterministic
engine output via a streaming LLM (Gemini or a local OpenAI-compatible endpoint). See
`src/services/tissueIntelligenceContext.jsx`, `src/services/llmClient.js`,
`src/components/TissueIntelligenceWindow.jsx`, `src/components/AskTissueButton.jsx`.

Two gaps motivate this work:

1. **The assistant only talks; it cannot act.** The user wants an *agentic* assistant:
   "if I say add a particular channel it must," and likewise for regions, camera, and
   navigation. The AI should change app state, not just describe it.
2. **The maximized ("large") view is not built for the AI or even for itself.** When a
   bottom panel is maximized, the AI is still a small floating window, and Direction
   View does not resize correctly (arrows cluster top-left, see below). The large view
   should weave the AI in as a first-class surface.

Intended outcome: a single agentic assistant that executes real, reversible actions
(channels, regions, camera, navigation) and a redesigned expanded view with a docked AI
panel beside the 3D scene.

## Decisions (from brainstorm)

- **Expanded-view AI layout:** right-side **dock** (3D canvas left, AI panel ~320px right).
- **Execution model:** **execute immediately + Undo** for direct commands.
- **Capabilities (v1):** channel control, region control, camera/view control,
  panel/navigation.
- **Action protocol:** **structured action blocks** — the model emits a fenced
  ` ```action {json} ``` ` block; the app parses, strips, executes, and renders a result
  chip. Provider-agnostic (works with Gemini *and* the local model), no per-provider
  tool-calling plumbing.
- **Scope of the dock:** floating window stays for non-maximized panels; the dock only
  appears in maximized mode; only one chat surface is visible at a time.

## Action surface (existing state these tools drive)

- Channels: `App.handleChannelsChange(updatedChannels)` → `setChannels`; channel objects
  carry `{ id, name, color, thresholds/min/max, visible, ... }`. `ChannelSelection`
  owns add/apply-filter/threshold UI. Region selection also auto-aggregates channels via
  `buildAggregatedChannels` (changing regions resets channels + bumps `presetVersion`).
- Regions: `App.handleRegionToggle({ regionPayload, shouldSelect })`; predefined region
  groups + Single/Two/Three mode live in `Region_Selection`. Toggling a region clears all
  3D selections and reloads panels.
- Camera: Three.js scenes in `Local_View` and `Direction_view` (imperative — no React
  state); each manages its own renderer/camera.
- Panels/nav: `App.toggleMaximize(panel)`, `maximizedPanel` state; active Box tab is
  internal to `Local_View`.

## Architecture

Three new units plus targeted wiring. Each unit has one job and a defined interface.

### 1. Action registry — `src/services/agentActions.jsx`
A React context (`AgentActionsProvider`, `useAgentActions`) holding a mutable map
`tool name → { execute(args) => { result, undo } , describe(args) => string }`.

- `registerActions(map)` / `unregisterActions(keys)` — callers add/remove tools as they
  mount.
- `runAction(tool, args)` — looks up and executes; returns `{ ok, message, undo }` or an
  error result for unknown tool / bad args. Never touches React state directly.

Registration sources:
- **App.jsx** registers global tools (channels, regions, panel/navigation) — it owns
  that state.
- **Local_View / Direction_view** register camera tools (`focusCamera`, `resetCamera`,
  `setView`) on mount; unregister on unmount, so camera tools exist only for the mounted
  scene. (When a tool is unavailable, `runAction` returns a graceful "not available
  here" result.)

### 2. Tool catalog — `src/services/agentTools.js`
A declarative array of tool descriptors `{ name, args, description }`, plus a
`buildToolCatalogPrompt()` that renders them into the system prompt so the model knows
the exact tool names, argument shapes, and the required ` ```action ``` ` block format.
This is the single source of truth shared by the prompt and (for validation) the registry.

v1 tools:
- Channels: `enableChannels({markers})`, `disableChannels({markers})`,
  `addChannel({marker, color?})`, `setThreshold({marker, min, max})`,
  `setChannelColor({marker, color})`, `applyFilter({})`
- Regions: `selectRegions({groups})`, `deselectRegions({groups})`,
  `setRegionMode({mode})`, `resetRegions({})`
- Camera/view: `focusCamera({target})`, `resetCamera({panel})`, `setView({orientation})`
- Panel/nav: `maximizePanel({panel})`, `restorePanel({})`, `switchBox({index})`

### 3. Action parser — `src/services/actionParser.js` (pure, unit-tested)
- `extractActions(text) => { cleanText, actions: [{ tool, args, raw }] }` — finds all
  ` ```action ... ``` ` blocks, JSON-parses each (tolerating malformed blocks → flagged,
  not thrown), and returns the display text with the blocks removed.

### Execution flow & Undo
On each completed assistant turn (in `tissueIntelligenceContext.sendMessage` /
`runAnalysis`), after streaming finishes: `extractActions` → for each action,
`runAction` → collect `{ message, undo }`. Store the executed actions on the message so
the chat view renders a result chip per action with an **Undo** button that calls
`undo()`. Each executor snapshots the relevant state slice before mutating (prev channels
array / prev `selectedRegions` / prev camera pose) and restores it on undo. Actions run
in order; region changes note the reload in their chip text.

Streaming note (v1): parse actions on turn completion (not mid-stream) to keep the
streamer simple; the narrative still streams live, action chips appear when the turn ends.

### 4. Expanded-view right-side dock
Extract the chat UI from `TissueIntelligenceWindow` into a shared presentational
`src/components/TissueChatView.jsx` (message list + MarkdownLite + action chips + input).
Two wrappers:
- `TissueIntelligenceWindow` — existing draggable floating frame (non-maximized).
- `ExpandedAgentDock` — fixed ~320px right-side panel rendered inside the maximized panel
  layout (canvas flexes left). Bound to the maximized panel's context thread.

The floating window is suppressed while a panel is maximized so only one surface shows.

### 5. Direction View (and Local View) large-view fix
`Direction_view` currently listens for **window** resize only; maximizing changes the
container, not the window, so the renderer never resizes and the camera aspect is wrong
(arrows cluster top-left). Replace with a **`ResizeObserver`** on the container (update
`renderer.setSize` + `camera.aspect` + `updateProjectionMatrix`), and add a
**fit-to-view** recenter so arrows fill the available space. Apply the same
`ResizeObserver` pattern to `Local_View`'s 3D content.

## Components / files

New:
- `src/services/agentActions.jsx` — registry context
- `src/services/agentTools.js` — tool catalog + prompt builder
- `src/services/actionParser.js` (+ `.test.js`) — block extraction
- `src/components/TissueChatView.jsx` — shared chat UI
- `src/components/ExpandedAgentDock.jsx` — docked AI for maximized view

Modified:
- `src/App.jsx` — wrap in `AgentActionsProvider`; register channel/region/panel tools;
  render `ExpandedAgentDock` in the maximized layout
- `src/services/tissueIntelligenceContext.jsx` — run parsed actions on turn completion;
  attach executed actions (with undo) to messages
- `src/services/llmClient.js` — inject tool-catalog prompt for chat/analysis
- `src/components/TissueIntelligenceWindow.jsx` — use shared `TissueChatView`
- `src/components/Direction_view.jsx`, `src/components/Local_View.jsx` — ResizeObserver +
  fit-to-view

## Build phasing

- **Phase 1 — Agentic core:** `agentActions`, `agentTools`, `actionParser`, undo, action
  chips; wire **channels + regions** to App handlers; run via the existing floating
  window. Deliverable: typing "add CD8a" or "select tumor + immune" changes app state
  with working Undo.
- **Phase 2 — Large view:** `TissueChatView` extraction, `ExpandedAgentDock`, Direction/
  Local `ResizeObserver` + fit-to-view, and camera/panel-nav tools.

## Verification

- **Unit:** `actionParser` (extracts/strips one and many blocks, ignores malformed JSON
  without throwing); each executor against a mock registry (applies + undo restores prior
  state); `buildToolCatalogPrompt` output shape.
- **Manual end-to-end:** in the running app (`npx vite`, localhost:3001):
  - "add the CD8a channel" → CD8a appears/enabled; Undo removes it.
  - "select tumor + immune regions" → regions toggle, panels reload; Undo restores.
  - Maximize Direction View → arrows resize and recenter to fill the panel.
  - Maximize a panel → right-side dock appears, floating window hidden; converse + act.

## Out of scope (YAGNI for v1)

- Native provider function-calling.
- Mid-stream action execution.
- Multi-step autonomous planning / chained tool loops (single turn → its action blocks).
- Proactive AI-initiated actions (only responds to user turns).
