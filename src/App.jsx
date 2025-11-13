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

  const handleChannelsChange = useCallback((updatedChannels) => {
    setChannels(updatedChannels);
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
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#000000', position: 'fixed', top: 0, left: 0 }}>
      {/* Title - 5% height, 100% width */}
      <div style={{ flex: '0 0 5%', minHeight: 0 }}>
        <Title softwareName="Melanoma Tissue Volumes" />
      </div>

      {/* Main Content Area - 95% height, 100% width */}
      <div
        style={{
          flex: '1 1 95%',
          width: '100%',
          display: 'flex',
          overflow: 'hidden'
        }}
      >
        {/* Left Sidebar - 100% of main content height, 25% width */}
        <div
          style={{
            width: '25%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            overflow: 'hidden',
            gap: '10px',
            paddingRight: '6px'
          }}
        >
          {/* Channel Selection - 40% of sidebar height */}
          <div
            style={{
              flex: '0 0 45%',
              minHeight: 0,
              overflow: 'hidden'
            }}
          >
            <ChannelSelection
              onChannelsChange={handleChannelsChange}
              presetChannels={channels}
              presetVersion={presetVersion}
            />
          </div>
          {/* Region Selection - 55% of sidebar height */}
          <div
            style={{
              flex: '1 1 55%',
              minHeight: 0,
              overflow: 'hidden'
            }}
          >
            <Region_Selection
              onToggleRegion={handleRegionToggle}
              selectedRegions={selectedRegions}
            />
          </div>
        </div>

        {/* Right Section - 100% of main content height, 75% width */}
        <div
          style={{
            width: '75%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            overflow: 'hidden',
            gap: '10px'
          }}
        >
          {/* Main View - 75% height */}
          <div
            style={{
              flex: '3 1 0%',
              minHeight: 0,
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <Main_View channels={channels} activeRegions={selectedRegions} />
          </div>

          {/* Bottom panels - 25% height */}
          <div
            style={{
              flex: '1 1 0%',
              minHeight: 0,
              display: 'flex',
              gap: '10px',
              overflow: 'hidden'
            }}
          >
            {/* Local View - 25% width */}
            <div
              style={{
                width: '33.3%',
                height: '100%',
                overflow: 'auto',
                boxSizing: 'border-box'
              }}
            >
              <Local_View />
            </div>
            {/* Graph Panel - 25% width */}
            <div
              style={{
                width: '33.3%',
                height: '100%',
                overflow: 'auto',
                boxSizing: 'border-box'
              }}
            >
              <Graph_Pannel />
            </div>
            {/* Direction View - 25% width */}
            <div
              style={{
                width: '33.3%',
                height: '100%',
                overflow: 'auto',
                boxSizing: 'border-box'
              }}
            >
              <Direction_view />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
