// Curated biomarker knowledge base for the melanoma CyCIF panel.
//
// Keys are the *cleaned* biomarker names produced by getBiomarkerName()
// (i.e. with "(do not use)" suffixes stripped). Each entry classifies the
// marker so the phenotype engine and the LLM explainer share one grounded
// source of biology rather than the model inventing associations.
//
// Categories:
//   tumor          - melanoma / melanocytic lineage
//   immune-T       - T lymphocytes
//   immune-B       - B lymphocytes
//   immune-myeloid - macrophages, DCs, monocytes, granulocytes, mast cells
//   checkpoint     - immune checkpoint / exhaustion
//   vasculature    - endothelial / lymphatic
//   proliferation  - cell-cycle / proliferation
//   stroma         - ECM / mesenchymal
//   epithelial     - keratinocyte / epithelial
//   structural     - cytoskeleton / nuclear lamina / housekeeping
//   epigenetic     - chromatin / DNA modification
//   metabolic      - mitochondrial / oxidative
//   immune-activation - interferon response / antigen presentation
//   dna-damage     - DNA-damage response
//
// NOTE: assignments follow standard melanoma multiplexed-imaging panels and
// require expert validation before any biological conclusion. The UI surfaces
// this caveat.

export const MARKER_KB = {
  // --- Melanoma / melanocytic lineage ---
  'SOX10':           { category: 'tumor', cellType: 'Melanoma / melanocyte', func: 'Neural-crest / melanocytic transcription factor' },
  'MART1':           { category: 'tumor', cellType: 'Melanoma / melanocyte', func: 'Melanocyte differentiation antigen (MLANA)' },
  'MITF':            { category: 'tumor', cellType: 'Melanoma / melanocyte', func: 'Master melanocytic transcription factor' },
  'PMEL':            { category: 'tumor', cellType: 'Melanoma / melanocyte', func: 'Melanosomal matrix protein (gp100)' },
  'S100B':           { category: 'tumor', cellType: 'Melanoma / melanocyte', func: 'Melanoma-associated S100 protein' },
  'S100A':           { category: 'tumor', cellType: 'Melanoma / inflammatory', func: 'S100 protein; tumor & inflammation' },
  'PRAME':           { category: 'tumor', cellType: 'Melanoma', func: 'Preferentially expressed antigen in melanoma' },
  'SOX9':            { category: 'tumor', cellType: 'Melanocytic / progenitor', func: 'Melanocyte progenitor transcription factor' },

  // --- T lymphocytes ---
  'CD3E':            { category: 'immune-T', cellType: 'Pan T cell', func: 'T-cell receptor complex' },
  'CD8a':            { category: 'immune-T', cellType: 'Cytotoxic T cell', func: 'CD8 cytotoxic T-cell co-receptor' },
  'CD4':             { category: 'immune-T', cellType: 'Helper T cell', func: 'CD4 helper T-cell co-receptor' },
  'FOXP3':           { category: 'immune-T', cellType: 'Regulatory T cell (Treg)', func: 'Treg master transcription factor' },
  'CD103':           { category: 'immune-T', cellType: 'Tissue-resident memory T cell', func: 'ITGAE; tissue residency' },
  'GranzymeB':       { category: 'immune-T', cellType: 'Cytotoxic effector (CD8/NK)', func: 'Cytotoxic granule serine protease' },

  // --- B lymphocytes ---
  'CD20':            { category: 'immune-B', cellType: 'B cell', func: 'B-lymphocyte surface marker (MS4A1)' },

  // --- Myeloid / innate ---
  'CD163':           { category: 'immune-myeloid', cellType: 'M2 macrophage', func: 'Scavenger receptor; M2 polarization' },
  'CD206':           { category: 'immune-myeloid', cellType: 'M2 macrophage', func: 'Mannose receptor (MRC1); M2' },
  'CD11b':           { category: 'immune-myeloid', cellType: 'Myeloid cell', func: 'ITGAM; monocyte/macrophage/granulocyte' },
  'CD11c':           { category: 'immune-myeloid', cellType: 'Dendritic cell / myeloid', func: 'ITGAX; DC marker' },
  'LysozymeC':       { category: 'immune-myeloid', cellType: 'Macrophage / granulocyte', func: 'Antimicrobial enzyme' },
  'CD15':            { category: 'immune-myeloid', cellType: 'Granulocyte / neutrophil', func: 'Granulocyte surface carbohydrate' },
  'Mast cell tryptase': { category: 'immune-myeloid', cellType: 'Mast cell', func: 'Mast-cell granule protease' },

  // --- Checkpoint / exhaustion ---
  'PD1':             { category: 'checkpoint', cellType: 'Exhausted/activated T cell', func: 'PDCD1 inhibitory receptor' },
  'PDL1':            { category: 'checkpoint', cellType: 'Tumor / APC', func: 'PD-1 ligand; immune evasion' },
  'LAG3':            { category: 'checkpoint', cellType: 'Exhausted T cell', func: 'Inhibitory checkpoint receptor' },

  // --- Vasculature / lymphatic ---
  'CD31':            { category: 'vasculature', cellType: 'Endothelial cell', func: 'PECAM1; blood vessels' },
  'Podoplanin':      { category: 'vasculature', cellType: 'Lymphatic endothelial / stroma', func: 'Lymphatic vessel marker' },

  // --- Proliferation ---
  'Ki67':            { category: 'proliferation', cellType: 'Proliferating cell', func: 'MKI67; active cell cycle' },
  'CyclinD1':        { category: 'proliferation', cellType: 'Proliferating cell', func: 'G1/S cell-cycle driver' },

  // --- Stroma / mesenchymal ---
  'Collagen (SHG)':  { category: 'stroma', cellType: 'ECM / fibrous stroma', func: 'Collagen second-harmonic signal' },
  'Vimentin':        { category: 'stroma', cellType: 'Mesenchymal / EMT', func: 'Mesenchymal intermediate filament' },

  // --- Epithelial ---
  'pan-cytokeratin': { category: 'epithelial', cellType: 'Epithelial / keratinocyte', func: 'Epithelial intermediate filaments' },
  'E-cadherin':      { category: 'epithelial', cellType: 'Epithelial', func: 'Adherens-junction adhesion' },

  // --- Immune activation / antigen presentation ---
  'MHC-I':           { category: 'immune-activation', cellType: 'Most nucleated cells', func: 'Antigen presentation to CD8' },
  'MHC-II':          { category: 'immune-activation', cellType: 'Antigen-presenting cell', func: 'Antigen presentation to CD4' },
  'MX1':             { category: 'immune-activation', cellType: 'IFN-responsive cell', func: 'Type-I interferon response' },
  'IRF1':            { category: 'immune-activation', cellType: 'IFN-responsive cell', func: 'Interferon regulatory factor' },

  // --- Signaling / adhesion ---
  'B-catenin':       { category: 'signaling', cellType: 'Many', func: 'Wnt signaling / cell adhesion' },
  'pMLC2':           { category: 'signaling', cellType: 'Many', func: 'Actomyosin contractility' },

  // --- Epigenetic / chromatin ---
  'H3K27me3':        { category: 'epigenetic', cellType: 'Many', func: 'Repressive histone mark' },
  "5'hmC":           { category: 'epigenetic', cellType: 'Many', func: '5-hydroxymethylcytosine DNA mark' },
  'BAF1':            { category: 'epigenetic', cellType: 'Many', func: 'Chromatin remodeling' },

  // --- DNA damage ---
  'y-H2AX':          { category: 'dna-damage', cellType: 'Many', func: 'Double-strand-break marker' },

  // --- Metabolic ---
  'COX-IV':          { category: 'metabolic', cellType: 'Many', func: 'Mitochondrial oxidative phosphorylation' },
  'Catalase':        { category: 'metabolic', cellType: 'Many', func: 'Oxidative-stress detoxification' },

  // --- Structural / housekeeping (excluded from "key drivers") ---
  'Hoechst':         { category: 'structural', cellType: 'All nuclei', func: 'DNA counterstain' },
  'lamin-ABC':       { category: 'structural', cellType: 'All nuclei', func: 'Nuclear lamina' },
  'B-actin':         { category: 'structural', cellType: 'Many', func: 'Cytoskeleton housekeeping' },
  'B-tubulin':       { category: 'structural', cellType: 'Many', func: 'Microtubule cytoskeleton' }
};

// Markers we never want to surface as a biological "driver" of a region.
export const STRUCTURAL_CATEGORIES = new Set(['structural']);

export const getMarkerInfo = (name) =>
  MARKER_KB[name] || { category: 'unknown', cellType: 'Unknown', func: '' };
