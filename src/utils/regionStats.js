import * as d3 from 'd3';
import { loadChannelData } from '../hooks/useChannelData';
import channelNamesData from '../channel_names.json';

// Shared statistical helpers for a drawn 3D selection box.
//
// These were originally defined inside Graph_Pannel.jsx; they are extracted
// here so multiple panels (the stats/violin Graph Panel and the AI Analysis
// panel) can derive the same per-channel summary from a selection's bounds.

// Clean biomarker name for a channel index (drops "(do not use)" suffixes).
export const getBiomarkerName = (channelIndex) => {
  if (channelNamesData && channelIndex >= 0 && channelIndex < channelNamesData.length) {
    const name = channelNamesData[channelIndex];
    return name.replace(/\s*\(do not use\)/gi, '').trim() || `Channel ${channelIndex}`;
  }
  return `Channel ${channelIndex}`;
};

// Extract voxel intensities (in data units) that fall inside `bounds` and
// within the optional [thresholdMin, thresholdMax] window for one channel.
export const extractVoxelsInBounds = (channelData, bounds, thresholdMin, thresholdMax) => {
  if (!channelData || !bounds) return { voxels: [], cellCount: 0, totalVoxels: 0 };

  const { data, metadata } = channelData;
  const shape = metadata.shape;
  const [zSize, ySize, xSize] = shape;
  const dataRange = metadata.dataRange || [0, 65535];
  const dataMin = dataRange[0];
  const dataMax = dataRange[1];

  const voxelMinX = Math.max(0, Math.floor(bounds.min.x));
  const voxelMaxX = Math.min(xSize - 1, Math.ceil(bounds.max.x));
  const voxelMinY = Math.max(0, Math.floor(bounds.min.y));
  const voxelMaxY = Math.min(ySize - 1, Math.ceil(bounds.max.y));
  const voxelMinZ = Math.max(0, Math.floor(bounds.min.z));
  const voxelMaxZ = Math.min(zSize - 1, Math.ceil(bounds.max.z));

  const voxels = [];
  let cellCount = 0;

  for (let z = voxelMinZ; z <= voxelMaxZ; z++) {
    for (let y = voxelMinY; y <= voxelMaxY; y++) {
      for (let x = voxelMinX; x <= voxelMaxX; x++) {
        const idx = z * ySize * xSize + y * xSize + x;
        if (idx >= data.length) continue;

        const normalizedValue = data[idx];
        const actualValue = (normalizedValue / 255) * (dataMax - dataMin) + dataMin;

        let minThreshold = thresholdMin !== undefined ? thresholdMin : dataMin;
        let maxThreshold = thresholdMax !== undefined ? thresholdMax : dataMax;
        if (minThreshold > maxThreshold) {
          [minThreshold, maxThreshold] = [maxThreshold, minThreshold];
        }

        if (actualValue >= minThreshold && actualValue <= maxThreshold) {
          voxels.push(actualValue);
          cellCount++;
        }
      }
    }
  }

  return {
    voxels,
    cellCount,
    totalVoxels:
      (voxelMaxX - voxelMinX + 1) * (voxelMaxY - voxelMinY + 1) * (voxelMaxZ - voxelMinZ + 1)
  };
};

// Whole-volume baseline (mean & std of the normalized 0–255 intensities) for a
// channel, used to express a region's enrichment as a z-score. Computed once per
// channel from a strided sample (caps work regardless of volume size) and cached.
const baselineCache = new Map();
// 150k strided samples is plenty for a stable mean/std and keeps the first
// Analyze fast even on large volumes (it's cached per channel afterwards).
const MAX_BASELINE_SAMPLES = 150_000;

export const getChannelBaseline = (channelIndex, channelData) => {
  if (baselineCache.has(channelIndex)) return baselineCache.get(channelIndex);

  const data = channelData?.data;
  if (!data || data.length === 0) {
    const empty = { mean: 0, std: 0 };
    baselineCache.set(channelIndex, empty);
    return empty;
  }

  const n = data.length;
  const stride = Math.max(1, Math.floor(n / MAX_BASELINE_SAMPLES));
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i += stride) {
    const v = data[i]; // normalized 0–255
    sum += v;
    sumSq += v * v;
    count++;
  }
  const mean = count > 0 ? sum / count : 0;
  const variance = count > 0 ? Math.max(0, sumSq / count - mean * mean) : 0;
  const result = { mean, std: Math.sqrt(variance) };
  baselineCache.set(channelIndex, result);
  return result;
};

// Summary statistics for a list of intensity values.
export const calculateStats = (voxels) => {
  if (!voxels || voxels.length === 0) {
    return { mean: 0, median: 0, std: 0, q1: 0, q2: 0, q3: 0, min: 0, max: 0 };
  }
  const sorted = [...voxels].sort((a, b) => a - b);
  return {
    mean: d3.mean(sorted) || 0,
    median: d3.median(sorted) || 0,
    std: d3.deviation(sorted) || 0,
    q1: d3.quantile(sorted, 0.25) || 0,
    q2: d3.quantile(sorted, 0.5) || 0,
    q3: d3.quantile(sorted, 0.75) || 0,
    min: d3.min(sorted) || 0,
    max: d3.max(sorted) || 0
  };
};

// Pick which channels to analyze for a region, mirroring Graph_Pannel:
// prefer the globally-selected channels, else the region's own channels,
// and drop anything explicitly hidden.
const resolveChannels = (region, channels) => {
  const source = channels && channels.length > 0 ? channels : region.channels || [];
  return source.filter((c) => c && c.visible !== false);
};

/**
 * Build a compact, LLM-friendly summary of a single drawn 3D selection box.
 *
 * @param {Object} params
 * @param {Object} params.region - one entry from selectedRegionsData (has .bounds)
 * @param {Array}  params.channels - currently active channel configs
 * @param {Array}  [params.selectedRegions] - active biological region groups
 * @returns {Promise<Object|null>} summary suitable for serialising into a prompt
 */
export const computeRegionSummary = async ({ region, channels, selectedRegions = [] }) => {
  if (!region || !region.bounds) return null;

  const { bounds } = region;
  const dimensions = {
    x: Math.round(bounds.max.x - bounds.min.x + 1),
    y: Math.round(bounds.max.y - bounds.min.y + 1),
    z: Math.round(bounds.max.z - bounds.min.z + 1)
  };
  const volume = dimensions.x * dimensions.y * dimensions.z;

  const validChannels = resolveChannels(region, channels);

  const loaded = await Promise.all(
    validChannels.map(async (config) => {
      const channelData = await loadChannelData(config.channelIndex);
      if (!channelData) return null;
      const { voxels, cellCount } = extractVoxelsInBounds(
        channelData,
        bounds,
        config.thresholdMin,
        config.thresholdMax
      );
      const stats = calculateStats(voxels);

      // Relative expression: how enriched this marker is in the selected region
      // versus the whole volume, as a z-score mapped to 0–1. Comparing against
      // the channel's own baseline (rather than its full possible range) is what
      // makes markers actually differentiate — otherwise every marker collapses
      // to a narrow band and phenotype proportions come out artificially equal.
      const dataRange = channelData.metadata?.dataRange || [0, 65535];
      const [dataMin, dataMax] = dataRange;
      const baseline = getChannelBaseline(config.channelIndex, channelData);
      // Region mean expressed in the same normalized 0–255 units as the baseline.
      const regionMeanNorm =
        dataMax > dataMin ? ((stats.mean - dataMin) / (dataMax - dataMin)) * 255 : 0;
      const z = baseline.std > 1 ? (regionMeanNorm - baseline.mean) / baseline.std : 0;
      // Logistic map of the enrichment z-score → (0,1). 0.5 = at baseline; it
      // approaches but never reaches 1, so strongly-enriched markers spread out
      // instead of all clamping to exactly 1.00 (which looked broken).
      const relativeExpression = 1 / (1 + Math.exp(-z / 2));
      const enrichmentZ = z;

      return {
        name: getBiomarkerName(config.channelIndex),
        channelIndex: config.channelIndex,
        cellCount,
        density: volume > 0 ? cellCount / volume : 0,
        mean: stats.mean,
        median: stats.median,
        std: stats.std,
        q1: stats.q1,
        q3: stats.q3,
        min: stats.min,
        max: stats.max,
        relativeExpression,
        enrichmentZ
      };
    })
  );

  const markers = loaded.filter(Boolean).sort((a, b) => b.mean - a.mean);

  return {
    dimensions,
    volume,
    activeRegionGroups: selectedRegions.map((r) => r.title).filter(Boolean),
    markers
  };
};
