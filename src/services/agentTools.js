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
  { name: 'isolateChannel', args: '{ "marker": "SOX10" }', description: 'Show ONLY this marker; hide all other channels.' },
  { name: 'showAllChannels', args: '{}', description: 'Make every channel visible.' },
  { name: 'removeChannel', args: '{ "marker": "MITF" }', description: 'Remove a channel from the list entirely.' },
  { name: 'resetThreshold', args: '{ "marker": "SOX10" }', description: 'Reset a channel threshold back to auto (full range).' },
  { name: 'applyFilter', args: '{}', description: 'Apply the current threshold settings to the view.' },
  { name: 'selectRegions', args: '{ "groups": ["Tumor / Epithelial", "Immune (T/B/Myeloid)"] }', description: 'Select one or more region groups (reloads panels).' },
  { name: 'deselectRegions', args: '{ "groups": ["Stroma"] }', description: 'Deselect region groups.' },
  { name: 'setRegionMode', args: '{ "mode": "two" }', description: 'Switch region mode: "single" | "two" | "three".' },
  { name: 'resetRegions', args: '{}', description: 'Clear all region selections.' },
  { name: 'resetCamera', args: '{ "panel": "direction" }', description: 'Reset the camera in a 3D panel ("local" or "direction") to its default view.' },
  { name: 'setView', args: '{ "panel": "direction", "orientation": "top" }', description: 'Orient a 3D panel camera: "top" | "front" | "side" | "iso".' },
  { name: 'focusCamera', args: '{ "panel": "direction" }', description: 'Frame/fit the content in a 3D panel to fill the view.' },
  { name: 'maximizePanel', args: '{ "panel": "direction" }', description: 'Open/expand a bottom panel full-screen: "local" | "graph" | "direction".' },
  { name: 'restorePanel', args: '{}', description: 'Restore panels from the maximized/expanded state.' },
  { name: 'switchBox', args: '{ "box": 2 }', description: 'Switch the active Box tab in Local View (1-based, matches the "Box N" labels).' },
  { name: 'closeBox', args: '{ "box": 2 }', description: 'Close a Box tab in Local View (1-based). Removes that selection.' },
  { name: 'clearAllBoxes', args: '{}', description: 'Close all Box tabs in Local View (clear all selections).' },
  { name: 'setGraphView', args: '{ "view": "heatmap" }', description: 'Switch the Graph Panel visualization: "cells" | "bar" | "heatmap" | "violin".' }
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
