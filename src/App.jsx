import React, { useState } from 'react';
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
  const [channels, setChannels] = useState([
    {
      id: 0,
      channelIndex: 19,
      color: rgbToHex(0, 255, 0), // Green [0, 255, 0]
      thresholdMin: 300,
      thresholdMax: 20000,
      opacity: 1.0,
      visible: true
    },
    {
      id: 1,
      channelIndex: 27,
      color: rgbToHex(255, 255, 0), // Yellow [255, 255, 0]
      thresholdMin: 1000,
      thresholdMax: 7000,
      opacity: 1.0,
      visible: true
    }
  ]);

  const [selectedRegionData, setSelectedRegionData] = useState(null);

  const handleChannelsChange = (updatedChannels) => {
    setChannels(updatedChannels);
  };

  const handleSelectionChange = (selectedData) => {
    setSelectedRegionData(selectedData);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#000000', position: 'fixed', top: 0, left: 0 }}>
      {/* Title - 9.5% height, 100% width */}
      <Title softwareName="Melanoma Tissue Volumes" />

      {/* Main Content Area - 90.5% height, 100% width */}
      <div style={{
        flex: '100%',
        width: '100%',
        display: 'flex'
      }}>
        {/* Left Sidebar - 100% of main content height, 25% width */}
        <div style={{ width: '25%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Channel Selection - 40% of sidebar height */}
          <div style={{ height: '45%' }}>
            <ChannelSelection onChannelsChange={handleChannelsChange} />
          </div>
          {/* Region Selection - 55% of sidebar height */}
          <div style={{ height: '55%' }}>
            <Region_Selection />
          </div>
        </div>

        {/* Right Section - 100% of main content height, 75% width */}
        <div style={{ width: '75%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Main View - 75% height */}
          <div style={{ height: '75%' }}>
            <Main_View channels={channels} onSelectionChange={handleSelectionChange} />
          </div>

          {/* Bottom panels - 25% height */}
          <div style={{ height: '25%', display: 'flex' }}>
            {/* Local View - 25% width */}
            <div style={{ width: '33.3%', height: '100%' }}>
              <Local_View selectedRegionData={selectedRegionData} channels={channels} />
            </div>
            {/* Graph Panel - 25% width */}
            <div style={{ width: '33.3%', height: '100%' }}>
              <Graph_Pannel />
            </div>
            {/* Direction View - 25% width */}
            <div style={{ width: '33.3%', height: '100%' }}>
              <Direction_view />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
