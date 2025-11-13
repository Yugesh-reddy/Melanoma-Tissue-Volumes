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

const Region_Selection = ({ onRegionSelect, selectedRegionId }) => {
  const [hoveredRegionId, setHoveredRegionId] = useState(null);

  const lookupTables = useMemo(
    () => buildLookupTables(channelNamesData || []),
    []
  );

  const selectedRegion = useMemo(
    () => REGION_DEFINITIONS.find((region) => region.id === selectedRegionId) || null,
    [selectedRegionId]
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
          id: `region-${region.id}-${index}`,
          channelIndex,
          color: colorHex,
          thresholdMin: undefined,
          thresholdMax: undefined,
          opacity: 1,
          visible: true,
          markerName: marker
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
      channels: channelConfigs
    };
  };

  const handleRegionToggle = (region, isChecked) => {
    if (!onRegionSelect) return;
    if (isChecked) {
      onRegionSelect(buildRegionPayload(region));
    } else {
      onRegionSelect(null);
    }
  };

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        backgroundColor: '#000000',
        border: '1px solid #444',
        padding: '12px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {REGION_DEFINITIONS.map((region) => {
          const isSelected = selectedRegionId === region.id;
          const isHovered = hoveredRegionId === region.id;

          return (
            <label
              key={region.id}
              onMouseEnter={() => setHoveredRegionId(region.id)}
              onMouseLeave={() => setHoveredRegionId(null)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                width: '100%',
                background: isSelected
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(0,0,0,0.2))'
                  : '#111',
                border: isSelected ? '1px solid #2d7ff9' : '1px solid #333',
                borderRadius: '8px',
                padding: '12px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'transform 0.15s ease, border 0.15s ease, box-shadow 0.15s ease',
                boxShadow: isSelected
                  ? '0 0 12px rgba(45, 127, 249, 0.35)'
                  : isHovered
                    ? '0 0 8px rgba(255, 255, 255, 0.12)'
                    : 'none'
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(event) => handleRegionToggle(region, event.target.checked)}
                style={{
                  width: '18px',
                  height: '18px',
                  marginTop: '2px',
                  cursor: 'pointer',
                  accentColor: '#2d7ff9',
                  flexShrink: 0
                }}
              />

              <div style={{ flex: 1 }}>
                <div
                  style={{
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 600,
                    marginBottom: '6px'
                  }}
                >
                  {region.title}
                </div>
                <div
                  style={{
                    color: '#cccccc',
                    fontSize: '12px',
                    lineHeight: 1.4
                  }}
                >
                  ({region.markers.join(', ')})
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {selectedRegion && (
        <div
          style={{
            marginTop: '4px',
            padding: '14px',
            borderRadius: '10px',
            border: '1px solid #2d7ff9',
            background: 'linear-gradient(135deg, rgba(45,127,249,0.12), rgba(13,17,23,0.9))',
            color: '#f0f6ff',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 600 }}>
            {selectedRegion.title}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '12px', letterSpacing: '0.2px', color: '#c8dcff' }}>
              Top 4 channels for visualization:
            </div>
            {selectedRegion.markers.slice(0, 4).map((marker, index) => {
              const color = selectedRegion.palette[index] || selectedRegion.palette[selectedRegion.palette.length - 1];
              const swatch = rgbToHex(color[0], color[1], color[2]);
              return (
                <div
                  key={`${selectedRegion.id}-preview-${marker}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}
                >
                  <span
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '3px',
                      backgroundColor: swatch,
                      border: '1px solid rgba(255,255,255,0.25)'
                    }}
                  />
                  <span>{marker}</span>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: '12px', color: '#c8dcff', marginTop: '4px' }}>
            All region markers:
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              fontSize: '11px'
            }}
          >
            {selectedRegion.markers.map((marker) => (
              <span
                key={`${selectedRegion.id}-marker-${marker}`}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(45, 127, 249, 0.18)',
                  border: '1px solid rgba(45, 127, 249, 0.32)'
                }}
              >
                {marker}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Region_Selection;

