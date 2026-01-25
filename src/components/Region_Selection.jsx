import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useAgentActions } from '../services/agentActions';
import channelNamesData from '../channel_names.json';

const REGION_DEFINITIONS = [
  {
    id: 'tumor-epithelial',
    title: 'Tumor / Epithelial',
    markers: [
      'MART1',
      'SOX10',
      'MITF',
      'S100B',
      'pan-CK',
      'PRAME',
      'β-catenin',
      'E-cadherin'
    ],
    palette: [
      [27, 158, 119],
      [217, 95, 2],
      [117, 112, 179],
      [231, 41, 138]
    ]
  },
  {
    id: 'immune',
    title: 'Immune (T/B/Myeloid)',
    markers: [
      'CD11b',
      'CD11c',
      'CD4',
      'CD20',
      'CD8a',
      'FOXP3',
      'PD1',
      'LAG3',
      'CD163',
      'CD206'
    ],
    palette: [
      [166, 206, 227],
      [31, 120, 180],
      [51, 160, 44],
      [251, 154, 153]
    ]
  },
  {
    id: 'stroma',
    title: 'Stroma',
    markers: [
      'CD31',
      'Collagen (SHG)',
      'Lamin-ABC',
      'pMLC2'
    ],
    palette: [
      [228, 26, 28],
      [55, 126, 184],
      [77, 175, 74],
      [152, 78, 163]
    ]
  },
  {
    id: 'stress-metabolism',
    title: 'Stress / Metabolism',
    markers: [
      'COX-IV',
      'Catalase',
      'γ-H2AX'
    ],
    palette: [
      [102, 194, 165],
      [252, 141, 98],
      [141, 160, 203],
      [231, 138, 195]
    ]
  },
  {
    id: 'checkpoint-crosstalk',
    title: 'Checkpoint / Crosstalk',
    markers: [
      'PDL1',
      'PD1',
      'MHC-I',
      'MHC-II',
      'IRF1'
    ],
    palette: [
      [141, 211, 199],
      [255, 255, 179],
      [190, 186, 218],
      [251, 128, 114]
    ]
  },
  {
    id: 'proliferation-cellstate',
    title: 'Proliferation / Cell State',
    markers: [
      'Ki67',
      'CyclinD1',
      'BAF1',
      'H3K27me3',
      "5’hmC"
    ],
    palette: [
      [127, 201, 127],
      [190, 174, 212],
      [253, 192, 134],
      [56, 108, 176]
    ]
  }
];

// Two Region Combinations
const TWO_REGION_COMBINATIONS = [
  {
    id: 'tumor-immune',
    title: 'Tumor + Immune',
    description: 'Tumor–immune interaction',
    regionIds: ['tumor-epithelial', 'immune']
  },
  {
    id: 'tumor-checkpoint',
    title: 'Tumor + Checkpoint',
    description: 'Immune evasion / PD-L1 biology',
    regionIds: ['tumor-epithelial', 'checkpoint-crosstalk']
  },
  {
    id: 'immune-stroma',
    title: 'Immune + Stroma',
    description: 'Immune positioning & stromal barriers',
    regionIds: ['immune', 'stroma']
  }
];

// Three Region Combinations
const THREE_REGION_COMBINATIONS = [
  {
    id: 'tumor-immune-checkpoint',
    title: 'Tumor + Immune + Checkpoint',
    description: 'Comprehensive immuno-oncology view',
    regionIds: ['tumor-epithelial', 'immune', 'checkpoint-crosstalk']
  },
  {
    id: 'tumor-stroma-proliferation',
    title: 'Tumor + Stroma + Proliferation',
    description: 'Architecture + growth + tumor cell state',
    regionIds: ['tumor-epithelial', 'stroma', 'proliferation-cellstate']
  }
];

const rgbToHex = (r, g, b) => {
  const toHex = (value) => {
    const clamped = Math.max(0, Math.min(255, value));
    const hex = clamped.toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const normalizeName = (name) =>
  name
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/β/g, 'b')
    .replace(/γ/g, 'y')
    .replace(/\s+/g, ' ')
    .trim();

const aliasMap = {
  'pan-ck': 'pan-cytokeratin'
};

const buildLookupTables = (names) => {
  const exact = new Map();
  const withoutParens = new Map();

  names.forEach((rawName, index) => {
    const normalized = normalizeName(rawName);
    if (!exact.has(normalized)) {
      exact.set(normalized, index);
    }

    const stripped = rawName.replace(/\(.*?\)/g, '').trim();
    if (stripped) {
      const normalizedStripped = normalizeName(stripped);
      if (!withoutParens.has(normalizedStripped)) {
        withoutParens.set(normalizedStripped, index);
      }
    }
  });

  return { exact, withoutParens };
};

const Region_Selection = ({ onToggleRegion, selectedRegions = [] }) => {
  const [activeTab, setActiveTab] = useState('single'); // 'single', 'two', 'three'

  const lookupTables = useMemo(
    () => buildLookupTables(channelNamesData || []),
    []
  );

  const selectedRegionIds = useMemo(
    () => new Set(selectedRegions.map((region) => region.id)),
    [selectedRegions]
  );

  const resolveChannelIndex = (markerName) => {
    if (!markerName) return null;
    const normalized = normalizeName(markerName);
    const aliasTarget = aliasMap[normalized];
    if (aliasTarget) {
      return resolveChannelIndex(aliasTarget);
    }

    if (lookupTables.exact.has(normalized)) {
      return lookupTables.exact.get(normalized);
    }

    if (lookupTables.withoutParens.has(normalized)) {
      return lookupTables.withoutParens.get(normalized);
    }

    const relaxedMatch = channelNamesData.findIndex((rawName) =>
      normalizeName(rawName).includes(normalized)
    );
    if (relaxedMatch !== -1) {
      return relaxedMatch;
    }

    console.warn(`Region_Selection: marker "${markerName}" not found in channel list.`);
    return null;
  };

  const buildRegionPayload = (region) => {
    const topMarkers = region.markers.slice(0, 4);
    const channelConfigs = topMarkers
      .map((marker, index) => {
        const channelIndex = resolveChannelIndex(marker);
        const paletteColor = region.palette[index] || region.palette[region.palette.length - 1];
        const colorHex = Array.isArray(paletteColor)
          ? rgbToHex(paletteColor[0], paletteColor[1], paletteColor[2])
          : '#ffffff';

        if (channelIndex === null || channelIndex === undefined) {
          return null;
        }

        return {
          id: `${region.id}-${channelIndex ?? index}`,
          channelIndex,
          color: colorHex,
          thresholdMin: undefined,
          thresholdMax: undefined,
          opacity: 1,
          visible: true,
          markerName: marker,
          regionId: region.id
        };
      })
      .filter(Boolean);

    return {
      id: region.id,
      title: region.title,
      topMarkers: channelConfigs.map(({ markerName, color }) => ({
        name: markerName,
        color
      })),
      channels: channelConfigs,
      markers: region.markers,
      palette: region.palette
    };
  };

  const { registerActions, unregisterActions, registerState, unregisterState } = useAgentActions();
  const selectedRegionsRef = useRef(selectedRegions);
  useEffect(() => { selectedRegionsRef.current = selectedRegions; }, [selectedRegions]);
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Expose live region state for the assistant's system awareness.
  useEffect(() => {
    registerState('regions', () => {
      const sel = selectedRegionsRef.current || [];
      const names = sel.map((r) => {
        const def = REGION_DEFINITIONS.find((d) => d.id === r.id) ||
          REGION_DEFINITIONS.find((d) => r.id?.startsWith(d.id));
        return def ? def.title : r.id;
      });
      return `Region mode: ${activeTabRef.current}. Selected groups: ${names.length ? names.join(', ') : 'none'}.`;
    });
    return () => unregisterState('regions');
  }, [registerState, unregisterState]);

  useEffect(() => {
    if (!onToggleRegion) return;

    const findDef = (group) => {
      const g = group.toLowerCase().trim();
      return REGION_DEFINITIONS.find(
        (r) => r.title.toLowerCase() === g || r.id === g
      );
    };

    const toggleGroups = (groups, shouldSelect) => {
      const matched = groups.map(findDef).filter(Boolean);
      matched.forEach((region) => {
        onToggleRegion({ regionPayload: buildRegionPayload(region), shouldSelect });
      });
      const titles = matched.map((r) => r.title).join(', ') || '(none matched)';
      return {
        message: `${shouldSelect ? 'Selected' : 'Deselected'} ${titles}`,
        undo: () => matched.forEach((region) =>
          onToggleRegion({ regionPayload: buildRegionPayload(region), shouldSelect: !shouldSelect })
        )
      };
    };

    registerActions({
      selectRegions: ({ groups = [] }) => toggleGroups(groups, true),
      deselectRegions: ({ groups = [] }) => toggleGroups(groups, false),
      setRegionMode: ({ mode }) => {
        const valid = ['single', 'two', 'three'];
        if (!valid.includes(mode)) return { message: `Unknown mode "${mode}"` };
        const prev = activeTab;
        setActiveTab(mode);
        return { message: `Switched to ${mode} region mode`, undo: () => setActiveTab(prev) };
      },
      resetRegions: () => {
        const defs = (selectedRegionsRef.current || [])
          .map((region) =>
            REGION_DEFINITIONS.find((r) => r.id === region.id) ||
            REGION_DEFINITIONS.find((r) => region.id?.startsWith(r.id)))
          .filter(Boolean);
        defs.forEach((def) => onToggleRegion({ regionPayload: buildRegionPayload(def), shouldSelect: false }));
        return {
          message: 'Cleared region selections',
          undo: defs.length
            ? () => defs.forEach((def) => onToggleRegion({ regionPayload: buildRegionPayload(def), shouldSelect: true }))
            : null
        };
      }
    });

    return () => unregisterActions(['selectRegions', 'deselectRegions', 'setRegionMode', 'resetRegions']);
  }, [onToggleRegion, activeTab, registerActions, unregisterActions]);

  // Build payload for combination (two or three regions)
  const buildCombinationPayload = (combination) => {
    const allChannels = [];
    const allMarkers = [];
    const allTopMarkers = [];

    combination.regionIds.forEach((regionId) => {
      const region = REGION_DEFINITIONS.find((r) => r.id === regionId);
      if (region) {
        const regionPayload = buildRegionPayload(region);
        allChannels.push(...regionPayload.channels);
        allMarkers.push(...region.markers);
        allTopMarkers.push(...regionPayload.topMarkers);
      }
    });

    return {
      id: combination.id,
      title: combination.title,
      description: combination.description,
      topMarkers: allTopMarkers,
      channels: allChannels,
      markers: allMarkers,
      regionIds: combination.regionIds,
      isCombination: true
    };
  };

  const handleRegionToggle = (region, shouldSelect) => {
    if (!onToggleRegion) return;
    onToggleRegion({
      regionPayload: buildRegionPayload(region),
      shouldSelect
    });
  };

  const handleCombinationToggle = (combination, shouldSelect) => {
    if (!onToggleRegion) return;
    
    // Toggle all regions in the combination
    combination.regionIds.forEach((regionId) => {
      const region = REGION_DEFINITIONS.find((r) => r.id === regionId);
      if (region) {
        const isCurrentlySelected = selectedRegionIds.has(regionId);
        // Only toggle if the state needs to change
        if (isCurrentlySelected !== shouldSelect) {
          onToggleRegion({
            regionPayload: buildRegionPayload(region),
            shouldSelect
          });
        }
      }
    });
  };

  // Check if a combination is selected (all its regions must be selected)
  const isCombinationSelected = (combination) => {
    return combination.regionIds.every((regionId) => selectedRegionIds.has(regionId));
  };

  // Reset all selections
  const handleResetAll = () => {
    if (!onToggleRegion) return;
    
    // Deselect all currently selected regions
    selectedRegions.forEach((region) => {
      // Find the original region definition to build payload
      const regionDef = REGION_DEFINITIONS.find((r) => r.id === region.id);
      if (regionDef) {
        onToggleRegion({
          regionPayload: buildRegionPayload(regionDef),
          shouldSelect: false
        });
      }
    });
  };

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        backgroundColor: '#000000',
        border: '1px solid var(--border)',
        padding: '12px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxSizing: 'border-box'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '15px',
            fontFamily: 'var(--font-display)',
            color: 'var(--text-1)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 0 3px rgba(59,130,246,0.5))' }}>
            <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" stroke="#3b82f6" strokeWidth="1.6" fill="rgba(59,130,246,0.12)" />
            <rect x="11.5" y="11.5" width="9" height="9" rx="1.5" stroke="#3b82f6" strokeWidth="1.6" fill="rgba(59,130,246,0.18)" />
          </svg>
          Region Selection
        </h3>
        <button
          type="button"
          onClick={handleResetAll}
          disabled={selectedRegions.length === 0}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            color: selectedRegions.length === 0 ? '#666' : '#fff',
            background: selectedRegions.length === 0 ? 'var(--bg-3)' : 'var(--accent)',
            border: selectedRegions.length === 0 ? '1px solid var(--border)' : '1px solid var(--accent)',
            borderRadius: '4px',
            cursor: selectedRegions.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'background-color 150ms var(--ease-out), border-color 150ms var(--ease-out), color 150ms var(--ease-out)',
            outline: 'none'
          }}
          onMouseEnter={(e) => {
            if (selectedRegions.length > 0) {
              e.target.style.background = '#1f57b8';
            }
          }}
          onMouseLeave={(e) => {
            if (selectedRegions.length > 0) {
              e.target.style.background = 'var(--accent)';
            }
          }}
          title="Reset all selections"
        >
          Reset
        </button>
      </div>

      {/* Tab Bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '8px',
          gap: '4px',
          flexShrink: 0
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('single')}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '12px',
            fontWeight: activeTab === 'single' ? 600 : 400,
            color: activeTab === 'single' ? '#fff' : '#b9bed0',
            background: activeTab === 'single' ? '#1a1d29' : 'transparent',
            border: activeTab === 'single' ? '1px solid var(--accent)' : '1px solid var(--border)',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background-color 150ms var(--ease-out), border-color 150ms var(--ease-out), color 150ms var(--ease-out)'
          }}
        >
          Single Region
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('two')}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '12px',
            fontWeight: activeTab === 'two' ? 600 : 400,
            color: activeTab === 'two' ? '#fff' : '#b9bed0',
            background: activeTab === 'two' ? '#1a1d29' : 'transparent',
            border: activeTab === 'two' ? '1px solid var(--accent)' : '1px solid var(--border)',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background-color 150ms var(--ease-out), border-color 150ms var(--ease-out), color 150ms var(--ease-out)'
          }}
        >
          Two Regions
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('three')}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '12px',
            fontWeight: activeTab === 'three' ? 600 : 400,
            color: activeTab === 'three' ? '#fff' : '#b9bed0',
            background: activeTab === 'three' ? '#1a1d29' : 'transparent',
            border: activeTab === 'three' ? '1px solid var(--accent)' : '1px solid var(--border)',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background-color 150ms var(--ease-out), border-color 150ms var(--ease-out), color 150ms var(--ease-out)'
          }}
        >
          Three Regions
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {/* Single Region Tab */}
        {activeTab === 'single' && REGION_DEFINITIONS.map((region) => {
          const isSelected = selectedRegionIds.has(region.id);

          return (
            <button
              key={region.id}
              type="button"
              onClick={() => handleRegionToggle(region, !isSelected)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                width: '100%',
                background: isSelected ? '#1a1d29' : '#0f1016',
                borderRadius: '6px',
                padding: '7px 10px',
                cursor: 'pointer',
                border: 'none',
                outline: 'none'
              }}
              aria-pressed={isSelected}
            >
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '5px',
                  border: isSelected ? '1px solid #1f57b8' : '1px solid #5a5f73',
                  backgroundColor: isSelected ? 'var(--accent)' : 'var(--bg-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '1px',
                  transition: 'background-color 0.15s ease, border 0.15s ease'
                }}
              >
                {isSelected && (
                  <svg
                    viewBox="0 0 16 16"
                    style={{
                      width: '12px',
                      height: '12px'
                    }}
                  >
                    <polyline
                      points="3.2 8.6 6.4 11.6 12.4 4.4"
                      style={{
                        fill: 'none',
                        stroke: '#ffffff',
                        strokeWidth: '2.1',
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round'
                      }}
                    />
                  </svg>
                )}
              </div>

              <div style={{ flex: 1 }}>
                <div
                  style={{
                    color: 'white',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    marginBottom: '2px'
                  }}
                >
                  {region.title}
                </div>
                <div
                  style={{
                    color: '#b9bed0',
                    fontSize: '10.5px',
                    lineHeight: 1.35
                  }}
                >
                  ({region.markers.join(', ')})
                </div>
              </div>
            </button>
          );
        })}

        {/* Two Regions Tab */}
        {activeTab === 'two' && TWO_REGION_COMBINATIONS.map((combination) => {
          const isSelected = isCombinationSelected(combination);

          return (
            <button
              key={combination.id}
              type="button"
              onClick={() => handleCombinationToggle(combination, !isSelected)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                width: '100%',
                background: isSelected ? '#1a1d29' : '#0f1016',
                borderRadius: '6px',
                padding: '7px 10px',
                cursor: 'pointer',
                border: 'none',
                outline: 'none'
              }}
              aria-pressed={isSelected}
            >
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '5px',
                  border: isSelected ? '1px solid #1f57b8' : '1px solid #5a5f73',
                  backgroundColor: isSelected ? 'var(--accent)' : 'var(--bg-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '1px',
                  transition: 'background-color 0.15s ease, border 0.15s ease'
                }}
              >
                {isSelected && (
                  <svg
                    viewBox="0 0 16 16"
                    style={{
                      width: '12px',
                      height: '12px'
                    }}
                  >
                    <polyline
                      points="3.2 8.6 6.4 11.6 12.4 4.4"
                      style={{
                        fill: 'none',
                        stroke: '#ffffff',
                        strokeWidth: '2.1',
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round'
                      }}
                    />
                  </svg>
                )}
              </div>

              <div style={{ flex: 1 }}>
                <div
                  style={{
                    color: 'white',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    marginBottom: '2px'
                  }}
                >
                  {combination.title}
                </div>
                <div
                  style={{
                    color: '#b9bed0',
                    fontSize: '10.5px',
                    lineHeight: 1.35
                  }}
                >
                  {combination.description}
                </div>
              </div>
            </button>
          );
        })}

        {/* Three Regions Tab */}
        {activeTab === 'three' && THREE_REGION_COMBINATIONS.map((combination) => {
          const isSelected = isCombinationSelected(combination);

          return (
            <button
              key={combination.id}
              type="button"
              onClick={() => handleCombinationToggle(combination, !isSelected)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                width: '100%',
                background: isSelected ? '#1a1d29' : '#0f1016',
                borderRadius: '6px',
                padding: '7px 10px',
                cursor: 'pointer',
                border: 'none',
                outline: 'none'
              }}
              aria-pressed={isSelected}
            >
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '5px',
                  border: isSelected ? '1px solid #1f57b8' : '1px solid #5a5f73',
                  backgroundColor: isSelected ? 'var(--accent)' : 'var(--bg-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '1px',
                  transition: 'background-color 0.15s ease, border 0.15s ease'
                }}
              >
                {isSelected && (
                  <svg
                    viewBox="0 0 16 16"
                    style={{
                      width: '12px',
                      height: '12px'
                    }}
                  >
                    <polyline
                      points="3.2 8.6 6.4 11.6 12.4 4.4"
                      style={{
                        fill: 'none',
                        stroke: '#ffffff',
                        strokeWidth: '2.1',
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round'
                      }}
                    />
                  </svg>
                )}
              </div>

              <div style={{ flex: 1 }}>
                <div
                  style={{
                    color: 'white',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    marginBottom: '2px'
                  }}
                >
                  {combination.title}
                </div>
                <div
                  style={{
                    color: '#b9bed0',
                    fontSize: '10.5px',
                    lineHeight: 1.35
                  }}
                >
                  {combination.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

    </div>
  );
};

export default Region_Selection;

