import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { loadChannelData } from '../hooks/useChannelData';
import { computeRegionSummary } from '../utils/regionStats';
import { runEngine } from '../services/phenotypeEngine';
import channelNamesData from '../channel_names.json';
import { useAgentActions } from '../services/agentActions';

// Selection colors - synced with App.jsx and Main_View
const SELECTION_COLORS = [
  '#60a5fa', '#facc15', '#e879f9', '#4ade80', '#fb923c',
  '#f472b6', '#22d3d8', '#f87171', '#a78bfa', '#84cc16'
];
const getSelectionColor = (index) => {
  return SELECTION_COLORS[index % SELECTION_COLORS.length];
};

const GRAPH_VIEW_META = {
  composition: {
    label: 'Cells',
    accent: '#60a5fa',
    activeBackground: 'rgba(96, 165, 250, 0.24)'
  },
  bar: {
    label: 'Bar',
    accent: '#facc15',
    activeBackground: 'rgba(250, 204, 21, 0.22)'
  },
  violin: {
    label: 'Violin',
    accent: '#e879f9',
    activeBackground: 'rgba(232, 121, 249, 0.22)'
  }
};

// Kernel density estimation helpers
const kernelEpanechnikov = (k) => {
  return (v) => {
    return Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0;
  };
};

const kernelDensityEstimator = (kernel, X) => {
  return (V) => {
    return X.map((x) => [
      x,
      d3.mean(V, (v) => kernel(x - v))
    ]);
  };
};

const Graph_Pannel = ({ selectedRegionData, selectedRegionsData, channels = [], selectedRegions = [], onToggleMaximize, isMaximized = false }) => {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [graphType, setGraphType] = useState('composition'); // 'composition', 'bar', 'violin'
  const [targetGraphType, setTargetGraphType] = useState('composition'); // For instant visual feedback

  // Agent tool + system awareness for the Graph Panel visualization.
  const { registerActions, unregisterActions, registerState, unregisterState } = useAgentActions();
  const graphTypeRef = useRef(graphType);
  useEffect(() => { graphTypeRef.current = graphType; }, [graphType]);

  useEffect(() => {
    const VIEW_MAP = { cells: 'composition', composition: 'composition', bar: 'bar', violin: 'violin' };
    const LABEL = { composition: 'cells', bar: 'bar', violin: 'violin' };
    registerActions({
      setGraphView: ({ view } = {}) => {
        const target = VIEW_MAP[(view || '').toLowerCase()];
        if (!target) return { message: `Unknown graph view "${view}" (use cells/bar/violin).` };
        const prev = graphTypeRef.current;
        setTargetGraphType(target);
        setGraphType(target);
        setIsCalculating(true);
        setTimeout(() => setIsCalculating(false), 80);
        return {
          message: `Graph view: ${LABEL[target]}`,
          undo: () => { setTargetGraphType(prev); setGraphType(prev); }
        };
      }
    });
    registerState('graph', () => `Graph Panel visualization: ${LABEL[graphTypeRef.current] || graphTypeRef.current}.`);
    return () => {
      unregisterActions(['setGraphView']);
      unregisterState('graph');
    };
  }, [registerActions, unregisterActions, registerState, unregisterState]);

  // Cell-population composition per region (from the Tissue Intelligence engine).
  const [compositionData, setCompositionData] = useState([]);
  const [compositionLoading, setCompositionLoading] = useState(false);
  const [channelStats, setChannelStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const chartRef = useRef(null);

  // Box comparison state used by the violin plot.
  const [box1Index, setBox1Index] = useState(0);
  const [box2Index, setBox2Index] = useState(1);
  const [showBox1Dropdown, setShowBox1Dropdown] = useState(false);
  const [showBox2Dropdown, setShowBox2Dropdown] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);

  // Helper function to get biomarker name from channel index
  const getBiomarkerName = useCallback((channelIndex) => {
    if (channelNamesData && channelIndex >= 0 && channelIndex < channelNamesData.length) {
      const name = channelNamesData[channelIndex];
      // Clean up names - remove "(do not use)" suffix and trim
      return name.replace(/\s*\(do not use\)/gi, '').trim() || `Channel ${channelIndex}`;
    }
    return `Channel ${channelIndex}`;
  }, []);

  // Load channel data using utility
  // Note: loadChannelData is now imported from hooks/useChannelData

  // Extract voxel values within bounds for a channel
  const extractVoxelsInBounds = useCallback((channelData, bounds, thresholdMin, thresholdMax) => {
    if (!channelData || !bounds) return [];

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

          // Apply thresholds
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

    return { voxels, cellCount, totalVoxels: (voxelMaxX - voxelMinX + 1) * (voxelMaxY - voxelMinY + 1) * (voxelMaxZ - voxelMinZ + 1) };
  }, []);

  // Calculate statistics for a channel
  const calculateStats = useCallback((voxels) => {
    if (!voxels || voxels.length === 0) {
      return {
        mean: 0,
        median: 0,
        std: 0,
        q1: 0,
        q2: 0,
        q3: 0,
        min: 0,
        max: 0,
        distribution: []
      };
    }

    const sorted = [...voxels].sort((a, b) => a - b);
    const mean = d3.mean(sorted);
    const median = d3.median(sorted);
    const std = d3.deviation(sorted) || 0;
    const q1 = d3.quantile(sorted, 0.25);
    const q2 = d3.quantile(sorted, 0.50);
    const q3 = d3.quantile(sorted, 0.75);
    const min = d3.min(sorted);
    const max = d3.max(sorted);

    return {
      mean: mean || 0,
      median: median || 0,
      std: std || 0,
      q1: q1 || 0,
      q2: q2 || 0,
      q3: q3 || 0,
      min: min || 0,
      max: max || 0,
      distribution: sorted
    };
  }, []);

  // Analyze selected region with performance optimizations
  const analyzeSelectedRegion = useCallback(async () => {
    // Support both single and multiple selections
    const regionsToAnalyze = selectedRegionsData && selectedRegionsData.length > 0
      ? selectedRegionsData
      : (selectedRegionData ? [selectedRegionData] : []);

    if (regionsToAnalyze.length === 0) {
      setChannelStats(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Analyze all regions
      const allStats = {};

      for (let regionIndex = 0; regionIndex < regionsToAnalyze.length; regionIndex++) {
        const regionData = regionsToAnalyze[regionIndex];
        if (!regionData || !regionData.bounds) continue;

        const bounds = regionData.bounds;

        // Determine channels to analyze for this region
        // Use region's channels if available, otherwise use global channels
        let channelsToAnalyze = channels.length > 0 ? channels : (regionData.channels || []);

        const validChannels = channelsToAnalyze.filter(c => c.visible !== false);

        if (validChannels.length === 0) {
          setChannelStats(null);
          setLoading(false);
          return;
        }

        const stats = {};
        const volume = (bounds.max.x - bounds.min.x + 1) *
          (bounds.max.y - bounds.min.y + 1) *
          (bounds.max.z - bounds.min.z + 1);

        // Load all channel data in parallel
        const channelPromises = validChannels.map(async (channelConfig) => {
          try {
            const channelData = await loadChannelData(channelConfig.channelIndex);
            if (!channelData) {
              console.warn(`Graph_Panel: Failed to load channel ${channelConfig.channelIndex}`);
              return null;
            }
            return { config: channelConfig, data: channelData };
          } catch (err) {
            console.error(`Graph_Panel: Error loading channel ${channelConfig.channelIndex}:`, err);
            return null;
          }
        });

        const loadedChannels = await Promise.all(channelPromises);

        // Process loaded channels
        for (const item of loadedChannels) {
          if (!item) continue;

          const { config, data } = item;

          // Process extraction
          // Note: This is still synchronous per channel, but we avoided serial loading waits
          const { voxels, cellCount, totalVoxels } = extractVoxelsInBounds(
            data,
            bounds,
            config.thresholdMin,
            config.thresholdMax
          );

          const channelStat = calculateStats(voxels);

          // Store stats per channel per region
          const channelKey = config.channelIndex;
          if (!allStats[channelKey]) {
            allStats[channelKey] = {
              name: getBiomarkerName(config.channelIndex),
              channelIndex: config.channelIndex,
              color: config.color,
              regions: []
            };
          }

          // Use color from region data (synced with Main_View wireframes and Local_View tabs)
          // Fall back to SELECTION_COLORS if not available
          const boxColor = regionData.color || getSelectionColor(regionIndex);

          allStats[channelKey].regions.push({
            regionIndex,
            regionId: regionData.id || regionIndex,
            color: boxColor,
            cellCount,
            totalVoxels,
            volumeOccupied: cellCount,
            density: cellCount / volume,
            meanIntensity: channelStat.mean,
            medianIntensity: channelStat.median,
            stdIntensity: channelStat.std,
            q1: channelStat.q1,
            q2: channelStat.q2,
            q3: channelStat.q3,
            min: channelStat.min,
            max: channelStat.max,
            distribution: channelStat.distribution
          });
        }
      }

      setChannelStats(allStats);
    } catch (err) {
      console.error('Graph_Panel: Error analyzing region:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedRegionData, selectedRegionsData, channels, extractVoxelsInBounds, calculateStats, getBiomarkerName]);

  // Reset Graph Panel when selectedRegionsData becomes empty
  useEffect(() => {
    const hasRegions = (selectedRegionsData && selectedRegionsData.length > 0) || selectedRegionData;
    if (!hasRegions) {
      // Reset all state when no regions are selected
      setChannelStats(null);
      setLoading(false);
      setError(null);

      // Clear chart if it exists
      if (chartRef.current?.tooltip) {
        chartRef.current.tooltip.remove();
        chartRef.current = null;
      }

      // Clear SVG
      if (svgRef.current) {
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();
      }

      console.log('Graph_Panel: Reset - no regions selected');
    }
  }, [selectedRegionsData, selectedRegionData]);

  // Analyze region when selection or channels change
  useEffect(() => {
    analyzeSelectedRegion();
  }, [analyzeSelectedRegion]);

  // Clear SVG when no selections
  useEffect(() => {
    const hasSelections = (selectedRegionsData && selectedRegionsData.length > 0) || selectedRegionData;
    if (!hasSelections && svgRef.current) {
      // Clear the SVG content when there are no selections
      d3.select(svgRef.current).selectAll('*').remove();
      setChannelStats(null);
      console.log('Graph_Pannel: Cleared SVG - no selections');
    }
  }, [selectedRegionsData, selectedRegionData]);

  // Render Bar Chart
  const renderBarChart = useCallback(() => {
    if (!svgRef.current || !channelStats) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    // Significantly increased bottom margin for rotated labels
    const margin = { top: 30, right: 20, bottom: 120, left: 60 };

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const statsArray = Object.values(channelStats);
    if (statsArray.length === 0) return;

    // Check if we have multiple regions (grouped bars) or single region (simple bars)
    const hasMultipleRegions = statsArray.some(d => d.regions && d.regions.length > 1);
    const maxRegions = hasMultipleRegions
      ? Math.max(...statsArray.map(d => d.regions ? d.regions.length : 1))
      : 1;

    // Use cell count for bar chart
    const xScale = d3.scaleBand()
      .domain(statsArray.map(d => d.name))
      .range([0, chartWidth])
      .padding(hasMultipleRegions ? 0.2 : 0.2);

    // Calculate max value across all regions
    let maxValue = 0;
    statsArray.forEach(channel => {
      if (channel.regions && channel.regions.length > 0) {
        channel.regions.forEach(region => {
          maxValue = Math.max(maxValue, region.cellCount);
        });
      } else {
        maxValue = Math.max(maxValue, channel.cellCount || 0);
      }
    });

    const yScale = d3.scaleLinear()
      .domain([0, maxValue || 1])
      .nice()
      .range([chartHeight, 0]);

    // Sub-group scale for grouped bars
    const xSubgroupScale = hasMultipleRegions
      ? d3.scaleBand()
        .domain(d3.range(maxRegions))
        .range([0, xScale.bandwidth()])
        .padding(0.1)
      : null;

    // Create tooltip
    const tooltip = d3.select('body').append('div')
      .attr('class', 'graph-tooltip')
      .style('opacity', 0)
      .style('position', 'absolute')
      .style('background', 'rgba(0, 0, 0, 0.9)')
      .style('color', '#fff')
      .style('padding', '8px')
      .style('border-radius', '4px')
      .style('pointer-events', 'none')
      .style('font-size', '12px')
      .style('z-index', '10000');

    // Bars - grouped if multiple regions, simple if single
    if (hasMultipleRegions) {
      // Grouped bars
      statsArray.forEach((channel, channelIndex) => {
        const xPos = xScale(channel.name);

        if (channel.regions && channel.regions.length > 0) {
          channel.regions.forEach((region, regionIndex) => {
            const barWidth = xSubgroupScale.bandwidth();
            const barX = xPos + xSubgroupScale(regionIndex);

            g.append('rect')
              .attr('class', 'bar')
              .attr('x', barX)
              .attr('y', yScale(region.cellCount))
              .attr('width', barWidth)
              .attr('height', chartHeight - yScale(region.cellCount))
              .attr('fill', region.color)
              .attr('opacity', 0.8)
              .on('mouseover', function (event) {
                d3.select(this).attr('opacity', 1);
                tooltip.style('opacity', 1)
                  .html(`<strong>${channel.name}</strong><br/>Box ${regionIndex + 1}<br/>Cells: ${region.cellCount.toLocaleString()}<br/>Density: ${region.density.toFixed(2)} cells/μm³`)
                  .style('left', (event.pageX + 10) + 'px')
                  .style('top', (event.pageY - 10) + 'px');
              })
              .on('mouseout', function () {
                d3.select(this).attr('opacity', 0.8);
                tooltip.style('opacity', 0);
              });
          });
        }
      });
    } else {
      // Simple bars (single region or legacy format)
      statsArray.forEach(channel => {
        const cellCount = channel.regions && channel.regions.length > 0
          ? channel.regions[0].cellCount
          : channel.cellCount;
        const density = channel.regions && channel.regions.length > 0
          ? channel.regions[0].density
          : channel.density;
        const color = channel.regions && channel.regions.length > 0
          ? channel.regions[0].color
          : channel.color;

        g.append('rect')
          .attr('class', 'bar')
          .attr('x', xScale(channel.name))
          .attr('y', yScale(cellCount))
          .attr('width', xScale.bandwidth())
          .attr('height', chartHeight - yScale(cellCount))
          .attr('fill', color)
          .attr('opacity', 0.8)
          .on('mouseover', function (event) {
            d3.select(this).attr('opacity', 1);
            tooltip.style('opacity', 1)
              .html(`<strong>${channel.name}</strong><br/>Cells: ${cellCount.toLocaleString()}<br/>Density: ${density.toFixed(2)} cells/μm³`)
              .style('left', (event.pageX + 10) + 'px')
              .style('top', (event.pageY - 10) + 'px');
          })
          .on('mouseout', function () {
            d3.select(this).attr('opacity', 0.8);
            tooltip.style('opacity', 0);
          });
      });
    }

    // X axis
    const xAxis = g.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale));

    // Scalable labels
    xAxis.selectAll('text')
      .style('fill', '#fff')
      .style('font-size', statsArray.length > 15 ? '9px' : '11px')
      .style('text-anchor', 'middle')
      .attr('dy', '1em');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(yScale).ticks(10))
      .selectAll('text')
      .style('fill', '#fff')
      .style('font-size', '11px');

    // Axis labels
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 0 - margin.left)
      .attr('x', 0 - (chartHeight / 2))
      .attr('dy', '1em')
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '12px')
      .text('Cell Count');

    g.append('text')
      .attr('transform', `translate(${chartWidth / 2}, ${chartHeight + margin.bottom - 10})`)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '12px')
      .text('Biomarker');

    // Title
    g.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', -10)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text(hasMultipleRegions ? 'Cell Distribution Across Multiple Regions' : 'Cell Distribution in Selected Region');

    chartRef.current = { tooltip };
  }, [channelStats]);

  // Render Violin Plot (Enhanced with adaptive sizing and better statistics)
  const renderViolinPlot = useCallback(() => {
    if (!svgRef.current || !channelStats) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Adaptive margins
    const statsArray = Object.values(channelStats);
    if (statsArray.length === 0) return;

    const numChannels = statsArray.length;
    // Get regions array and check if we have multiple regions
    const regionsArray = selectedRegionsData || (selectedRegionData ? [selectedRegionData] : []);
    const hasMultipleRegions = regionsArray.length >= 2;

    // Validate selected indices
    const validBox1Index = Math.min(box1Index, regionsArray.length - 1);
    const validBox2Index = hasMultipleRegions ? Math.min(box2Index, regionsArray.length - 1) : validBox1Index;

    // Determine if we should show comparison view
    const showComparison = hasMultipleRegions && validBox1Index !== validBox2Index;

    const margin = {
      top: 30,
      right: showComparison ? 90 : 40, // Account for controls when comparing
      bottom: 120, // Increased for X-axis labels
      left: 60
    };

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Adaptive padding based on number of channels
    const padding = numChannels > 5 ? 0.2 : 0.3;
    const xScale = d3.scaleBand()
      .domain(statsArray.map(d => d.name))
      .range([0, chartWidth])
      .padding(padding);

    // Normalize distributions for better comparison
    // Instead of absolute intensity, we plot normalized intensity (0-1)
    // This allows comparing the SHAPE of distributions across channels with different ranges
    const yScale = d3.scaleLinear()
      .domain([0, 1]) // Normalized domain
      .nice()
      .range([chartHeight, 0]);

    // Create tooltip
    const tooltip = d3.select('body').append('div')
      .attr('class', 'graph-tooltip')
      .style('opacity', 0)
      .style('position', 'absolute')
      .style('background', 'rgba(0, 0, 0, 0.95)')
      .style('color', '#fff')
      .style('padding', '12px')
      .style('border-radius', '6px')
      .style('pointer-events', 'none')
      .style('font-size', '12px')
      .style('z-index', '10000')
      .style('border', '1px solid rgba(255, 255, 255, 0.2)')
      .style('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.5)');

    // Box colors from selection data (synced with Main_View wireframes and Local_View tabs)
    const box1Color = regionsArray[validBox1Index]?.color || getSelectionColor(validBox1Index);
    const box2Color = regionsArray[validBox2Index]?.color || getSelectionColor(validBox2Index);

    // Create kernel density estimation for each channel with adaptive bandwidth
    statsArray.forEach((stat, i) => {
      // Get data from selected boxes
      const region1 = stat.regions && stat.regions[validBox1Index] ? stat.regions[validBox1Index] : null;
      const region2 = showComparison && stat.regions && stat.regions[validBox2Index] ? stat.regions[validBox2Index] : null;

      if (!region1 || (!region1.distribution || region1.distribution.length === 0)) return;

      const xPos = xScale(stat.name) + xScale.bandwidth() / 2;
      const bandwidth = xScale.bandwidth() / 2.2;

      // Process Box 1 (left side)
      const localMax1 = region1.max || 1;
      const normalizedData1 = region1.distribution.map(v => v / localMax1);
      const kde1 = kernelDensityEstimator(kernelEpanechnikov(0.05), yScale.ticks(40));
      const density1 = kde1(normalizedData1);
      const maxDensity1 = d3.max(density1, d => d[1]);
      const normalizedDensity1 = density1.map(d => [d[0], d[1] / maxDensity1]);

      // Create area path for left side (Box 1)
      const areaLeft = d3.area()
        .x0(d => xPos - bandwidth * d[1])
        .x1(d => xPos) // Center line
        .y(d => yScale(d[0]))
        .curve(d3.curveCatmullRom.alpha(0.5));

      // Draw left violin shape (Box 1)
      g.append('path')
        .datum(normalizedDensity1)
        .attr('fill', box1Color)
        .attr('opacity', 0.7)
        .attr('d', areaLeft)
        .attr('stroke', box1Color)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.9)
        .on('mouseover', function (event) {
          d3.select(this).attr('opacity', 1).attr('stroke-width', 2.5);
          tooltip.style('opacity', 1)
            .html(`
              <div style="font-weight: bold; margin-bottom: 6px; color: ${box1Color}; font-size: 13px;">
                ${stat.name} - Box ${validBox1Index + 1}
              </div>
              <div style="line-height: 1.6;">
                <div><strong>Mean:</strong> ${region1.meanIntensity.toFixed(2)}</div>
                <div><strong>Max:</strong> ${region1.max.toFixed(2)}</div>
                <div style="margin-top: 4px; font-style: italic; color: #aaa;">Normalized View</div>
              </div>
            `)
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function () {
          d3.select(this).attr('opacity', 0.7).attr('stroke-width', 1.5);
          tooltip.style('opacity', 0);
        });

      // Process Box 2 (right side) if available and comparing
      if (showComparison && region2 && region2.distribution && region2.distribution.length > 0) {
        const localMax2 = region2.max || 1;
        const normalizedData2 = region2.distribution.map(v => v / localMax2);
        const kde2 = kernelDensityEstimator(kernelEpanechnikov(0.05), yScale.ticks(40));
        const density2 = kde2(normalizedData2);
        const maxDensity2 = d3.max(density2, d => d[1]);
        const normalizedDensity2 = density2.map(d => [d[0], d[1] / maxDensity2]);

        // Create area path for right side (Box 2)
        const areaRight = d3.area()
          .x0(d => xPos) // Center line
          .x1(d => xPos + bandwidth * d[1])
          .y(d => yScale(d[0]))
          .curve(d3.curveCatmullRom.alpha(0.5));

        // Draw right violin shape (Box 2)
        g.append('path')
          .datum(normalizedDensity2)
          .attr('fill', box2Color)
          .attr('opacity', 0.7)
          .attr('d', areaRight)
          .attr('stroke', box2Color)
          .attr('stroke-width', 1.5)
          .attr('stroke-opacity', 0.9)
          .on('mouseover', function (event) {
            d3.select(this).attr('opacity', 1).attr('stroke-width', 2.5);
            tooltip.style('opacity', 1)
              .html(`
                <div style="font-weight: bold; margin-bottom: 6px; color: ${box2Color}; font-size: 13px;">
                  ${stat.name} - Box ${validBox2Index + 1}
                </div>
                <div style="line-height: 1.6;">
                  <div><strong>Mean:</strong> ${region2.meanIntensity.toFixed(2)}</div>
                  <div><strong>Max:</strong> ${region2.max.toFixed(2)}</div>
                  <div style="margin-top: 4px; font-style: italic; color: #aaa;">Normalized View</div>
                </div>
              `)
              .style('left', (event.pageX + 15) + 'px')
              .style('top', (event.pageY - 10) + 'px');
          })
          .on('mouseout', function () {
            d3.select(this).attr('opacity', 0.7).attr('stroke-width', 1.5);
            tooltip.style('opacity', 0);
          });
      }

      // Draw quartiles for Box 1 (left side)
      const q1Y1 = yScale(region1.q1 / localMax1);
      const q2Y1 = yScale(region1.q2 / localMax1);
      const q3Y1 = yScale(region1.q3 / localMax1);
      const minY1 = yScale(region1.min / localMax1);
      const maxY1 = yScale(region1.max / localMax1);

      // Median line for Box 1 (left side)
      g.append('line')
        .attr('x1', xPos - bandwidth * 1.1)
        .attr('x2', xPos)
        .attr('y1', q2Y1)
        .attr('y2', q2Y1)
        .attr('stroke', box1Color)
        .attr('stroke-width', 2.5)
        .attr('opacity', 0.95);

      // Box plot rectangle for Box 1 (left side)
      g.append('rect')
        .attr('x', xPos - bandwidth * 0.6)
        .attr('y', q3Y1)
        .attr('width', bandwidth * 0.6)
        .attr('height', q1Y1 - q3Y1)
        .attr('fill', 'none')
        .attr('stroke', box1Color)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.6);

      // Whiskers for Box 1
      g.append('line')
        .attr('x1', xPos - bandwidth * 0.3)
        .attr('x2', xPos - bandwidth * 0.3)
        .attr('y1', q3Y1)
        .attr('y2', maxY1)
        .attr('stroke', box1Color)
        .attr('stroke-width', 1)
        .attr('opacity', 0.5)
        .attr('stroke-dasharray', '3,3');

      g.append('line')
        .attr('x1', xPos - bandwidth * 0.3)
        .attr('x2', xPos - bandwidth * 0.3)
        .attr('y1', q1Y1)
        .attr('y2', minY1)
        .attr('stroke', box1Color)
        .attr('stroke-width', 1)
        .attr('opacity', 0.5)
        .attr('stroke-dasharray', '3,3');

      // Draw quartiles for Box 2 (right side) if available and comparing
      if (showComparison && region2) {
        const localMax2 = region2.max || 1;
        const q1Y2 = yScale(region2.q1 / localMax2);
        const q2Y2 = yScale(region2.q2 / localMax2);
        const q3Y2 = yScale(region2.q3 / localMax2);
        const minY2 = yScale(region2.min / localMax2);
        const maxY2 = yScale(region2.max / localMax2);

        // Median line for Box 2 (right side)
        g.append('line')
          .attr('x1', xPos)
          .attr('x2', xPos + bandwidth * 1.1)
          .attr('y1', q2Y2)
          .attr('y2', q2Y2)
          .attr('stroke', box2Color)
          .attr('stroke-width', 2.5)
          .attr('opacity', 0.95);

        // Box plot rectangle for Box 2 (right side)
        g.append('rect')
          .attr('x', xPos)
          .attr('y', q3Y2)
          .attr('width', bandwidth * 0.6)
          .attr('height', q1Y2 - q3Y2)
          .attr('fill', 'none')
          .attr('stroke', box2Color)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.6);

        // Whiskers for Box 2
        g.append('line')
          .attr('x1', xPos + bandwidth * 0.3)
          .attr('x2', xPos + bandwidth * 0.3)
          .attr('y1', q3Y2)
          .attr('y2', maxY2)
          .attr('stroke', box2Color)
          .attr('stroke-width', 1)
          .attr('opacity', 0.5)
          .attr('stroke-dasharray', '3,3');

        g.append('line')
          .attr('x1', xPos + bandwidth * 0.3)
          .attr('x2', xPos + bandwidth * 0.3)
          .attr('y1', q1Y2)
          .attr('y2', minY2)
          .attr('stroke', box2Color)
          .attr('stroke-width', 1)
          .attr('opacity', 0.5)
          .attr('stroke-dasharray', '3,3');
      }
    });

    // Statistics text - REMOVED to reduce clutter as requested
    // The tooltip already provides detailed statistics
    /*
    const statsTextX = chartWidth + 10;
    const statsTextY = xPos;
    const statsGroup = g.append('g')
      .attr('transform', `translate(${statsTextX}, ${statsTextY})`);
    
    ...
    */

    // X axis with better styling and scalability
    const xAxis = g.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale));
    xAxis.selectAll('text')
      .style('fill', '#fff')
      .style('font-size', numChannels > 15 ? '9px' : '11px')
      .style('text-anchor', 'middle')
      .attr('dy', '1em');

    // Y axis with better styling
    g.append('g')
      .call(d3.axisLeft(yScale).ticks(10))
      .selectAll('text')
      .style('fill', '#fff')
      .style('font-size', '11px');

    g.selectAll('.domain, .tick line')
      .style('stroke', '#666')
      .style('stroke-width', 1);

    // Axis labels
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 0 - margin.left)
      .attr('x', 0 - (chartHeight / 2))
      .attr('dy', '1em')
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '13px')
      .style('font-weight', '500')
      .text('Normalized Intensity (0-1)');

    g.append('text')
      .attr('transform', `translate(${chartWidth / 2}, ${chartHeight + margin.bottom - 15})`)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '13px')
      .style('font-weight', '500')
      .text('Biomarker');

    // Title (adjusted position) - shows which boxes are being compared
    const titleText = showComparison
      ? `Violin Plot: Box ${validBox1Index + 1} vs Box ${validBox2Index + 1}`
      : `Violin Plot: Box ${validBox1Index + 1}`;
    g.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', -10)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '16px')
      .style('font-weight', 'bold')
      .text(titleText);

    // Legend removed - not needed for violin plots

    chartRef.current = { tooltip };
  }, [channelStats, box1Index, box2Index, selectedRegionsData, selectedRegionData]);

  // Kernel density estimation helpers


  // Render chart based on type
  useEffect(() => {
    if (loading || !channelStats) return;

    // Cleanup previous tooltip
    if (chartRef.current?.tooltip) {
      chartRef.current.tooltip.remove();
    }

    switch (graphType) {
      case 'bar':
        renderBarChart();
        break;
      case 'violin':
        renderViolinPlot();
        break;
      // 'composition' is rendered in React (see compositionData), not via d3.
    }

    return () => {
      if (chartRef.current?.tooltip) {
        chartRef.current.tooltip.remove();
      }
    };
  }, [graphType, channelStats, loading, renderBarChart, renderViolinPlot]);

  // Compute per-region cell-population composition for the 'composition' view.
  // Reuses the same grounded engine as the Tissue Intelligence panel, so the two
  // views always agree. Channel data is cached, so this is fast after first load.
  useEffect(() => {
    if (graphType !== 'composition') return;
    const regions =
      selectedRegionsData && selectedRegionsData.length > 0
        ? selectedRegionsData
        : selectedRegionData
        ? [selectedRegionData]
        : [];
    if (regions.length === 0) {
      setCompositionData([]);
      return;
    }

    let cancelled = false;
    setCompositionLoading(true);
    (async () => {
      try {
        const results = [];
        for (let i = 0; i < regions.length; i++) {
          const region = regions[i];
          const summary = await computeRegionSummary({ region, channels, selectedRegions });
          const engine = runEngine(summary);
          results.push({
            id: region.id ?? i,
            label: `Box ${i + 1}`,
            color: region.color || getSelectionColor(i),
            tme: engine.tme,
            phenotypes: engine.topPhenotypes.map((p) => ({
              id: p.id,
              label: p.label,
              color: p.color,
              proportion: p.proportion
            }))
          });
        }
        if (!cancelled) setCompositionData(results);
      } catch (e) {
        if (!cancelled) setCompositionData([]);
      } finally {
        if (!cancelled) setCompositionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graphType, selectedRegionsData, selectedRegionData, channels, selectedRegions]);

  // Reset box indices when selections change
  useEffect(() => {
    const regionsArray = selectedRegionsData || (selectedRegionData ? [selectedRegionData] : []);
    if (regionsArray.length === 0) {
      setBox1Index(0);
      setBox2Index(1);
    } else if (regionsArray.length === 1) {
      setBox1Index(0);
      setBox2Index(0);
    } else {
      // When 2+ boxes available, default to comparing Box 1 vs Box 2
      setBox1Index(0);
      setBox2Index(1);
    }
  }, [selectedRegionsData, selectedRegionData]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showBox1Dropdown || showBox2Dropdown) {
        const target = event.target;
        if (!target.closest('[data-dropdown]')) {
          setShowBox1Dropdown(false);
          setShowBox2Dropdown(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBox1Dropdown, showBox2Dropdown]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current?.tooltip) {
        chartRef.current.tooltip.remove();
      }
    };
  }, []);

  const activeGraphAccent = GRAPH_VIEW_META[targetGraphType]?.accent || GRAPH_VIEW_META.composition.accent;

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        width: '100%',
        backgroundColor: '#000000',
        borderTop: '1px solid var(--border)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Header with title and toggle - Flexbox layout */}
      <div
        onDoubleClick={onToggleMaximize}
        title="Double-click to expand"
        style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: onToggleMaximize ? 'pointer' : 'default',
        userSelect: 'none',
        padding: '6px 10px',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        zIndex: 10
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '15px',
          color: 'var(--text-1)',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          whiteSpace: 'nowrap',
          flexShrink: 0
        }}>
          {/* Glyph: bar chart + helix (uniform blue accent) */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 0 3px rgba(59,130,246,0.5))' }}>
            {/* Bar chart */}
            <rect x="2" y="14" width="4" height="8" rx="1" fill="#3b82f6" opacity="0.7" />
            <rect x="8" y="10" width="4" height="12" rx="1" fill="#3b82f6" opacity="0.85" />
            <rect x="14" y="6" width="4" height="16" rx="1" fill="#3b82f6" />
            {/* Helix overlay */}
            <path d="M18 2c2 2 2 4 0 6s-2 4 0 6" stroke="#93b8f8" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <path d="M22 2c-2 2-2 4 0 6s2 4 0 6" stroke="#93b8f8" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <line x1="18" y1="4" x2="22" y2="4" stroke="#93b8f8" strokeWidth="1" opacity="0.7" />
            <line x1="18" y1="8" x2="22" y2="8" stroke="#93b8f8" strokeWidth="1" opacity="0.7" />
            <line x1="18" y1="12" x2="22" y2="12" stroke="#93b8f8" strokeWidth="1" opacity="0.7" />
          </svg>
          <span style={{ color: 'var(--text-1)' }}>Graph Panel</span>
          {onToggleMaximize && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }}
              title={isMaximized ? 'Restore' : 'Expand'}
              style={{
                padding: '3px 7px',
                fontSize: '12px',
                color: '#9aa0ad',
                background: 'transparent',
                border: '1px solid #2a2f3a',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              {isMaximized ? '⤡' : '⤢'}
            </button>
          )}
        </h3>

        {/* Toggle buttons with icons and labels */}
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '3px',
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px'
        }}>
          <button
            onClick={() => {
              if (targetGraphType === 'composition') return;
              setTargetGraphType('composition');
              setGraphType('composition');
            }}
            style={{
              padding: '4px 8px',
              background: targetGraphType === 'composition' ? GRAPH_VIEW_META.composition.activeBackground : 'transparent',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)'
            }}
            title="Composition - inferred cell populations per region"
            disabled={isCalculating}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke={targetGraphType === 'composition' ? GRAPH_VIEW_META.composition.accent : '#fff'} strokeWidth="1.5" opacity={targetGraphType === 'composition' ? 1 : 0.7} />
              <path d="M8 2 A6 6 0 0 1 13.2 11 L8 8 Z" fill={targetGraphType === 'composition' ? GRAPH_VIEW_META.composition.accent : '#fff'} opacity={targetGraphType === 'composition' ? 0.9 : 0.5} />
            </svg>
            <span style={{
              fontSize: '11px',
              color: targetGraphType === 'composition' ? GRAPH_VIEW_META.composition.accent : 'rgba(255,255,255,0.7)',
              fontWeight: targetGraphType === 'composition' ? '600' : '400'
            }}>Cells</span>
          </button>

          <button
            onClick={() => {
              if (targetGraphType === 'bar') return;
              setTargetGraphType('bar');
              setIsCalculating(true);
              setGraphType('bar'); // Bar is fast, but instant feedback is good
              setTimeout(() => setIsCalculating(false), 50);
            }}
            style={{
              padding: '4px 8px',
              background: targetGraphType === 'bar' ? GRAPH_VIEW_META.bar.activeBackground : 'transparent',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
              opacity: isCalculating && targetGraphType !== 'bar' ? 0.7 : 1
            }}
            title="Bar Chart - Cell count distribution"
            disabled={isCalculating}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="12" width="2" height="2" fill={targetGraphType === 'bar' ? GRAPH_VIEW_META.bar.accent : '#fff'} opacity={targetGraphType === 'bar' ? 1 : 0.7} />
              <rect x="5" y="8" width="2" height="6" fill={targetGraphType === 'bar' ? GRAPH_VIEW_META.bar.accent : '#fff'} opacity={targetGraphType === 'bar' ? 1 : 0.7} />
              <rect x="8" y="4" width="2" height="10" fill={targetGraphType === 'bar' ? GRAPH_VIEW_META.bar.accent : '#fff'} opacity={targetGraphType === 'bar' ? 1 : 0.7} />
              <rect x="11" y="6" width="2" height="8" fill={targetGraphType === 'bar' ? GRAPH_VIEW_META.bar.accent : '#fff'} opacity={targetGraphType === 'bar' ? 1 : 0.7} />
            </svg>
            <span style={{
              fontSize: '11px',
              color: targetGraphType === 'bar' ? GRAPH_VIEW_META.bar.accent : 'rgba(255,255,255,0.7)',
              fontWeight: targetGraphType === 'bar' ? '600' : '400'
            }}>Bar</span>
          </button>

          <button
            onClick={() => {
              if (targetGraphType === 'violin') return;
              setTargetGraphType('violin'); // Instant visual update
              setIsCalculating(true);

              // Force separate render to show loader and hide old chart
              setTimeout(() => {
                requestAnimationFrame(() => {
                  setGraphType('violin');
                  // Wait for render/calculation to finish
                  setTimeout(() => setIsCalculating(false), 100);
                });
              }, 50);
            }}
            style={{
              padding: '4px 8px',
              background: targetGraphType === 'violin' ? GRAPH_VIEW_META.violin.activeBackground : 'transparent',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
              opacity: isCalculating && targetGraphType !== 'violin' ? 0.7 : 1
            }}
            title="Violin Plot - Intensity distribution shapes"
            disabled={isCalculating}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2 L6 4 L5 6 L5 10 L6 12 L8 14 L10 12 L11 10 L11 6 L10 4 Z"
                fill={targetGraphType === 'violin' ? GRAPH_VIEW_META.violin.accent : '#fff'}
                opacity={targetGraphType === 'violin' ? 1 : 0.7} />
              <line x1="8" y1="2" x2="8" y2="14" stroke={targetGraphType === 'violin' ? GRAPH_VIEW_META.violin.accent : '#fff'} strokeWidth="1.5" opacity={targetGraphType === 'violin' ? 1 : 0.7} />
            </svg>
            <span style={{
              fontSize: '11px',
              color: targetGraphType === 'violin' ? GRAPH_VIEW_META.violin.accent : 'rgba(255,255,255,0.7)',
              fontWeight: targetGraphType === 'violin' ? '600' : '400'
            }}>Violin</span>
          </button>
        </div>
      </div>

      {/* Chart Area */}
      <div style={{
        flex: 1,
        padding: '0px',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row'
      }}>
        {/* SVG Container */}
        <div style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden'
        }}>
          {(loading || isCalculating) && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px'
            }}>
              {/* CSS for loader */}
              <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes rotateCube {
                  0% { transform: rotateX(0deg) rotateY(0deg); }
                  100% { transform: rotateX(360deg) rotateY(360deg); }
                }
                .cube-loader {
                  width: 40px;
                  height: 40px;
                  position: relative;
                  transform-style: preserve-3d;
                  animation: rotateCube 2s infinite linear;
                }
                .cube-face {
                  position: absolute;
                  width: 40px;
                  height: 40px;
                  opacity: 0.8;
                  border: 1px solid rgba(255,255,255,0.5);
                }
                .face-front  { transform: rotateY(  0deg) translateZ(20px); background: #60a5fa77; }
                .face-right  { transform: rotateY( 90deg) translateZ(20px); background: #22d3d877; }
                .face-back   { transform: rotateY(180deg) translateZ(20px); background: #f472b677; }
                .face-left   { transform: rotateY(-90deg) translateZ(20px); background: #facc1577; }
                .face-top    { transform: rotateX( 90deg) translateZ(20px); background: #a78bfa77; }
                .face-bottom { transform: rotateX(-90deg) translateZ(20px); background: #fb923c77; }
              `}} />

              <div className="cube-loader">
                <div className="cube-face face-front"></div>
                <div className="cube-face face-back"></div>
                <div className="cube-face face-right"></div>
                <div className="cube-face face-left"></div>
                <div className="cube-face face-top"></div>
                <div className="cube-face face-bottom"></div>
              </div>
              <div style={{ color: activeGraphAccent, fontSize: '13px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                Analyzing Data...
              </div>
            </div>
          )}

          {error && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#f44',
              fontSize: '12px',
              textAlign: 'center'
            }}>
              Error: {error}
            </div>
          )}

          {!loading && !isCalculating && !error && !selectedRegionData && (!selectedRegionsData || selectedRegionsData.length === 0) && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#666',
              fontSize: '12px',
              textAlign: 'center'
            }}>
              <div>No selection made</div>
              <div style={{ fontSize: '10px', marginTop: '5px' }}>Select a region in Main View</div>
            </div>
          )}

          {graphType !== 'composition' && !loading && !isCalculating && !error && (selectedRegionData || (selectedRegionsData && selectedRegionsData.length > 0)) && (!channelStats || Object.keys(channelStats).length === 0) && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#666',
              fontSize: '12px',
              textAlign: 'center'
            }}>
              <div>No channel data available</div>
              <div style={{ fontSize: '10px', marginTop: '5px' }}>Enable channels to see statistics</div>
            </div>
          )}

          {/* Composition view (React-rendered; covers the SVG when active) */}
          {graphType === 'composition' && (selectedRegionData || (selectedRegionsData && selectedRegionsData.length > 0)) && (
            <div style={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              background: 'var(--bg-0)',
              overflowY: 'auto',
              padding: '12px 14px',
              boxSizing: 'border-box'
            }}>
              <div style={{
                fontSize: '9.5px', letterSpacing: '0.09em', textTransform: 'uppercase',
                color: 'var(--text-3)', fontWeight: 600, marginBottom: '12px'
              }}>
                Cell-population composition by region
              </div>

              {compositionLoading && compositionData.length === 0 ? (
                <div style={{ color: 'var(--text-2)', fontSize: '12px' }}>Computing composition…</div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {compositionData.map((region) => (
                      <div key={region.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px' }}>
                          <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: region.color, flexShrink: 0 }} />
                          <span style={{ fontSize: '12px', color: 'var(--text-1)', fontWeight: 600 }}>{region.label}</span>
                          {region.tme && (
                            <span style={{ fontSize: '10px', color: region.tme.color, marginLeft: 'auto' }}>{region.tme.label}</span>
                          )}
                        </div>
                        {region.phenotypes.length === 0 ? (
                          <div style={{ fontSize: '10.5px', color: 'var(--text-3)', fontStyle: 'italic' }}>
                            No enriched populations — quiet region.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', width: '100%', height: '22px', borderRadius: '5px', overflow: 'hidden', background: 'var(--bg-3)' }}>
                            {region.phenotypes.map((p) => (
                              <div
                                key={p.id}
                                title={`${p.label}: ${Math.round(p.proportion * 100)}%`}
                                style={{
                                  width: `${p.proportion * 100}%`,
                                  background: p.color,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '9px',
                                  color: 'rgba(0,0,0,0.7)',
                                  fontWeight: 700,
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {p.proportion >= 0.12 ? `${Math.round(p.proportion * 100)}%` : ''}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Legend: union of populations across regions */}
                  {(() => {
                    const m = new Map();
                    compositionData.forEach((r) => r.phenotypes.forEach((p) => { if (!m.has(p.id)) m.set(p.id, p); }));
                    const legend = [...m.values()];
                    if (legend.length === 0) return null;
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-soft)' }}>
                        {legend.map((p) => (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: p.color }} />
                            <span style={{ fontSize: '10.5px', color: 'var(--text-2)' }}>{p.label}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  <div style={{ fontSize: '9px', color: 'var(--text-3)', marginTop: '14px', lineHeight: 1.4 }}>
                    Proportions are relative shares of inferred cell populations, from per-marker abundance in each box. Research support only.
                  </div>
                </>
              )}
            </div>
          )}

          <svg
            ref={svgRef}
            style={{
              width: '100%',
              height: '100%',
              opacity: (loading || isCalculating) ? 0 : 1,
              transition: 'opacity 0.2s'
            }}
          />
        </div>

        {/* Selection Controls - Show for violin with multiple selections and when not calculating */}
        {graphType === 'violin' && selectedRegionsData && selectedRegionsData.length >= 2 && !isCalculating && (
          <div style={{
            width: '70px',
            padding: '8px 4px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            backgroundColor: 'transparent',
            flexShrink: 0,
            overflow: 'visible'
          }}>
            {/* Compare Controls - Top */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{
                fontSize: '9px',
                color: 'rgba(255, 255, 255, 0.5)',
                textAlign: 'center',
                marginBottom: '2px'
              }}>
                Compare
              </div>

              {/* Select Box 1 */}
              <div style={{ position: 'relative' }} data-dropdown>
                <button
                  onClick={() => {
                    setShowBox1Dropdown(!showBox1Dropdown);
                    setShowBox2Dropdown(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 4px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: `2px solid ${selectedRegionsData[box1Index]?.color || getSelectionColor(box1Index)}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontSize: '9px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)'
                  }}
                >
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '2px',
                    backgroundColor: selectedRegionsData[box1Index]?.color || getSelectionColor(box1Index),
                    flexShrink: 0
                  }} />
                  <span>Box {box1Index + 1}</span>
                </button>
                {showBox1Dropdown && (
                  <div data-dropdown style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '2px',
                    background: 'rgba(0, 0, 0, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '4px',
                    zIndex: 1000,
                    maxHeight: '150px',
                    overflowY: 'auto'
                  }}>
                    {selectedRegionsData.map((region, index) => {
                      const color = region.color || getSelectionColor(index);
                      const isSelected = index === box1Index;
                      return (
                        <button
                          key={region.id || index}
                          onClick={() => {
                            setBox1Index(index);
                            setShowBox1Dropdown(false);
                          }}
                          style={{
                            width: '100%',
                            padding: '5px 6px',
                            background: isSelected ? `${color}33` : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: isSelected ? color : 'rgba(255, 255, 255, 0.7)',
                            fontSize: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)'
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.target.style.background = 'transparent';
                          }}
                        >
                          <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '2px',
                            backgroundColor: color,
                            flexShrink: 0
                          }} />
                          <span>Box {index + 1}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{
                fontSize: '9px',
                color: 'rgba(255, 255, 255, 0.4)',
                textAlign: 'center'
              }}>vs</div>

              {/* Select Box 2 */}
              <div style={{ position: 'relative' }} data-dropdown>
                <button
                  onClick={() => {
                    setShowBox2Dropdown(!showBox2Dropdown);
                    setShowBox1Dropdown(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 4px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: `2px solid ${selectedRegionsData[box2Index]?.color || getSelectionColor(box2Index)}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontSize: '9px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)'
                  }}
                >
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '2px',
                    backgroundColor: selectedRegionsData[box2Index]?.color || getSelectionColor(box2Index),
                    flexShrink: 0
                  }} />
                  <span>Box {box2Index + 1}</span>
                </button>
                {showBox2Dropdown && (
                  <div data-dropdown style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '2px',
                    background: 'rgba(0, 0, 0, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '4px',
                    zIndex: 1000,
                    maxHeight: '150px',
                    overflowY: 'auto'
                  }}>
                    {selectedRegionsData.map((region, index) => {
                      const color = region.color || getSelectionColor(index);
                      const isSelected = index === box2Index;
                      return (
                        <button
                          key={region.id || index}
                          onClick={() => {
                            setBox2Index(index);
                            setShowBox2Dropdown(false);
                          }}
                          style={{
                            width: '100%',
                            padding: '5px 6px',
                            background: isSelected ? `${color}33` : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: isSelected ? color : 'rgba(255, 255, 255, 0.7)',
                            fontSize: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)'
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.target.style.background = 'transparent';
                          }}
                        >
                          <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '2px',
                            backgroundColor: color,
                            flexShrink: 0
                          }} />
                          <span>Box {index + 1}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Graph_Pannel;
