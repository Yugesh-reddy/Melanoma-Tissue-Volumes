import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Title from './components/Title';
import ChannelSelection from './components/ChannelSelection';
import Region_Selection from './components/Region_Selection';
import Main_View from './components/Main_View';
import Local_View from './components/Local_View';
import Graph_Pannel from './components/Graph_Pannel';
import Direction_view from './components/Direction_view';
import SettingsModal from './components/SettingsModal';
import TissueIntelligenceWindow from './components/TissueIntelligenceWindow';
import ExpandedAgentDock from './components/ExpandedAgentDock';
import { TissueIntelligenceProvider } from './services/tissueIntelligenceContext';
import { AgentActionsProvider, useAgentActions } from './services/agentActions';

// Helper function to convert RGB to hex
const rgbToHex = (r, g, b) => {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

// Selection box colors - distinct, vibrant colors for easy identification
const SELECTION_COLORS = [
  '#60a5fa', // Blue (first selection)
  '#facc15', // Yellow
  '#e879f9', // Magenta
  '#4ade80', // Green
  '#fb923c', // Orange
  '#f472b6', // Pink
  '#22d3d8', // Cyan
  '#f87171', // Red
  '#a78bfa', // Purple
  '#84cc16', // Lime
];

// Get color for selection index (cycles through colors)
const getSelectionColor = (index) => SELECTION_COLORS[index % SELECTION_COLORS.length];

// Bottom-panel wrappers: normal third-width slot, or maximized overlay that
// covers the whole right section (main view + strip) without remounting.
const panelStyle = {
  width: '33.3%',
  height: '100%',
  overflow: 'hidden',
  boxSizing: 'border-box',
  flexShrink: 0
};
const maximizedStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1000, // above Main_View's floating buttons
  overflow: 'hidden',
  boxSizing: 'border-box'
};

function PanelNavActions({ setMaximizedPanel, maximizedPanel }) {
  const { registerActions, unregisterActions, registerState, unregisterState } = useAgentActions();
  useEffect(() => {
    const valid = ['local', 'graph', 'direction'];
    registerActions({
      maximizePanel: ({ panel }) => {
        if (!valid.includes(panel)) return { message: `Unknown panel "${panel}"` };
        setMaximizedPanel(panel);
        return { message: `Maximized ${panel}`, undo: () => setMaximizedPanel(null) };
      },
      restorePanel: () => { setMaximizedPanel(null); return { message: 'Restored panels' }; }
    });
    return () => unregisterActions(['maximizePanel', 'restorePanel']);
  }, [registerActions, unregisterActions, setMaximizedPanel]);

  // Live "which panel is expanded" awareness.
  useEffect(() => {
    registerState('view', () => `Expanded panel: ${maximizedPanel || 'none (all three panels shown)'}.`);
    return () => unregisterState('view');
  }, [registerState, unregisterState, maximizedPanel]);

  return null;
}

function App() {
  const [channels, setChannels] = useState([]);
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [presetVersion, setPresetVersion] = useState(0);
  const lastAggregatedSignatureRef = useRef('');

  const [selectedRegionsData, setSelectedRegionsData] = useState([]);
  const lastSelectionBoundsRef = useRef(null); // Persist selection bounds across region switches

  // Which bottom panel is maximized over the workspace ('local' | 'graph' | 'ai' | null).
  // Double-clicking a panel's header toggles it. We reposition the same instance
  // (no remount) so the 3D contexts in Main/Local View are never torn down.
  const [maximizedPanel, setMaximizedPanel] = useState(null);
  const toggleMaximize = useCallback(
    (id) => setMaximizedPanel((prev) => (prev === id ? null : id)),
    []
  );

  // Global Settings modal (AI model provider config).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  const handleChannelsChange = useCallback((updatedChannels) => {
    console.log('App: Channels updated:', updatedChannels.length, 'channels');
    setChannels(updatedChannels);
  }, []);

  const agentSetChannels = useCallback((updater) => {
    setChannels((prev) => (typeof updater === 'function' ? updater(prev) : updater));
    setPresetVersion((v) => v + 1);
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

      // Use color from Main_View wireframe for consistency, fallback to computed color
      const newIndex = prev.length;
      const assignedColor = selectedData.color || getSelectionColor(newIndex);
      
      const selectionWithIdAndColor = {
        ...selectedData,
        id: Date.now(),
        color: assignedColor,
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
    <AgentActionsProvider>
      <PanelNavActions setMaximizedPanel={setMaximizedPanel} maximizedPanel={maximizedPanel} />
    <TissueIntelligenceProvider openSettings={openSettings}>
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
        <Title softwareName="Melanoma Tissue Volumes" onOpenSettings={openSettings} />
      </div>

      {/* Main Content Area — fills the space below the title (flex:1 so Title +
          content never exceed 100vh and clip the bottom of maximized panels). */}
      <div style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}>
        {/* Left Sidebar - 100% of main content height, 21% width */}
        <div style={{
          width: '21%',
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
              agentSetChannels={agentSetChannels}
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

        {/* Right Section - 100% of main content height, 79% width */}
        <div style={{
          width: '79%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
          flexShrink: 0,
          position: 'relative' // anchor for the maximized-panel overlay
        }}>
          {/* Main View - 60% height (40% goes to the bottom panels).
              Hidden (not unmounted) while a bottom panel is maximized, so its
              floating 3D-Selection / Reset buttons don't bleed over the overlay. */}
          <div style={{
            height: '60%',
            width: '100%',
            overflow: 'hidden',
            boxSizing: 'border-box',
            flexShrink: 0,
            visibility: maximizedPanel ? 'hidden' : 'visible'
          }}>
            <Main_View
              channels={channels}
              activeRegions={selectedRegions}
              onSelectionChange={handleSelectionChange}
              initialSelectionBounds={lastSelectionBoundsRef.current} // Pass persistent bounds
              selectedRegionsData={selectedRegionsData} // Pass selections to sync wireframes
            />
          </div>

          {/* Bottom panels - 40% height */}
          <div style={{
            height: '40%',
            width: '100%',
            display: 'flex',
            overflow: 'hidden',
            boxSizing: 'border-box',
            flexShrink: 0
          }}>
            {/* Local View */}
            <div style={maximizedPanel === 'local' ? { ...maximizedStyle, display: 'flex' } : panelStyle}>
              <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                <Local_View
                  selectedRegionsData={selectedRegionsData}
                  channels={channels}
                  onRemoveSelection={handleRemoveSelection}
                  onClearAllSelections={handleClearAllSelections}
                  onRestoreSelections={setSelectedRegionsData}
                  onToggleMaximize={() => toggleMaximize('local')}
                  isMaximized={maximizedPanel === 'local'}
                />
              </div>
              {maximizedPanel === 'local' && <ExpandedAgentDock panel="local" onMaximizePanel={setMaximizedPanel} />}
            </div>
            {/* Graph Panel */}
            <div style={maximizedPanel === 'graph' ? { ...maximizedStyle, display: 'flex' } : panelStyle}>
              <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                <Graph_Pannel
                  key={selectedRegionsData.map(r => r.id).join('-') || 'empty'}
                  selectedRegionsData={selectedRegionsData}
                  channels={channels}
                  selectedRegions={selectedRegions}
                  onToggleMaximize={() => toggleMaximize('graph')}
                  isMaximized={maximizedPanel === 'graph'}
                />
              </div>
              {maximizedPanel === 'graph' && <ExpandedAgentDock panel="graph" onMaximizePanel={setMaximizedPanel} />}
            </div>
            {/* Direction View */}
            <div style={maximizedPanel === 'direction' ? { ...maximizedStyle, display: 'flex' } : panelStyle}>
              <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                <Direction_view
                  channels={channels}
                  onToggleMaximize={() => toggleMaximize('direction')}
                  isMaximized={maximizedPanel === 'direction'}
                />
              </div>
              {maximizedPanel === 'direction' && <ExpandedAgentDock panel="direction" onMaximizePanel={setMaximizedPanel} />}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Tissue Intelligence window + global Settings (portal-rendered) */}
      {!maximizedPanel && <TissueIntelligenceWindow />}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
    </TissueIntelligenceProvider>
    </AgentActionsProvider>
  );
}

export default App;
