import React, { useState, useEffect } from 'react';
import channelNamesData from '../channel_names.json';

// Generate channel options (0-69 based on data shape)
const CHANNEL_COUNT = 70;

// Helper function to convert RGB to hex
const rgbToHex = (r, g, b) => {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

const ChannelSelection = ({ onChannelsChange }) => {
  const [channels, setChannels] = useState([]);
  
  
  const [channelRanges, setChannelRanges] = useState({}); // Store data ranges for each channel

  const [channelOptions, setChannelOptions] = useState(() => {
    // Initialize with channel names from JSON or fallback to "Channel X"
    if (channelNamesData && Array.isArray(channelNamesData) && channelNamesData.length >= CHANNEL_COUNT) {
      return Array.from({ length: CHANNEL_COUNT }, (_, i) => ({
        value: i,
        label: channelNamesData[i] || `Channel ${i}`
      }));
    }
    // Fallback if channel names not loaded
    return Array.from({ length: CHANNEL_COUNT }, (_, i) => ({
      value: i,
      label: `Channel ${i}`
    }));
  });

  // Load channel names from JSON file (if not already loaded)
  useEffect(() => {
    const loadChannelNames = async () => {
      try {
        // Try to load from src folder
        const response = await fetch('/src/channel_names.json');
        if (response.ok) {
          const names = await response.json();
          if (Array.isArray(names) && names.length >= CHANNEL_COUNT) {
            setChannelOptions(
              Array.from({ length: CHANNEL_COUNT }, (_, i) => ({
                value: i,
                label: names[i] || `Channel ${i}`
              }))
            );
          }
        }
      } catch (error) {
        console.warn('Could not load channel names from JSON, using defaults:', error);
        // Keep default channel options
      }
    };

    // Only load if we don't have the data from import
    if (!channelNamesData || !Array.isArray(channelNamesData) || channelNamesData.length < CHANNEL_COUNT) {
      loadChannelNames();
    }
  }, []);

  // Load metadata to get data ranges for each channel
  useEffect(() => {
    const loadChannelRanges = async () => {
      const ranges = {};
      const channelIndices = channels.map(c => c.channelIndex);
      
      for (const channelIndex of channelIndices) {
        if (ranges[channelIndex]) continue; // Already loaded
        
        // Try to load metadata for this channel
        const paths = [
          `./visualization_data/channel_${channelIndex}_napari_metadata.json`,
          `visualization_data/channel_${channelIndex}_napari_metadata.json`,
          `./visualization_data/channel_${channelIndex}_metadata.json`,
          `visualization_data/channel_${channelIndex}_metadata.json`
        ];
        
        for (const path of paths) {
          try {
            const response = await fetch(path);
            if (response.ok) {
              const metadata = await response.json();
              const dataRange = metadata.dataRange || [0, 65535];
              ranges[channelIndex] = dataRange;
              console.log(`Channel ${channelIndex}: Data range [${dataRange[0]}, ${dataRange[1]}]`);
              break;
            }
          } catch (error) {
            continue;
          }
        }
        
        // If not found, use default
        if (!ranges[channelIndex]) {
          ranges[channelIndex] = [0, 65535];
          console.log(`Channel ${channelIndex}: Using default data range [0, 65535]`);
        }
      }
      
      setChannelRanges(ranges);
      
      // Update channels with data ranges and adjust thresholds
      const updatedChannels = channels.map(channel => {
        const range = ranges[channel.channelIndex] || [0, 65535];
        const hasDataRange = channel.dataRange && 
          channel.dataRange[0] === range[0] && 
          channel.dataRange[1] === range[1];
        
        // Calculate 10% to 90% of range (default if threshold not set)
        const rangeSpan = range[1] - range[0];
        const defaultMin = range[0] + rangeSpan * 0.1; // 10% of range
        const defaultMax = range[0] + rangeSpan * 0.9; // 90% of range
        
        // Only update if data range changed or channel doesn't have dataRange
        if (!hasDataRange) {
          return {
            ...channel,
            dataRange: range,
            // Keep existing threshold values if they're valid, otherwise use 10%-90% default
            thresholdMin: (channel.thresholdMin === undefined || channel.thresholdMin < range[0] || channel.thresholdMin > range[1])
              ? Math.round(defaultMin)
              : channel.thresholdMin,
            thresholdMax: (channel.thresholdMax === undefined || channel.thresholdMax < range[0] || channel.thresholdMax > range[1])
              ? Math.round(defaultMax)
              : channel.thresholdMax
          };
        }
        return channel;
      });
      
      // Only update if something changed
      const needsUpdate = updatedChannels.some((ch, idx) => 
        !channels[idx].dataRange || 
        ch.dataRange[0] !== channels[idx].dataRange[0] || 
        ch.dataRange[1] !== channels[idx].dataRange[1] ||
        ch.thresholdMin !== channels[idx].thresholdMin ||
        ch.thresholdMax !== channels[idx].thresholdMax
      );
      
      if (needsUpdate) {
        setChannels(updatedChannels);
      }
    };
    
    loadChannelRanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.map(c => c.channelIndex).join(',')]); // Reload when channel indices change
  
  // Notify parent on mount and whenever channels change
  useEffect(() => {
    if (onChannelsChange) {
      onChannelsChange(channels);
    }
  }, [channels, onChannelsChange]);

  const addChannel = async () => {
    const newId = channels.length > 0 ? Math.max(...channels.map(c => c.id)) + 1 : 0;
    
    // Try to load data range for channel 0
    let dataRange = [0, 65535];
    const paths = [
      `./visualization_data/channel_0_napari_metadata.json`,
      `visualization_data/channel_0_napari_metadata.json`,
      `./visualization_data/channel_0_metadata.json`,
      `visualization_data/channel_0_metadata.json`
    ];
    
    for (const path of paths) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          const metadata = await response.json();
          dataRange = metadata.dataRange || [0, 65535];
          break;
        }
      } catch (error) {
        continue;
      }
    }
    
    // Set threshold to 10%-90% of range
    const rangeSpan = dataRange[1] - dataRange[0];
    const defaultMin = Math.round(dataRange[0] + rangeSpan * 0.1);
    const defaultMax = Math.round(dataRange[0] + rangeSpan * 0.9);
    
    const newChannel = {
      id: newId,
      channelIndex: 0,
      color: '#ffffff',
      thresholdMin: defaultMin,
      thresholdMax: defaultMax,
      dataRange: dataRange,
      opacity: 1.0,
      visible: false  // Start as unchecked - user will check when ready to visualize
    };
    const updatedChannels = [...channels, newChannel];
    setChannels(updatedChannels);
    if (onChannelsChange) {
      onChannelsChange(updatedChannels);
    }
  };

  const removeChannel = (id) => {
    if (channels.length === 1) return; // Keep at least one channel
    const updatedChannels = channels.filter(c => c.id !== id);
    setChannels(updatedChannels);
    if (onChannelsChange) {
      onChannelsChange(updatedChannels);
    }
  };

  const updateChannel = (id, field, value) => {
    const updatedChannels = channels.map(channel => {
      if (channel.id === id) {
        const updated = { ...channel, [field]: value };
        
        // If channel index changed, update data range
        if (field === 'channelIndex') {
          const newIndex = parseInt(value);
          const range = channelRanges[newIndex] || [0, 65535];
          updated.dataRange = range;
          // Reset thresholds to 10%-90% of range
          const rangeSpan = range[1] - range[0];
          updated.thresholdMin = Math.round(range[0] + rangeSpan * 0.1);
          updated.thresholdMax = Math.round(range[0] + rangeSpan * 0.9);
        }
        
        // Convert threshold and opacity to numbers
        if (field === 'thresholdMin' || field === 'thresholdMax' || field === 'opacity') {
          updated[field] = parseFloat(value);
        }
        
        // Ensure thresholdMin <= thresholdMax
        if (field === 'thresholdMin' && updated.thresholdMin > updated.thresholdMax) {
          updated.thresholdMax = updated.thresholdMin;
        }
        if (field === 'thresholdMax' && updated.thresholdMax < updated.thresholdMin) {
          updated.thresholdMin = updated.thresholdMax;
        }
        
        // Clamp thresholds to data range
        const dataRange = updated.dataRange || [0, 65535];
        if (updated.thresholdMin < dataRange[0]) updated.thresholdMin = dataRange[0];
        if (updated.thresholdMin > dataRange[1]) updated.thresholdMin = dataRange[1];
        if (updated.thresholdMax < dataRange[0]) updated.thresholdMax = dataRange[0];
        if (updated.thresholdMax > dataRange[1]) updated.thresholdMax = dataRange[1];
        
        return updated;
      }
      return channel;
    });
    setChannels(updatedChannels);
    // Immediately notify parent for real-time updates
    if (onChannelsChange) {
      onChannelsChange(updatedChannels);
    }
  };

  // Helper to convert hex to RGB
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
  };

  return (
    <div style={{
      height: '100%',
      width: '100%',
      backgroundColor: '#000000',
      border: '1px solid #444',
      padding: '12px',
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        marginBottom: '16px',
        paddingBottom: '12px',
        borderBottom: '1px solid #444'
      }}>
        <h3 style={{ margin: 0, fontSize: '16px', color: 'white', fontWeight: '500' }}>
          Image
        </h3>
      </div>
      
      {/* Channel List */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px' }}>
        {channels.map((channel, index) => {
          const rgb = hexToRgb(channel.color);
          const checkboxColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
          
          return (
            <div
              key={channel.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
                padding: '8px',
                backgroundColor: '#1a1a1a',
                borderRadius: '4px',
                border: '1px solid #444'
              }}
            >
              {/* Visibility Checkbox */}
              <div style={{ position: 'relative', width: '20px', height: '20px' }}>
                <input
                  type="checkbox"
                  checked={channel.visible}
                  onChange={(e) => updateChannel(channel.id, 'visible', e.target.checked)}
                  style={{
                    width: '20px',
                    height: '20px',
                    cursor: 'pointer',
                    appearance: 'none',
                    border: '2px solid #ccc',
                    borderRadius: '3px',
                    backgroundColor: channel.visible ? checkboxColor : 'white',
                    position: 'relative'
                  }}
                />
                {channel.visible && (
                  <span style={{
                    position: 'absolute',
                    left: '4px',
                    top: '1px',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    pointerEvents: 'none'
                  }}>✓</span>
                )}
              </div>

              {/* Color Square */}
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  backgroundColor: channel.color,
                  borderRadius: '3px',
                  border: '1px solid #555',
                  flexShrink: 0
                }}
              />

              {/* Channel Name Dropdown */}
              <select
                value={channel.channelIndex}
                onChange={(e) => updateChannel(channel.id, 'channelIndex', parseInt(e.target.value))}
                style={{
                  padding: '6px 10px',
                  backgroundColor: '#2a2a2a',
                  color: 'white',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  fontSize: '13px',
                  minWidth: '120px',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {channelOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              {/* Color Picker (hidden, but accessible via color square) */}
              <input
                type="color"
                value={channel.color}
                onChange={(e) => updateChannel(channel.id, 'color', e.target.value)}
                style={{
                  width: '0px',
                  height: '0px',
                  opacity: 0,
                  position: 'absolute',
                  pointerEvents: 'none'
                }}
                id={`color-picker-${channel.id}`}
              />
              <div
                onClick={() => document.getElementById(`color-picker-${channel.id}`).click()}
                style={{
                  width: '24px',
                  height: '24px',
                  backgroundColor: channel.color,
                  borderRadius: '4px',
                  border: '1px solid #555',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              />

            {/* Threshold Range Slider (Dual Range with Value Labels) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0px', minWidth: '200px', flex: 1, position: 'relative' }}>
              {(() => {
                const dataRange = channel.dataRange || [0, 65535];
                const rangeMin = dataRange[0];
                const rangeMax = dataRange[1];
                const thresholdMin = channel.thresholdMin !== undefined ? channel.thresholdMin : rangeMin;
                const thresholdMax = channel.thresholdMax !== undefined ? channel.thresholdMax : rangeMax;
                const minPercent = ((thresholdMin - rangeMin) / (rangeMax - rangeMin)) * 100;
                const maxPercent = ((thresholdMax - rangeMin) / (rangeMax - rangeMin)) * 100;
                
                return (
                  <>
                    {/* Value labels above handles */}
                    <div style={{ position: 'relative', width: '100%', height: '24px', marginBottom: '4px' }}>
                      {/* Min value label */}
                      <div style={{
                        position: 'absolute',
                        left: `${minPercent}%`,
                        transform: 'translateX(-50%)',
                        top: '0px',
                        backgroundColor: channel.color,
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        zIndex: 10,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                      }}>
                        {thresholdMin.toLocaleString()}
                      </div>
                      {/* Max value label */}
                      <div style={{
                        position: 'absolute',
                        left: `${maxPercent}%`,
                        transform: 'translateX(-50%)',
                        top: '0px',
                        backgroundColor: channel.color,
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        zIndex: 10,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                      }}>
                        {thresholdMax.toLocaleString()}
                      </div>
                    </div>
                    
                    {/* Slider container */}
                    <div style={{ position: 'relative', width: '100%', height: '12px', display: 'flex', alignItems: 'center', flex: 1 }}>
                      {/* Background track */}
                      <div style={{
                        position: 'absolute',
                        width: '100%',
                        height: '6px',
                        backgroundColor: '#555',
                        borderRadius: '3px',
                        zIndex: 0
                      }} />
                      {/* Active range indicator - colored with channel color */}
                      <div style={{
                        position: 'absolute',
                        left: `${minPercent}%`,
                        width: `${maxPercent - minPercent}%`,
                        height: '6px',
                        backgroundColor: channel.color,
                        borderRadius: '3px',
                        zIndex: 0,
                        pointerEvents: 'none',
                        opacity: 0.8
                      }} />
                      
                      {/* Min Slider Handle */}
                      <input
                        type="range"
                        min={rangeMin}
                        max={rangeMax}
                        step={Math.max(1, Math.floor((rangeMax - rangeMin) / 1000))}
                        value={thresholdMin}
                        onChange={(e) => {
                          const newMin = Math.min(parseInt(e.target.value), thresholdMax);
                          updateChannel(channel.id, 'thresholdMin', newMin);
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          // Bring min slider to front when dragging
                          e.currentTarget.style.zIndex = '10';
                          // Find max slider and put it behind
                          const container = e.currentTarget.closest('div');
                          if (container) {
                            const maxSlider = container.querySelector('input[type="range"]:last-of-type');
                            if (maxSlider && maxSlider !== e.currentTarget) {
                              maxSlider.style.zIndex = '9';
                            }
                          }
                        }}
                        onMouseUp={(e) => {
                          // Reset z-index based on position
                          const minPos = (thresholdMin - rangeMin) / (rangeMax - rangeMin);
                          const maxPos = (thresholdMax - rangeMin) / (rangeMax - rangeMin);
                          e.currentTarget.style.zIndex = minPos <= maxPos ? '4' : '5';
                        }}
                        style={{
                          position: 'absolute',
                          width: '100%',
                          height: '12px',
                          margin: 0,
                          padding: 0,
                          top: '-3px',
                          zIndex: minPercent <= maxPercent ? '4' : '5',
                          pointerEvents: 'auto',
                          background: 'transparent',
                          WebkitAppearance: 'none',
                          appearance: 'none',
                          cursor: 'pointer',
                          outline: 'none',
                          touchAction: 'none'
                        }}
                      />
                      
                      {/* Max Slider Handle */}
                      <input
                        type="range"
                        min={rangeMin}
                        max={rangeMax}
                        step={Math.max(1, Math.floor((rangeMax - rangeMin) / 1000))}
                        value={thresholdMax}
                        onChange={(e) => {
                          const newMax = Math.max(parseInt(e.target.value), thresholdMin);
                          updateChannel(channel.id, 'thresholdMax', newMax);
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          // Bring max slider to front when dragging
                          e.currentTarget.style.zIndex = '10';
                          // Find min slider and put it behind
                          const container = e.currentTarget.closest('div');
                          if (container) {
                            const minSlider = container.querySelector('input[type="range"]:first-of-type');
                            if (minSlider && minSlider !== e.currentTarget) {
                              minSlider.style.zIndex = '9';
                            }
                          }
                        }}
                        onMouseUp={(e) => {
                          // Reset z-index based on position
                          const minPos = (thresholdMin - rangeMin) / (rangeMax - rangeMin);
                          const maxPos = (thresholdMax - rangeMin) / (rangeMax - rangeMin);
                          e.currentTarget.style.zIndex = maxPos >= minPos ? '5' : '4';
                        }}
                        style={{
                          position: 'absolute',
                          width: '100%',
                          height: '12px',
                          margin: 0,
                          padding: 0,
                          top: '-3px',
                          zIndex: maxPercent >= minPercent ? '5' : '4',
                          pointerEvents: 'auto',
                          background: 'transparent',
                          WebkitAppearance: 'none',
                          appearance: 'none',
                          cursor: 'pointer',
                          outline: 'none',
                          touchAction: 'none'
                        }}
                      />
                    </div>
                  </>
                );
              })()}
            </div>

              {/* More Options (Vertical Ellipsis) with Delete */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // Show delete confirmation or directly delete
                    if (window.confirm(`Delete channel ${channel.channelIndex}?`)) {
                      removeChannel(channel.id);
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    fontSize: '18px',
                    color: '#aaa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title="Delete channel"
                >
                  ⋮
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Channel Button */}
      <button
        onClick={addChannel}
        style={{
          marginTop: '10px',
          padding: '10px 20px',
          backgroundColor: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '500',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          width: '100%'
        }}
        onMouseOver={(e) => { e.target.style.backgroundColor = '#45a049'; }}
        onMouseOut={(e) => { e.target.style.backgroundColor = '#4CAF50'; }}
      >
        + Add Channel
      </button>
    </div>
  );
};

export default ChannelSelection;
