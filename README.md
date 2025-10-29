# Melanoma Tissue Volumes

**Team Members:**
- Hossein Fathollahian
- Yugesh Spinidi

This is a React + Three.js test application with an interactive rotating cube for the Melanoma Tissue Volumes project.

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
