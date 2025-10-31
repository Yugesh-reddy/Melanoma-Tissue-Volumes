import React from 'react';

const Graph_Pannel = () => {
  return (
    <div style={{
      height: '100%',
      width: '100%',
      backgroundColor: '#000000',
      border: '1px solid #444',
      padding: '1px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'auto'
    }}>
      <h3 style={{ marginTop: 0, marginBottom: '15px', fontSize: '18px', color: 'white' }}>Graph Panel</h3>
      <div style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1a1a1a',
        border: '2px dashed #666',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: '16px'
      }}>
        Graph Content
      </div>
    </div>
  );
};

export default Graph_Pannel;

