import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { loadChannelData } from '../hooks/useChannelData';

const Graph_Pannel = ({ selectedRegionData, channels = [] }) => {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [graphType, setGraphType] = useState('bar'); // 'bar', 'heatmap', 'violin'
  const [channelStats, setChannelStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const chartRef = useRef(null);

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

  // Analyze selected region
  const analyzeSelectedRegion = useCallback(async () => {
    if (!selectedRegionData || !selectedRegionData.bounds) {
      setChannelStats(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const bounds = selectedRegionData.bounds;
      const channelsToAnalyze = channels.length > 0 ? channels : selectedRegionData.channels || [];

      if (channelsToAnalyze.length === 0) {
        setChannelStats(null);
        setLoading(false);
        return;
      }

      const stats = {};
      const volume = (bounds.max.x - bounds.min.x + 1) *
        (bounds.max.y - bounds.min.y + 1) *
        (bounds.max.z - bounds.min.z + 1);

      // Analyze each channel
      for (const channelConfig of channelsToAnalyze) {
        if (channelConfig.visible === false) continue;

        try {
          const channelData = await loadChannelData(channelConfig.channelIndex);
          if (!channelData) {
            console.warn(`Graph_Panel: Failed to load channel ${channelConfig.channelIndex}`);
            continue;
          }

          const { voxels, cellCount, totalVoxels } = extractVoxelsInBounds(
            channelData,
            bounds,
            channelConfig.thresholdMin,
            channelConfig.thresholdMax
          );

          const channelStat = calculateStats(voxels);

          stats[channelConfig.channelIndex] = {
            name: `Channel ${channelConfig.channelIndex}`,
            channelIndex: channelConfig.channelIndex,
            color: channelConfig.color,
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
          };
        } catch (err) {
          console.error(`Graph_Panel: Error analyzing channel ${channelConfig.channelIndex}:`, err);
        }
      }

      setChannelStats(stats);
    } catch (err) {
      console.error('Graph_Panel: Error analyzing region:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedRegionData, channels, loadChannelData, extractVoxelsInBounds, calculateStats]);

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

    const width = container.clientWidth - 40;
    const height = container.clientHeight - 80;
    const margin = { top: 40, right: 20, bottom: 60, left: 60 };

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const statsArray = Object.values(channelStats);
    if (statsArray.length === 0) return;

    // Use cell count for bar chart
    const xScale = d3.scaleBand()
      .domain(statsArray.map(d => d.name))
      .range([0, chartWidth])
      .padding(0.2);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max(statsArray, d => d.cellCount) || 1])
      .nice()
      .range([chartHeight, 0]);

    // Bars
    g.selectAll('.bar')
      .data(statsArray)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', d => xScale(d.name))
      .attr('y', d => yScale(d.cellCount))
      .attr('width', xScale.bandwidth())
      .attr('height', d => chartHeight - yScale(d.cellCount))
      .attr('fill', d => d.color)
      .attr('opacity', 0.8)
      .on('mouseover', function (event, d) {
        d3.select(this).attr('opacity', 1);
        tooltip.style('opacity', 1)
          .html(`<strong>${d.name}</strong><br/>Cells: ${d.cellCount.toLocaleString()}<br/>Density: ${d.density.toFixed(2)} cells/μm³`)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mouseout', function () {
        d3.select(this).attr('opacity', 0.8);
        tooltip.style('opacity', 0);
      });

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
      .style('fill', '#fff')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(yScale).ticks(10))
      .selectAll('text')
      .style('fill', '#fff');

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
      .text('Channel');

    // Title
    g.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', -10)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Cell Distribution in Selected Region');

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

  // Render Heatmap
  const renderHeatmap = useCallback(() => {
    if (!svgRef.current || !channelStats) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth - 40;
    const height = container.clientHeight - 80;
    const margin = { top: 60, right: 20, bottom: 60, left: 60 };

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const statsArray = Object.values(channelStats);
    if (statsArray.length === 0) return;

    // Compute correlation matrix
    const correlationMatrix = [];
    const channelNames = statsArray.map(d => d.name);

    for (let i = 0; i < statsArray.length; i++) {
      correlationMatrix[i] = [];
      for (let j = 0; j < statsArray.length; j++) {
        if (i === j) {
          correlationMatrix[i][j] = 1.0;
        } else {
          // Pearson correlation
          const dist1 = statsArray[i].distribution;
          const dist2 = statsArray[j].distribution;
          const correlation = calculatePearsonCorrelation(dist1, dist2);
          correlationMatrix[i][j] = correlation;
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

    // Color scale: blue (negative) -> white (zero) -> red (positive)
    const colorScale = d3.scaleSequential((t) => {
      // t is normalized to [0, 1] where 0 = -1, 0.5 = 0, 1 = 1
      if (t < 0.5) {
        // Blue to white (t: 0 -> 0.5 maps to -1 -> 0)
        const normalized = t * 2; // 0 -> 1
        const r = Math.round(normalized * 255);
        const g = Math.round(normalized * 255);
        const b = 255;
        return d3.rgb(r, g, b);
      } else {
        // White to red (t: 0.5 -> 1 maps to 0 -> 1)
        const normalized = (t - 0.5) * 2; // 0 -> 1
        const r = 255;
        const g = Math.round((1 - normalized) * 255);
        const b = Math.round((1 - normalized) * 255);
        return d3.rgb(r, g, b);
      }
    }).domain([-1, 1]);

    // Cells
    for (let i = 0; i < statsArray.length; i++) {
      for (let j = 0; j < statsArray.length; j++) {
        g.append('rect')
          .attr('x', xScale(channelNames[j]))
          .attr('y', yScale(channelNames[i]))
          .attr('width', xScale.bandwidth())
          .attr('height', yScale.bandwidth())
          .attr('fill', colorScale(correlationMatrix[i][j]))
          .attr('stroke', '#000')
          .attr('stroke-width', 0.5)
          .on('mouseover', function (event, d) {
            d3.select(this).attr('stroke-width', 2);
            tooltip.style('opacity', 1)
              .html(`<strong>${channelNames[i]} × ${channelNames[j]}</strong><br/>Correlation: ${correlationMatrix[i][j].toFixed(3)}`)
              .style('left', (event.pageX + 10) + 'px')
              .style('top', (event.pageY - 10) + 'px');
          })
          .on('mouseout', function () {
            d3.select(this).attr('stroke-width', 0.5);
            tooltip.style('opacity', 0);
          });
      }
    }

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
      .style('fill', '#fff')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(yScale))
      .selectAll('text')
      .style('fill', '#fff');

    // Title
    g.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', -20)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Marker Co-expression Heatmap');

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
    const MAX_SAMPLES = 50000; // Increased from 1000 for better accuracy
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

  // Render Violin Plot
  const renderViolinPlot = useCallback(() => {
    if (!svgRef.current || !channelStats) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth - 40;
    const height = container.clientHeight - 80;
    const margin = { top: 40, right: 20, bottom: 60, left: 60 };

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const statsArray = Object.values(channelStats);
    if (statsArray.length === 0) return;

    const xScale = d3.scaleBand()
      .domain(statsArray.map(d => d.name))
      .range([0, chartWidth])
      .padding(0.3);

    const maxIntensity = d3.max(statsArray, d => d.max) || 1;
    const yScale = d3.scaleLinear()
      .domain([0, maxIntensity])
      .nice()
      .range([chartHeight, 0]);

    // Create kernel density estimation for each channel
    statsArray.forEach((stat, i) => {
      if (!stat.distribution || stat.distribution.length === 0) return;

      const kde = kernelDensityEstimator(kernelEpanechnikov(7), yScale.ticks(40));
      const density = kde(stat.distribution);

      const bandwidth = xScale.bandwidth() / 2;
      const xPos = xScale(stat.name);

      // Create area path
      const area = d3.area()
        .x0(d => xPos - bandwidth * d[1])
        .x1(d => xPos + bandwidth * d[1])
        .y(d => yScale(d[0]))
        .curve(d3.curveBasis);

      // Left side
      const leftPath = d3.area()
        .x0(xPos - bandwidth)
        .x1(d => xPos - bandwidth * d[1])
        .y(d => yScale(d[0]))
        .curve(d3.curveBasis);

      // Right side
      const rightPath = d3.area()
        .x0(d => xPos + bandwidth * d[1])
        .x1(xPos + bandwidth)
        .y(d => yScale(d[0]))
        .curve(d3.curveBasis);

      // Draw violin shape
      g.append('path')
        .datum(density)
        .attr('fill', stat.color)
        .attr('opacity', 0.6)
        .attr('d', area);

      // Draw quartiles
      const q1Y = yScale(stat.q1);
      const q2Y = yScale(stat.q2);
      const q3Y = yScale(stat.q3);

      // Median line
      g.append('line')
        .attr('x1', xPos - bandwidth)
        .attr('x2', xPos + bandwidth)
        .attr('y1', q2Y)
        .attr('y2', q2Y)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);

      // Q1 and Q3 lines
      g.append('line')
        .attr('x1', xPos - bandwidth * 0.5)
        .attr('x2', xPos + bandwidth * 0.5)
        .attr('y1', q1Y)
        .attr('y2', q1Y)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7);

      g.append('line')
        .attr('x1', xPos - bandwidth * 0.5)
        .attr('x2', xPos + bandwidth * 0.5)
        .attr('y1', q3Y)
        .attr('y2', q3Y)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7);
    });

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
      .style('fill', '#fff')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(yScale).ticks(10))
      .selectAll('text')
      .style('fill', '#fff');

    // Axis labels
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 0 - margin.left)
      .attr('x', 0 - (chartHeight / 2))
      .attr('dy', '1em')
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '12px')
      .text('Intensity (Gray Level Units)');

    g.append('text')
      .attr('transform', `translate(${chartWidth / 2}, ${chartHeight + margin.bottom - 10})`)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '12px')
      .text('Channel');

    // Title
    g.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', -10)
      .style('text-anchor', 'middle')
      .style('fill', '#fff')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Intensity Distribution by Channel');
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
      {/* Header with title and toggle */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid #444',
        backgroundColor: '#0a0a0a'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '14px',
          color: 'white',
          fontWeight: 'normal'
        }}>
          Graph Panel
        </h3>

        {/* Compact Toggle */}
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '4px',
          background: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '4px'
        }}>
          <button
            onClick={() => setGraphType('bar')}
            style={{
              width: '28px',
              height: '28px',
              padding: '6px',
              background: graphType === 'bar' ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
              border: `1px solid ${graphType === 'bar' ? '#4ade80' : 'rgba(255, 255, 255, 0.2)'}`,
              borderRadius: '3px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Bar Chart"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="12" width="2" height="2" fill={graphType === 'bar' ? '#4ade80' : '#fff'} opacity={graphType === 'bar' ? 1 : 0.7} />
              <rect x="5" y="8" width="2" height="6" fill={graphType === 'bar' ? '#4ade80' : '#fff'} opacity={graphType === 'bar' ? 1 : 0.7} />
              <rect x="8" y="4" width="2" height="10" fill={graphType === 'bar' ? '#4ade80' : '#fff'} opacity={graphType === 'bar' ? 1 : 0.7} />
              <rect x="11" y="6" width="2" height="8" fill={graphType === 'bar' ? '#4ade80' : '#fff'} opacity={graphType === 'bar' ? 1 : 0.7} />
            </svg>
          </button>

          <button
            onClick={() => setGraphType('heatmap')}
            style={{
              width: '28px',
              height: '28px',
              padding: '6px',
              background: graphType === 'heatmap' ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
              border: `1px solid ${graphType === 'heatmap' ? '#4ade80' : 'rgba(255, 255, 255, 0.2)'}`,
              borderRadius: '3px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Heatmap"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
          </button>

          <button
            onClick={() => setGraphType('violin')}
            style={{
              width: '28px',
              height: '28px',
              padding: '6px',
              background: graphType === 'violin' ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
              border: `1px solid ${graphType === 'violin' ? '#4ade80' : 'rgba(255, 255, 255, 0.2)'}`,
              borderRadius: '3px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Violin Plot"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2 L6 4 L5 6 L5 10 L6 12 L8 14 L10 12 L11 10 L11 6 L10 4 Z"
                fill={graphType === 'violin' ? '#4ade80' : '#fff'}
                opacity={graphType === 'violin' ? 1 : 0.7} />
              <line x1="8" y1="2" x2="8" y2="14" stroke={graphType === 'violin' ? '#4ade80' : '#fff'} strokeWidth="1.5" opacity={graphType === 'violin' ? 1 : 0.7} />
            </svg>
          </button>
        </div>
      </div>

      {/* Chart Area */}
      <div style={{
        flex: 1,
        padding: '10px',
        overflow: 'auto',
        position: 'relative'
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

        {!loading && !error && !selectedRegionData && (
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

        {!loading && !error && selectedRegionData && (!channelStats || Object.keys(channelStats).length === 0) && (
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
