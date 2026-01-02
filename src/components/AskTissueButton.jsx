// Shared "Ask Tissue Intelligence" trigger. Drop it on any component with a
// context descriptor; clicking opens the floating Tissue Intelligence window
// focused on that context.
//
// Variants:
//   'chip'  — a labelled pill for panel headers (Local View, Direction View, Graph)
//   'badge' — a compact glyph button for the 3D cuboid overlay in Main View

import React, { useId } from 'react';
import { useTissueIntelligence } from '../services/tissueIntelligenceContext';

const GeminiSpark = ({ size = 16 }) => {
  const gradId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 0 3px rgba(120,90,200,0.55))', flexShrink: 0 }} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1C7DFF" />
          <stop offset="52%" stopColor="#9168C0" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path d="M12 0c0 6.627 5.373 12 12 12-6.627 0-12 5.373-12 12 0-6.627-5.373-12-12-12 6.627 0 12-5.373 12-12z" fill={`url(#${gradId})`} />
    </svg>
  );
};

const AskTissueButton = ({ descriptor, variant = 'chip', disabled = false, label = 'Ask AI', title = 'Ask Tissue Intelligence' }) => {
  const { open } = useTissueIntelligence();

  const handleClick = (e) => {
    e.stopPropagation();
    if (disabled) return;
    open(descriptor);
  };

  if (variant === 'badge') {
    return (
      <button
        type="button"
        className="mtv-press"
        onClick={handleClick}
        disabled={disabled}
        title={title}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '28px', height: '28px', padding: 0,
          background: 'rgba(10,11,14,0.72)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: '999px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          transition: 'background-color 160ms var(--ease-out), border-color 160ms var(--ease-out), transform 140ms var(--ease-out)'
        }}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.borderColor = 'rgba(145,104,192,0.8)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; }}
      >
        <GeminiSpark size={16} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="mtv-press"
      onClick={handleClick}
      disabled={disabled}
      title={disabled ? 'No data to analyze yet' : title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '3px 9px', fontSize: '11px', fontWeight: 600,
        color: 'var(--text-1)',
        background: 'rgba(145,104,192,0.12)',
        border: '1px solid rgba(145,104,192,0.45)',
        borderRadius: '999px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        whiteSpace: 'nowrap',
        transition: 'background-color 160ms var(--ease-out), border-color 160ms var(--ease-out), transform 140ms var(--ease-out)'
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'rgba(145,104,192,0.22)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(145,104,192,0.12)'; }}
    >
      <GeminiSpark size={13} />
      {label}
    </button>
  );
};

export default AskTissueButton;
