# Melanoma Tissue Volumes

**Team Members:**
- Hossein Fathollahian
- Yugesh Reddy Sappidi

## About the Project

This project is a **Microscopy Dashboard** designed to support the investigation of biopsy tissue CyCF (Cyclic Immunofluorescence) microscopic images. Developed for the Visual Data Science graduate course at the University of Illinois Chicago (Fall 2025), in collaboration with Dr. Lei Duan and Dr. Carl Maki of Rush Medical University.

The dashboard provides an interactive 3D visualization and analysis platform for biomedical researchers to explore, analyze, and compare tissue samples with multiple biomarker channels. It combines advanced visualization techniques with statistical analysis tools to help researchers understand complex patterns in biomedical data.

### Key Features

- **Interactive 3D Visualization**: Explore tissue volumes in 3D space with rotation, zoom, and pan controls
- **Multi-Channel Analysis**: Visualize and compare multiple biomarker channels simultaneously
- **Region Selection**: Select and analyze specific tissue regions using 3D selection boxes
- **Statistical Analysis**: View detailed statistics including cell counts, density, and intensity distributions
- **Multiple Visualization Modes**: Bar charts, heatmaps, and violin plots for data analysis
- **Local View**: Detailed examination of selected regions in separate tabs
- **Direction Analysis**: Spatial orientation and directional analysis of biomarker distributions

### Live Demo

🌐 **Online Version**: [https://hosseinfatho.github.io/BioProject/](https://hosseinfatho.github.io/BioProject/)

## Technology Stack

- **React 18** - Frontend framework for component-based UI
- **Three.js** - 3D graphics library for WebGL rendering
- **Vite** - Fast build tool and development server
- **JavaScript ES6+** - Modern JavaScript features

## How to Run

### Development Mode (Recommended)
1. **Install dependencies:**
```bash
npm install
```

2. **Start React development server:**
```bash
npm run dev
```

3. **Open your browser and go to:** `http://localhost:3000`

### Production Mode
```bash
npm run build
npm run preview
```

### Alternative (Simple Server)
```bash
npm start
```

## Components

### Main View
Interactive 3D visualization of the entire tissue volume with:
- Multi-channel biomarker visualization
- 3D selection boxes for region analysis
- Camera controls (rotate, pan, zoom)
- Level-of-detail (LOD) optimization for performance

### Channel Selection
Configure and manage multiple biomarker channels:
- Adjust color, opacity, and threshold values
- Enable/disable channels for focused analysis
- Real-time visualization updates

### Region Selection
Manage and toggle different tissue regions for comparative analysis.

### Local View
Detailed 3D examination of selected regions:
- Multiple region tabs
- Independent camera controls per region
- High-resolution local analysis

### Graph Panel
Statistical analysis and visualization:
- Bar charts for cell count comparison
- Heatmaps for co-expression analysis
- Violin plots for distribution analysis
- Multi-region comparison

### Direction View
Spatial orientation and directional analysis of biomarker distributions.

## Project Structure

```
src/
├── components/
│   ├── Main_View.jsx          # Main 3D visualization component
│   ├── Local_View.jsx         # Local region view component
│   ├── Graph_Pannel.jsx       # Statistical analysis panel
│   ├── ChannelSelection.jsx   # Channel configuration
│   ├── Region_Selection.jsx   # Region management
│   ├── Direction_view.jsx     # Directional analysis
│   └── Title.jsx              # Header with About/Help
├── hooks/
│   └── useChannelData.js      # Data loading utilities
├── App.jsx                     # Main application component
└── main.jsx                    # React entry point
```

## Deployment

The project is deployed on GitHub Pages:
- **Live URL**: [https://hosseinfatho.github.io/BioProject/](https://hosseinfatho.github.io/BioProject/)

To deploy:
```bash
npm run build
npm run deploy
```

## Acknowledgments

Developed in collaboration with:
- **Dr. Lei Duan** - Rush Medical University
- **Dr. Carl Maki** - Rush Medical University

Course: Visual Data Science (Fall 2025) - University of Illinois Chicago
