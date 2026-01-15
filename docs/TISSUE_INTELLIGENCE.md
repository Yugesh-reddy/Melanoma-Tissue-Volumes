# Tissue Intelligence & Project Changes

A detailed reference for the agentic **Tissue Intelligence** assistant and every change
made to the Melanoma‑Tissue‑Volumes dashboard in this work cycle. Written for a developer
who has never seen the codebase.

> Status: all changes described here live in the working tree (uncommitted). They build
> cleanly (`npx vite build`) and the service unit tests pass (`node --test`).

---

## 1. What this project is

A React + Vite single‑page app for exploring **3D multiplexed (CyCIF) melanoma tissue
imaging**. The screen is laid out as:

- **Title bar** (top)
- **Left sidebar** — *Channel Selection* (which marker channels are shown, their colors,
  visibility, and intensity thresholds) and *Region Selection* (pre‑defined biological
  marker groups, e.g. Tumor / Epithelial, Immune).
- **Right area** — *Main View* (the big interactive 3D point‑cloud renderer, three.js)
  on top, and three **bottom panels**: *Local View* (3D sub‑volume of a drawn box),
  *Graph Panel* (per‑marker charts), *Direction View* (per‑marker principal orientation
  arrows). Each bottom panel can be **maximized** to fill the right area.

The headline addition this cycle is **Tissue Intelligence**: an in‑app AI assistant that
not only explains the data but **takes actions** on the user's behalf (an *agent*).

---

## 2. Tissue Intelligence — overview

Tissue Intelligence is a single, app‑wide AI surface with three properties:

1. **Grounded** — it explains numbers a deterministic engine already computed (it does not
   invent findings).
2. **Agentic** — it can change the app: toggle channels, select regions, move the camera,
   switch visualizations, open/close panels and boxes — and every change is **reversible**
   (an inline *Undo*).
3. **System‑aware** — before every reply it receives a live snapshot of the app state
   (visible channels, selected regions, which panel is expanded, active box, current graph
   view), so it reasons over what is actually on screen.

It works with two LLM providers, configured in **Settings**:
- **Gemini** (Google Generative Language API, SSE streaming)
- **Local / OpenAI‑compatible** endpoint (e.g. Ollama serving `gpt‑oss`), SSE streaming.

### Surfaces

- **Floating window** — a draggable/resizable chat window (default surface).
- **3D badges** — compact "Ask AI" glyphs projected onto selected boxes in Main View.
- **Header / body chips** — "Ask AI" triggers inside panels.
- **Main View launcher** — a **Tissue Intelligence** button (top‑right of Main View) that
  opens the **general** assistant.
- **Expanded‑view dock** — when a bottom panel is maximized, a 340 px AI panel docks on
  the right (the floating window is hidden so there is only one chat surface).

---

## 3. The agentic architecture

The agent is built from small, single‑purpose units. Data flows:

```
user types  ─▶ sendMessage()                       (tissueIntelligenceContext)
            ─▶ streamChat({ kind, grounding,        (llmClient)
                            peers, systemState })
            ─▶ model streams reply text, possibly containing one or more
                 ```action {json} ``` blocks
            ─▶ on turn completion: extractActions()  (actionParser)
            ─▶ runAction(tool, args) per block       (actionRegistry via agentActions)
            ─▶ executor mutates app state + returns { message, undo }
            ─▶ result chip rendered with an Undo button   (TissueChatView)
```

### 3.1 Action protocol — structured blocks (provider‑agnostic)

The model is taught (via the system prompt) to emit actions as fenced blocks:

````
Enabling the immune markers.
```action
{"tool":"enableChannels","args":{"markers":["CD8a","CD4"]}}
```
````

This text‑based protocol works with **any** model (Gemini *and* local), needs no
provider‑specific tool‑calling plumbing, and is trivial to log and undo. Multiple blocks
per reply are allowed and run in order. Malformed JSON is flagged, never thrown.

- `src/services/actionParser.js` → `extractActions(text)` returns
  `{ cleanText, actions: [{ tool, args, raw, error }] }`. The blocks are stripped from the
  text shown to the user; the cleaned prose remains.

### 3.2 Action registry

- `src/services/actionRegistry.js` → `createActionRegistry()` returns
  `{ register, unregister, run, has }`. Executors are functions
  `(args) => { message, undo? }` (sync or async). `run()` never throws — it returns a
  uniform `{ ok, message, undo }`.

- `src/services/agentActions.jsx` wraps a single registry instance in a React context
  (`AgentActionsProvider`, `useAgentActions()`), exposing:
  `registerActions`, `unregisterActions`, `runAction`, `hasAction`,
  and the **state registry** (below): `registerState`, `unregisterState`,
  `getSystemState`.

Executors are **registered by the component that owns the relevant state** and
unregistered on unmount:
- Channels → `ChannelSelection.jsx`
- Regions → `Region_Selection.jsx`
- Boxes (Local View tabs) → `Local_View.jsx`
- Graph visualization → `Graph_Pannel.jsx`
- Camera (Direction) → `Direction_view.jsx`
- Panels (maximize/restore) → a tiny `PanelNavActions` child inside `App.jsx`
  (App's body sits *above* the provider, so a child component does the registering).

### 3.3 Tool catalog (single source of truth)

- `src/services/agentTools.js` exports `TOOL_CATALOG` (name, args shape, description),
  `REGION_GROUP_NAMES`, and `buildToolCatalogPrompt()` which renders the catalog + the
  action‑block format into the system prompt. Adding a tool here teaches the model; the
  matching executor must be registered by a component.

### 3.4 LLM client

- `src/services/llmClient.js`
  - `streamAnalysis()` — the structured sectioned report for a grounded context.
  - `streamChat({ kind, grounding, peers, systemState, messages, … })` — free‑form chat.
  - `composeChatSystem()` (pure, unit‑tested) assembles the system prompt:
    base persona → `=== GROUNDING DATA ===` → `=== OTHER OPEN CONTEXTS ===` (peers, for
    cross‑region comparison) → `=== CURRENT APP STATE ===` (live awareness) →
    `=== ACTIONS YOU CAN TAKE ===` (tool catalog).
  - Grounding builders (`buildRegionGrounding`, `buildOrientationGrounding`,
    `buildGraphGrounding`) are pure functions so the LLM only explains computed numbers.

### 3.5 Conversation state & undo

- `src/services/tissueIntelligenceContext.jsx` (`TissueIntelligenceProvider`,
  `useTissueIntelligence()`):
  - Manages a floating window + a map of **per‑context threads** (each box, orientation,
    graph, and the general assistant). Switching contexts never loses a conversation.
  - `open(descriptor)` resolves a context's data, builds grounding, and (for grounded
    kinds) auto‑streams the analysis. `openGeneral()` opens the app‑wide assistant
    (no grounded report; opens straight to chat).
  - `sendMessage()` gathers **peers** (other open threads, for comparison) and the live
    **systemState**, streams the reply, then on completion runs any parsed actions and
    attaches `{ ok, message, undoId }` results to the assistant message.
  - Undo closures are kept in a ref keyed by `undoId`; `undoAction(undoId)` restores the
    pre‑action state (snapshot‑based).

### 3.6 Chat UI

- `src/components/TissueChatView.jsx` — the shared chat body: context switcher chips,
  message list (Markdown + action result chips + Undo), **suggested‑action chips** (shown
  until the first user message, mixing agentic prompts and questions), and the composer
  (textarea + Send). Rendered by both the floating window and the dock.
- `src/components/TissueIntelligenceWindow.jsx` — draggable/resizable frame around
  `TissueChatView` (the default surface).
- `src/components/ExpandedAgentDock.jsx` — the right‑side dock for the maximized view;
  **auto‑opens the general assistant** if no context is active, so chat is always usable.
- `src/components/AskTissueButton.jsx` — `chip` and `badge` trigger variants.
- `src/components/RegionFindings.jsx` — deterministic findings card for region contexts.

### 3.7 System awareness (state registry)

Each panel registers a live getter (`registerState(key, () => "…")`). Before every reply,
`getSystemState()` aggregates them into the `=== CURRENT APP STATE ===` block:

- **channels** — markers in view + which are hidden
- **regions** — region mode + selected groups
- **view** — which panel is expanded (or none)
- **localView** — number of boxes + active box
- **graph** — current visualization (cells/bar/heatmap/violin)

This lets the assistant answer "what am I looking at?" and avoid redundant actions.

---

## 4. The agent's tools (current set)

| Group | Tools |
|---|---|
| **Channels** | `enableChannels`, `disableChannels`, `addChannel`, `removeChannel`, `isolateChannel`, `showAllChannels`, `setThreshold`, `resetThreshold`, `setChannelColor`, `applyFilter` |
| **Regions** | `selectRegions`, `deselectRegions`, `setRegionMode`, `resetRegions` |
| **Boxes (Local View)** | `switchBox`, `closeBox`, `clearAllBoxes` |
| **Graph** | `setGraphView` (cells / bar / heatmap / violin) |
| **Camera (Direction View)** | `resetCamera`, `setView` (top/front/side/iso), `focusCamera` |
| **Panels** | `maximizePanel`, `restorePanel` |

Example prompts: *"add CD8a"*, *"isolate SOX10"*, *"reset the MITF threshold"*,
*"select tumor + immune regions"*, *"switch to two‑region mode"*, *"close box 2"*,
*"clear all boxes"*, *"show the heatmap"*, *"maximize the Direction View and show the top
view"*, *"what markers am I currently viewing?"*.

Every state‑changing action returns a `✓ … [Undo]` chip.

---

## 5. UI / UX changes (beyond the AI)

### 5.1 Main View keyboard controls
- Removed **WASD** panning (arrow keys do the same and are kept).
- Zoom remapped from `Z`/`X` to **Ctrl+Z / Ctrl+X**.
- **Keyboard is ignored while typing** in inputs/textareas/contenteditable (an
  `isEditableTarget` guard), so chatting no longer moves the 3D camera.

### 5.2 Markdown rendering (`MarkdownLite.jsx`)
Extended the dependency‑free renderer to support **tables** (GitHub pipe syntax),
**horizontal rules**, **inline code**, and **italics** (it already did headings, bold,
and lists). AI answers with tables now render properly.

### 5.3 Panel consistency
- **Ask AI** moved from panel **headers** to the **top‑right of panel bodies** (Local &
  Direction); **removed entirely from the Graph Panel** (self‑explanatory).
- Removed the Local View **info (ⓘ)** button/modal (Ask AI takes that spot).
- Header heights unified (Graph Panel was thicker — padding/whitespace fixed); all three
  headers align inline.
- **Borders unified** to the design token `var(--border)` (`#262a35`) across the sidebar
  and the three bottom panels, replacing brighter `#444`/mismatched values; dividers are
  single‑sourced to avoid doubled lines.
- **Direction View** recolored from green to the blue accent (`#3b82f6`) to match the
  other panels; its **expand button** moved next to the title (consistent with Local &
  Graph).

### 5.4 Maximized ("large") view fixes
- **Resize** — Direction View and Local View now use a `ResizeObserver` on their
  containers, so maximizing actually resizes the renderer + fixes the camera aspect and
  re‑centers (previously only a `window` resize triggered it, which maximize does not).
- **Camera sync (Direction View)** — orbit state (`distance`, `rotX`, `rotY`) was lifted
  into a shared ref used by both manual drag/zoom and the agent camera tools, so an
  AI‑driven `setView`/`resetCamera` stays in sync with the next manual drag (no snap‑back).
- **Dock** — the right‑side AI dock appears in the maximized layout; the floating window
  is suppressed while maximized.

### 5.5 Cross‑region comparison
`sendMessage` now passes every *other* open thread's grounding as **peers**, and the chat
system prompt includes an `=== OTHER OPEN CONTEXTS ===` section, so you can ask Box 2's
thread to "compare this with Box 1" and it has Box 1's numbers.

---

## 6. Notable bug fixes

- **Added channels rendered invisibly.** `addChannel` set `thresholdMin/Max` to `0/0`.
  `Main_View` computes `thresholdMin ?? autoMin`; since `0` is not nullish it produced an
  empty `[0,0]` window that filtered out every voxel. Fixed by using `undefined`
  (auto full‑range), matching region‑built channels.
- **Floating panels bled over the maximized overlay.** Direction View's readout/Ask‑AI
  had `zIndex` ≥ the maximized overlay (`1000`); lowered to small values so they stay
  within their panel.

---

## 7. File map (created / modified)

**New services**
- `src/services/actionParser.js` (+ `.test.js`) — action‑block extraction
- `src/services/channelCatalog.js` (+ `.test.js`) — marker name → channel index
- `src/services/actionRegistry.js` (+ `.test.js`) — tool dispatch core
- `src/services/agentTools.js` (+ `.test.js`) — tool catalog + prompt builder
- `src/services/agentActions.jsx` — action + state registry context

**New components**
- `src/components/TissueChatView.jsx` — shared chat UI
- `src/components/ExpandedAgentDock.jsx` — maximized‑view AI dock

**Modified services**
- `src/services/llmClient.js` — `composeChatSystem` (+ peers, systemState, tool catalog),
  `general` chat persona
- `src/services/tissueIntelligenceContext.jsx` — general thread, action execution on
  completion, undo store, peers + systemState wiring

**Modified components**
- `src/App.jsx` — `AgentActionsProvider` wrap, `agentSetChannels`, `PanelNavActions`
  (panel tools + view state), dock in maximized layout, floating window suppressed while
  maximized
- `src/components/Main_View.jsx` — keyboard fix, Tissue Intelligence launcher button
- `src/components/ChannelSelection.jsx` — channel executors + live channel state
- `src/components/Region_Selection.jsx` — region executors + live region state
- `src/components/Local_View.jsx` — box tools (switch/close/clearAll) + localView state +
  ResizeObserver + body Ask‑AI + info button removed
- `src/components/Graph_Pannel.jsx` — `setGraphView` + graph state + header/Ask‑AI cleanup
- `src/components/Direction_view.jsx` — camera tools + orbit sync + ResizeObserver +
  blue accent + body Ask‑AI + expand reposition
- `src/components/MarkdownLite.jsx` — tables, rules, code, italics

**Design docs**
- `docs/superpowers/specs/2026-06-14-agentic-tissue-ai-design.md` — design spec
- `docs/superpowers/plans/2026-06-14-agentic-tissue-ai-phase1.md` — Phase 1 plan
- `docs/superpowers/plans/2026-06-14-agentic-tissue-ai-phase2.md` — Phase 2 plan
- `docs/TISSUE_INTELLIGENCE.md` — this document

---

## 8. How to run & test

```bash
npx vite --port 3001     # dev server → http://localhost:3001/
npx vite build           # production build (pre-existing WebGLMultisampleRenderTarget
                         # warnings are unrelated)
node --test              # service unit tests (the legacy root test.js failing on
                         # "document is not defined" is pre-existing/unrelated)
```

To exercise the agent: open **Settings**, configure a provider (Gemini key or local
endpoint), then click **Tissue Intelligence** on Main View (or **Ask AI** on a panel) and
type commands. Maximize a panel to use the docked chat.

Unit tests cover the pure modules (`actionParser`, `channelCatalog`, `actionRegistry`,
`agentTools`, `composeChatSystem`). The React/3D wiring is verified via build + manual
checks (there is no DOM test environment in this repo).

---

## 9. Known limitations / next ideas

- **Channel opacity** is stored but not applied by the renderer, so no `setChannelOpacity`
  tool exists (it would be a no‑op).
- **Local View camera** tools are not wired (the camera lives in a per‑tab inner
  component); only Direction View has agent camera control.
- Agent `setView` sets the camera pose directly; in Direction View it now stays in sync
  with manual orbit, but Local View camera is not yet agent‑controllable.
- Actions are parsed on **turn completion** (not mid‑stream), and the agent acts only in
  response to the user (no autonomous multi‑step planning).
- Candidate future tools: Local View camera (reset/fit), `describeView` (structured
  summary), region‑by‑arbitrary‑markers, draw/select a box from text.
