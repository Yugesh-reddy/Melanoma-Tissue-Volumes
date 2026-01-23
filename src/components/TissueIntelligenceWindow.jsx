// The single floating, draggable, resizable Tissue Intelligence window.
// Rendered once (portal to body) and driven entirely by the TI provider.

import React, { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTissueIntelligence } from '../services/tissueIntelligenceContext';
import TissueChatView from './TissueChatView';

const MIN_W = 320;
const MIN_H = 320;

const AiSpark = ({ size = 16 }) => {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1C7DFF" />
          <stop offset="52%" stopColor="#9168C0" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path d="M12 0c0 6.627 5.373 12 12 12-6.627 0-12 5.373-12 12 0-6.627-5.373-12-12-12 6.627 0 12-5.373 12-12z" fill={`url(#${id})`} />
    </svg>
  );
};

const TissueIntelligenceWindow = () => {
  const {
    isOpen, windowRect, close, setRect, openSettings
  } = useTissueIntelligence();

  const winRef = useRef(null);
  const cardRef = useRef(null);

  if (!isOpen) return null;

  const iconBtn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '24px', height: '24px', padding: 0, color: 'var(--text-2)',
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer'
  };

  // --- drag (title bar) ---
  const onDragDown = (e) => {
    if (e.target.closest('[data-no-drag]')) return;
    e.preventDefault();
    const base = { ...windowRect };
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev) => {
      const nx = base.x + (ev.clientX - startX);
      const ny = base.y + (ev.clientY - startY);
      if (winRef.current) winRef.current.style.transform = `translate(${nx}px, ${ny}px)`;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setRect({ x: base.x + (ev.clientX - startX), y: base.y + (ev.clientY - startY) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // --- resize (bottom-right handle) ---
  const onResizeDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const base = { ...windowRect };
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev) => {
      const w = Math.max(MIN_W, base.w + (ev.clientX - startX));
      const h = Math.max(MIN_H, base.h + (ev.clientY - startY));
      if (cardRef.current) { cardRef.current.style.width = `${w}px`; cardRef.current.style.height = `${h}px`; }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setRect({ w: Math.max(MIN_W, base.w + (ev.clientX - startX)), h: Math.max(MIN_H, base.h + (ev.clientY - startY)) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return createPortal(
    <div
      ref={winRef}
      style={{
        position: 'fixed', top: 0, left: 0, zIndex: 4000,
        transform: `translate(${windowRect.x}px, ${windowRect.y}px)`
      }}
    >
      <div
        ref={cardRef}
        style={{
          width: `${windowRect.w}px`, height: `${windowRect.h}px`,
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-1)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
          transformOrigin: 'center', animation: 'mtv-window-in 200ms var(--ease-out)'
        }}
      >
        {/* Title bar / drag handle */}
        <div
          onPointerDown={onDragDown}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
            background: 'var(--bg-2)', borderBottom: '1px solid var(--border)',
            cursor: 'grab', userSelect: 'none', flexShrink: 0
          }}
        >
          <AiSpark size={16} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '13px', color: 'var(--text-1)' }}>
            Tissue Intelligence
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }} data-no-drag>
            <button type="button" className="mtv-press" style={iconBtn} title="Settings" onClick={openSettings}>⚙</button>
            <button type="button" className="mtv-press" style={iconBtn} title="Close" onClick={close}>✕</button>
          </div>
        </div>

        {/* Chat sections: context switcher, body, composer */}
        <TissueChatView />

        {/* Resize handle */}
        <div
          onPointerDown={onResizeDown}
          title="Resize"
          style={{ position: 'absolute', right: 0, bottom: 0, width: '16px', height: '16px', cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, var(--border) 50%, var(--border) 60%, transparent 60%, transparent 75%, var(--border) 75%)' }}
        />
      </div>
    </div>,
    document.body
  );
};

export default TissueIntelligenceWindow;
