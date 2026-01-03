// Right-side AI dock shown inside the maximized panel layout. Reuses the
// shared TissueChatView; the panel canvas sits to its left.

import React, { useEffect } from 'react';
import TissueChatView from './TissueChatView';
import { useTissueIntelligence } from '../services/tissueIntelligenceContext';

const GEMINI_PURPLE = '#9168C0';

export default function ExpandedAgentDock() {
  const { openSettings, openGeneral, activeContextId } = useTissueIntelligence();

  // Ensure the dock always has a chattable context. If the user maximized a
  // panel without opening a specific context, fall back to the general assistant
  // so the chat box is usable (they can still click a panel's Ask AI for a
  // grounded context, which then becomes active here).
  useEffect(() => {
    if (!activeContextId) openGeneral();
  }, [activeContextId, openGeneral]);

  return (
    <div style={{
      width: '340px', flexShrink: 0, height: '100%',
      display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--border)', background: 'var(--bg-1)'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
        borderBottom: '1px solid var(--border)', flexShrink: 0
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: GEMINI_PURPLE }} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '13px', color: 'var(--text-1)' }}>
          Tissue AI
        </span>
        <button type="button" className="mtv-press" title="Settings" onClick={openSettings}
          style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-2)', cursor: 'pointer', padding: '2px 7px' }}>⚙</button>
      </div>
      <TissueChatView />
    </div>
  );
}
