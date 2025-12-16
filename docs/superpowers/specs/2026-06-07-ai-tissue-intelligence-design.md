# AI Tissue Intelligence — Design

**Date:** 2026-06-07
**Status:** Phase 0 + Phase 1 implemented; Phases 2–4 specified at architecture level.

## Goal

Turn the thin "AI Analysis" LLM wrapper into an **AI Tissue Intelligence** system for the
Melanoma Tissue Volumes dashboard. Every AI feature is grounded in a shared biology
knowledge base + deterministic engines, with the LLM acting as the *explainer* on top of
computed findings — so the product reads as computational pathology, not an API wrapper.

Audience: recruiter-facing portfolio piece *and* a genuinely useful spatial-biology tool.
Architecture: client-side-first (deploys to GitHub Pages, user-supplied Gemini key), but AI
logic lives in swappable service modules so a backend can be added later without UI changes.

## Shared foundation (Phase 0)

- **`src/services/markerKnowledgeBase.js`** — curated map of each cleaned channel name →
  `{ category, cellType, function }`. Categories: tumor, immune-T, immune-B, immune-myeloid,
  vasculature, proliferation, checkpoint, stroma, structural, epigenetic, metabolic.
  Derived from standard melanoma CyCIF panels; requires expert validation (covered by the
  existing in-UI disclaimer).
- **`src/services/phenotypeEngine.js`** — pure functions: `scorePhenotypes`, `classifyTME`,
  `checkpointSignal`, `runEngine`. Consumes a marker map of relative-expression values
  (0–1) and produces deterministic phenotype proportions, a TME immunophenotype, a
  checkpoint-relevance flag, proliferation index, and key drivers. No browser/React deps,
  so it is unit-testable in Node.
- **`src/components/MarkdownLite.jsx`** — minimal markdown renderer (headings, bold, bullet
  lists, paragraphs) used to render the streaming LLM narrative as structured text.
- **`regionStats.computeRegionSummary`** extended to expose per-marker
  `relativeExpression` (mean normalized into the channel's data range, 0–1) — the grounded,
  cross-channel-comparable signal the engine consumes.

## Phase 1 — Flagship: grounded phenotyping + TME classifier

Flow: draw box → `computeRegionSummary` → `runEngine(summary)` (instant, deterministic) →
render cards immediately → `streamAnalysis({ summary, engine })` streams a grounded LLM
narrative constrained to the computed findings.

Deterministic outputs:
- **Phenotype breakdown** — proportions across populations (melanoma, CD8/CD4/Treg T cells,
  B cells, M2 macrophages, DCs, myeloid, mast, granulocytes, vasculature, lymphatics, stroma,
  epithelial). AND-rules (e.g. CD8a+CD3E) require co-expression (min); lineage rules use max.
- **TME immunophenotype badge** — hot / warm / cold from immune-infiltration index.
  (True hot/excluded/desert distinction needs spatial proximity → Phase 3.)
- **Checkpoint-relevance flag** — PD1/PDL1/LAG3/FOXP3 above threshold.
- **Proliferation index** — Ki67 / CyclinD1.
- **Key drivers** — top markers by relative expression (structural/nuclear excluded).

UI: TME badge, checkpoint + proliferation chips, phenotype bars colored by category, key-driver
chips, streaming AI narrative (MarkdownLite), caveat footer. The deterministic cards appear
before the narrative streams, so the panel is useful even without an API key.

## Phase 2 — Conversation + multi-region comparison (specified)

- Multi-turn "chat with your tissue" retaining region summary + engine result as context.
- AI narrative diff of two boxes layered on the existing violin comparison.

## Phase 3 — ML depth (specified)

- `ml-kmeans` on per-voxel multi-channel vectors → discovered cell niches, AI-labeled.
- Immune-to-tumor voxel proximity → upgrades TME to hot / excluded / desert.
- Sliding-window "interestingness" scan → auto-suggested regions of interest.

## Phase 4 — Exportable AI report (specified)

- Compile region analyses (engine + narrative) into a downloadable markdown/PDF report.

## Non-goals

- No backend in this iteration (designed for, not built).
- Not a diagnostic tool; research support only.
