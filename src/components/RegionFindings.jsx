// Deterministic engine findings, rendered as instant cards (no LLM needed).
// Extracted from the former AI_Analysis panel so the Tissue Intelligence window
// can show the same grounded readout for any region context.

import React from 'react';

const pct = (p) => `${Math.round(p * 100)}%`;

const PHENOTYPE_GLYPH = {
  melanoma: 'TU', cd8_t: 'T8', cd4_t: 'T4', treg: 'Tr', b_cell: 'B',
  m2_macro: 'Mø', dc: 'DC', myeloid: 'My', mast: 'Ma', granulocyte: 'Gr',
  vasculature: 'V', lymphatic: 'Ly', stroma: 'St', epithelial: 'Ep'
};

export const Chip = ({ color = 'var(--border)', bg = 'transparent', children, title }) => (
  <span
    title={title}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 9px',
      fontSize: '11px', color: 'var(--text-1)', background: bg,
      border: `1px solid ${color}`, borderRadius: '999px', whiteSpace: 'nowrap'
    }}
  >
    {children}
  </span>
);

export const Card = ({ title, children }) => (
  <div style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-lg)', padding: '11px 12px', background: 'var(--bg-2)' }}>
    <div style={{ marginBottom: '9px' }}>
      <span style={{ fontSize: '9.5px', letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600 }}>
        {title}
      </span>
    </div>
    {children}
  </div>
);

const TmeHero = ({ tme }) => (
  <div
    style={{
      position: 'relative', borderRadius: 'var(--radius-lg)', padding: '13px 14px',
      background: `linear-gradient(135deg, ${tme.color}22, ${tme.color}08)`,
      border: `1px solid ${tme.color}55`, overflow: 'hidden', animation: 'mtv-fade-in 0.4s ease'
    }}
  >
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: tme.color }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '5px' }}>
      <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: tme.color, boxShadow: `0 0 10px ${tme.color}`, flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-display)', fontSize: '17px', fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>
        {tme.label}
      </span>
      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginLeft: 'auto' }}>
        Microenvironment
      </span>
    </div>
    <div style={{ fontSize: '11.5px', color: 'var(--text-2)', lineHeight: 1.45 }}>{tme.description}</div>
    <div style={{ display: 'flex', gap: '14px', marginTop: '9px' }}>
      <div>
        <div style={{ fontSize: '8.5px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)' }}>Immune</div>
        <div className="mono" style={{ fontSize: '13px', color: 'var(--text-1)', fontWeight: 600 }}>{tme.immuneIndex.toFixed(2)}</div>
      </div>
      <div>
        <div style={{ fontSize: '8.5px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)' }}>Tumor</div>
        <div className="mono" style={{ fontSize: '13px', color: 'var(--text-1)', fontWeight: 600 }}>{tme.tumorIndex.toFixed(2)}</div>
      </div>
    </div>
  </div>
);

const RegionFindings = ({ engine }) => {
  if (!engine) return null;
  const { tme, checkpoint, proliferation, topPhenotypes, drivers } = engine;

  const prolifColor =
    proliferation.level === 'high' ? 'var(--tme-hot)'
      : proliferation.level === 'moderate' ? 'var(--tme-warm)'
      : 'var(--border)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
      <TmeHero tme={tme} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
        <Chip
          color={checkpoint.flagged ? '#a855f7' : 'var(--border)'}
          bg={checkpoint.flagged ? 'rgba(168,85,247,0.14)' : 'transparent'}
          title={checkpoint.flagged ? checkpoint.markers.map((m) => `${m.name} ${m.value.toFixed(2)}`).join(', ') : 'No checkpoint markers above threshold'}
        >
          <span style={{ opacity: 0.7 }}>⚑</span>
          {checkpoint.flagged ? `Checkpoint: ${checkpoint.markers.map((m) => m.name).join(', ')}` : 'No checkpoint signal'}
        </Chip>
        <Chip color={prolifColor} bg={proliferation.level !== 'low' ? `${prolifColor}22` : 'transparent'}>
          Proliferation: <span style={{ textTransform: 'capitalize' }}>{proliferation.level}</span>
        </Chip>
      </div>

      <Card title="Inferred cell populations">
        {topPhenotypes.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: '11px', lineHeight: 1.5 }}>
            No population is enriched above the whole-volume baseline — this region is biologically quiet, or only structural channels are active.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {topPhenotypes.map((p, i) => (
              <div key={p.id} style={{ animation: `mtv-fade-in 0.35s ease ${i * 0.04}s both` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--text-2)', marginBottom: '4px' }}>
                  <span style={{ flexShrink: 0, width: '22px', height: '16px', borderRadius: '4px', background: `${p.color}22`, color: p.color, fontSize: '8.5px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.02em' }}>
                    {PHENOTYPE_GLYPH[p.id] || '•'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                  <span className="mono" style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: '11px' }}>{pct(p.proportion)}</span>
                </div>
                <div style={{ height: '6px', background: 'var(--bg-3)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(2, p.proportion * 100)}%`, height: '100%', background: `linear-gradient(90deg, ${p.color}cc, ${p.color})`, borderRadius: '3px', transformOrigin: 'left', animation: 'mtv-bar-grow 0.5s cubic-bezier(0.22, 1, 0.36, 1) both' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {drivers.length > 0 && (
        <Card title="Dominant markers">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {drivers.map((d) => (
              <Chip key={d.name} title={`${d.info.cellType} — ${d.info.func}`}>
                {d.name}
                <span className="mono" style={{ color: 'var(--text-3)' }}>·</span>
                <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{d.relativeExpression.toFixed(2)}</span>
              </Chip>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default RegionFindings;
