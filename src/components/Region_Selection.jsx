import React, { useMemo, useState } from 'react';
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
        border: '1px solid #444',
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
            fontSize: '18px',
            color: 'white',
            fontWeight: 500
          }}
        >
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
            background: selectedRegions.length === 0 ? '#1a1a1a' : '#2d7ff9',
            border: selectedRegions.length === 0 ? '1px solid #444' : '1px solid #2d7ff9',
            borderRadius: '4px',
            cursor: selectedRegions.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
            outline: 'none'
          }}
          onMouseEnter={(e) => {
            if (selectedRegions.length > 0) {
              e.target.style.background = '#1f57b8';
            }
          }}
          onMouseLeave={(e) => {
            if (selectedRegions.length > 0) {
              e.target.style.background = '#2d7ff9';
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
          borderBottom: '1px solid #444',
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
            border: activeTab === 'single' ? '1px solid #2d7ff9' : '1px solid #444',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
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
            border: activeTab === 'two' ? '1px solid #2d7ff9' : '1px solid #444',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
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
            border: activeTab === 'three' ? '1px solid #2d7ff9' : '1px solid #444',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
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
                padding: '10px 12px',
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
                  backgroundColor: isSelected ? '#2d7ff9' : '#12131d',
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
                    fontSize: '14px',
                    fontWeight: 500,
                    marginBottom: '4px'
                  }}
                >
                  {region.title}
                </div>
                <div
                  style={{
                    color: '#b9bed0',
                    fontSize: '12px',
                    lineHeight: 1.4
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
                padding: '10px 12px',
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
                  backgroundColor: isSelected ? '#2d7ff9' : '#12131d',
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
                    fontSize: '14px',
                    fontWeight: 500,
                    marginBottom: '4px'
                  }}
                >
                  {combination.title}
                </div>
                <div
                  style={{
                    color: '#b9bed0',
                    fontSize: '12px',
                    lineHeight: 1.4
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
                padding: '10px 12px',
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
                  backgroundColor: isSelected ? '#2d7ff9' : '#12131d',
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
                    fontSize: '14px',
                    fontWeight: 500,
                    marginBottom: '4px'
                  }}
                >
                  {combination.title}
                </div>
                <div
                  style={{
                    color: '#b9bed0',
                    fontSize: '12px',
                    lineHeight: 1.4
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

