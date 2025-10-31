import React from 'react';

const Title = ({ softwareName = "Software Name (title)" }) => {
  return (
    <div style={{
      flex: '5%',
      width: '100%',
      backgroundColor: '#000000',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '24px',
      fontWeight: 'bold',
      borderBottom: '2px solid #34495e'
    }}>
      {softwareName}
    </div>
  );
};

export default Title;

