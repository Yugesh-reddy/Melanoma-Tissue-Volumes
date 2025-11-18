import React, { useState, useEffect, useMemo, useRef } from 'react';
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

const ChannelSelection = ({ onChannelsChange, presetChannels = [], presetVersion = 0 }) => {
  const [channels, setChannels] = useState([]);
  const presetVersionRef = useRef(null);
  const presetChannelsRef = useRef(presetChannels);
  const applyingPresetRef = useRef(false);

  useEffect(() => {
    presetChannelsRef.current = presetChannels;
  }, [presetChannels]);
  
  
  const [channelRanges, setChannelRanges] = useState({}); // Store data ranges for each channel
  const [pendingThresholds, setPendingThresholds] = useState({});

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

  const channelIndexKey = useMemo(
    () => channels.map((c) => c.channelIndex).join(','),
    [channels]
  );

  useEffect(() => {
    if (presetVersion === undefined || presetVersion === null) return;
    if (presetVersionRef.current === presetVersion) return;
    presetVersionRef.current = presetVersion;

    const externalChannels = Array.isArray(presetChannelsRef.current)
      ? presetChannelsRef.current
      : [];

    const usedIds = new Set();
    const normalizedChannels = externalChannels.map((channel, idx) => {
      const baseId = channel.id ?? channel.channelIndex ?? idx;
      let candidateId = String(baseId);
      let duplicateCounter = 1;
      while (usedIds.has(candidateId)) {
        candidateId = `${baseId}_${duplicateCounter++}`;
      }
      usedIds.add(candidateId);

      return {
        ...channel,
        id: candidateId,
        visible: channel.visible !== false,
        opacity: channel.opacity ?? 1,
        color: channel.color || '#ffffff'
      };
    });

    const initialPending = {};
    normalizedChannels.forEach((channel) => {
      initialPending[channel.id] = {
        thresholdMin: channel.thresholdMin ?? 0,
        thresholdMax: channel.thresholdMax ?? 0
      };
    });

    setChannelRanges({});
    setPendingThresholds(initialPending);
    applyingPresetRef.current = true;
    setChannels(normalizedChannels);
  }, [presetVersion, onChannelsChange]);

  // Keep pending thresholds in sync with channel list
  useEffect(() => {
    setPendingThresholds((prev) => {
      const next = {};
      channels.forEach((channel) => {
        const existing = prev[channel.id];
        next[channel.id] = existing || {
          thresholdMin: channel.thresholdMin,
          thresholdMax: channel.thresholdMax
        };
      });
      return next;
    });
  }, [channels]);

  // Load metadata to get data ranges for each channel only when indices change
  useEffect(() => {
    let cancelled = false;

    const loadChannelRanges = async () => {
      if (channels.length === 0) {
        if (!cancelled) {
          setChannelRanges({});
        }
        return;
      }

      const ranges = { ...channelRanges };
      let changed = false;

      for (const channel of channels) {
        const channelIndex = channel.channelIndex;
        if (ranges[channelIndex]) continue;

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
              changed = true;
              break;
            }
          } catch (error) {
            // continue trying other paths
          }
        }

        if (!ranges[channelIndex]) {
          ranges[channelIndex] = [0, 65535];
          changed = true;
          console.log(`Channel ${channelIndex}: Using default data range [0, 65535]`);
        }
      }

      if (changed && !cancelled) {
        setChannelRanges(ranges);
        setChannels((prev) =>
          prev.map((channel) => {
            const range = ranges[channel.channelIndex] || [0, 65535];
            if (
              channel.dataRange &&
              channel.dataRange[0] === range[0] &&
              channel.dataRange[1] === range[1]
            ) {
              return channel;
            }

            const rangeSpan = range[1] - range[0];
            const defaultMin = Math.round(range[0] + rangeSpan * 0.1);
            const defaultMax = Math.round(range[0] + rangeSpan * 0.9);

            setPendingThresholds((prevPending) => ({
              ...prevPending,
              [channel.id]: {
                thresholdMin: defaultMin,
                thresholdMax: defaultMax
              }
            }));

            return {
              ...channel,
              dataRange: range,
              thresholdMin:
                channel.thresholdMin === undefined ||
                channel.thresholdMin < range[0] ||
                channel.thresholdMin > range[1]
                  ? defaultMin
                  : channel.thresholdMin,
              thresholdMax:
                channel.thresholdMax === undefined ||
                channel.thresholdMax < range[0] ||
                channel.thresholdMax > range[1]
                  ? defaultMax
                  : channel.thresholdMax
            };
          })
        );
      }
    };

    loadChannelRanges();

    return () => {
      cancelled = true;
    };
  }, [channelIndexKey]);
  
  // Notify parent on mount and whenever channels change
  useEffect(() => {
    if (applyingPresetRef.current) {
      applyingPresetRef.current = false;
      return;
    }
    if (onChannelsChange) {
      onChannelsChange(channels);
    }
  }, [channels, onChannelsChange]);

  const addChannel = async () => {
    const numericIds = channels
      .map((c) => (typeof c.id === 'number' && Number.isFinite(c.id) ? c.id : null))
      .filter((id) => id !== null);
    const maxId = numericIds.length > 0 ? Math.max(...numericIds) : -1;
    const newId = maxId + 1;
    
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
    setPendingThresholds((prev) => ({
      ...prev,
      [newId]: {
        thresholdMin: newChannel.thresholdMin,
        thresholdMax: newChannel.thresholdMax
      }
    }));
    if (onChannelsChange) {
      onChannelsChange(updatedChannels);
    }
  };

  const removeChannel = (id) => {
    const updatedChannels = channels.filter(c => c.id !== id);
    setChannels(updatedChannels);
    setPendingThresholds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
        if (field === 'opacity') {
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
        
        if (field === 'channelIndex') {
          setPendingThresholds((prevPending) => ({
            ...prevPending,
            [id]: {
              thresholdMin: updated.thresholdMin,
              thresholdMax: updated.thresholdMax
            }
          }));
        }
        
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

  const handlePendingThresholdChange = (id, type, rawValue) => {
    const channel = channels.find((c) => c.id === id);
    if (!channel) return;

    const dataRange = channel.dataRange || [0, 65535];
    const clamped = clampValue(parseInt(rawValue, 10), dataRange[0], dataRange[1]);

    setPendingThresholds((prev) => {
      const existing = prev[id] || {
        thresholdMin: channel.thresholdMin,
        thresholdMax: channel.thresholdMax
      };
      const next = {
        ...existing,
        [type]: clamped
      };
      if (type === 'thresholdMin' && next.thresholdMin > next.thresholdMax) {
        next.thresholdMax = next.thresholdMin;
      }
      if (type === 'thresholdMax' && next.thresholdMax < next.thresholdMin) {
        next.thresholdMin = next.thresholdMax;
      }
      next.thresholdMin = clampValue(next.thresholdMin, dataRange[0], dataRange[1]);
      next.thresholdMax = clampValue(next.thresholdMax, dataRange[0], dataRange[1]);
      return {
        ...prev,
        [id]: next
      };
    });
  };

  const clampValue = (value, min, max) => {
    if (Number.isNaN(value)) return min;
    return Math.min(Math.max(value, min), max);
  };

  const applyPendingThresholds = () => {
    let changed = false;
    const updatedChannels = channels.map((channel) => {
      const pending = pendingThresholds[channel.id];
      if (!pending) return channel;
      if (
        channel.thresholdMin === pending.thresholdMin &&
        channel.thresholdMax === pending.thresholdMax
      ) {
        return channel;
      }
      changed = true;
      return {
        ...channel,
        thresholdMin: pending.thresholdMin,
        thresholdMax: pending.thresholdMax
      };
    });

    if (!changed) return;

    setChannels(updatedChannels);
    setPendingThresholds((prev) => {
      const next = { ...prev };
      updatedChannels.forEach((channel) => {
        next[channel.id] = {
          thresholdMin: channel.thresholdMin,
          thresholdMax: channel.thresholdMax
        };
      });
      return next;
    });

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
      padding: '10px',
      display: 'flex',
      flexDirection: 'column',
      fontSize: '12px',
      boxSizing: 'border-box',
      overflow: 'hidden'
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
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '12px' }}>
        {channels.map((channel, index) => {
          const rgb = hexToRgb(channel.color);
          const checkboxColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
          
          return (
            <div
              key={channel.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '10px',
                padding: '6px',
                backgroundColor: '#1a1a1a',
                borderRadius: '4px',
                border: '1px solid #444'
              }}
            >
              {/* Visibility Checkbox */}
              <div style={{ position: 'relative', width: '16px', height: '16px' }}>
                <input
                  type="checkbox"
                  checked={channel.visible}
                  onChange={(e) => updateChannel(channel.id, 'visible', e.target.checked)}
                  style={{
                    width: '16px',
                    height: '16px',
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
                    left: '2px',
                    top: '-1px',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    pointerEvents: 'none'
                  }}>✓</span>
                )}
              </div>

              {/* Color Square */}
              <div
                style={{
                  width: '16px',
                  height: '16px',
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
                  padding: '5px 8px',
                  backgroundColor: '#2a2a2a',
                  color: 'white',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  fontSize: '11px',
                  minWidth: '100px',
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
                  width: '20px',
                  height: '20px',
                  backgroundColor: channel.color,
                  borderRadius: '4px',
                  border: '1px solid #555',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              />

            {/* Threshold Range Slider (Dual Range with Value Labels) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px', flex: 1, position: 'relative' }}>
              {(() => {
                const dataRange = channel.dataRange || [0, 65535];
                const rangeMin = dataRange[0];
                const rangeMax = dataRange[1];
                const pending = pendingThresholds[channel.id] || {
                  thresholdMin: channel.thresholdMin ?? rangeMin,
                  thresholdMax: channel.thresholdMax ?? rangeMax
                };
                const thresholdMin = pending.thresholdMin;
                const thresholdMax = pending.thresholdMax;
                const minPercent = ((thresholdMin - rangeMin) / (rangeMax - rangeMin)) * 100;
                const maxPercent = ((thresholdMax - rangeMin) / (rangeMax - rangeMin)) * 100;
                
                return (
                  <>
                    {/* Value labels above handles */}
                    <div style={{ position: 'relative', width: '100%', height: '20px', marginBottom: '4px' }}>
                      {/* Min value label */}
                      <div style={{
                        position: 'absolute',
                        left: `${minPercent}%`,
                        transform: 'translateX(-50%)',
                        top: '0px',
                        backgroundColor: channel.color,
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        fontSize: '10px',
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
                        padding: '2px 6px',
                        borderRadius: '10px',
                        fontSize: '10px',
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
                    <div style={{ position: 'relative', width: '100%', height: '10px', display: 'flex', alignItems: 'center', flex: 1 }}>
                      {/* Background track */}
                      <div style={{
                        position: 'absolute',
                        width: '100%',
                        height: '5px',
                        backgroundColor: '#555',
                        borderRadius: '3px',
                        zIndex: 0
                      }} />
                      {/* Active range indicator - colored with channel color */}
                      <div style={{
                        position: 'absolute',
                        left: `${minPercent}%`,
                        width: `${maxPercent - minPercent}%`,
                        height: '5px',
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
                          const value = Math.min(parseInt(e.target.value, 10), thresholdMax);
                          handlePendingThresholdChange(channel.id, 'thresholdMin', value);
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
                          height: '10px',
                          margin: 0,
                          padding: 0,
                          top: '-2px',
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
                          const value = Math.max(parseInt(e.target.value, 10), thresholdMin);
                          handlePendingThresholdChange(channel.id, 'thresholdMax', value);
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
                          height: '10px',
                          margin: 0,
                          padding: 0,
                          top: '-2px',
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
              <div />
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
                    padding: '2px 6px',
                    fontSize: '16px',
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
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button
          onClick={addChannel}
          style={{
            flex: 1,
            padding: '8px 16px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.4px'
          }}
          onMouseOver={(e) => { e.target.style.backgroundColor = '#45a049'; }}
          onMouseOut={(e) => { e.target.style.backgroundColor = '#4CAF50'; }}
        >
          + Add Channel
        </button>
        <button
          onClick={applyPendingThresholds}
          disabled={!channels.some((channel) => {
            const pending = pendingThresholds[channel.id];
            if (!pending) return false;
            return (
              pending.thresholdMin !== channel.thresholdMin ||
              pending.thresholdMax !== channel.thresholdMax
            );
          })}
          style={{
            padding: '8px 16px',
            backgroundColor: channels.some((channel) => {
              const pending = pendingThresholds[channel.id];
              if (!pending) return false;
              return (
                pending.thresholdMin !== channel.thresholdMin ||
                pending.thresholdMax !== channel.thresholdMax
              );
            })
              ? '#2d7ff9'
              : '#444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: channels.some((channel) => {
              const pending = pendingThresholds[channel.id];
              if (!pending) return false;
              return (
                pending.thresholdMin !== channel.thresholdMin ||
                pending.thresholdMax !== channel.thresholdMax
              );
            })
              ? 'pointer'
              : 'default',
            fontSize: '11px',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.4px'
          }}
        >
          Apply Filter
        </button>
      </div>
    </div>
  );
};

export default ChannelSelection;
