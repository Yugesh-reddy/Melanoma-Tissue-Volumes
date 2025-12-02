import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Title from './components/Title';
import ChannelSelection from './components/ChannelSelection';
import Region_Selection from './components/Region_Selection';
import Main_View from './components/Main_View';
import Local_View from './components/Local_View';
import Graph_Pannel from './components/Graph_Pannel';
import Direction_view from './components/Direction_view';

// Helper function to convert RGB to hex
const rgbToHex = (r, g, b) => {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

// Selection box colors - distinct, vibrant colors for easy identification
const SELECTION_COLORS = [
  '#4ade80', // Green (default)
  '#60a5fa', // Blue
  '#f472b6', // Pink
  '#facc15', // Yellow
  '#a78bfa', // Purple
  '#fb923c', // Orange
  '#22d3d8', // Cyan
  '#f87171', // Red
  '#84cc16', // Lime
  '#e879f9', // Magenta
];

// Get color for selection index (cycles through colors)
const getSelectionColor = (index) => SELECTION_COLORS[index % SELECTION_COLORS.length];

function App() {
  const [channels, setChannels] = useState([]);
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [presetVersion, setPresetVersion] = useState(0);
  const lastAggregatedSignatureRef = useRef('');

  const [selectedRegionsData, setSelectedRegionsData] = useState([]);
  const lastSelectionBoundsRef = useRef(null); // Persist selection bounds across region switches

  const handleChannelsChange = useCallback((updatedChannels) => {
    console.log('App: Channels updated:', updatedChannels.length, 'channels');
    setChannels(updatedChannels);
  }, []);

  const handleSelectionChange = useCallback((selectedData) => {
    console.log('App: ===== RECEIVED SELECTION DATA =====');
    console.log('App: Selected data received:', selectedData);

    // If null is passed, clear all selections (reset was pressed)
    if (selectedData === null) {
      console.log('App: Clearing all selections (reset triggered)');
      setSelectedRegionsData([]);
      lastSelectionBoundsRef.current = null;
      return;
    }

    console.log('App: Bounds:', selectedData?.bounds);
    console.log('App: Channels:', selectedData?.channels);
    console.log('App: Scaling:', selectedData?.scaling);
    console.log('App: Adding to selectedRegionsData array...');

    if (!selectedData.bounds) {
      console.error('App: Invalid selection data received (no bounds):', selectedData);
      return;
    }

    // Update persistent bounds
    if (selectedData.worldBounds) {
      lastSelectionBoundsRef.current = selectedData.worldBounds;
      console.log('App: Updated persistent selection bounds');
    }

    // Add new selection to array with unique ID and color
    setSelectedRegionsData((prev) => {
      // Check if this selection already exists (by comparing bounds)
      const exists = prev.some((sel) => {
        if (!sel.bounds || !selectedData.bounds) return false;
        return (
          sel.bounds.min.x === selectedData.bounds.min.x &&
          sel.bounds.min.y === selectedData.bounds.min.y &&
          sel.bounds.min.z === selectedData.bounds.min.z &&
          sel.bounds.max.x === selectedData.bounds.max.x &&
          sel.bounds.max.y === selectedData.bounds.max.y &&
          sel.bounds.max.z === selectedData.bounds.max.z
        );
      });

      if (exists) {
        console.log('App: Selection already exists, not adding duplicate');
        return prev;
      }

      // Assign color based on the new index
      const newIndex = prev.length;
      const selectionWithIdAndColor = {
        ...selectedData,
        id: Date.now(),
        color: getSelectionColor(newIndex),
        index: newIndex
      };

      console.log(`App: ✓ Adding new selection (total: ${newIndex + 1}) with color: ${selectionWithIdAndColor.color}`);
      return [...prev, selectionWithIdAndColor];
    });
  }, []);

  // Function to remove a selection by ID
  const handleRemoveSelection = useCallback((selectionId) => {
    console.log(`App: Removing selection with ID: ${selectionId}`);
    setSelectedRegionsData((prev) => prev.filter((sel) => sel.id !== selectionId));
  }, []);

  // Function to clear all selections
  const handleClearAllSelections = useCallback(() => {
    console.log('App: Clearing all selections');
    setSelectedRegionsData([]);
  }, []);

  const buildAggregatedChannels = useCallback((regions) => {
    return regions.flatMap((region) =>
      region.channels.map((channel, index) => ({
        ...channel,
        id: channel.id ?? `${region.id}-${channel.channelIndex ?? index}`,
        regionId: region.id,
        visible: channel.visible !== false,
        opacity: channel.opacity ?? 1
      }))
    );
  }, []);

  const handleRegionToggle = useCallback(({ regionPayload, shouldSelect }) => {
    if (!regionPayload) return;

    // Clear all 3D selections when region changes
    console.log('App: Region changed - clearing all 3D selections');
    setSelectedRegionsData([]);
    lastSelectionBoundsRef.current = null;

    setSelectedRegions((prevRegions) => {
      let nextRegions = prevRegions;

      if (shouldSelect) {
        const exists = prevRegions.some((region) => region.id === regionPayload.id);
        if (!exists) {
          nextRegions = [...prevRegions, regionPayload];
        }
      } else {
        nextRegions = prevRegions.filter((region) => region.id !== regionPayload.id);
      }

      console.log('App: Region toggled. New regions count:', nextRegions.length);
      return nextRegions;
    });
  }, [buildAggregatedChannels]);

  const aggregatedRegionChannels = useMemo(
    () => buildAggregatedChannels(selectedRegions),
    [selectedRegions, buildAggregatedChannels]
  );

  const aggregatedSignature = useMemo(
    () => aggregatedRegionChannels.map((channel) => `${channel.regionId}-${channel.channelIndex}`).join('|'),
    [aggregatedRegionChannels]
  );

  useEffect(() => {
    if (aggregatedSignature === lastAggregatedSignatureRef.current) return;
    lastAggregatedSignatureRef.current = aggregatedSignature;
    setChannels(aggregatedRegionChannels);
    setPresetVersion((prev) => prev + 1);
  }, [aggregatedSignature, aggregatedRegionChannels]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      backgroundColor: '#000000',
      position: 'fixed',
      top: 0,
      left: 0,
      boxSizing: 'border-box'
    }}>
      {/* Title - 9.5% height, 100% width */}
      <div style={{ height: '4%', width: '100%', flexShrink: 0, overflow: 'hidden' }}>
        <Title softwareName="Melanoma Tissue Volumes" />
      </div>

      {/* Main Content Area - 90.5% height, 100% width */}
      <div style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        overflow: 'hidden',
        boxSizing: 'border-box',
        flexShrink: 0
      }}>
        {/* Left Sidebar - 100% of main content height, 25% width */}
        <div style={{
          width: '25%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
          flexShrink: 0
        }}>
          {/* Channel Selection - 45% of sidebar height */}
          <div style={{
            height: '45%',
            width: '100%',
            overflow: 'hidden',
            boxSizing: 'border-box',
            flexShrink: 0
          }}>
            <ChannelSelection
              onChannelsChange={handleChannelsChange}
              presetChannels={channels}
              presetVersion={presetVersion}
            />
          </div>
          {/* Region Selection - 55% of sidebar height */}
          <div style={{
            height: '55%',
            width: '100%',
            overflow: 'hidden',
            boxSizing: 'border-box',
            flexShrink: 0
          }}>
            <Region_Selection
              onToggleRegion={handleRegionToggle}
              selectedRegions={selectedRegions}
            />
          </div>
        </div>

        {/* Right Section - 100% of main content height, 75% width */}
        <div style={{
          width: '75%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
          flexShrink: 0
        }}>
          {/* Main View - 75% height */}
          <div style={{
            height: '70%',
            width: '100%',
            overflow: 'hidden',
            boxSizing: 'border-box',
            flexShrink: 0
          }}>
            <Main_View
              channels={channels}
              activeRegions={selectedRegions}
              onSelectionChange={handleSelectionChange}
              initialSelectionBounds={lastSelectionBoundsRef.current} // Pass persistent bounds
              selectedRegionsData={selectedRegionsData} // Pass selections to sync wireframes
            />
          </div>

          {/* Bottom panels - 30% height */}
          <div style={{
            height: '30%',
            width: '100%',
            display: 'flex',
            overflow: 'hidden',
            boxSizing: 'border-box',
            flexShrink: 0
          }}>
            {/* Local View - 33.3% width */}
            <div style={{
              width: '33.3%',
              height: '100%',
              overflow: 'hidden',
              boxSizing: 'border-box',
              flexShrink: 0
            }}>
              <Local_View 
                selectedRegionsData={selectedRegionsData} 
                channels={channels} 
                onRemoveSelection={handleRemoveSelection}
                onClearAllSelections={handleClearAllSelections}
              />
            </div>
            {/* Graph Panel - 33.3% width */}
            <div style={{
              width: '33.3%',
              height: '100%',
              overflow: 'hidden',
              boxSizing: 'border-box',
              flexShrink: 0
            }}>
              <Graph_Pannel selectedRegionsData={selectedRegionsData} channels={channels} selectedRegions={selectedRegions} />
            </div>
            {/* Direction View - 33.3% width */}
            <div style={{
              width: '33.3%',
              height: '100%',
              overflow: 'hidden',
              boxSizing: 'border-box',
              flexShrink: 0
            }}>
              <Direction_view channels={channels} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
