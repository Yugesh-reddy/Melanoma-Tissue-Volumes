import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

const Local_View = ({ selectedRegionData }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const animationRef = useRef(null);
  const voxelMeshesRef = useRef([]);
  const boundingBoxRef = useRef(null);
  const axesHelperRef = useRef(null);
  
  // Camera state for local view (super zoomed)
  const cameraStateRef = useRef({
    rotation: { x: 0.5, y: 0.5 },
    distance: 0.3, // Much closer for super zoom
    panOffset: { x: 0, y: 0, z: 0 }
  });

  // Load channel data (same as Main_View)
  const loadChannelData = async (channelIndex) => {
    const paths = [
      { data: `./visualization_data/channel_${channelIndex}_napari_data.raw`, metadata: `./visualization_data/channel_${channelIndex}_napari_metadata.json` },
      { data: `visualization_data/channel_${channelIndex}_napari_data.raw`, metadata: `visualization_data/channel_${channelIndex}_napari_metadata.json` },
      { data: `./visualization_data/channel_${channelIndex}_data.raw`, metadata: `./visualization_data/channel_${channelIndex}_metadata.json` },
      { data: `visualization_data/channel_${channelIndex}_data.raw`, metadata: `visualization_data/channel_${channelIndex}_metadata.json` }
    ];

    for (const path of paths) {
      try {
        let metadataResponse = await fetch(path.metadata);
        if (!metadataResponse.ok) continue;
        
        const contentType = metadataResponse.headers.get('content-type');
        if (contentType && !contentType.includes('application/json')) continue;
        
        const metadataText = await metadataResponse.text();
        if (metadataText.trim().startsWith('<!DOCTYPE') || metadataText.trim().startsWith('<html')) continue;
        
        const metadata = JSON.parse(metadataText);
        let dataResponse = await fetch(path.data);
        if (!dataResponse.ok) continue;
        
        const dataContentType = dataResponse.headers.get('content-type');
        if (dataContentType && dataContentType.includes('text/html')) continue;
        
        const arrayBuffer = await dataResponse.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        
        return { data, metadata };
      } catch (error) {
        continue;
      }
    }
    return null;
  };

  // Create voxel visualization for a channel region (similar to Main_View but for selected region)
  const createRegionVisualization = (channelData, channelConfig, bounds, scene) => {
    const { data, metadata } = channelData;
    const { color, thresholdMin, thresholdMax } = channelConfig;
    const shape = metadata.shape;
    const [zSize, ySize, xSize] = shape;
    
    console.log(`Local_View: Creating visualization for channel ${channelConfig.channelIndex}`);
    console.log(`Local_View: Shape: [${zSize}, ${ySize}, ${xSize}], Bounds:`, bounds);
    
    const dataRange = metadata.dataRange || [0, 65535];
    const dataMin = dataRange[0];
    const dataMax = dataRange[1];
    
    let minThreshold = thresholdMin !== undefined ? thresholdMin : dataMin;
    let maxThreshold = thresholdMax !== undefined ? thresholdMax : dataMax;
    
    if (minThreshold > maxThreshold) {
      [minThreshold, maxThreshold] = [maxThreshold, minThreshold];
    }
    
    minThreshold = Math.max(dataMin, Math.min(dataMax, minThreshold));
    maxThreshold = Math.max(dataMin, Math.min(dataMax, maxThreshold));

    console.log(`Local_View: Threshold range: [${minThreshold}, ${maxThreshold}], Data range: [${dataMin}, ${dataMax}]`);

    // Convert hex color to RGB
    const hexColor = color.replace('#', '');
    const r = parseInt(hexColor.substr(0, 2), 16) / 255;
    const g = parseInt(hexColor.substr(2, 2), 16) / 255;
    const b = parseInt(hexColor.substr(4, 2), 16) / 255;

    const points = [];
    const opacities = [];
    const baseOpacityFloor = 0.35;
    const opacityBoost = 1.3;
    const maxDim = Math.max(zSize, ySize, xSize);
    const scaleX = xSize / maxDim;
    const scaleY = ySize / maxDim;
    const scaleZ = (zSize / maxDim) / 4;

    // Extract region within bounds (use sampling=1 for maximum detail in local view)
    const sampling = 1;
    const voxelMinX = Math.max(0, Math.floor(bounds.min.x));
    const voxelMaxX = Math.min(xSize - 1, Math.ceil(bounds.max.x));
    const voxelMinY = Math.max(0, Math.floor(bounds.min.y));
    const voxelMaxY = Math.min(ySize - 1, Math.ceil(bounds.max.y));
    const voxelMinZ = Math.max(0, Math.floor(bounds.min.z));
    const voxelMaxZ = Math.min(zSize - 1, Math.ceil(bounds.max.z));

    console.log(`Local_View: Voxel bounds: X[${voxelMinX}, ${voxelMaxX}], Y[${voxelMinY}, ${voxelMaxY}], Z[${voxelMinZ}, ${voxelMaxZ}]`);

    // Validate bounds
    if (voxelMinX > voxelMaxX || voxelMinY > voxelMaxY || voxelMinZ > voxelMaxZ) {
      console.warn(`Local_View: Invalid bounds for channel ${channelConfig.channelIndex}`);
      return null;
    }

    let pointCount = 0;
    let thresholdPassCount = 0;

    for (let z = voxelMinZ; z <= voxelMaxZ; z += sampling) {
      for (let y = voxelMinY; y <= voxelMaxY; y += sampling) {
        for (let x = voxelMinX; x <= voxelMaxX; x += sampling) {
          const idx = z * ySize * xSize + y * xSize + x;
          if (idx >= data.length) {
            console.warn(`Local_View: Index ${idx} out of bounds (data length: ${data.length})`);
            continue;
          }
          
          const normalizedValue = data[idx];
          const actualValue = (normalizedValue / 255) * (dataMax - dataMin) + dataMin;

          if (actualValue >= minThreshold && actualValue <= maxThreshold) {
            thresholdPassCount++;
            const nx = ((x / xSize) * 2 - 1) * scaleX;
            const ny = ((y / ySize) * 2 - 1) * scaleY;
            const nz = ((z / zSize) * 2 - 1) * scaleZ;
            points.push(nx, ny, nz);

            const pointOpacity = dataMax > 0 ? actualValue / dataMax : 0;
            const boostedOpacity = Math.min(1, pointOpacity * opacityBoost);
            const clampedOpacity = Math.max(baseOpacityFloor, boostedOpacity);
            opacities.push(clampedOpacity);
            pointCount++;
          }
        }
      }
    }

    console.log(`Local_View: Extracted ${pointCount} points (${thresholdPassCount} passed threshold) from ${(voxelMaxX - voxelMinX + 1) * (voxelMaxY - voxelMinY + 1) * (voxelMaxZ - voxelMinZ + 1)} voxels`);

    const numPoints = points.length / 3;
    if (numPoints === 0) {
      console.warn(`Local_View: No points extracted for channel ${channelConfig.channelIndex}`);
      return null;
    }

    // Calculate voxel step size - make them larger for better visibility in local view
    // Use the actual bounds size to determine appropriate voxel size
    const boundsWidth = bounds.max.x - bounds.min.x + 1;
    const boundsHeight = bounds.max.y - bounds.min.y + 1;
    const boundsDepth = bounds.max.z - bounds.min.z + 1;
    const maxBoundsDim = Math.max(boundsWidth, boundsHeight, boundsDepth);
    
    // Make voxels larger - scale based on bounds size for better visibility
    // For small regions, make voxels bigger; for large regions, keep them proportional
    const baseVoxelScale = Math.max(2.0, maxBoundsDim / 20); // Minimum 2x scale, larger for smaller regions
    const stepX = ((2 / xSize) * scaleX) * baseVoxelScale;
    const stepY = ((2 / ySize) * scaleY) * baseVoxelScale;
    const stepZ = ((2 / zSize) * scaleZ) * baseVoxelScale;
    
    console.log(`Local_View: Voxel step sizes: X=${stepX.toFixed(6)}, Y=${stepY.toFixed(6)}, Z=${stepZ.toFixed(6)}, scaleFactor=${baseVoxelScale.toFixed(2)}`);

    const baseGeometry = new THREE.BoxGeometry(stepX, stepY, stepZ);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.copy(baseGeometry);
    baseGeometry.dispose();
    geometry.instanceCount = numPoints;
    geometry.setAttribute(
      'instanceOffset',
      new THREE.InstancedBufferAttribute(new Float32Array(points), 3)
    );
    geometry.setAttribute(
      'instanceOpacity',
      new THREE.InstancedBufferAttribute(new Float32Array(opacities), 1)
    );

    const voxelMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(r, g, b) },
        lightDirection: { value: new THREE.Vector3(0, 0, 1) },
        ambientColor: { value: new THREE.Color(0.95, 0.95, 0.95) },
        specularColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
        shininess: { value: 1.0 },
        brightness: { value: 2.0 },
        opacityBoost: { value: opacityBoost },
        edgeFeather: { value: 0.99 }
      },
      vertexShader: `
        attribute vec3 instanceOffset;
        attribute float instanceOpacity;
        varying float vOpacity;
        varying vec3 vWorldPos;
        varying vec3 vViewDir;
        varying vec3 vNormal;
        varying vec3 vLocalPos;
        void main() {
          vOpacity = instanceOpacity;
          vec3 transformed = position + instanceOffset;
          vNormal = normalize(normalMatrix * normal);
          vLocalPos = position;
          vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
          vWorldPos = worldPosition.xyz;
          vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float opacityBoost;
        uniform vec3 lightDirection;
        uniform vec3 ambientColor;
        uniform vec3 specularColor;
        uniform float shininess;
        uniform float brightness;
        uniform float edgeFeather;
        varying float vOpacity;
        varying vec3 vWorldPos;
        varying vec3 vViewDir;
        varying vec3 vNormal;
        varying vec3 vLocalPos;
        void main() {
          vec3 normal = normalize(vNormal);
          vec3 V = normalize(vViewDir);
          vec3 L = normalize(V);
          float diffuse = max(dot(normal, L), 0.0);
          vec3 R = reflect(-L, normal);
          float spec = pow(max(dot(R, V), 0.0), shininess);
          float base = clamp(vOpacity * opacityBoost, 0.0, 1.0);
          float edge = max(max(abs(vLocalPos.x), abs(vLocalPos.y)), abs(vLocalPos.z));
          float edgeFade = smoothstep(0.5 - edgeFeather, 0.5, edge);
          base *= (1.0 - edgeFade);
          vec3 baseColor = pow(color, vec3(0.55));
          vec3 lighting = ambientColor + diffuse * baseColor + spec * specularColor;
          vec3 finalColor = lighting * brightness;
          float alpha = clamp(base, 0.0, 1.0);
          if (alpha <= 0.01) discard;
          gl_FragColor = vec4(finalColor * alpha, alpha);
        }
      `,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      blending: THREE.NormalBlending
    });

    const mesh = new THREE.Mesh(geometry, voxelMaterial);
    mesh.frustumCulled = false;
    mesh.userData = { channelIndex: channelConfig.channelIndex };
    
    return mesh;
  };

  // Update camera position
  const updateCameraPosition = () => {
    if (!cameraRef.current) return;

    const state = cameraStateRef.current;
    const lookAtPoint = new THREE.Vector3(
      state.panOffset.x || 0,
      state.panOffset.y || 0,
      state.panOffset.z || 0
    );

    const radius = state.distance;
    const theta = state.rotation.y;
    const phi = state.rotation.x;

    cameraRef.current.position.x = lookAtPoint.x + radius * Math.sin(theta) * Math.cos(phi);
    cameraRef.current.position.y = lookAtPoint.y + radius * Math.sin(phi);
    cameraRef.current.position.z = lookAtPoint.z + radius * Math.cos(theta) * Math.cos(phi);
    cameraRef.current.up.set(0, -1, 0);
    cameraRef.current.lookAt(lookAtPoint);
  };

  // Update lighting based on camera direction
  const updateLighting = () => {
    const camera = cameraRef.current;
    if (!camera) return;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    voxelMeshesRef.current.forEach(mesh => {
      const material = mesh?.material;
      if (material && material.uniforms && material.uniforms.lightDirection) {
        material.uniforms.lightDirection.value.copy(direction);
      }
    });
  };

  // Create visualization from selected region data
  const createLocalVisualization = async (selectedData) => {
    if (!sceneRef.current || !selectedData || !selectedData.channels || !selectedData.bounds) {
      console.log('Local_View: Invalid selected data', selectedData);
      return;
    }

    console.log('Local_View: Creating visualization for selected region', selectedData);

    const scene = sceneRef.current;
    
    // Clear existing meshes
    voxelMeshesRef.current.forEach(mesh => {
      scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    });
    voxelMeshesRef.current = [];

    // Remove existing bounding box
    if (boundingBoxRef.current) {
      scene.remove(boundingBoxRef.current);
      if (boundingBoxRef.current.geometry) boundingBoxRef.current.geometry.dispose();
      if (boundingBoxRef.current.material) boundingBoxRef.current.material.dispose();
      boundingBoxRef.current = null;
    }

    // Remove existing axes helper
    if (axesHelperRef.current) {
      scene.remove(axesHelperRef.current);
      axesHelperRef.current = null;
    }

    const { channels, bounds } = selectedData;
    if (channels.length === 0) {
      console.log('Local_View: No channels in selection');
      return;
    }

    // Load first channel data to get metadata for bounding box calculation
    const firstChannelConfig = channels[0];
    const firstChannelData = await loadChannelData(firstChannelConfig.channelIndex);
    if (!firstChannelData) {
      console.log('Local_View: Failed to load first channel data');
      return;
    }

    const { metadata: firstMetadata } = firstChannelData;
    const [zSize, ySize, xSize] = firstMetadata.shape;
    const maxDimData = Math.max(zSize, ySize, xSize);
    const scaleXData = xSize / maxDimData;
    const scaleYData = ySize / maxDimData;
    const scaleZData = (zSize / maxDimData) / 4;

    // Calculate bounding box size in normalized coordinates
    const boundsWidth = bounds.max.x - bounds.min.x + 1;
    const boundsHeight = bounds.max.y - bounds.min.y + 1;
    const boundsDepth = bounds.max.z - bounds.min.z + 1;
    
    // Calculate center in normalized coordinates
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerY = (bounds.min.y + bounds.max.y) / 2;
    const centerZ = (bounds.min.z + bounds.max.z) / 2;
    
    const boxCenter = {
      x: ((centerX / xSize) * 2 - 1) * scaleXData,
      y: ((centerY / ySize) * 2 - 1) * scaleYData,
      z: ((centerZ / zSize) * 2 - 1) * scaleZData
    };
    
    // Calculate bounding box size in normalized space
    const boxSize = {
      x: (boundsWidth / xSize) * 2 * scaleXData,
      y: (boundsHeight / ySize) * 2 * scaleYData,
      z: (boundsDepth / zSize) * 2 * scaleZData
    };

    console.log('Local_View: Bounding box center', boxCenter, 'size', boxSize);
    console.log('Local_View: Bounds dimensions (voxels)', boundsWidth, boundsHeight, boundsDepth);

    const boxGeometry = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
    const boxEdges = new THREE.EdgesGeometry(boxGeometry);
    const boxMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
    const boxWireframe = new THREE.LineSegments(boxEdges, boxMaterial);
    boxWireframe.position.set(boxCenter.x, boxCenter.y, boxCenter.z);
    scene.add(boxWireframe);
    boundingBoxRef.current = boxWireframe;

    // Create voxel meshes for each channel
    let meshCount = 0;
    for (const channelConfig of channels) {
      const channelData = await loadChannelData(channelConfig.channelIndex);
      if (!channelData) {
        console.log(`Local_View: Failed to load channel ${channelConfig.channelIndex}`);
        continue;
      }

      const mesh = createRegionVisualization(channelData, channelConfig, bounds, scene);
      if (mesh) {
        scene.add(mesh);
        voxelMeshesRef.current.push(mesh);
        meshCount++;
        console.log(`Local_View: Added mesh for channel ${channelConfig.channelIndex} with ${mesh.geometry.instanceCount} instances`);
      } else {
        console.log(`Local_View: No mesh created for channel ${channelConfig.channelIndex} (no points in bounds)`);
      }
    }

    console.log(`Local_View: Created ${meshCount} meshes`);

    // Add coordinate axes helper - scale based on bounding box size
    const axesSize = Math.max(boxSize.x, boxSize.y, boxSize.z) * 0.3;
    const axesHelper = new THREE.AxesHelper(axesSize);
    axesHelper.position.set(boxCenter.x, boxCenter.y, boxCenter.z);
    scene.add(axesHelper);
    axesHelperRef.current = axesHelper;

    // Center camera on the selected region and auto-zoom
    cameraStateRef.current.panOffset = { x: boxCenter.x, y: boxCenter.y, z: boxCenter.z };
    
    // Calculate optimal camera distance to fit the bounding box
    // Use diagonal of bounding box to ensure everything is visible
    const boxDiagonal = Math.sqrt(boxSize.x * boxSize.x + boxSize.y * boxSize.y + boxSize.z * boxSize.z);
    const maxDimension = Math.max(boxSize.x, boxSize.y, boxSize.z);
    
    // Set camera distance to show the entire bounding box with some padding
    // Use a factor that ensures the bounding box fits well in view
    const fovRad = (60 * Math.PI) / 180; // Convert FOV to radians (matches camera FOV)
    const distanceFactor = maxDimension / (2 * Math.tan(fovRad / 2));
    cameraStateRef.current.distance = Math.max(0.3, Math.min(3.0, distanceFactor * 2.0));
    
    // Reset camera rotation to a good viewing angle
    cameraStateRef.current.rotation = { x: 0.5, y: 0.5 };
    
    updateCameraPosition();
    updateLighting();
    
    console.log('Local_View: Camera positioned at distance', cameraStateRef.current.distance, 'looking at', boxCenter);
    console.log('Local_View: Visualization complete');
  };

  // Setup Three.js scene
  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera (wider FOV for better 3D view)
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.001, 100);
    cameraRef.current = camera;
    updateCameraPosition();

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (renderer.outputEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    // Mouse controls for rotation
    let isRotating = false;
    let mouseX = 0, mouseY = 0;

    const handleMouseDown = (e) => {
      if (e.button === 0) {
        isRotating = true;
        mouseX = e.clientX;
        mouseY = e.clientY;
      }
    };

    const handleMouseUp = () => {
      isRotating = false;
    };

    const handleMouseMove = (e) => {
      if (isRotating) {
        const state = cameraStateRef.current;
        state.rotation.y += (e.clientX - mouseX) * 0.01;
        state.rotation.x += (e.clientY - mouseY) * 0.01;
        updateCameraPosition();
        updateLighting();
      }
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const handleWheel = (e) => {
      const state = cameraStateRef.current;
      state.distance *= (1 + e.deltaY * 0.001);
      state.distance = Math.max(0.1, Math.min(5, state.distance));
      updateCameraPosition();
      updateLighting();
    };

    const handleContextMenu = (e) => e.preventDefault();

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('wheel', handleWheel);
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);

    // Animation loop
    const animate = () => {
      updateLighting();
      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      
      // Clean up meshes
      voxelMeshesRef.current.forEach(mesh => {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      });
      voxelMeshesRef.current = [];
      
      if (boundingBoxRef.current) {
        if (boundingBoxRef.current.geometry) boundingBoxRef.current.geometry.dispose();
        if (boundingBoxRef.current.material) boundingBoxRef.current.material.dispose();
      }
      
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update visualization when selected region data changes
  useEffect(() => {
    if (selectedRegionData) {
      createLocalVisualization(selectedRegionData);
    }
  }, [selectedRegionData]);

  // Calculate section depth from selected region data
  const getSectionDepth = () => {
    if (!selectedRegionData || !selectedRegionData.bounds) return null;
    
    const bounds = selectedRegionData.bounds;
    const depthVoxels = bounds.max.z - bounds.min.z + 1;
    
    // Estimate physical size (assuming 1 µm per voxel, adjust based on your data)
    const voxelSize = 1; // µm per voxel (adjust as needed)
    const depthMicrons = depthVoxels * voxelSize;
    
    return Math.round(depthMicrons);
  };

  const sectionDepth = getSectionDepth();

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
      overflow: 'hidden',
      position: 'relative'
    }}>
      <h3 style={{ 
        marginTop: 0, 
        marginBottom: '5px', 
        fontSize: '14px', 
        color: 'white',
        position: 'absolute',
        top: '5px',
        left: '10px',
        zIndex: 100
      }}>
        Local View
      </h3>
      
      {/* Section Label */}
      {sectionDepth && (
        <div style={{
          position: 'absolute',
          top: '25px',
          left: '10px',
          color: 'white',
          fontSize: '12px',
          zIndex: 100
        }}>
          {sectionDepth} µm section
        </div>
      )}
      
      {/* Scale Bar */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end'
      }}>
        <div style={{
          width: '60px',
          height: '2px',
          backgroundColor: 'white',
          marginBottom: '4px'
        }} />
        <div style={{
          color: 'white',
          fontSize: '10px'
        }}>
          10 µm
        </div>
      </div>
      
      <div 
        ref={mountRef} 
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0
        }} 
      />
    </div>
  );
};

export default Local_View;
