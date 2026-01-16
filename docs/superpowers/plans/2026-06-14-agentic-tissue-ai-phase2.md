# Agentic Tissue AI — Phase 2 (Large View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the maximized ("large") view first-class: fix the 3D panels so they resize/recenter when maximized, dock the AI beside the canvas in the large view, and give the agent camera + panel-navigation tools.

**Architecture:** Builds on Phase 1 (action registry, parser, tool catalog, chat). A `ResizeObserver` fixes the renderer/camera when the container (not the window) changes size. The existing chat UI inside `TissueIntelligenceWindow` is extracted into a shared `TissueChatView`; a new `ExpandedAgentDock` reuses it as a right-side panel rendered inside the maximized layout. Camera and panel-nav executors register into the Phase-1 registry.

**Tech Stack:** React 18, Vite, three.js, plain JS ES modules. Pure helpers get `node --test`; React/3D wiring is verified with `npx vite build` + manual checks.

**Depends on:** Phase 1 (committed). Spec: `docs/superpowers/specs/2026-06-14-agentic-tissue-ai-design.md`.

---

## File structure

New:
- `src/services/agentTools.phase2.js` additions — extend the existing `src/services/agentTools.js` TOOL_CATALOG with camera + panel tools (no new file; edit the catalog)
- `src/components/TissueChatView.jsx` — shared chat UI (context switcher + body + composer), extracted from `TissueIntelligenceWindow`
- `src/components/ExpandedAgentDock.jsx` — right-side AI dock for the maximized layout

Modified:
- `src/components/Direction_view.jsx` — `ResizeObserver` + recenter
- `src/components/Local_View.jsx` — `ResizeObserver` on the 3D content
- `src/components/TissueIntelligenceWindow.jsx` — consume `TissueChatView`
- `src/App.jsx` — render `ExpandedAgentDock` in the maximized layout; suppress floating window while maximized; register panel-nav actions
- `src/services/agentTools.js` — add camera + panel tools to the catalog

---

## Task 1: Direction View resize + recenter

**Files:**
- Modify: `src/components/Direction_view.jsx`

Background: the 3D scene is set up in a `useEffect` (~line 88) with refs `mountRef` (container), `sceneRef`, `cameraRef`, `rendererRef`. Camera is a `PerspectiveCamera(50, width/height, …)` aimed at origin `(0,0,0)`; arrows are added around the origin. There is currently a `handleResize` that reads `container.clientWidth/Height` and a `window.addEventListener('resize', handleResize)` (~line 206-212). When a panel is **maximized**, the window does not resize — only the container does — so the renderer keeps its old size and the camera aspect is wrong, pushing the arrows off-center.

- [ ] **Step 1: Locate the resize code**

Run: `grep -n "handleResize\|addEventListener('resize'\|removeEventListener('resize'\|clientWidth" src/components/Direction_view.jsx`
Confirm there is a `handleResize` function and matching add/removeEventListener('resize', handleResize) inside the main scene `useEffect`.

- [ ] **Step 2: Replace the window resize listener with a ResizeObserver**

Find the existing block (it looks like):
```jsx
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);
```
Replace it with a version that observes the container AND guards against zero size:
```jsx
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      if (newWidth === 0 || newHeight === 0) return;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
      camera.lookAt(0, 0, 0); // keep arrows centered after a resize
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);
```

- [ ] **Step 3: Update the cleanup**

In the same `useEffect`'s return cleanup, find `window.removeEventListener('resize', handleResize);` and add the observer disconnect right after it:
```jsx
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
```

- [ ] **Step 4: Verify build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built` (pre-existing WebGLMultisampleRenderTarget warnings OK).

- [ ] **Step 5: Manual check**

Run `npx vite --port 3001`, open localhost:3001, select a region so arrows render, then double-click the Direction View header to maximize.
Expected: the arrows resize to fill the panel and stay centered (no longer clustered top-left).

- [ ] **Step 6: Commit**

```bash
git add src/components/Direction_view.jsx
git commit -m "fix: Direction View resizes and recenters when maximized (ResizeObserver)"
```

---

## Task 2: Local View 3D content resize

**Files:**
- Modify: `src/components/Local_View.jsx`

Background: the inner `LocalViewContent` component mounts a three.js renderer into a `mountRef` and has its own scene `useEffect`. It likely also only listens to `window` resize, so the maximized Local View has the same problem.

- [ ] **Step 1: Locate the resize code in LocalViewContent**

Run: `grep -n "handleResize\|addEventListener('resize'\|removeEventListener('resize'\|ResizeObserver\|mountRef" src/components/Local_View.jsx`
Identify the scene `useEffect` that creates the renderer/camera and its resize handler. Note the container variable name (the `mountRef.current` it appends to) and the camera/renderer ref names.

- [ ] **Step 2: Add a ResizeObserver alongside the existing resize handler**

In that `useEffect`, immediately AFTER the existing `window.addEventListener('resize', handleResize)` (use the actual handler name found in step 1; if there is none, create one that updates `camera.aspect`, calls `camera.updateProjectionMatrix()`, and `renderer.setSize(container.clientWidth, container.clientHeight)`), add:
```jsx
    const localResizeObserver = new ResizeObserver(() => handleResize());
    localResizeObserver.observe(container);
```
(Use the actual container variable name from step 1 in `.observe(...)`.)

- [ ] **Step 3: Disconnect on cleanup**

In the same `useEffect` cleanup return, after the existing `window.removeEventListener('resize', handleResize)`, add:
```jsx
    localResizeObserver.disconnect();
```

- [ ] **Step 4: Verify build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 5: Manual check**

Maximize the Local View (double-click its header). Expected: the 3D tissue box scales up to fill the panel instead of staying small/centered.

- [ ] **Step 6: Commit**

```bash
git add src/components/Local_View.jsx
git commit -m "fix: Local View 3D content resizes when maximized (ResizeObserver)"
```

> If the camera/renderer for the active tab is recreated per tab, ensure the observer attaches to the visible content's container. If you cannot cleanly identify the single renderer (multiple tabs), report DONE_WITH_CONCERNS describing what you found.

---

## Task 3: Extract shared TissueChatView

**Files:**
- Create: `src/components/TissueChatView.jsx`
- Modify: `src/components/TissueIntelligenceWindow.jsx`

Background: `TissueIntelligenceWindow.jsx` currently renders, inside its draggable frame: a **context switcher** (the thread chips, ~line 204-238), a **body** (findings / narrative / chat turns with action chips, ~line 240-315), and a **composer** (textarea + send, ~line 317 onward). These three sections are reusable for the dock. Extract them into `TissueChatView` which reads everything from `useTissueIntelligence()` itself (so both the window and the dock just render `<TissueChatView />`).

- [ ] **Step 1: Read the full component**

Run: `sed -n '1,400p' src/components/TissueIntelligenceWindow.jsx` and identify: the imports (MarkdownLite, RegionFindings, GeminiSpark, useTissueIntelligence, useState for draft, ContextCard, Skeleton helpers), the context switcher block, the body block, the composer block, and any local helper components/styles (`iconBtn`, `Skeleton`, `ContextCard`).

- [ ] **Step 2: Create `src/components/TissueChatView.jsx`**

Move the context-switcher + body + composer JSX into a new component. It should:
- `import` React (with `useState`), `MarkdownLite`, `RegionFindings`, and any helpers it uses (move `Skeleton` and `ContextCard` here, or import them if you keep them in the window file — prefer moving them here since only the chat view uses them).
- Call `const { threads, threadOrder, activeThread, activeContextId, setActive, removeThread, sendMessage, retryAnalysis, undoAction, openSettings } = useTissueIntelligence();` plus `const configured = isConfigured();` (import `isConfigured` from `../services/llmConfig`).
- Hold its own `const [draft, setDraft] = useState('')` and `handleSend` (same logic as the window currently uses: `sendMessage(activeThread.id, draft); setDraft('')`).
- Render the three sections exactly as they currently appear (context switcher, body, composer), preserving all styles, the action chips, and Undo wiring.
- NOT render the draggable title bar (that stays in the window) — but DO include the context switcher, body, and composer.
- Accept one optional prop `style` applied to its root wrapper so the dock can size it.

Root wrapper:
```jsx
return (
  <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, ...style }}>
    {/* context switcher */}
    {/* body */}
    {/* composer */}
  </div>
);
```

- [ ] **Step 3: Use it in TissueIntelligenceWindow**

In `TissueIntelligenceWindow.jsx`, remove the now-extracted switcher/body/composer JSX and replace with `<TissueChatView />` (keep the draggable title bar, the resize handle, and the floating-frame wrapper). Remove now-unused imports/helpers from the window file (whatever moved into `TissueChatView`). Keep the window's own `draft` state ONLY if still used — it should now live in `TissueChatView`, so delete it from the window.

- [ ] **Step 4: Verify build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 5: Manual check**

Open the floating Tissue Intelligence window — it must look and behave exactly as before (thread chips, findings, streaming, chat, action chips, Undo, send).

- [ ] **Step 6: Commit**

```bash
git add src/components/TissueChatView.jsx src/components/TissueIntelligenceWindow.jsx
git commit -m "refactor: extract shared TissueChatView from the floating window"
```

> This is a refactor of a large existing component. If decoupling a helper (`ContextCard`/`Skeleton`) proves entangled, keep it in the window file and import it into `TissueChatView` instead — report what you did.

---

## Task 4: Expanded-view right-side dock

**Files:**
- Create: `src/components/ExpandedAgentDock.jsx`
- Modify: `src/App.jsx`

Background: App tracks `maximizedPanel` (`'local' | 'graph' | 'direction' | null`). The maximized panel wrapper uses `maximizedStyle` (absolute inset 0, zIndex 1000) — see `panelStyle`/`maximizedStyle` near line 40-56 and the bottom-panels render near line 322-352. The floating `TissueIntelligenceWindow` is rendered near the end of App (~line 357). For the large view we want: when a panel is maximized, lay the panel canvas on the left and a ~320px AI dock on the right, and hide the floating window.

- [ ] **Step 1: Create `src/components/ExpandedAgentDock.jsx`**

```jsx
// Right-side AI dock shown inside the maximized panel layout. Reuses the
// shared TissueChatView; the panel canvas sits to its left.

import React from 'react';
import TissueChatView from './TissueChatView';
import { useTissueIntelligence } from '../services/tissueIntelligenceContext';

const GEMINI_PURPLE = '#9168C0';

export default function ExpandedAgentDock() {
  const { openSettings, close } = useTissueIntelligence();
  return (
    <div style={{
      width: '340px', flexShrink: 0, height: '100%',
      display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--border)', background: 'var(--bg-1)'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
        borderBottom: '1px solid var(--border)', flexShrink: 0
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: GEMINI_PURPLE }} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '13px', color: 'var(--text-1)' }}>
          Tissue AI
        </span>
        <button type="button" className="mtv-press" title="Settings" onClick={openSettings}
          style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-2)', cursor: 'pointer', padding: '2px 7px' }}>⚙</button>
      </div>
      <TissueChatView />
    </div>
  );
}
```

- [ ] **Step 2: Restructure the maximized panel layout in App.jsx**

The bottom-panels row currently renders three wrappers, each `style={maximizedPanel === X ? maximizedStyle : panelStyle}`. When maximized, the wrapper is an absolute full-area overlay. Change ONLY the maximized wrapper to be a flex row containing the panel (flex:1) and the dock. The simplest robust approach: wrap the maximized panel content and the dock together.

Replace the three panel wrappers' maximized branch so that when a given panel is maximized, its wrapper uses `maximizedStyle` PLUS `display:'flex'` and renders the panel component (in a `flex:1` div) followed by `<ExpandedAgentDock />`. Example for the Local wrapper:
```jsx
            <div style={maximizedPanel === 'local' ? { ...maximizedStyle, display: 'flex' } : panelStyle}>
              <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                <Local_View
                  selectedRegionsData={selectedRegionsData}
                  channels={channels}
                  onRemoveSelection={handleRemoveSelection}
                  onClearAllSelections={handleClearAllSelections}
                  onToggleMaximize={() => toggleMaximize('local')}
                  isMaximized={maximizedPanel === 'local'}
                />
              </div>
              {maximizedPanel === 'local' && <ExpandedAgentDock />}
            </div>
```
Apply the SAME pattern to the Graph and Direction wrappers (wrap their component in a `flex:1` div and append `{maximizedPanel === 'graph' && <ExpandedAgentDock />}` / `'direction'`). For the NON-maximized case the extra `flex:1` wrapper div is harmless (panel fills it).

Add the import at the top of App.jsx:
```jsx
import ExpandedAgentDock from './components/ExpandedAgentDock';
```

- [ ] **Step 3: Suppress the floating window while maximized**

Find where `<TissueIntelligenceWindow />` is rendered (~line 357). Wrap it so it only renders when no panel is maximized:
```jsx
      {!maximizedPanel && <TissueIntelligenceWindow />}
```

- [ ] **Step 4: Open the dock's thread when maximizing (optional nicety)**

When a panel is maximized the dock shows whatever context is active. No code needed for v1 — the user clicks Ask AI (badge/chip) to open the relevant context, which the dock then shows. Leave as-is.

- [ ] **Step 5: Verify build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 6: Manual check**

Maximize a panel → a 340px AI dock appears on the right, canvas fills the rest, and the floating window does not show. Restore → floating window behavior returns.

- [ ] **Step 7: Commit**

```bash
git add src/components/ExpandedAgentDock.jsx src/App.jsx
git commit -m "feat: right-side AI dock in the maximized panel view"
```

---

## Task 5: Camera action executors

**Files:**
- Modify: `src/services/agentTools.js` (catalog), `src/components/Direction_view.jsx`, `src/components/Local_View.jsx`

Add three tools to the catalog and register executors from whichever 3D panel is mounted. Keep them simple and reversible.

- [ ] **Step 1: Add camera tools to the catalog**

In `src/services/agentTools.js`, append to the `TOOL_CATALOG` array:
```js
  { name: 'resetCamera', args: '{ "panel": "local" }', description: 'Reset the camera in a 3D panel ("local" or "direction") to its default view.' },
  { name: 'setView', args: '{ "panel": "direction", "orientation": "top" }', description: 'Orient a 3D panel camera: "top" | "front" | "side" | "iso".' },
  { name: 'focusCamera', args: '{ "panel": "local" }', description: 'Frame/fit the content in a 3D panel to fill the view.' }
```
Run `node --test src/services/agentTools.test.js` — the existing 2 tests still pass (they only assert phase-1 tool presence + format).

- [ ] **Step 2: Register camera executors in Direction_view.jsx**

In `Direction_view.jsx`, get the registry (`const { registerActions, unregisterActions } = useAgentActions();` — add the import `import { useAgentActions } from '../services/agentActions';` if not present). After the scene refs exist, add an effect that registers a `resetCamera`/`setView`/`focusCamera` keyed to `panel === 'direction'`:
```jsx
  useEffect(() => {
    const applies = (p) => p === 'direction' || p === undefined;
    const reset = ({ panel } = {}) => {
      if (!applies(panel) || !cameraRef.current) return { message: 'No direction camera here.' };
      cameraRef.current.position.set(0.5, 0.5, 1.5);
      cameraRef.current.lookAt(0, 0, 0);
      return { message: 'Reset Direction View camera' };
    };
    const setView = ({ panel, orientation } = {}) => {
      if (!applies(panel) || !cameraRef.current) return { message: 'No direction camera here.' };
      const d = 1.5;
      const poses = { top: [0, d, 0.001], front: [0, 0, d], side: [d, 0, 0], iso: [d, d, d] };
      const p = poses[orientation] || poses.iso;
      cameraRef.current.position.set(p[0], p[1], p[2]);
      cameraRef.current.lookAt(0, 0, 0);
      return { message: `Direction View: ${orientation || 'iso'} view` };
    };
    registerActions({ resetCamera: reset, setView, focusCamera: reset });
    return () => unregisterActions(['resetCamera', 'setView', 'focusCamera']);
  }, [registerActions, unregisterActions]);
```
Note: because both panels register the same tool names, the LAST mounted wins. That is acceptable for v1 (the maximized panel is the relevant one). If you want both, namespace later — out of scope now.

- [ ] **Step 3: (Optional) Local_View camera reset**

Local_View already has a `resetView` for its camera (the Reset button calls `resetView`). If `resetView` is accessible at the component scope where you can register actions, register `resetCamera`/`focusCamera` for `panel === 'local'` calling `resetView()`. If `resetView` is buried in the inner content component and not reachable, SKIP this step and report it — Direction camera control still works.

- [ ] **Step 4: Verify build + tools test**

Run: `node --test src/services/agentTools.test.js 2>&1 | grep -E "pass|fail"` then `npx vite build 2>&1 | tail -3`.
Expected: tests pass, `✓ built`.

- [ ] **Step 5: Manual check**

Maximize Direction View, in the dock type "show the top view" / "reset the camera". Expected: the arrows reorient.

- [ ] **Step 6: Commit**

```bash
git add src/services/agentTools.js src/components/Direction_view.jsx src/components/Local_View.jsx
git commit -m "feat: agent camera actions (resetCamera/setView/focusCamera)"
```

---

## Task 6: Panel / navigation action executors

**Files:**
- Modify: `src/services/agentTools.js` (catalog), `src/App.jsx`

- [ ] **Step 1: Add panel/nav tools to the catalog**

Append to `TOOL_CATALOG` in `src/services/agentTools.js`:
```js
  { name: 'maximizePanel', args: '{ "panel": "direction" }', description: 'Maximize a bottom panel: "local" | "graph" | "direction".' },
  { name: 'restorePanel', args: '{}', description: 'Restore panels from the maximized state.' }
```

- [ ] **Step 2: Register from App.jsx**

App owns `maximizedPanel` and `toggleMaximize`/the setter. Add the registry hook and an effect. Add import `import { useAgentActions } from './services/agentActions';` (the provider wraps App's children, but App itself is INSIDE AgentActionsProvider only if the provider is above App — it is wrapped in the return, so calling useAgentActions in App will fail because the provider is rendered by App, not above it).

IMPORTANT integration detail: `AgentActionsProvider` is rendered *inside* App's return, so App cannot call `useAgentActions()` directly. Instead, create a tiny child component that lives inside the provider to register panel actions. Add this component in App.jsx (or its own file) and render it inside `<AgentActionsProvider>`:
```jsx
function PanelNavActions({ setMaximizedPanel }) {
  const { registerActions, unregisterActions } = useAgentActions();
  useEffect(() => {
    const valid = ['local', 'graph', 'direction'];
    registerActions({
      maximizePanel: ({ panel }) => {
        if (!valid.includes(panel)) return { message: `Unknown panel "${panel}"` };
        const prev = null;
        setMaximizedPanel(panel);
        return { message: `Maximized ${panel}`, undo: () => setMaximizedPanel(prev) };
      },
      restorePanel: () => { setMaximizedPanel(null); return { message: 'Restored panels' }; }
    });
    return () => unregisterActions(['maximizePanel', 'restorePanel']);
  }, [registerActions, unregisterActions, setMaximizedPanel]);
  return null;
}
```
Render `<PanelNavActions setMaximizedPanel={setMaximizedPanel} />` inside `<AgentActionsProvider>` (use the actual maximized-panel state setter name from App — grep `setMaximizedPanel` / `maximizedPanel`). Add `useEffect` to App's React import and import `useAgentActions`.

- [ ] **Step 3: Verify build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 4: Manual check**

In any chat, type "expand the direction view" → Direction maximizes (dock appears). "restore panels" → returns.

- [ ] **Step 5: Commit**

```bash
git add src/services/agentTools.js src/App.jsx
git commit -m "feat: agent panel navigation actions (maximize/restore)"
```

> `switchBox` (active Box tab) was in the spec but the tab index lives inside Local_View's internal state; defer it unless Local_View exposes a setter. If you skip it, note it.

---

## Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Unit tests**

Run: `node --test`
Expected: all service test suites pass (legacy root `test.js` failing on `document` is pre-existing/unrelated).

- [ ] **Step 2: Build**

Run: `npx vite build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 3: Manual large-view pass (needs a configured LLM provider)**

`npx vite --port 3001`, open localhost:3001, set a provider in Settings, select a region:
- Maximize Direction View → arrows fill + recenter; AI dock on the right; floating window hidden.
- Dock: "reset the camera" / "show top view" → camera reorients.
- Dock: "expand the local view" → switches maximize; "restore panels" → returns.
- Maximize Local View → 3D box fills the panel.
- Channels/regions commands (from Phase 1) still work from the dock with Undo.

- [ ] **Step 4: Final commit (if verification needed tweaks)**

```bash
git add -A && git commit -m "chore: phase-2 large-view verification fixes"
```

---

## Self-review notes

- **Spec coverage:** right-side dock (Tasks 3,4); Direction/Local resize-&-fit (Tasks 1,2); camera tools (Task 5); panel-nav tools (Task 6). `switchBox` deferred with a note (Local_View internal state).
- **Known integration gotcha (called out in Task 6):** `AgentActionsProvider` is rendered inside App, so App's own body can't call `useAgentActions()` — panel-nav actions are registered from a child component (`PanelNavActions`) rendered inside the provider.
- **Naming consistency:** reuses Phase-1 `registerActions`/`unregisterActions`/`runAction`, `TOOL_CATALOG`, `TissueChatView`, `ExpandedAgentDock`, `maximizedPanel` consistently.
- **Verification:** pure catalog change keeps `node --test`; all 3D/React work is build + manual (no DOM test env).
