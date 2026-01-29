// Labeled evaluation set for the agent. `expect: null` means the utterance is a
// QUESTION that must trigger NO state mutation (the false-action metric). Keep
// these unambiguous; ambiguity belongs in a separate fuzzier set.
//
// The set is split into SLICES so the headline accuracy can be read per
// distribution, not just in aggregate (a single self-authored number over-states
// generalization — the model author also wrote the phrasings):
//   - core        : the canonical, author-written phrasings.
//   - paraphrase  : naturalistic rewordings of the same intents. SEED examples
//                   only — expand this with LLM-generated paraphrases so the
//                   number measures robustness to phrasing, not recall.
//   - ood         : held-out / out-of-distribution surface forms the tool
//                   wording did not anticipate (tests generalization).
// scoreAgent() reports overall AND per-slice metrics.

const CORE = [
  // --- channels: visibility ---
  { utterance: 'hide MITF', expect: { tool: 'disableChannels', args: { markers: ['MITF'] } } },
  { utterance: 'hide SOX10 and MITF', expect: { tool: 'disableChannels', args: { markers: ['SOX10', 'MITF'] } } },
  { utterance: 'make CD8a visible', expect: { tool: 'enableChannels', args: { markers: ['CD8a'] } } },
  { utterance: 'turn on the CD4 channel', expect: { tool: 'enableChannels', args: { markers: ['CD4'] } } },
  { utterance: 'show only SOX10', expect: { tool: 'isolateChannel', args: { marker: 'SOX10' } } },
  { utterance: 'isolate MART1', expect: { tool: 'isolateChannel', args: { marker: 'MART1' } } },
  { utterance: 'show all channels', expect: { tool: 'showAllChannels' } },
  { utterance: 'make every channel visible', expect: { tool: 'showAllChannels' } },

  // --- channels: add / remove ---
  { utterance: 'add the PDL1 channel', expect: { tool: 'addChannel', args: { marker: 'PDL1' } } },
  { utterance: 'add CD20', expect: { tool: 'addChannel', args: { marker: 'CD20' } } },
  { utterance: 'remove the MITF channel', expect: { tool: 'removeChannel', args: { marker: 'MITF' } } },
  { utterance: 'remove S100B', expect: { tool: 'removeChannel', args: { marker: 'S100B' } } },

  // --- channels: thresholds / color / filter ---
  { utterance: 'set the SOX10 threshold to between 5000 and 30000', expect: { tool: 'setThreshold', args: { marker: 'SOX10', min: 5000, max: 30000 } } },
  { utterance: 'reset the SOX10 threshold', expect: { tool: 'resetThreshold', args: { marker: 'SOX10' } } },
  { utterance: 'reset the MITF threshold to auto', expect: { tool: 'resetThreshold', args: { marker: 'MITF' } } },
  { utterance: 'recolor MART1 to cyan', expect: { tool: 'setChannelColor', args: { marker: 'MART1' } } },
  { utterance: 'make SOX10 red', expect: { tool: 'setChannelColor', args: { marker: 'SOX10' } } },
  { utterance: 'apply the filter', expect: { tool: 'applyFilter' } },

  // --- regions ---
  { utterance: 'select the tumor and immune regions', expect: { tool: 'selectRegions' } },
  { utterance: 'select the stroma region', expect: { tool: 'selectRegions' } },
  { utterance: 'deselect the stroma region', expect: { tool: 'deselectRegions' } },
  { utterance: 'switch to two region mode', expect: { tool: 'setRegionMode', args: { mode: 'two' } } },
  { utterance: 'switch to single region mode', expect: { tool: 'setRegionMode', args: { mode: 'single' } } },
  { utterance: 'use three regions', expect: { tool: 'setRegionMode', args: { mode: 'three' } } },
  { utterance: 'clear all the regions', expect: { tool: 'resetRegions' } },

  // --- graph ---
  { utterance: 'switch the graph to the violin plot', expect: { tool: 'setGraphView', args: { view: 'violin' } } },
  { utterance: 'show the bar chart', expect: { tool: 'setGraphView', args: { view: 'bar' } } },
  { utterance: 'show the cells view', expect: { tool: 'setGraphView', args: { view: 'cells' } } },

  // --- boxes ---
  { utterance: 'switch to box 2', expect: { tool: 'switchBox', args: { box: 2 } } },
  { utterance: 'go to box 1', expect: { tool: 'switchBox', args: { box: 1 } } },
  { utterance: 'close box 2', expect: { tool: 'closeBox', args: { box: 2 } } },
  { utterance: 'close box 3', expect: { tool: 'closeBox', args: { box: 3 } } },
  { utterance: 'clear all boxes', expect: { tool: 'clearAllBoxes' } },

  // --- panels / camera ---
  { utterance: 'maximize the direction view', expect: { tool: 'maximizePanel', args: { panel: 'direction' } } },
  { utterance: 'expand the local view', expect: { tool: 'maximizePanel', args: { panel: 'local' } } },
  { utterance: 'maximize the graph panel', expect: { tool: 'maximizePanel', args: { panel: 'graph' } } },
  { utterance: 'restore the panels', expect: { tool: 'restorePanel' } },
  { utterance: 'show the top view', expect: { tool: 'setView', args: { orientation: 'top' } } },
  { utterance: 'show the front view', expect: { tool: 'setView', args: { orientation: 'front' } } },
  { utterance: 'reset the camera', expect: { tool: 'resetCamera' } },

  // --- read-only query (an explicit data request → read tool, not a mutation) ---
  { utterance: 'get the stats for box 2', expect: { tool: 'getRegionStats', args: { box: 2 } } },
  { utterance: 'pull box 1 region stats', expect: { tool: 'getRegionStats', args: { box: 1 } } },

  // --- questions: MUST NOT mutate state (false-action metric) ---
  { utterance: 'what markers am I currently viewing?', expect: null },
  { utterance: 'which channels are hidden?', expect: null },
  { utterance: 'what region groups are selected?', expect: null },
  { utterance: 'what panel is currently maximized?', expect: null },
  { utterance: 'how many boxes do I have open?', expect: null },
  { utterance: 'is this region tumor or immune?', expect: null },
  { utterance: 'which markers are most aligned?', expect: null },
  { utterance: 'explain the current selection', expect: null },
  { utterance: 'what does coherence mean?', expect: null },
  { utterance: 'what is the tumor microenvironment class here?', expect: null },
  { utterance: "what's the proliferation index?", expect: null },
  { utterance: "what's the difference between the bar and violin views?", expect: null },
  { utterance: 'why might this region be immune-hot?', expect: null },
  { utterance: 'what is MITF a marker of?', expect: null },
  { utterance: 'should I add a checkpoint marker?', expect: null },
  { utterance: 'what colors are my channels set to?', expect: null },
  { utterance: 'describe the orientation of the collagen', expect: null },
  { utterance: 'summarize the findings for this box', expect: null },
  { utterance: 'is PDL1 expressed in this region?', expect: null }
];

// Naturalistic rewordings of core intents. SEED set — expand with
// LLM-generated paraphrases so this slice measures robustness to phrasing.
const PARAPHRASE = [
  { utterance: 'could you turn off MITF for me', expect: { tool: 'disableChannels', args: { markers: ['MITF'] } } },
  { utterance: 'I want to see CD8a', expect: { tool: 'enableChannels', args: { markers: ['CD8a'] } } },
  { utterance: 'just show SOX10 by itself', expect: { tool: 'isolateChannel', args: { marker: 'SOX10' } } },
  { utterance: 'pop the PDL1 channel onto the view', expect: { tool: 'addChannel', args: { marker: 'PDL1' } } },
  { utterance: 'get rid of the S100B channel', expect: { tool: 'removeChannel', args: { marker: 'S100B' } } },
  { utterance: 'clamp SOX10 to only show 5000 through 30000', expect: { tool: 'setThreshold', args: { marker: 'SOX10', min: 5000, max: 30000 } } },
  { utterance: "let's compare two regions side by side", expect: { tool: 'setRegionMode', args: { mode: 'two' } } },
  { utterance: 'jump over to box 2', expect: { tool: 'switchBox', args: { box: 2 } } },
  { utterance: 'blow up the graph panel', expect: { tool: 'maximizePanel', args: { panel: 'graph' } } },
  { utterance: 'put the camera back', expect: { tool: 'resetCamera' } },
  { utterance: 'flip the chart over to a violin', expect: { tool: 'setGraphView', args: { view: 'violin' } } },
  // questions (must not mutate)
  { utterance: 'remind me which channels I have on right now', expect: null },
  { utterance: 'break down what this selection is showing', expect: null },
  { utterance: 'how hot is this microenvironment immunologically', expect: null }
];

// Held-out surface forms the tool wording did not anticipate.
const OOD = [
  { utterance: 'paint MART1 green', expect: { tool: 'setChannelColor', args: { marker: 'MART1' } } },
  { utterance: 'declutter everything except SOX10', expect: { tool: 'isolateChannel', args: { marker: 'SOX10' } } },
  { utterance: 'wipe all my selection boxes', expect: { tool: 'clearAllBoxes' } },
  { utterance: "I'm done with box 3, dismiss it", expect: { tool: 'closeBox', args: { box: 3 } } },
  { utterance: 'orient the direction view looking straight down', expect: { tool: 'setView', args: { orientation: 'top' } } },
  { utterance: 'bring everything back to the normal layout', expect: { tool: 'restorePanel' } },
  { utterance: 'tally the voxels per marker in box 1', expect: { tool: 'getRegionStats', args: { box: 1 } } },
  // questions (must not mutate)
  { utterance: 'between these two boxes, which looks more inflamed?', expect: null },
  { utterance: 'does anything here scream active proliferation?', expect: null },
  { utterance: 'walk me through the collagen alignment', expect: null }
];

const tag = (arr, slice) => arr.map((c) => ({ ...c, slice }));

export const EVAL_CASES = [
  ...tag(CORE, 'core'),
  ...tag(PARAPHRASE, 'paraphrase'),
  ...tag(OOD, 'ood')
];

export { CORE, PARAPHRASE, OOD };
