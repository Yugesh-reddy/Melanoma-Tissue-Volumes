// Right-side AI dock shown inside the maximized panel layout. Reuses the
// shared TissueChatView; the panel canvas sits to its left.
//
// The dock and the maximized panel stay in sync (two-way): selecting an AI
// context tab shifts the maximized panel to the matching one, and maximizing a
// panel activates that panel's matching context tab.

import React, { useEffect, useRef } from 'react';
import TissueChatView from './TissueChatView';
import { useTissueIntelligence } from '../services/tissueIntelligenceContext';

const AI_PURPLE = '#9168C0';

// Mapping between an AI context kind and a maximizable panel (both directions).
// 'general' maps to no panel — selecting it keeps the current panel.
const PANEL_FOR_KIND = { region: 'local', graph: 'graph', orientation: 'direction' };
const KIND_FOR_PANEL = { local: 'region', graph: 'graph', direction: 'orientation' };

export default function ExpandedAgentDock({ panel = null, onMaximizePanel }) {
  const { threads, activeContextId, setActive, openGeneral, openSettings } = useTissueIntelligence();
  const didInitRef = useRef(false);

  // Keep the dock chattable: if nothing is active, open the general assistant.
  useEffect(() => {
    if (!activeContextId) openGeneral();
  }, [activeContextId, openGeneral]);

  // Panel → tab (mount-only): when this dock opens for a panel, prefer that
  // panel's matching context tab (e.g. maximizing Local activates a box thread),
  // unless a matching context is already active. Runs once per mount, so it
  // never clobbers an explicit tab choice the user makes afterwards.
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    const wantKind = KIND_FOR_PANEL[panel];
    if (!wantKind) return;
    const active = activeContextId ? threads[activeContextId] : null;
    if (active && active.kind === wantKind) return; // already matching
    const match = Object.values(threads).find((t) => t.kind === wantKind);
    if (match) setActive(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab → panel: selecting a context also shifts the maximized panel to match.
  const handleSelectContext = (id) => {
    setActive(id);
    const mapped = PANEL_FOR_KIND[threads[id]?.kind];
    if (mapped && onMaximizePanel) onMaximizePanel(mapped);
  };

  return (
    <div style={{
      width: '340px', flexShrink: 0, height: '100%', minHeight: 0,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      borderLeft: '1px solid var(--border)', background: 'var(--bg-1)'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
        borderBottom: '1px solid var(--border)', flexShrink: 0
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: AI_PURPLE }} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '13px', color: 'var(--text-1)' }}>
          Tissue Intelligence
        </span>
        <button type="button" className="mtv-press" title="Settings" onClick={openSettings}
          style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-2)', cursor: 'pointer', padding: '2px 7px' }}>⚙</button>
      </div>
      <TissueChatView onSelectContext={handleSelectContext} />
    </div>
  );
}
