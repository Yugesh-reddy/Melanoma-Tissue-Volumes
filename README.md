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

## Features

### Interactive 3D Cube
- **Rotating cube** - Continuously spins on X and Y axes
- **Color changing** - Click button to cycle through 8 colors
- **React state management** - Color changes managed with React hooks
- **Responsive design** - Adapts to window size

### Available Colors
- Green, Red, Blue, Yellow, Magenta, Cyan, Orange, Purple

## How It Works

### React Components
- **App.jsx** - Main component containing Three.js scene
- **main.jsx** - React entry point and root rendering


### Why We're Testing This
This React + Three.js test helps us verify that our 3D rendering 
## Project Structure

```
src/
├── App.jsx          # Main React component with Three.js
├── main.jsx         # React entry point
index.html           # HTML template
vite.config.js       # Vite configuration
package.json         # Dependencies and scripts
```
