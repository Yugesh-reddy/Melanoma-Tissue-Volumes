import React, { useState } from 'react';

const Title = ({ softwareName = "Software Name (title)" }) => {
  const [showAbout, setShowAbout] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <>
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
        borderBottom: '2px solid #34495e',
        position: 'relative'
      }}>
        {softwareName}
        
        {/* Help Button - Left of About */}
        <button
          onClick={() => setShowHelp(true)}
          style={{
            position: 'absolute',
            right: '100px',
            top: '50%',
            transform: 'translateY(-50%)',
            padding: '8px 16px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#45a049'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#4CAF50'}
        >
          Help
        </button>
        
        {/* About Button - Top Right */}
        <button
          onClick={() => setShowAbout(true)}
          style={{
            position: 'absolute',
            right: '20px',
            top: '50%',
            transform: 'translateY(-50%)',
            padding: '8px 16px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#45a049'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#4CAF50'}
        >
          About
        </button>
      </div>

      {/* About Popup Modal */}
      {showAbout && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={(e) => {
            // Close when clicking outside the modal
            if (e.target === e.currentTarget) {
              setShowAbout(false);
            }
          }}
        >
          <div
            style={{
              backgroundColor: '#1a1a1a',
              padding: '30px',
              borderRadius: '8px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              border: '2px solid #4CAF50',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setShowAbout(false)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                padding: '6px 12px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#45a049'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#4CAF50'}
            >
              ×
            </button>

            {/* About Text */}
            <div style={{
              color: 'white',
              fontSize: '18px',
              lineHeight: '1.6',
              textAlign: 'justify'
            }}>
              This project, completed by{' '}
              <a
                href="https://hosseinfatho.github.io/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#2196F3',
                  textDecoration: 'underline',
                  fontWeight: 'bold'
                }}
                onMouseEnter={(e) => e.target.style.color = '#1976D2'}
                onMouseLeave={(e) => e.target.style.color = '#2196F3'}
              >
                Hossein Fathollahian
              </a>
              {' '}and{' '}
              <a
                href="https://www.linkedin.com/in/yugesh-reddy-sappidi/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#2196F3',
                  textDecoration: 'underline',
                  fontWeight: 'bold'
                }}
                onMouseEnter={(e) => e.target.style.color = '#1976D2'}
                onMouseLeave={(e) => e.target.style.color = '#2196F3'}
              >
                Yugesh Sappidy
              </a>
              {' '}for the Visual Data Science graduate course at the University of Illinois Chicago (Fall 2025), was developed in collaboration with{' '}
              <a
                href="https://www.rushu.rush.edu/research-rush-university/departmental-research/anatomy-cell-biology-research/laboratory-lei-duan-md"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#2196F3',
                  textDecoration: 'underline',
                  fontWeight: 'bold'
                }}
                onMouseEnter={(e) => e.target.style.color = '#1976D2'}
                onMouseLeave={(e) => e.target.style.color = '#2196F3'}
              >
                Dr. Lei Duan
              </a>
              {' '}and Dr. Carl Maki of Rush Medical University. Together, we designed a Microscopy Dashboard to support the investigation of biopsy tissue CyCF microscopic images.
            </div>
          </div>
        </div>
      )}

      {/* Help Popup Modal */}
      {showHelp && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={(e) => {
            // Close when clicking outside the modal
            if (e.target === e.currentTarget) {
              setShowHelp(false);
            }
          }}
        >
          <div
            style={{
              backgroundColor: '#1a1a1a',
              padding: '30px',
              borderRadius: '8px',
              maxWidth: '700px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              border: '2px solid #4CAF50',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setShowHelp(false)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                padding: '6px 12px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#45a049'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#4CAF50'}
            >
              ×
            </button>

            {/* Help Content */}
            <div style={{
              color: 'white',
              fontSize: '18px',
              lineHeight: '1.8'
            }}>
              <h2 style={{ 
                color: '#4CAF50', 
                marginTop: '0', 
                marginBottom: '20px',
                fontSize: '24px'
              }}>
                Component Guide
              </h2>
              
              <div style={{ marginBottom: '25px' }}>
                <h3 style={{ 
                  color: '#4CAF50', 
                  marginBottom: '10px',
                  fontSize: '20px'
                }}>
                  Channel Selection
                </h3>
                <p style={{ margin: '0', textAlign: 'justify' }}>
                  Select and configure multiple biomarker channels to visualize. You can adjust color, opacity, threshold values, and visibility for each channel. Channels can be enabled or disabled to focus on specific biomarkers.
                </p>
              </div>

              <div style={{ marginBottom: '25px' }}>
                <h3 style={{ 
                  color: '#4CAF50', 
                  marginBottom: '10px',
                  fontSize: '20px'
                }}>
                  Region Selection
                </h3>
                <p style={{ margin: '0', textAlign: 'justify' }}>
                  Manage and toggle different tissue regions. Select regions to analyze and compare their biomarker expressions. Each region can be individually enabled or disabled for analysis.
                </p>
              </div>

              <div style={{ marginBottom: '25px' }}>
                <h3 style={{ 
                  color: '#4CAF50', 
                  marginBottom: '10px',
                  fontSize: '20px'
                }}>
                  Main View
                </h3>
                <p style={{ margin: '0', textAlign: 'justify' }}>
                  Interactive 3D visualization of the entire tissue volume. Use the "3D Selection" button to draw selection boxes for analysis. Rotate (left-click + drag), pan (right-click + drag), and zoom (scroll) to explore the data. Each selection box is color-coded and can be used to extract data for detailed analysis.
                </p>
              </div>

              <div style={{ marginBottom: '25px' }}>
                <h3 style={{ 
                  color: '#4CAF50', 
                  marginBottom: '10px',
                  fontSize: '20px'
                }}>
                  Local View
                </h3>
                <p style={{ margin: '0', textAlign: 'justify' }}>
                  Detailed 3D view of selected tissue regions. Each selection appears as a separate tab. You can rotate, zoom, and pan within each local view to examine the selected region in detail. Use "Reset View" to close the current tab.
                </p>
              </div>

              <div style={{ marginBottom: '25px' }}>
                <h3 style={{ 
                  color: '#4CAF50', 
                  marginBottom: '10px',
                  fontSize: '20px'
                }}>
                  Graph Panel
                </h3>
                <p style={{ margin: '0', textAlign: 'justify' }}>
                  Statistical analysis and visualization of selected regions. View bar charts, heatmaps, or violin plots showing cell counts, density, and intensity distributions for each biomarker. Compare multiple selected regions side by side.
                </p>
              </div>

              <div style={{ marginBottom: '0' }}>
                <h3 style={{ 
                  color: '#4CAF50', 
                  marginBottom: '10px',
                  fontSize: '20px'
                }}>
                  Direction View
                </h3>
                <p style={{ margin: '0', textAlign: 'justify' }}>
                  Spatial orientation and directional analysis of biomarker distributions. Visualize how biomarkers are distributed across different spatial directions in the tissue sample.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Title;

