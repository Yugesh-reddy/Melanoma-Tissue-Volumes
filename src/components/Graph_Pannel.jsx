import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { loadChannelData } from '../hooks/useChannelData';
import channelNamesData from '../channel_names.json';

// Color map for selection boxes (matching 3D box colors)
const BOX_COLOR_MAP = [
  '#ca0020', // First box - Red
  '#f4a582', // Second box - Light orange
  '#f7f7f7', // Third box - Light gray
  '#92c5de', // Fourth box - Light blue
  '#0571b0'  // Fifth box - Dark blue
];

const Graph_Pannel = ({ selectedRegionData, selectedRegionsData, channels = [], selectedRegions = [] }) => {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [graphType, setGraphType] = useState('bar'); // 'bar', 'heatmap', 'violin'
  const [channelStats, setChannelStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const chartRef = useRef(null);

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

      // If we have selected regions and want co-expression, collect all unique channels from regions
      if (graphType === 'heatmap' && selectedRegions.length > 0) {
        const allRegionChannels = new Map();
        selectedRegions.forEach(region => {
          if (region.channels && Array.isArray(region.channels)) {
            region.channels.forEach(channelConfig => {
              if (!allRegionChannels.has(channelConfig.channelIndex)) {
                allRegionChannels.set(channelConfig.channelIndex, {
                  ...channelConfig,
                  visible: true
                });
              }
            });
          }
        });
        if (allRegionChannels.size > 0) {
          channelsToAnalyze = Array.from(allRegionChannels.values());
        }
      }

      // Filter channels based on visibility (unless heatmap mode which forces visibility)
      const validChannels = channelsToAnalyze.filter(c => c.visible !== false || graphType === 'heatmap');

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

        // Generate color for this box (use color map matching 3D box colors)
        const boxColors = [
          '#ca0020', // First box - Red
          '#f4a582', // Second box - Light orange
          '#f7f7f7', // Third box - Light gray
          '#92c5de', // Fourth box - Light blue
          '#0571b0'  // Fifth box - Dark blue
        ];
        const boxColor = boxColors[regionIndex % boxColors.length];

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
  }, [selectedRegionData, selectedRegionsData, channels, selectedRegions, graphType, extractVoxelsInBounds, calculateStats, getBiomarkerName]);

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
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('dx', '-0.8em')
      .attr('dy', '0.15em');

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

  // Render Heatmap
  const renderHeatmap = useCallback(() => {
    if (!svgRef.current || !channelStats) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    // Significantly increased margins for labels
    const margin = { top: 40, right: 80, bottom: 120, left: 60 };

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const statsArray = Object.values(channelStats);
    if (statsArray.length === 0) return;

    // Check if we have multiple regions (at least 2)
    const hasMultipleRegions = statsArray.some(d => d.regions && d.regions.length >= 2);
    
    // Box colors for comparison (use color map)
    const box1Color = BOX_COLOR_MAP[0]; // First box
    const box2Color = BOX_COLOR_MAP[1]; // Second box

    // Compute correlation matrices for both boxes
    const correlationMatrix1 = [];
    const correlationMatrix2 = [];
    const channelNames = statsArray.map(d => d.name);

    for (let i = 0; i < statsArray.length; i++) {
      correlationMatrix1[i] = [];
      correlationMatrix2[i] = [];
      
      for (let j = 0; j < statsArray.length; j++) {
        if (i === j) {
          correlationMatrix1[i][j] = 1.0;
          correlationMatrix2[i][j] = 1.0;
        } else {
          // Get distributions from first two boxes
          const dist1Box1 = statsArray[i].regions && statsArray[i].regions[0] 
            ? statsArray[i].regions[0].distribution 
            : statsArray[i].distribution;
          const dist2Box1 = statsArray[j].regions && statsArray[j].regions[0] 
            ? statsArray[j].regions[0].distribution 
            : statsArray[j].distribution;
          
          const dist1Box2 = statsArray[i].regions && statsArray[i].regions.length > 1 && statsArray[i].regions[1]
            ? statsArray[i].regions[1].distribution 
            : dist1Box1;
          const dist2Box2 = statsArray[j].regions && statsArray[j].regions.length > 1 && statsArray[j].regions[1]
            ? statsArray[j].regions[1].distribution 
            : dist2Box1;

          const correlation1 = calculatePearsonCorrelation(dist1Box1, dist2Box1);
          const correlation2 = hasMultipleRegions 
            ? calculatePearsonCorrelation(dist1Box2, dist2Box2)
            : correlation1;
          
          correlationMatrix1[i][j] = correlation1;
          correlationMatrix2[i][j] = correlation2;
        }
      }
    }

    const cellSize = Math.min(chartWidth, chartHeight) / statsArray.length;
    const xScale = d3.scaleBand()
      .domain(channelNames)
      .range([0, chartWidth])
      .padding(0.05);

    const yScale = d3.scaleBand()
      .domain(channelNames)
      .range([0, chartHeight])
      .padding(0.05);

    // Color scale: Viridis (0 to 1)
    const colorScale = d3.scaleSequential(d3.interpolateViridis)
      .domain([0, 1]);

    // Cells - split each cell into two halves for two boxes
    for (let i = 0; i < statsArray.length; i++) {
      for (let j = 0; j < statsArray.length; j++) {
        const cellWidth = xScale.bandwidth();
        const cellHeight = yScale.bandwidth();
        
        if (hasMultipleRegions) {
          // Split cell into two halves
          // Left half: Box 1
          g.append('rect')
            .attr('x', xScale(channelNames[j]))
            .attr('y', yScale(channelNames[i]))
            .attr('width', cellWidth / 2)
            .attr('height', cellHeight)
            .attr('fill', colorScale(correlationMatrix1[i][j]))
            .attr('stroke', box1Color)
            .attr('stroke-width', 1)
            .on('mouseover', function (event) {
              d3.select(this).attr('stroke-width', 2);
              tooltip.style('opacity', 1)
                .html(`<strong>${channelNames[i]} × ${channelNames[j]}</strong><br/>Box 1<br/>Correlation: ${correlationMatrix1[i][j].toFixed(3)}`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseout', function () {
              d3.select(this).attr('stroke-width', 1);
              tooltip.style('opacity', 0);
            });
          
          // Right half: Box 2
          g.append('rect')
            .attr('x', xScale(channelNames[j]) + cellWidth / 2)
            .attr('y', yScale(channelNames[i]))
            .attr('width', cellWidth / 2)
            .attr('height', cellHeight)
            .attr('fill', colorScale(correlationMatrix2[i][j]))
            .attr('stroke', box2Color)
            .attr('stroke-width', 1)
            .on('mouseover', function (event) {
              d3.select(this).attr('stroke-width', 2);
              tooltip.style('opacity', 1)
                .html(`<strong>${channelNames[i]} × ${channelNames[j]}</strong><br/>Box 2<br/>Correlation: ${correlationMatrix2[i][j].toFixed(3)}`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseout', function () {
              d3.select(this).attr('stroke-width', 1);
              tooltip.style('opacity', 0);
            });
        } else {
          // Single box - show full cell
          g.append('rect')
            .attr('x', xScale(channelNames[j]))
            .attr('y', yScale(channelNames[i]))
            .attr('width', cellWidth)
            .attr('height', cellHeight)
            .attr('fill', colorScale(correlationMatrix1[i][j]))
            .attr('stroke', '#000')
            .attr('stroke-width', 0.5)
            .on('mouseover', function (event) {
              d3.select(this).attr('stroke-width', 2);
              tooltip.style('opacity', 1)
                .html(`<strong>${channelNames[i]} × ${channelNames[j]}</strong><br/>Correlation: ${correlationMatrix1[i][j].toFixed(3)}`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseout', function () {
              d3.select(this).attr('stroke-width', 0.5);
              tooltip.style('opacity', 0);
            });
        }
      }
    }

    // X axis
    const xAxis = g.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale));

    // Scalable labels
    xAxis.selectAll('text')
      .style('fill', '#fff')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .style('font-size', channelNames.length > 15 ? '9px' : '11px');

    // Y axis
    const yAxis = g.append('g')
      .call(d3.axisLeft(yScale));

    yAxis.selectAll('text')
      .style('fill', '#fff')
      .style('font-size', channelNames.length > 15 ? '9px' : '11px');

    // Title
    const titleText = hasMultipleRegions 
      ? 'Biomarker Co-expression Heatmap (Box 1 vs Box 2)'
      : 'Biomarker Co-expression Heatmap';
    g.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', -20)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text(titleText);

    // Legend for two boxes if multiple regions
    if (hasMultipleRegions) {
      const legendY = -5;
      const legendX = chartWidth - 150;
      
      // Box 1 legend
      g.append('rect')
        .attr('x', legendX)
        .attr('y', legendY)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', 'none')
        .attr('stroke', box1Color)
        .attr('stroke-width', 2);
      
      g.append('text')
        .attr('x', legendX + 18)
        .attr('y', legendY + 9)
        .style('fill', box1Color)
        .style('font-size', '11px')
        .text('Box 1');
      
      // Box 2 legend
      g.append('rect')
        .attr('x', legendX + 70)
        .attr('y', legendY)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', 'none')
        .attr('stroke', box2Color)
        .attr('stroke-width', 2);
      
      g.append('text')
        .attr('x', legendX + 88)
        .attr('y', legendY + 9)
        .style('fill', box2Color)
        .style('font-size', '11px')
        .text('Box 2');
    }

    // Add color legend (Vertical on the Right)
    const legendWidth = 15;
    const legendHeight = Math.min(200, chartHeight);
    const legendX = chartWidth + 20;
    const legendY = (chartHeight - legendHeight) / 2;

    const legendScale = d3.scaleLinear()
      .domain([1, 0]) // Top is 1, bottom is 0
      .range([0, legendHeight]);

    const gradientId = `heatmap-gradient-${Date.now()}`;
    const legendGradient = svg.append('defs')
      .append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0%')
      .attr('x2', '0%')
      .attr('y1', '0%')
      .attr('y2', '100%');

    // Create gradient stops
    // Stop 0% = Top = 1 (Red)
    // Stop 50% = Middle = 0 (White)
    // Stop 100% = Bottom = -1 (Blue)
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      // Map t (0..1) to value (1..0)
      const value = 1 - t;
      legendGradient.append('stop')
        .attr('offset', `${i}%`)
        .attr('stop-color', colorScale(value));
    }

    g.append('rect')
      .attr('x', legendX)
      .attr('y', legendY)
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', `url(#${gradientId})`)
      .style('stroke', '#666')
      .style('stroke-width', 1);

    const legendAxis = d3.axisRight(legendScale)
      .ticks(5)
      .tickFormat(d => d.toFixed(1));

    g.append('g')
      .attr('transform', `translate(${legendX + legendWidth}, ${legendY})`)
      .call(legendAxis)
      .selectAll('text')
      .style('fill', '#fff')
      .style('font-size', '10px');

    g.append('text')
      .attr('x', legendX + legendWidth / 2)
      .attr('y', legendY - 10)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '11px')
      .text('Corr');

    // Tooltip
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

    chartRef.current = { tooltip };
  }, [channelStats]);

  // Calculate Pearson correlation
  const calculatePearsonCorrelation = (x, y) => {
    if (!x || !y || x.length === 0 || y.length === 0 || x.length !== y.length) return 0;

    // Sample if arrays are too large - INCREASED ACCURACY
    // Sample if arrays are too large - INCREASED ACCURACY but balanced for performance
    const MAX_SAMPLES = 10000; // Reduced from 50000 to 10000 for better performance while maintaining accuracy
    const sampleSize = Math.min(MAX_SAMPLES, x.length);
    const step = Math.max(1, Math.floor(x.length / sampleSize));
    const sampledX = [];
    const sampledY = [];

    for (let i = 0; i < x.length; i += step) {
      sampledX.push(x[i]);
      sampledY.push(y[i]);
    }

    const n = sampledX.length;
    const meanX = d3.mean(sampledX);
    const meanY = d3.mean(sampledY);

    let numerator = 0;
    let sumXSq = 0;
    let sumYSq = 0;

    for (let i = 0; i < n; i++) {
      const dx = sampledX[i] - meanX;
      const dy = sampledY[i] - meanY;
      numerator += dx * dy;
      sumXSq += dx * dx;
      sumYSq += dy * dy;
    }

    const denominator = Math.sqrt(sumXSq * sumYSq);
    return denominator === 0 ? 0 : numerator / denominator;
  };

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
    const margin = {
      top: 30,
      right: 40, // Reduced right margin since we removed the text stats
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

    // Check if we have multiple regions (at least 2)
    const hasMultipleRegions = statsArray.some(d => d.regions && d.regions.length >= 2);
    
    // Box colors (use color map)
    const box1Color = BOX_COLOR_MAP[0]; // First box
    const box2Color = BOX_COLOR_MAP[1]; // Second box

    // Create kernel density estimation for each channel with adaptive bandwidth
    statsArray.forEach((stat, i) => {
      // Get data from first two boxes only
      const region1 = stat.regions && stat.regions.length > 0 ? stat.regions[0] : null;
      const region2 = stat.regions && stat.regions.length > 1 ? stat.regions[1] : null;
      
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
                ${stat.name} - Box 1
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

      // Process Box 2 (right side) if available
      if (hasMultipleRegions && region2 && region2.distribution && region2.distribution.length > 0) {
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
                  ${stat.name} - Box 2
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

      // Draw quartiles for Box 2 (right side) if available
      if (hasMultipleRegions && region2) {
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
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('dx', '-0.8em')
      .attr('dy', '0.15em');

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

    // Title (adjusted position)
    const titleText = hasMultipleRegions 
      ? 'Normalized Intensity Distributions (Box 1 vs Box 2)'
      : 'Normalized Intensity Distributions';
    g.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', -10)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '16px')
      .style('font-weight', 'bold')
      .text(titleText);

    // Legend for two boxes if multiple regions
    if (hasMultipleRegions) {
      const legendY = -5;
      const legendX = chartWidth - 150;
      
      // Box 1 legend
      g.append('rect')
        .attr('x', legendX)
        .attr('y', legendY)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', box1Color)
        .attr('opacity', 0.7);
      
      g.append('text')
        .attr('x', legendX + 18)
        .attr('y', legendY + 9)
        .style('fill', box1Color)
        .style('font-size', '11px')
        .text('Box 1 (Left)');
      
      // Box 2 legend
      g.append('rect')
        .attr('x', legendX + 90)
        .attr('y', legendY)
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', box2Color)
        .attr('opacity', 0.7);
      
      g.append('text')
        .attr('x', legendX + 108)
        .attr('y', legendY + 9)
        .style('fill', box2Color)
        .style('font-size', '11px')
        .text('Box 2 (Right)');
    }

    chartRef.current = { tooltip };
  }, [channelStats]);

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
      case 'heatmap':
        renderHeatmap();
        break;
      case 'violin':
        renderViolinPlot();
        break;
    }

    return () => {
      if (chartRef.current?.tooltip) {
        chartRef.current.tooltip.remove();
      }
    };
  }, [graphType, channelStats, loading, renderBarChart, renderHeatmap, renderViolinPlot]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current?.tooltip) {
        chartRef.current.tooltip.remove();
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        width: '100%',
        backgroundColor: '#000000',
        border: '1px solid #444',
        padding: '1px',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Header with title and toggle - Flexbox layout */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        flexShrink: 0,
        zIndex: 10
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '14px',
          color: 'white',
          fontWeight: '500'
        }}>
          Graph Panel
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
            onClick={() => setGraphType('bar')}
            style={{
              padding: '4px 8px',
              background: graphType === 'bar' ? 'rgba(74, 222, 128, 0.3)' : 'transparent',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s'
            }}
            title="Bar Chart - Cell count distribution"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="12" width="2" height="2" fill={graphType === 'bar' ? '#4ade80' : '#fff'} opacity={graphType === 'bar' ? 1 : 0.7} />
              <rect x="5" y="8" width="2" height="6" fill={graphType === 'bar' ? '#4ade80' : '#fff'} opacity={graphType === 'bar' ? 1 : 0.7} />
              <rect x="8" y="4" width="2" height="10" fill={graphType === 'bar' ? '#4ade80' : '#fff'} opacity={graphType === 'bar' ? 1 : 0.7} />
              <rect x="11" y="6" width="2" height="8" fill={graphType === 'bar' ? '#4ade80' : '#fff'} opacity={graphType === 'bar' ? 1 : 0.7} />
            </svg>
            <span style={{ 
              fontSize: '11px', 
              color: graphType === 'bar' ? '#4ade80' : 'rgba(255,255,255,0.7)',
              fontWeight: graphType === 'bar' ? '600' : '400'
            }}>Bar</span>
          </button>

          <button
            onClick={() => setGraphType('heatmap')}
            style={{
              padding: '4px 8px',
              background: graphType === 'heatmap' ? 'rgba(74, 222, 128, 0.3)' : 'transparent',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s'
            }}
            title="Heatmap - Biomarker co-expression correlation"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="3" height="3" fill={graphType === 'heatmap' ? '#4ade80' : '#fff'} opacity={graphType === 'heatmap' ? 1 : 0.7} />
              <rect x="6" y="2" width="3" height="3" fill={graphType === 'heatmap' ? '#4ade80' : '#fff'} opacity={graphType === 'heatmap' ? 1 : 0.7} />
              <rect x="10" y="2" width="3" height="3" fill={graphType === 'heatmap' ? '#4ade80' : '#fff'} opacity={graphType === 'heatmap' ? 1 : 0.7} />
              <rect x="2" y="6" width="3" height="3" fill={graphType === 'heatmap' ? '#4ade80' : '#fff'} opacity={graphType === 'heatmap' ? 1 : 0.7} />
              <rect x="6" y="6" width="3" height="3" fill={graphType === 'heatmap' ? '#4ade80' : '#fff'} opacity={graphType === 'heatmap' ? 1 : 0.7} />
              <rect x="10" y="6" width="3" height="3" fill={graphType === 'heatmap' ? '#4ade80' : '#fff'} opacity={graphType === 'heatmap' ? 1 : 0.7} />
              <rect x="2" y="10" width="3" height="3" fill={graphType === 'heatmap' ? '#4ade80' : '#fff'} opacity={graphType === 'heatmap' ? 1 : 0.7} />
              <rect x="6" y="10" width="3" height="3" fill={graphType === 'heatmap' ? '#4ade80' : '#fff'} opacity={graphType === 'heatmap' ? 1 : 0.7} />
              <rect x="10" y="10" width="3" height="3" fill={graphType === 'heatmap' ? '#4ade80' : '#fff'} opacity={graphType === 'heatmap' ? 1 : 0.7} />
            </svg>
            <span style={{ 
              fontSize: '11px', 
              color: graphType === 'heatmap' ? '#4ade80' : 'rgba(255,255,255,0.7)',
              fontWeight: graphType === 'heatmap' ? '600' : '400'
            }}>Heatmap</span>
          </button>

          <button
            onClick={() => setGraphType('violin')}
            style={{
              padding: '4px 8px',
              background: graphType === 'violin' ? 'rgba(74, 222, 128, 0.3)' : 'transparent',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s'
            }}
            title="Violin Plot - Intensity distribution shapes"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2 L6 4 L5 6 L5 10 L6 12 L8 14 L10 12 L11 10 L11 6 L10 4 Z"
                fill={graphType === 'violin' ? '#4ade80' : '#fff'}
                opacity={graphType === 'violin' ? 1 : 0.7} />
              <line x1="8" y1="2" x2="8" y2="14" stroke={graphType === 'violin' ? '#4ade80' : '#fff'} strokeWidth="1.5" opacity={graphType === 'violin' ? 1 : 0.7} />
            </svg>
            <span style={{ 
              fontSize: '11px', 
              color: graphType === 'violin' ? '#4ade80' : 'rgba(255,255,255,0.7)',
              fontWeight: graphType === 'violin' ? '600' : '400'
            }}>Violin</span>
          </button>
        </div>
      </div>

      {/* Chart Area */}
      <div style={{
        flex: 1,
        padding: '0px', // Removed padding to use full space
        overflow: 'hidden', // Changed from auto to hidden to prevent scrollbars
        position: 'relative',
        width: '100%',
        height: '100%'
      }}>
        {loading && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#666',
            fontSize: '12px'
          }}>
            Loading...
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

        {!loading && !error && !selectedRegionData && (!selectedRegionsData || selectedRegionsData.length === 0) && (
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

        {!loading && !error && (selectedRegionData || (selectedRegionsData && selectedRegionsData.length > 0)) && (!channelStats || Object.keys(channelStats).length === 0) && (
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

        <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
};

export default Graph_Pannel;
