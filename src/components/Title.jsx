import React from 'react';

const Title = ({ softwareName = "Software Name (title)", onOpenSettings }) => {
  const navBtn = {
    position: 'absolute',
    top: '50%',
    right: '20px',
    transform: 'translateY(-50%)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: 'var(--text-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    fontFamily: 'var(--font-body)',
    transition: 'border-color 160ms var(--ease-out), color 160ms var(--ease-out), background 160ms var(--ease-out)'
  };

  return (
    <div style={{
      flex: '5%',
      width: '100%',
      backgroundColor: 'var(--bg-0)',
      color: 'var(--text-1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '11px',
      borderBottom: '1px solid var(--border)',
      position: 'relative'
    }}>
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%',
        background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)'
      }} />
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: '21px',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        color: 'var(--text-1)'
      }}>
        {softwareName}
      </span>

      {/* Settings — single entry point for AI model configuration */}
      <button
        onClick={onOpenSettings}
        style={navBtn}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)'; }}
        title="Configure the AI model provider"
      >
        <span style={{ fontSize: '14px', lineHeight: 1 }}>⚙</span>
        Settings
      </button>
    </div>
  );
};

export default Title;
