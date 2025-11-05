import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';

const Main_View = ({ channels = [] }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const animationRef = useRef(null);
  const pointCloudsRef = useRef([]);
  const keysRef = useRef({});
  
  // Camera state
  const cameraStateRef = useRef({
    rotation: { x: 0.5, y: 0.5 },
    distance: 3,
    panOffset: { x: 0, y: 0, z: 0 }
  });

  const moveSpeed = 0.05;
  const fastMoveSpeed = 0.15;

  // Load channel data
  const loadChannelData = async (channelIndex) => {
    // Try multiple possible paths
    const paths = [
      { data: `./visualization_data/channel_${channelIndex}_napari_data.raw`, metadata: `./visualization_data/channel_${channelIndex}_napari_metadata.json` },
      { data: `visualization_data/channel_${channelIndex}_napari_data.raw`, metadata: `visualization_data/channel_${channelIndex}_napari_metadata.json` },
      { data: `./visualization_data/channel_${channelIndex}_data.raw`, metadata: `./visualization_data/channel_${channelIndex}_metadata.json` },
      { data: `visualization_data/channel_${channelIndex}_data.raw`, metadata: `visualization_data/channel_${channelIndex}_metadata.json` }
    ];

    for (const path of paths) {
      try {
        // Try to load metadata
        let metadataResponse = await fetch(path.metadata);
        if (!metadataResponse.ok) {
          continue;
        }
        
        // Check if response is HTML (404 page) instead of JSON
        const contentType = metadataResponse.headers.get('content-type');
        if (contentType && !contentType.includes('application/json')) {
          continue;
        }
        
        const metadataText = await metadataResponse.text();
        // Check if it's HTML (starts with <!DOCTYPE or <html)
        if (metadataText.trim().startsWith('<!DOCTYPE') || metadataText.trim().startsWith('<html')) {
          continue;
        }
        
        const metadata = JSON.parse(metadataText);

        // Try to load data
        let dataResponse = await fetch(path.data);
        if (!dataResponse.ok) {
          continue;
        }
        
        // Check if response is HTML (404 page) instead of binary
        const dataContentType = dataResponse.headers.get('content-type');
        if (dataContentType && dataContentType.includes('text/html')) {
          continue;
        }
        
        const arrayBuffer = await dataResponse.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        console.log(`Channel ${channelIndex}: Successfully loaded from ${path.data}`);
        return { data, metadata };
      } catch (error) {
        // Only log if it's not a JSON parse error from HTML response
        if (!error.message.includes('Unexpected token') && !error.message.includes('JSON')) {
          console.log(`Channel ${channelIndex}: Error trying ${path.data}:`, error.message);
        }
        continue; // Try next path
      }
    }
    
    console.warn(`Channel ${channelIndex}: Could not find data file in any of the expected locations`);
    console.warn(`Expected files: channel_${channelIndex}_napari_data.raw or channel_${channelIndex}_data.raw`);
    return null;
  };

  // Create visualization for a channel
  const createChannelVisualization = (channelData, channelConfig, scene) => {
    const { data, metadata } = channelData;
    const { color, thresholdMin, thresholdMax, opacity } = channelConfig;
    const shape = metadata.shape;
    const [zSize, ySize, xSize] = shape;
    
    // Get actual data range from metadata (real values, not normalized)
    const dataRange = metadata.dataRange || [0, 65535];
    const dataMin = dataRange[0];
    const dataMax = dataRange[1];
    
    // Use threshold range with real numbers (from channelConfig, already in real range)
    // thresholdMin and thresholdMax are already in the actual data range
    let minThreshold = thresholdMin !== undefined ? thresholdMin : dataMin;
    let maxThreshold = thresholdMax !== undefined ? thresholdMax : dataMax;
    
    // Ensure min <= max
    if (minThreshold > maxThreshold) {
      [minThreshold, maxThreshold] = [maxThreshold, minThreshold];
    }
    
    // Clamp thresholds to data range
    minThreshold = Math.max(dataMin, Math.min(dataMax, minThreshold));
    maxThreshold = Math.max(dataMin, Math.min(dataMax, maxThreshold));

    // Convert hex color to RGB
    const hexColor = color.replace('#', '');
    const r = parseInt(hexColor.substr(0, 2), 16) / 255;
    const g = parseInt(hexColor.substr(2, 2), 16) / 255;
    const b = parseInt(hexColor.substr(4, 2), 16) / 255;

    // Create point cloud
    const points = [];
    const colors = [];
    const pointSize = 0.006;
    
    // Adaptive sampling based on data size to prevent memory issues
    // Target: ~1 million points max per channel
    const totalVoxels = zSize * ySize * xSize;
    const maxPoints = 1000000; // Max points per channel (reduced for safety)
    let sampling = 1;
    
    // Calculate optimal sampling to stay under max points
    // Estimate: roughly 10-20% of voxels pass threshold
    const estimatedPassing = totalVoxels * 0.15;
    if (estimatedPassing > maxPoints) {
      // Calculate cubic root for 3D sampling (sample every Nth voxel in each dimension)
      const ratio = estimatedPassing / maxPoints;
      const neededSampling = Math.ceil(Math.cbrt(ratio * 1.5)); // Extra safety margin
      sampling = Math.max(2, neededSampling); // At least 2x downsampling
      
      // For very large datasets, use more aggressive downsampling
      if (totalVoxels > 50000000) {
        sampling = Math.max(sampling, 4);
      }
    }
    
    console.log(`Channel visualization: shape=${shape}, sampling=${sampling}, totalVoxels=${totalVoxels}`);
    console.log(`Channel ${channelConfig.channelIndex}: Data range [${dataMin}, ${dataMax}], Threshold range [${minThreshold}, ${maxThreshold}]`);

    // Sample and filter points with adaptive sampling
    let pointCount = 0;
    for (let z = 0; z < zSize; z += sampling) {
      for (let y = 0; y < ySize; y += sampling) {
        for (let x = 0; x < xSize; x += sampling) {
          const idx = z * ySize * xSize + y * xSize + x;
          // Data is stored as uint8 (0-255), need to denormalize to actual range
          const normalizedValue = data[idx]; // 0-255
          const actualValue = (normalizedValue / 255) * (dataMax - dataMin) + dataMin;

          // Filter data: actual value must be between minThreshold and maxThreshold (both bounds)
          // This filters using both lower and upper bands
          if (actualValue >= minThreshold && actualValue <= maxThreshold) {
            // Stop if we've reached max points
            if (pointCount >= maxPoints) {
              console.warn(`Channel ${channelConfig.channelIndex}: Reached max points limit (${maxPoints})`);
              break;
            }
            pointCount++;
            // Normalize coordinates with correct aspect ratio
            const maxDim = Math.max(zSize, ySize, xSize);
            const scaleX = xSize / maxDim;
            const scaleY = ySize / maxDim;
            const scaleZ = (zSize / maxDim) / 4; // Z compressed 4x

            // Normalize to [-1, 1] with aspect ratio
            const nx = ((x / xSize) * 2 - 1) * scaleX;
            const ny = ((y / ySize) * 2 - 1) * scaleY;
            const nz = ((z / zSize) * 2 - 1) * scaleZ;

            points.push(nx, ny, nz);

            // Color with intensity based on actual value normalized within threshold range
            // Normalize actualValue from [minThreshold, maxThreshold] to [0, 1]
            // Example: threshold 1000-5000, value 2000 -> intensity = (2000-1000)/(5000-1000) = 0.25
            const intensity = maxThreshold > minThreshold 
              ? (actualValue - minThreshold) / (maxThreshold - minThreshold)
              : 1.0;
            // Clamp intensity to [0, 1]
            const clampedIntensity = Math.max(0, Math.min(1, intensity));
            
            // Apply intensity to channel color
            // Example: Red [255,0,0] with intensity 0.25 -> [64, 0, 0] (approximately [51, 0, 0])
            colors.push(r * clampedIntensity, g * clampedIntensity, b * clampedIntensity);
          }
          if (pointCount >= maxPoints) break;
        }
        if (pointCount >= maxPoints) break;
      }
      if (pointCount >= maxPoints) break;
    }
    
    console.log(`Channel ${channelConfig.channelIndex}: Created ${pointCount} points with sampling=${sampling}`);

    // Create sphere geometry
    const numPoints = points.length / 3;
    if (numPoints === 0) {
      console.warn(`Channel ${channelConfig.channelIndex}: No points pass the threshold range [${minThreshold.toLocaleString()}, ${maxThreshold.toLocaleString()}]`);
      console.warn(`Channel ${channelConfig.channelIndex}: Data range is [${dataMin.toLocaleString()}, ${dataMax.toLocaleString()}]`);
      console.warn(`Channel ${channelConfig.channelIndex}: Try adjusting threshold range to match data values`);
      return null;
    }
    
    console.log(`Channel ${channelConfig.channelIndex}: Creating ${numPoints} points with color ${color}, opacity ${opacity}`);

    const sphereGeometry = new THREE.SphereGeometry(pointSize, 8, 8);
    const instancedMesh = new THREE.InstancedMesh(sphereGeometry, null, numPoints);

    // Create material
    const material = new THREE.MeshLambertMaterial({
      vertexColors: false,
      transparent: true,
      opacity: opacity,
      emissive: new THREE.Color(r, g, b),
      emissiveIntensity: 0.4
    });

    // Set up instances
    const matrix = new THREE.Matrix4();
    const threeColor = new THREE.Color();

    for (let i = 0; i < numPoints; i++) {
      matrix.makeTranslation(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
      instancedMesh.setMatrixAt(i, matrix);
      threeColor.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
      instancedMesh.setColorAt(i, threeColor);
    }

    instancedMesh.instanceColor.needsUpdate = true;
    instancedMesh.material = material;
    
    // Store channel index for reference
    instancedMesh.userData = { channelIndex: channelConfig.channelIndex };

    scene.add(instancedMesh);
    
    console.log(`Channel ${channelConfig.channelIndex}: Point cloud added to scene with ${numPoints} points`);
    
    // Clear arrays to free memory
    points.length = 0;
    colors.length = 0;
    
    return instancedMesh;
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
    cameraRef.current.lookAt(lookAtPoint);
  };

  // Handle movement
  const handleMovement = () => {
    if (!cameraRef.current) return;

    const keys = keysRef.current;
    const speed = keys['shift'] ? fastMoveSpeed : moveSpeed;
    const state = cameraStateRef.current;
    let moved = false;

    // Forward/Backward
    if (keys['w'] || keys['arrowup']) {
      const forward = new THREE.Vector3();
      cameraRef.current.getWorldDirection(forward);
      forward.multiplyScalar(speed);
      state.panOffset.x = (state.panOffset.x || 0) + forward.x;
      state.panOffset.y = (state.panOffset.y || 0) + forward.y;
      state.panOffset.z = (state.panOffset.z || 0) + forward.z;
      moved = true;
    }
    if (keys['s'] || keys['arrowdown']) {
      const backward = new THREE.Vector3();
      cameraRef.current.getWorldDirection(backward);
      backward.multiplyScalar(-speed);
      state.panOffset.x = (state.panOffset.x || 0) + backward.x;
      state.panOffset.y = (state.panOffset.y || 0) + backward.y;
      state.panOffset.z = (state.panOffset.z || 0) + backward.z;
      moved = true;
    }

    // Left/Right
    if (keys['a'] || keys['arrowleft']) {
      const forward = new THREE.Vector3();
      cameraRef.current.getWorldDirection(forward);
      const right = new THREE.Vector3();
      right.crossVectors(forward, cameraRef.current.up).normalize();
      right.multiplyScalar(-speed);
      state.panOffset.x = (state.panOffset.x || 0) + right.x;
      state.panOffset.y = (state.panOffset.y || 0) + right.y;
      state.panOffset.z = (state.panOffset.z || 0) + right.z;
      moved = true;
    }
    if (keys['d'] || keys['arrowright']) {
      const forward = new THREE.Vector3();
      cameraRef.current.getWorldDirection(forward);
      const right = new THREE.Vector3();
      right.crossVectors(forward, cameraRef.current.up).normalize();
      right.multiplyScalar(speed);
      state.panOffset.x = (state.panOffset.x || 0) + right.x;
      state.panOffset.y = (state.panOffset.y || 0) + right.y;
      state.panOffset.z = (state.panOffset.z || 0) + right.z;
      moved = true;
    }

    // Up/Down
    if (keys['q']) {
      const up = cameraRef.current.up.clone().multiplyScalar(speed);
      state.panOffset.x = (state.panOffset.x || 0) + up.x;
      state.panOffset.y = (state.panOffset.y || 0) + up.y;
      state.panOffset.z = (state.panOffset.z || 0) + up.z;
      moved = true;
    }
    if (keys['e']) {
      const down = cameraRef.current.up.clone().multiplyScalar(-speed);
      state.panOffset.x = (state.panOffset.x || 0) + down.x;
      state.panOffset.y = (state.panOffset.y || 0) + down.y;
      state.panOffset.z = (state.panOffset.z || 0) + down.z;
      moved = true;
    }

    if (moved) {
      updateCameraPosition();
    }
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

    // Camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    cameraRef.current = camera;
    updateCameraPosition();

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight1.position.set(1, 1, 1);
    scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight2.position.set(-1, 1, -1);
    scene.add(directionalLight2);

    const directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight3.position.set(1, -1, 1);
    scene.add(directionalLight3);

    const directionalLight4 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight4.position.set(-1, -1, -1);
    scene.add(directionalLight4);

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    scene.add(hemisphereLight);

    // Mouse controls
    let isRotating = false;
    let isPanning = false;
    let mouseX = 0, mouseY = 0;

    const handleMouseDown = (e) => {
      if (e.button === 0) isRotating = true;
      if (e.button === 2) isPanning = true;
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const handleMouseUp = () => {
      isRotating = false;
      isPanning = false;
    };

    const handleMouseMove = (e) => {
      const state = cameraStateRef.current;
      if (isRotating) {
        state.rotation.y += (e.clientX - mouseX) * 0.01;
        state.rotation.x += (e.clientY - mouseY) * 0.01;
        updateCameraPosition();
      }
      if (isPanning) {
        state.panOffset.x += (e.clientX - mouseX) * 0.001;
        state.panOffset.y -= (e.clientY - mouseY) * 0.001;
        updateCameraPosition();
      }
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const handleWheel = (e) => {
      const state = cameraStateRef.current;
      state.distance *= (1 + e.deltaY * 0.001);
      state.distance = Math.max(0.1, Math.min(20, state.distance));
      updateCameraPosition();
    };

    const handleContextMenu = (e) => e.preventDefault();

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('wheel', handleWheel);
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);

    // Keyboard controls
    const handleKeyDown = (e) => {
      keysRef.current[e.key.toLowerCase()] = true;
      keysRef.current[e.code] = true;
    };

    const handleKeyUp = (e) => {
      keysRef.current[e.key.toLowerCase()] = false;
      keysRef.current[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Focus canvas
    renderer.domElement.setAttribute('tabindex', '0');
    renderer.domElement.style.outline = 'none';
    renderer.domElement.addEventListener('click', () => {
      renderer.domElement.focus();
    });

    // Animation loop
    const animate = () => {
      handleMovement();
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
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Load and update channels
  useEffect(() => {
    if (!sceneRef.current || channels.length === 0) {
      console.log('Main_View: Scene not ready or no channels', { sceneReady: !!sceneRef.current, channelsCount: channels.length });
      return;
    }

    const scene = sceneRef.current;
    const visibleChannels = channels.filter(c => c.visible !== false);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Main_View: Starting channel load process`);
    console.log(`Main_View: Total channels: ${channels.length}, Visible: ${visibleChannels.length}`);
    console.log(`Main_View: Visible channels:`, visibleChannels.map(c => `Channel ${c.channelIndex} (${c.color}, threshold: ${c.thresholdMin}-${c.thresholdMax})`));
    console.log(`${'='.repeat(60)}\n`);

    // Remove existing point clouds
    pointCloudsRef.current.forEach(cloud => {
      if (cloud.geometry) cloud.geometry.dispose();
      if (cloud.material) cloud.material.dispose();
      scene.remove(cloud);
    });
    pointCloudsRef.current = [];

    // Load and add new channels (sequential to avoid memory issues)
    const loadChannels = async () => {
      console.log(`Main_View: Starting to load ${visibleChannels.length} visible channel(s) out of ${channels.length} total`);
      
      // Load channels sequentially to avoid memory overflow
      for (let i = 0; i < visibleChannels.length; i++) {
        const channelConfig = visibleChannels[i];
        
        console.log(`Main_View: Loading channel ${i + 1}/${visibleChannels.length}: Channel ${channelConfig.channelIndex} (${channelConfig.color})`);
        
        try {
          const channelData = await loadChannelData(channelConfig.channelIndex);
          if (channelData) {
            console.log(`Main_View: Channel ${channelConfig.channelIndex} data loaded successfully`);
            const pointCloud = createChannelVisualization(channelData, channelConfig, scene);
            if (pointCloud) {
              pointCloudsRef.current.push(pointCloud);
              console.log(`Main_View: ✅ Channel ${channelConfig.channelIndex} (color: ${channelConfig.color}) visualization created and added to scene`);
              console.log(`Main_View: Scene now contains ${pointCloudsRef.current.length} point cloud(s)`);
              
              // Force renderer to update
              if (rendererRef.current) {
                rendererRef.current.render(scene, cameraRef.current);
              }
            } else {
              console.warn(`Main_View: ⚠️ Channel ${channelConfig.channelIndex} visualization creation returned null (no points created)`);
            }
            // Clear channelData to free memory (data array is large)
            channelData.data = null;
            channelData.metadata = null;
          } else {
            console.warn(`Main_View: ⚠️ Channel ${channelConfig.channelIndex} - Data file not found. Please create visualization data for this channel.`);
            console.warn(`Main_View: Expected file: visualization_data/channel_${channelConfig.channelIndex}_data.raw or channel_${channelConfig.channelIndex}_napari_data.raw`);
          }
        } catch (error) {
          console.error(`Main_View: ❌ Error loading channel ${channelConfig.channelIndex}:`, error);
          console.error(`Main_View: Error details:`, error.stack);
        }
        
        // Small delay to allow garbage collection between channels
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const loadedCount = pointCloudsRef.current.length;
      const hiddenCount = channels.length - visibleChannels.length;
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Main_View: ✅ Finished loading channels`);
      console.log(`Main_View: Successfully loaded: ${loadedCount}/${visibleChannels.length} visible channel(s)`);
      if (hiddenCount > 0) {
        console.log(`Main_View: Hidden channels: ${hiddenCount}`);
      }
      console.log(`Main_View: Point clouds in scene: ${pointCloudsRef.current.length}`);
      if (loadedCount < visibleChannels.length) {
        const missingChannels = visibleChannels
          .filter((c, idx) => idx >= loadedCount || !pointCloudsRef.current[idx])
          .map(c => c.channelIndex);
        console.warn(`Main_View: ⚠️ ${visibleChannels.length - loadedCount} channel(s) failed to load: ${missingChannels.join(', ')}`);
        console.warn(`Main_View: ⚠️ Missing data files for channels: ${missingChannels.join(', ')}`);
        console.warn(`Main_View: 💡 To create data files, run in notebook:`);
        if (missingChannels.length > 0) {
          console.warn(`Main_View:    prepare_data_for_threejs(channel_idx=${missingChannels[0]}, downsample_factor=1)`);
        }
      }
      console.log(`${'='.repeat(60)}\n`);
      
      // Final render after all channels loaded
      if (rendererRef.current && scene && cameraRef.current) {
        rendererRef.current.render(scene, cameraRef.current);
        console.log(`Main_View: Final render completed with ${pointCloudsRef.current.length} point clouds`);
      }
    };

    loadChannels();
  }, [channels]);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative', backgroundColor: '#000000' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />
    </div>
  );
};

export default Main_View;
