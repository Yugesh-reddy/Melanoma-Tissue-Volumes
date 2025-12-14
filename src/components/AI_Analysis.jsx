import React, { useEffect, useMemo, useRef, useState } from 'react';
import { computeRegionSummary } from '../utils/regionStats';
import { runEngine } from '../services/phenotypeEngine';
import MarkdownLite from './MarkdownLite';
import {
  streamAnalysis,
  getApiKey,
  setApiKey,
  getModel,
  setModel,
  AVAILABLE_MODELS
} from '../services/geminiClient';

const labelForRegion = (region, index) => {
  const dims = region?.bounds
    ? ` (${Math.round(region.bounds.max.x - region.bounds.min.x + 1)}×` +
      `${Math.round(region.bounds.max.y - region.bounds.min.y + 1)}×` +
      `${Math.round(region.bounds.max.z - region.bounds.min.z + 1)})`
    : '';
  return `Box ${index + 1}${dims}`;
};

const pct = (p) => `${Math.round(p * 100)}%`;

// Short professional glyph per population (kept terse, instrument-like).
const PHENOTYPE_GLYPH = {
  melanoma: 'TU',
  cd8_t: 'T8',
  cd4_t: 'T4',
  treg: 'Tr',
  b_cell: 'B',
  m2_macro: 'Mø',
  dc: 'DC',
  myeloid: 'My',
  mast: 'Ma',
  granulocyte: 'Gr',
  vasculature: 'V',
  lymphatic: 'Ly',
  stroma: 'St',
  epithelial: 'Ep'
};

// --- small presentational pieces -------------------------------------------

const Chip = ({ color = 'var(--border)', bg = 'transparent', children, title }) => (
  <span
    title={title}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '3px 9px',
      fontSize: '11px',
      color: 'var(--text-1)',
      background: bg,
      border: `1px solid ${color}`,
      borderRadius: '999px',
      whiteSpace: 'nowrap'
    }}
  >
    {children}
  </span>
);

const Card = ({ title, action, children }) => (
  <div
    style={{
      border: '1px solid var(--border-soft)',
      borderRadius: '10px',
      padding: '11px 12px',
      background: 'var(--bg-2)'
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '9px'
      }}
    >
      <span
        style={{
          fontSize: '9.5px',
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
          fontWeight: 600
        }}
      >
        {title}
      </span>
      {action}
    </div>
    {children}
  </div>
);

const Skeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
    {[92, 78, 85, 60].map((w, i) => (
      <div
        key={i}
        style={{
          height: '10px',
          width: `${w}%`,
          borderRadius: '4px',
          background:
            'linear-gradient(90deg, #14161d 25%, #1e2230 50%, #14161d 75%)',
          backgroundSize: '200% 100%',
          animation: 'mtv-shimmer 1.2s ease-in-out infinite'
        }}
      />
    ))}
  </div>
);

const TmeHero = ({ tme }) => (
  <div
    style={{
      position: 'relative',
      borderRadius: '12px',
      padding: '13px 14px',
      background: `linear-gradient(135deg, ${tme.color}22, ${tme.color}08)`,
      border: `1px solid ${tme.color}55`,
      overflow: 'hidden',
      animation: 'mtv-fade-in 0.4s ease'
    }}
  >
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: tme.color }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '5px' }}>
      <span
        style={{
          width: '9px',
          height: '9px',
          borderRadius: '50%',
          background: tme.color,
          boxShadow: `0 0 10px ${tme.color}`,
          flexShrink: 0
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '17px',
          fontWeight: 700,
          color: '#fff',
          letterSpacing: '-0.01em'
        }}
      >
        {tme.label}
      </span>
      <span
        style={{
          fontSize: '9px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
          marginLeft: 'auto'
        }}
      >
        Microenvironment
      </span>
    </div>
    <div style={{ fontSize: '11.5px', color: 'var(--text-2)', lineHeight: 1.45 }}>{tme.description}</div>
    <div style={{ display: 'flex', gap: '14px', marginTop: '9px' }}>
      <div>
        <div style={{ fontSize: '8.5px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)' }}>
          Immune
        </div>
        <div className="mono" style={{ fontSize: '13px', color: 'var(--text-1)', fontWeight: 600 }}>
          {tme.immuneIndex.toFixed(2)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: '8.5px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)' }}>
          Tumor
        </div>
        <div className="mono" style={{ fontSize: '13px', color: 'var(--text-1)', fontWeight: 600 }}>
          {tme.tumorIndex.toFixed(2)}
        </div>
      </div>
    </div>
  </div>
);

const EngineReport = ({ engine }) => {
  if (!engine) return null;
  const { tme, checkpoint, proliferation, topPhenotypes, drivers } = engine;

  const prolifColor =
    proliferation.level === 'high'
      ? 'var(--tme-hot)'
      : proliferation.level === 'moderate'
      ? 'var(--tme-warm)'
      : 'var(--border)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', marginBottom: '12px' }}>
      <TmeHero tme={tme} />

      {/* Signal chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
        <Chip
          color={checkpoint.flagged ? '#a855f7' : 'var(--border)'}
          bg={checkpoint.flagged ? 'rgba(168,85,247,0.14)' : 'transparent'}
          title={
            checkpoint.flagged
              ? checkpoint.markers.map((m) => `${m.name} ${m.value.toFixed(2)}`).join(', ')
              : 'No checkpoint markers above threshold'
          }
        >
          <span style={{ opacity: 0.7 }}>⚑</span>
          {checkpoint.flagged
            ? `Checkpoint: ${checkpoint.markers.map((m) => m.name).join(', ')}`
            : 'No checkpoint signal'}
        </Chip>
        <Chip color={prolifColor} bg={proliferation.level !== 'low' ? `${prolifColor}22` : 'transparent'}>
          Proliferation: <span style={{ textTransform: 'capitalize' }}>{proliferation.level}</span>
        </Chip>
      </div>

      {/* Phenotype breakdown */}
      <Card title="Inferred cell populations">
        {topPhenotypes.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: '11px', lineHeight: 1.5 }}>
            No population is enriched above the whole-volume baseline — this region is biologically quiet,
            or only structural channels are active.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {topPhenotypes.map((p, i) => (
              <div key={p.id} style={{ animation: `mtv-fade-in 0.35s ease ${i * 0.04}s both` }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    fontSize: '11.5px',
                    color: 'var(--text-2)',
                    marginBottom: '4px'
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: '22px',
                      height: '16px',
                      borderRadius: '4px',
                      background: `${p.color}22`,
                      color: p.color,
                      fontSize: '8.5px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      letterSpacing: '0.02em'
                    }}
                  >
                    {PHENOTYPE_GLYPH[p.id] || '•'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.label}
                  </span>
                  <span className="mono" style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: '11px' }}>
                    {pct(p.proportion)}
                  </span>
                </div>
                <div style={{ height: '6px', background: 'var(--bg-3)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.max(2, p.proportion * 100)}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, ${p.color}cc, ${p.color})`,
                      borderRadius: '3px',
                      transformOrigin: 'left',
                      animation: 'mtv-bar-grow 0.5s cubic-bezier(0.22, 1, 0.36, 1) both'
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Key drivers */}
      {drivers.length > 0 && (
        <Card title="Dominant markers">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {drivers.map((d) => (
              <Chip key={d.name} title={`${d.info.cellType} — ${d.info.func}`}>
                {d.name}
                <span className="mono" style={{ color: 'var(--text-3)' }}>·</span>
                <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  {d.relativeExpression.toFixed(2)}
                </span>
              </Chip>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

// --- main component ---------------------------------------------------------

const AI_Analysis = ({
  selectedRegionsData = [],
  channels = [],
  selectedRegions = [],
  onToggleMaximize,
  isMaximized = false
}) => {
  const [selectedBoxId, setSelectedBoxId] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'streaming' | 'error' | 'done'
  const [output, setOutput] = useState('');
  const [engineResult, setEngineResult] = useState(null);
  const [error, setError] = useState(null);

  const [showSettings, setShowSettings] = useState(false);
  const [keyInput, setKeyInput] = useState(getApiKey());
  const [modelInput, setModelInput] = useState(getModel());

  const abortRef = useRef(null);

  const selectionSignature = useMemo(
    () => selectedRegionsData.map((r) => r.id).join('|'),
    [selectedRegionsData]
  );

  useEffect(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setOutput('');
    setEngineResult(null);
    setError(null);
    setStatus('idle');
    if (selectedRegionsData.length > 0) {
      setSelectedBoxId(selectedRegionsData[selectedRegionsData.length - 1].id);
    } else {
      setSelectedBoxId(null);
    }
  }, [selectionSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeRegion = useMemo(
    () => selectedRegionsData.find((r) => r.id === selectedBoxId) || null,
    [selectedRegionsData, selectedBoxId]
  );

  const hasKey = getApiKey().length > 0;

  const handleSaveSettings = () => {
    setApiKey(keyInput.trim());
    setModel(modelInput);
    setShowSettings(false);
  };

  const handleAnalyze = async () => {
    if (!activeRegion) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setError(null);
    setOutput('');
    setEngineResult(null);

    try {
      const summary = await computeRegionSummary({
        region: activeRegion,
        channels,
        selectedRegions
      });

      if (!summary || !summary.markers || summary.markers.length === 0) {
        throw new Error('No marker data available for this box. Make sure channels are loaded and visible.');
      }

      const engine = runEngine(summary);
      setEngineResult(engine);

      if (!getApiKey()) {
        setStatus('done');
        setShowSettings(true);
        abortRef.current = null;
        return;
      }

      setStatus('streaming');
      await streamAnalysis({
        summary,
        engine,
        signal: controller.signal,
        onToken: (token) => setOutput((prev) => prev + token)
      });

      if (!controller.signal.aborted) setStatus('done');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message);
      setStatus('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setStatus('done');
    }
  };

  const busy = status === 'loading' || status === 'streaming';

  const inputStyle = {
    padding: '7px 9px',
    fontSize: '12px',
    background: 'var(--bg-1)',
    color: 'var(--text-1)',
    border: '1px solid var(--border)',
    borderRadius: '7px',
    outline: 'none',
    fontFamily: 'var(--font-body)'
  };

  const primaryBtn = (enabled) => ({
    padding: '7px 14px',
    fontSize: '12px',
    fontWeight: 600,
    color: enabled ? '#fff' : 'var(--text-3)',
    background: enabled ? 'var(--accent)' : 'var(--bg-3)',
    border: `1px solid ${enabled ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: '7px',
    cursor: enabled ? 'pointer' : 'not-allowed',
    whiteSpace: 'nowrap',
    transition: 'background 0.15s ease, transform 0.1s ease'
  });

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--bg-0)',
        border: '1px solid var(--border)',
        padding: '13px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '11px',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        onDoubleClick={onToggleMaximize}
        title="Double-click to expand"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, cursor: onToggleMaximize ? 'pointer' : 'default', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '6px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px'
            }}
          >
            ✦
          </span>
          <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-1)', fontWeight: 600 }}>
            Tissue Intelligence
          </h3>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            title="API settings"
            style={{
              padding: '5px 9px',
              fontSize: '11px',
              color: 'var(--text-2)',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'border-color 0.15s ease'
            }}
          >
            {hasKey ? '⚙ Settings' : '⚙ Set key'}
          </button>
          {onToggleMaximize && (
            <button
              type="button"
              onClick={onToggleMaximize}
              title={isMaximized ? 'Restore' : 'Expand'}
              style={{
                padding: '5px 8px',
                fontSize: '12px',
                color: 'var(--text-2)',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              {isMaximized ? '⤡' : '⤢'}
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: '9px',
            padding: '11px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            flexShrink: 0,
            background: 'var(--bg-2)'
          }}
        >
          <label style={{ fontSize: '11px', color: 'var(--text-2)' }}>Gemini API key</label>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="AIza..."
            className="mono"
            style={inputStyle}
          />
          <label style={{ fontSize: '11px', color: 'var(--text-2)' }}>Model</label>
          <select value={modelInput} onChange={(e) => setModelInput(e.target.value)} style={inputStyle}>
            {AVAILABLE_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', lineHeight: 1.45 }}>
            Your key is stored only in this browser (localStorage) and sent directly to Google Gemini. The
            grounded phenotype report works without a key — the key only adds the written interpretation.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={handleSaveSettings} style={primaryBtn(true)}>
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              style={{
                padding: '7px 14px',
                fontSize: '12px',
                color: 'var(--text-2)',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '7px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      {!showSettings && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          <select
            value={selectedBoxId ?? ''}
            onChange={(e) => setSelectedBoxId(Number(e.target.value))}
            disabled={selectedRegionsData.length === 0 || busy}
            className="mono"
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
          >
            {selectedRegionsData.length === 0 && <option value="">No selection</option>}
            {selectedRegionsData.map((region, index) => (
              <option key={region.id} value={region.id}>
                {labelForRegion(region, index)}
              </option>
            ))}
          </select>
          {busy ? (
            <button
              type="button"
              onClick={handleStop}
              style={{
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#fff',
                background: '#b8431f',
                border: '1px solid #b8431f',
                borderRadius: '7px',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              ◼ Stop
            </button>
          ) : (
            <button type="button" onClick={handleAnalyze} disabled={!activeRegion} style={primaryBtn(!!activeRegion)}>
              ✦ Analyze
            </button>
          )}
        </div>
      )}

      {/* Output */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          border: '1px solid var(--border-soft)',
          borderRadius: '9px',
          padding: '11px',
          background: 'var(--bg-1)'
        }}
      >
        {status === 'idle' && !engineResult && (
          <div style={{ color: 'var(--text-3)', fontSize: '12px', lineHeight: 1.55 }}>
            {selectedRegionsData.length === 0
              ? 'Draw a 3D box in the Main View, then run a grounded analysis of its cell populations and microenvironment here.'
              : 'Pick a box and press Analyze. You get an instant grounded phenotype report; add a Gemini key for the written interpretation.'}
          </div>
        )}
        {status === 'loading' && !engineResult && (
          <div>
            <div style={{ color: 'var(--text-2)', fontSize: '12px', marginBottom: '8px' }}>
              Computing region statistics…
            </div>
            <Skeleton />
          </div>
        )}
        {error && <div style={{ color: '#f87171', fontSize: '12px', lineHeight: 1.55 }}>{error}</div>}

        {engineResult && <EngineReport engine={engineResult} />}

        {engineResult && (
          <div style={{ color: 'var(--text-1)', fontSize: '12px', lineHeight: 1.6 }}>
            {output ? (
              <>
                <div
                  style={{
                    fontSize: '9.5px',
                    letterSpacing: '0.09em',
                    textTransform: 'uppercase',
                    color: 'var(--text-3)',
                    fontWeight: 600,
                    marginBottom: '6px'
                  }}
                >
                  AI interpretation
                </div>
                <MarkdownLite text={output} />
                {status === 'streaming' && <span style={{ opacity: 0.6 }}>█</span>}
              </>
            ) : status === 'streaming' ? (
              <Skeleton />
            ) : !hasKey ? (
              <div style={{ color: 'var(--text-3)', fontStyle: 'italic', fontSize: '11.5px' }}>
                Add a Gemini API key (top right) and press Analyze again for the written interpretation.
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div style={{ fontSize: '9px', color: 'var(--text-3)', flexShrink: 0, lineHeight: 1.35 }}>
        Research support only — not a diagnostic conclusion. Phenotype and marker assignments require expert
        validation.
      </div>
    </div>
  );
};

export default AI_Analysis;
