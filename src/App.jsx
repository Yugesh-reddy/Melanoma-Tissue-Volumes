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

function App() {
  const [channels, setChannels] = useState([]);
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [presetVersion, setPresetVersion] = useState(0);
  const lastAggregatedSignatureRef = useRef('');

  const [selectedRegionData, setSelectedRegionData] = useState(null);

  const handleChannelsChange = useCallback((updatedChannels) => {
    setChannels(updatedChannels);
  }, []);

  const handleSelectionChange = (selectedData) => {
    console.log('App: ===== RECEIVED SELECTION DATA =====');
    console.log('App: Selected data received:', selectedData);
    console.log('App: Bounds:', selectedData?.bounds);
    console.log('App: Channels:', selectedData?.channels);
    console.log('App: Setting selectedRegionData state...');
    setSelectedRegionData(selectedData);
    console.log('App: ✓ selectedRegionData state updated');
  };

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
            <Main_View channels={channels} activeRegions={selectedRegions} onSelectionChange={handleSelectionChange} />
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
              <Local_View selectedRegionData={selectedRegionData} channels={channels} />
            </div>
            {/* Graph Panel - 33.3% width */}
            <div style={{ 
              width: '33.3%', 
              height: '100%',
              overflow: 'hidden',
              boxSizing: 'border-box',
              flexShrink: 0
            }}>
              <Graph_Pannel />
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
