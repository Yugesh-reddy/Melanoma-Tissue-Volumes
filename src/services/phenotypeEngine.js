// Deterministic phenotype + tumor-microenvironment engine.
//
// Pure functions only (no React / browser / d3 deps) so this is unit-testable
// in Node. It consumes a marker map of *relative expression* values in [0, 1]
// (mean intensity normalized into each channel's data range) and produces:
//   - phenotype population scores & proportions
//   - a TME immunophenotype (hot / warm / cold)
//   - a checkpoint-relevance flag
//   - a proliferation index
//   - key drivers
//
// The LLM then explains these computed findings rather than inventing biology,
// which is what makes the output grounded.

import { MARKER_KB, getMarkerInfo, STRUCTURAL_CATEGORIES } from './markerKnowledgeBase';

// Cell-population rules. Each phenotype is keyed on the LINEAGE-SPECIFIC
// marker(s) for that cell type; the score is the strongest of those markers
// present in the analyzed panel. We deliberately do NOT require co-markers
// (e.g. CD3E for T cells), because the imaging panel / selected channel groups
// often don't include them — requiring them would silently zero out whole
// populations and leave only the tumor showing.
export const PHENOTYPE_RULES = [
  { id: 'melanoma',    label: 'Melanoma / tumor cells',        category: 'tumor',      color: '#e0457b', markers: ['SOX10', 'MART1', 'MITF', 'PMEL', 'S100B', 'PRAME'] },
  { id: 'cd8_t',       label: 'Cytotoxic T cells (CD8+)',      category: 'immune',     color: '#3b82f6', markers: ['CD8a', 'GranzymeB'] },
  { id: 'cd4_t',       label: 'Helper T cells (CD4+)',         category: 'immune',     color: '#60a5fa', markers: ['CD4'] },
  { id: 'treg',        label: 'Regulatory T cells (Treg)',     category: 'immune',     color: '#8b5cf6', markers: ['FOXP3'] },
  { id: 'b_cell',      label: 'B cells',                       category: 'immune',     color: '#22d3ee', markers: ['CD20'] },
  { id: 'm2_macro',    label: 'M2 macrophages',                category: 'immune',     color: '#14b8a6', markers: ['CD163', 'CD206'] },
  { id: 'dc',          label: 'Dendritic cells',               category: 'immune',     color: '#2dd4bf', markers: ['CD11c'] },
  { id: 'myeloid',     label: 'Myeloid cells',                 category: 'immune',     color: '#0ea5e9', markers: ['CD11b', 'LysozymeC'] },
  { id: 'mast',        label: 'Mast cells',                    category: 'immune',     color: '#a78bfa', markers: ['Mast cell tryptase'] },
  { id: 'granulocyte', label: 'Granulocytes',                  category: 'immune',     color: '#38bdf8', markers: ['CD15'] },
  { id: 'vasculature', label: 'Vasculature (endothelial)',     category: 'stroma',     color: '#f59e0b', markers: ['CD31'] },
  { id: 'lymphatic',   label: 'Lymphatic vessels',             category: 'stroma',     color: '#fbbf24', markers: ['Podoplanin'] },
  { id: 'stroma',      label: 'Stroma / ECM',                  category: 'stroma',     color: '#a3a3a3', markers: ['Collagen (SHG)', 'Vimentin'] },
  { id: 'epithelial',  label: 'Epithelial / keratinocyte',     category: 'epithelial', color: '#fb923c', markers: ['pan-cytokeratin', 'E-cadherin'] }
];

const CHECKPOINT_MARKERS = ['PDL1', 'PD1', 'LAG3', 'FOXP3'];
const PROLIFERATION_MARKERS = ['Ki67', 'CyclinD1'];

// relativeExpression is now a per-marker normalized ABUNDANCE in [0,1] (see
// regionStats). Composition proportions are relative, so we only drop near-zero
// populations with a low floor; the TME class is derived from the immune *share*
// of the composition (relative), which needs no absolute calibration. Tunable.
const PRESENCE_THRESHOLD = 0.04;    // populations below this abundance are dropped
const CHECKPOINT_THRESHOLD = 0.2;   // checkpoint marker abundance to flag
const TME_HOT = 0.6;                // immune-vs-tumor balance for "hot" (immune clearly > tumor)
const TME_WARM = 0.4;               // balance for "intermediate"

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Build a { markerName: relativeExpression } map from a region summary's markers.
 */
export const buildMarkerMap = (markers = []) => {
  const map = {};
  for (const m of markers) {
    if (m && typeof m.relativeExpression === 'number') {
      map[m.name] = clamp01(m.relativeExpression);
    }
  }
  return map;
};

/**
 * Score every phenotype rule against the marker map.
 * @returns {Array} rules annotated with { score, hasData, presentMarkers }
 */
export const scorePhenotypes = (markerMap) => {
  return PHENOTYPE_RULES.map((rule) => {
    const present = rule.markers.filter((m) => markerMap[m] !== undefined);
    const values = present.map((m) => markerMap[m]);
    // Strongest lineage marker present defines the population's abundance.
    const score = values.length ? Math.max(...values) : 0;
    return {
      ...rule,
      score,
      hasData: present.length > 0,
      presentMarkers: present
    };
  });
};

/**
 * Convert phenotype scores into proportions across the phenotypes that clear
 * the presence threshold. Returns the full list sorted by score desc, each with
 * a `proportion` in [0, 1] (0 for sub-threshold phenotypes).
 */
export const phenotypeProportions = (scored) => {
  const present = scored.filter((p) => p.score >= PRESENCE_THRESHOLD);
  const total = present.reduce((s, p) => s + p.score, 0);
  return scored
    .map((p) => ({
      ...p,
      proportion: total > 0 && p.score >= PRESENCE_THRESHOLD ? p.score / total : 0
    }))
    .sort((a, b) => b.score - a.score);
};

/**
 * Classify the tumor microenvironment from the composition (proportions).
 * Uses the immune *share* of the called composition — a relative measure that
 * needs no absolute calibration and varies meaningfully per box.
 * NOTE: true hot/excluded/desert distinction needs spatial proximity (Phase 3).
 */
export const classifyTME = (phenotypes) => {
  // Compare the strongest immune population's abundance against the tumor
  // abundance (not the summed share of many tiny immune populations, which would
  // wrongly call a tumor-dominant box "hot").
  const immuneScores = phenotypes.filter((p) => p.category === 'immune').map((p) => p.score);
  const tumorScores = phenotypes.filter((p) => p.category === 'tumor').map((p) => p.score);
  const immuneMax = immuneScores.length ? Math.max(...immuneScores) : 0;
  const tumorMax = tumorScores.length ? Math.max(...tumorScores) : 0;
  const immuneShare = immuneMax + tumorMax > 0 ? immuneMax / (immuneMax + tumorMax) : 0;

  let cls, label, color, description;
  if (immuneShare >= TME_HOT) {
    cls = 'hot';
    label = 'Immune-hot';
    color = '#ef4444';
    description = 'Immune cells make up a large share of this region — inflamed microenvironment.';
  } else if (immuneShare >= TME_WARM) {
    cls = 'warm';
    label = 'Immune-intermediate';
    color = '#f59e0b';
    description = 'Moderate immune presence alongside other populations.';
  } else {
    cls = 'cold';
    label = 'Immune-cold';
    color = '#3b82f6';
    description = 'Few immune cells relative to other populations — immunologically quiet.';
  }

  return {
    cls,
    label,
    color,
    description,
    immuneIndex: immuneMax,
    tumorIndex: tumorMax,
    immuneToTumor: immuneShare
  };
};

/**
 * Checkpoint / exhaustion relevance from PD1/PDL1/LAG3/FOXP3.
 */
export const checkpointSignal = (markerMap) => {
  const present = CHECKPOINT_MARKERS
    .map((m) => ({ name: m, value: markerMap[m] ?? 0, info: getMarkerInfo(m) }))
    .filter((x) => x.value >= CHECKPOINT_THRESHOLD)
    .sort((a, b) => b.value - a.value);
  return { flagged: present.length > 0, markers: present };
};

/**
 * Proliferation index from Ki67 / CyclinD1.
 */
export const proliferationSignal = (markerMap) => {
  const values = PROLIFERATION_MARKERS.map((m) => markerMap[m] ?? 0);
  const index = Math.max(0, ...values);
  let level;
  if (index >= 0.3) level = 'high';
  else if (index >= 0.15) level = 'moderate';
  else level = 'low';
  return { index, level };
};

/**
 * Top biologically-meaningful markers by relative expression (drops structural
 * / housekeeping channels like Hoechst, actin, tubulin, lamin).
 */
export const keyDrivers = (markers = [], n = 5) => {
  return markers
    .filter((m) => !STRUCTURAL_CATEGORIES.has(getMarkerInfo(m.name).category))
    .filter((m) => typeof m.relativeExpression === 'number')
    .sort((a, b) => b.relativeExpression - a.relativeExpression)
    .slice(0, n)
    .map((m) => ({
      name: m.name,
      relativeExpression: m.relativeExpression,
      info: getMarkerInfo(m.name)
    }));
};

/**
 * Run the full deterministic engine over a region summary.
 * @param {Object} summary - output of computeRegionSummary (markers must carry
 *                           a relativeExpression field).
 */
export const runEngine = (summary) => {
  const markers = summary?.markers || [];
  const markerMap = buildMarkerMap(markers);
  const scored = scorePhenotypes(markerMap);
  const phenotypes = phenotypeProportions(scored);
  return {
    phenotypes,
    topPhenotypes: phenotypes.filter((p) => p.proportion > 0),
    tme: classifyTME(phenotypes),
    checkpoint: checkpointSignal(markerMap),
    proliferation: proliferationSignal(markerMap),
    drivers: keyDrivers(markers)
  };
};
