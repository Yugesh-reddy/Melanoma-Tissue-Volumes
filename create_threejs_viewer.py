"""
Create Three.js HTML viewer for volume data visualization
Run this script to generate the HTML viewer file
"""
from pathlib import Path
import json

def create_threejs_viewer(channel_idx=0, output_dir="visualization_data"):
    """Create Three.js HTML viewer for volume data"""
    
    output_path = Path(output_dir)
    metadata_file = output_path / f"channel_{channel_idx}_metadata.json"
    
    if not metadata_file.exists():
        print(f"Error: Metadata file not found: {metadata_file}")
        print("Please run the notebook cell to prepare data first.")
        return
    
    # Load metadata
    with open(metadata_file, 'r') as f:
        metadata = json.load(f)
    
    # Create HTML content
    html_content = f'''<!DOCTYPE html>
<html>
<head>
    <title>3D Volume Viewer - Channel {channel_idx}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <style>
        body {{ margin: 0; overflow: hidden; background: #000; font-family: Arial; }}
        #info {{
            position: absolute;
            top: 10px;
            left: 10px;
            color: white;
            background: rgba(0,0,0,0.7);
            padding: 15px;
            border-radius: 5px;
        }}
        #controls {{
            position: absolute;
            top: 10px;
            right: 10px;
            color: white;
            background: rgba(0,0,0,0.7);
            padding: 15px;
            border-radius: 5px;
            min-width: 200px;
        }}
        .control-group {{
            margin: 10px 0;
        }}
        label {{
            display: block;
            margin-bottom: 5px;
        }}
        input[type="range"] {{
            width: 100%;
        }}
        button {{
            padding: 8px 15px;
            margin: 5px;
            cursor: pointer;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 3px;
        }}
        button:hover {{
            background: #45a049;
        }}
    </style>
</head>
<body>
    <div id="info">
        <h3>3D Volume Viewer - Channel {channel_idx}</h3>
        <p><strong>Shape:</strong> {metadata['shape']}</p>
        <p><strong>Data Range:</strong> {metadata['dataRange'][0]} - {metadata['dataRange'][1]}</p>
        <p><strong>Controls:</strong></p>
        <ul>
            <li>Left Click + Drag: Rotate</li>
            <li>Right Click + Drag: Pan</li>
            <li>Scroll: Zoom</li>
        </ul>
    </div>
    
    <div id="controls">
        <h3>Settings</h3>
        <div class="control-group">
            <label>Threshold: <span id="thresholdValue">128</span></label>
            <input type="range" id="threshold" min="0" max="255" value="128">
        </div>
        <div class="control-group">
            <label>Point Size: <span id="sizeValue">2</span></label>
            <input type="range" id="pointSize" min="1" max="10" value="2">
        </div>
        <div class="control-group">
            <label>Opacity: <span id="opacityValue">0.6</span></label>
            <input type="range" id="opacity" min="0" max="100" value="60">
        </div>
        <div class="control-group">
            <label>Sampling: <span id="samplingValue">1</span></label>
            <input type="range" id="sampling" min="1" max="10" value="1">
        </div>
        <button onclick="resetCamera()">Reset Camera</button>
    </div>
    
    <script>
        const metadata = {json.dumps(metadata, separators=(',', ':'))};
        const dataFile = 'channel_{channel_idx}_data.raw';
        let scene, camera, renderer, pointCloud;
        
        // Scene setup
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        renderer = new THREE.WebGLRenderer({{ antialias: true }});
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x000000);
        document.body.appendChild(renderer.domElement);
        
        // Camera controls
        let isRotating = false;
        let mouseX = 0, mouseY = 0;
        let cameraRotation = {{ x: 0.5, y: 0.5 }};
        let cameraDistance = 3;
        
        renderer.domElement.addEventListener('mousedown', (e) => {{
            if (e.button === 0) isRotating = true;
            mouseX = e.clientX;
            mouseY = e.clientY;
        }});
        
        renderer.domElement.addEventListener('mouseup', () => {{
            isRotating = false;
        }});
        
        renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
        
        renderer.domElement.addEventListener('mousemove', (e) => {{
            if (isRotating) {{
                cameraRotation.y += (e.clientX - mouseX) * 0.01;
                cameraRotation.x += (e.clientY - mouseY) * 0.01;
                updateCameraPosition();
            }}
            mouseX = e.clientX;
            mouseY = e.clientY;
        }});
        
        renderer.domElement.addEventListener('wheel', (e) => {{
            cameraDistance *= (1 + e.deltaY * 0.001);
            cameraDistance = Math.max(0.5, Math.min(10, cameraDistance));
            updateCameraPosition();
        }});
        
        function updateCameraPosition() {{
            camera.position.x = cameraDistance * Math.sin(cameraRotation.y) * Math.cos(cameraRotation.x);
            camera.position.y = cameraDistance * Math.sin(cameraRotation.x);
            camera.position.z = cameraDistance * Math.cos(cameraRotation.y) * Math.cos(cameraRotation.x);
            camera.lookAt(0, 0, 0);
        }}
        
        updateCameraPosition();
        
        // Load and visualize volume data
        fetch(dataFile)
            .then(response => response.arrayBuffer())
            .then(buffer => {{
                const data = new Uint8Array(buffer);
                createVolumeVisualization(data);
            }})
            .catch(error => {{
                console.error('Error loading data:', error);
                document.getElementById('info').innerHTML += '<p style="color:red;">Error loading data file. Make sure channel_{channel_idx}_data.raw exists in the same directory.</p>';
            }});
        
        function createVolumeVisualization(data) {{
            const shape = metadata.shape;
            const [zSize, ySize, xSize] = shape;
            
            // Clear existing point cloud
            if (pointCloud) {{
                scene.remove(pointCloud);
                pointCloud.geometry.dispose();
                pointCloud.material.dispose();
            }}
            
            // Get settings
            const threshold = parseInt(document.getElementById('threshold').value);
            const pointSize = parseInt(document.getElementById('pointSize').value);
            const opacity = parseInt(document.getElementById('opacity').value) / 100;
            const sampling = parseInt(document.getElementById('sampling').value);
            
            // Create point cloud
            const points = [];
            const colors = [];
            
            // Sample and filter points
            for (let z = 0; z < zSize; z += sampling) {{
                for (let y = 0; y < ySize; y += sampling) {{
                    for (let x = 0; x < xSize; x += sampling) {{
                        const index = z * ySize * xSize + y * xSize + x;
                        if (index < data.length && data[index] > threshold) {{
                            // Normalize coordinates to -1 to 1 range
                            points.push(
                                (x / xSize - 0.5) * 2,
                                (y / ySize - 0.5) * 2,
                                (z / zSize - 0.5) * 2
                            );
                            
                            // Color based on intensity
                            const intensity = data[index] / 255;
                            colors.push(intensity, intensity * 0.8, intensity * 0.6);
                        }}
                    }}
                }}
            }}
            
            console.log(`Created ${{points.length / 3}} points`);
            
            // Create geometry
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            
            // Create material
            const material = new THREE.PointsMaterial({{
                size: pointSize,
                vertexColors: true,
                transparent: true,
                opacity: opacity,
                sizeAttenuation: true
            }});
            
            pointCloud = new THREE.Points(geometry, material);
            scene.add(pointCloud);
        }}
        
        // Update visualization when settings change
        document.getElementById('threshold').addEventListener('input', (e) => {{
            document.getElementById('thresholdValue').textContent = e.target.value;
            updateVisualization();
        }});
        
        document.getElementById('pointSize').addEventListener('input', (e) => {{
            document.getElementById('sizeValue').textContent = e.target.value;
            if (pointCloud) pointCloud.material.size = parseInt(e.target.value);
        }});
        
        document.getElementById('opacity').addEventListener('input', (e) => {{
            const val = e.target.value / 100;
            document.getElementById('opacityValue').textContent = val.toFixed(2);
            if (pointCloud) pointCloud.material.opacity = val;
        }});
        
        document.getElementById('sampling').addEventListener('input', (e) => {{
            document.getElementById('samplingValue').textContent = e.target.value;
            updateVisualization();
        }});
        
        function updateVisualization() {{
            fetch(dataFile)
                .then(response => response.arrayBuffer())
                .then(buffer => {{
                    const data = new Uint8Array(buffer);
                    createVolumeVisualization(data);
                }});
        }}
        
        function resetCamera() {{
            cameraRotation = {{ x: 0.5, y: 0.5 }};
            cameraDistance = 3;
            updateCameraPosition();
        }}
        
        // Animation loop
        function animate() {{
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
        }}
        animate();
        
        // Handle window resize
        window.addEventListener('resize', () => {{
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }});
    </script>
</body>
</html>'''
    
    # Save HTML file
    html_file = output_path / f"threejs_volume_viewer_channel_{channel_idx}.html"
    with open(html_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"✓ Three.js HTML viewer created: {html_file}")
    print(f"✓ Open this file in your browser")
    print(f"✓ Make sure 'channel_{channel_idx}_data.raw' is in the same directory")
    
    return html_file

if __name__ == "__main__":
    create_threejs_viewer(channel_idx=0)

