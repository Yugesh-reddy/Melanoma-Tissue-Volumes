// Maps a human marker name (as the AI or user would say it) to its channel
// index in channel_names.json. Tolerant of case and "(do not use)" suffixes.

import channelNames from '../channel_names.json' with { type: 'json' };

export const normalizeMarker = (name = '') =>
  name.toLowerCase().replace(/\(do not use\)/g, '').trim();

export const findChannelIndex = (marker) => {
  const target = normalizeMarker(marker);
  if (!target) return -1;
  return channelNames.findIndex((n) => normalizeMarker(n) === target);
};

export const channelNameAt = (index) => channelNames[index] ?? `Channel ${index}`;
