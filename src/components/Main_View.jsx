import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

const Main_View = ({ channels = [] }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const composerRef = useRef(null);
  const fxaaPassRef = useRef(null);
  const animationRef = useRef(null);
  const pointCloudsRef = useRef([]);
  const loadedChannelsRef = useRef(new Map()); // Store loaded channels by channelIndex
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
    const opacities = [];
    const pointSize = 0.001;
    const jitterScale = 0.1; // Random jitter factor to reduce grid artifacts
    const baseOpacityFloor = 0.35;
    const opacityBoost = 1.3;
    
    // Adaptive sampling based on data size to prevent memory issues
    // Target: ~1 million points max per channel
    const totalVoxels = zSize * ySize * xSize;
    const maxPoints = 4000000; // Max points per channel (higher for smoother visuals)
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

            if (jitterScale > 0) {
              const stepX = (2 / xSize) * scaleX * sampling;
              const stepY = (2 / ySize) * scaleY * sampling;
              const stepZ = (2 / zSize) * scaleZ * sampling;
              const jitterX = (Math.random() - 0.5) * stepX * jitterScale;
              const jitterY = (Math.random() - 0.5) * stepY * jitterScale;
              const jitterZ = (Math.random() - 0.5) * stepZ * jitterScale;
              points.push(nx + jitterX, ny + jitterY, nz + jitterZ);
            } else {
              points.push(nx, ny, nz);
            }

            // Calculate opacity based on original value
            // Opacity = actualValue / dataMax
            // For value 0: opacity = 0
            // For max value: opacity = 1
            // For value 15000 (if max is 32736): opacity ≈ 0.458
            const pointOpacity = dataMax > 0 ? actualValue / dataMax : 0;
            const boostedOpacity = Math.min(1, pointOpacity * opacityBoost);
            const clampedOpacity = Math.max(baseOpacityFloor, boostedOpacity);
            opacities.push(clampedOpacity);
          }
          if (pointCount >= maxPoints) break;
        }
        if (pointCount >= maxPoints) break;
      }
      if (pointCount >= maxPoints) break;
    }
    
    console.log(`Channel ${channelConfig.channelIndex}: Created ${pointCount} points with sampling=${sampling}`);

    // Create voxel geometry
    const numPoints = points.length / 3;
    if (numPoints === 0) {
      console.warn(`Channel ${channelConfig.channelIndex}: No points pass the threshold range [${minThreshold.toLocaleString()}, ${maxThreshold.toLocaleString()}]`);
      console.warn(`Channel ${channelConfig.channelIndex}: Data range is [${dataMin.toLocaleString()}, ${dataMax.toLocaleString()}]`);
      console.warn(`Channel ${channelConfig.channelIndex}: Try adjusting threshold range to match data values`);
      return null;
    }
    
    console.log(`Channel ${channelConfig.channelIndex}: Creating ${numPoints} points with fixed color ${color} and variable opacity`);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute('opacity', new THREE.Float32BufferAttribute(opacities, 1));

    const spritePixelSize = pointSize * Math.max(1, sampling) * 900.0;

    const pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(r, g, b) },
        pointSize: { value: spritePixelSize },
        opacityBoost: { value: opacityBoost },
        lightDirection: { value: new THREE.Vector3(0.4, 0.7, 0.2).normalize() },
        ambientColor: { value: new THREE.Color(0.5, 0.55, 0.65) },
        specularColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
        shininess: { value: 28.0 },
        reflectionStrength: { value: 0.45 },
        brightness: { value: 1.6 }
      },
      vertexShader: `
        attribute float opacity;
        varying float vOpacity;
        varying vec3 vViewDir;
        varying vec3 vWorldPos;
        uniform float pointSize;
        void main() {
          vOpacity = opacity;
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPosition.xyz;
          vec4 mvPosition = viewMatrix * worldPosition;
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
          float size = pointSize / max(0.0001, -mvPosition.z);
          gl_PointSize = size;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float opacityBoost;
        uniform vec3 lightDirection;
        uniform vec3 ambientColor;
        uniform vec3 specularColor;
        uniform float shininess;
        uniform float reflectionStrength;
        uniform float brightness;
        varying float vOpacity;
        varying vec3 vViewDir;
        varying vec3 vWorldPos;
        void main() {
          vec2 coord = gl_PointCoord * 2.0 - 1.0;
          float distSq = dot(coord, coord);
          if (distSq > 1.0) {
            discard;
          }
          float sphereZ = sqrt(max(0.0, 1.0 - distSq));
          vec3 normal = normalize(vec3(coord.xy, sphereZ));
          vec3 L = normalize(lightDirection);
          vec3 V = normalize(vViewDir);
          float diffuse = max(dot(normal, L), 0.0);
          vec3 R = reflect(-L, normal);
          float spec = pow(max(dot(R, V), 0.0), shininess);
          float falloff = exp(-distSq * 0.9);
          float base = clamp(vOpacity * falloff * opacityBoost, 0.0, 1.0);
          vec3 baseColor = pow(color, vec3(0.55));
          vec3 lighting = ambientColor + diffuse * baseColor + spec * specularColor;
          vec3 env = mix(baseColor, vec3(0.75, 0.82, 0.95), reflectionStrength * spec);
          vec3 finalColor = mix(lighting, env, 0.35) * brightness;
          float alpha = clamp(base * 1.15, 0.0, 1.0);
          gl_FragColor = vec4(finalColor * alpha, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending
    });

    const pointsObject = new THREE.Points(geometry, pointMaterial);
    pointsObject.userData = { channelIndex: channelConfig.channelIndex };

    scene.add(pointsObject);
    
    console.log(`Channel ${channelConfig.channelIndex}: Point cloud added to scene with ${numPoints} points`);
    
    // Clear arrays to free memory
    points.length = 0;
    opacities.length = 0;
    
    return pointsObject;
  };

  const renderScene = () => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    if (composerRef.current) {
      composerRef.current.render();
    } else if (rendererRef.current) {
      rendererRef.current.render(scene, camera);
    }
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
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Ensure consistent output regardless of lighting
    if (renderer.outputEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Post-processing composer with FXAA for smoother visuals
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.material.uniforms['resolution'].value.set(1 / width, 1 / height);
    composer.addPass(fxaaPass);

    composerRef.current = composer;
    fxaaPassRef.current = fxaaPass;

    // Note: Since we're using a completely unlit shader, lights don't affect the visualization
    // But we keep ambient light for other potential objects in the scene
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

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
      if (composerRef.current) {
        composerRef.current.render();
      } else {
      if (composerRef.current) {
        composerRef.current.render();
      } else {
        renderer.render(scene, camera);
      }
      }
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
      if (composerRef.current) {
        composerRef.current.setSize(width, height);
      }
      if (fxaaPassRef.current) {
        fxaaPassRef.current.material.uniforms['resolution'].value.set(1 / width, 1 / height);
      }
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
      
      // Clean up point clouds
      pointCloudsRef.current.forEach(cloud => {
        if (cloud.geometry) cloud.geometry.dispose();
        if (cloud.material) cloud.material.dispose();
      });
      pointCloudsRef.current = [];
      loadedChannelsRef.current.clear();
      
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
    const loadedChannels = loadedChannelsRef.current;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Main_View: Updating channels`);
    console.log(`Main_View: Total channels: ${channels.length}, Visible: ${visibleChannels.length}`);
    console.log(`${'='.repeat(60)}\n`);

    // Update visibility for existing channels (already loaded)
    channels.forEach(channelConfig => {
      const channelIndex = channelConfig.channelIndex;
      const pointCloud = loadedChannels.get(channelIndex);
      
      if (pointCloud) {
        // Channel already loaded, just update visibility based on checkbox state
        if (channelConfig.visible !== false) {
          // Checkbox is checked - should be visible
          if (!scene.children.includes(pointCloud)) {
            scene.add(pointCloud);
            console.log(`Main_View: ✅ Channel ${channelIndex} turned ON (checkbox checked)`);
            // Force renderer update
        renderScene();
          }
        } else {
          // Checkbox is unchecked - should be hidden
          if (scene.children.includes(pointCloud)) {
            scene.remove(pointCloud);
            console.log(`Main_View: ⚠️ Channel ${channelIndex} turned OFF (checkbox unchecked)`);
            // Force renderer update
            renderScene();
          }
        }
      }
    });

    // Load new channels that aren't loaded yet (only for visible channels with checked checkbox)
    const loadChannels = async () => {
      // Only load channels that are visible (checkbox checked) and not already loaded
      const channelsToLoad = visibleChannels.filter(c => {
        // Check if channel is visible and not already loaded
        return c.visible !== false && !loadedChannels.has(c.channelIndex);
      });
      
      if (channelsToLoad.length === 0) {
        console.log(`Main_View: All visible channels already loaded or no visible channels to load`);
        renderScene();
        return;
      }
      
      console.log(`Main_View: Loading ${channelsToLoad.length} new channel(s) (checkbox checked)`);
      
      // Load channels sequentially to avoid memory overflow
      for (let i = 0; i < channelsToLoad.length; i++) {
        const channelConfig = channelsToLoad[i];
        
        // Double-check visibility before loading (in case user unchecked during loading)
        if (channelConfig.visible === false) {
          console.log(`Main_View: Skipping channel ${channelConfig.channelIndex} - checkbox unchecked`);
          continue;
        }
        
        console.log(`Main_View: Loading channel ${i + 1}/${channelsToLoad.length}: Channel ${channelConfig.channelIndex} (${channelConfig.color})`);
        
        try {
          const channelData = await loadChannelData(channelConfig.channelIndex);
          if (channelData) {
            console.log(`Main_View: Channel ${channelConfig.channelIndex} data loaded successfully`);
            const pointCloud = createChannelVisualization(channelData, channelConfig, scene);
            if (pointCloud) {
              // Store in map (even if not visible, so we can quickly add it later)
              loadedChannels.set(channelConfig.channelIndex, pointCloud);
              pointCloudsRef.current.push(pointCloud);
              
              // Only add to scene if checkbox is still checked
              if (channelConfig.visible !== false) {
                scene.add(pointCloud);
                console.log(`Main_View: ✅ Channel ${channelConfig.channelIndex} (color: ${channelConfig.color}) added to scene`);
              } else {
                console.log(`Main_View: ⚠️ Channel ${channelConfig.channelIndex} loaded but not added (checkbox unchecked)`);
              }
              
              // Force renderer to update
              renderScene();
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
      
      const visibleCount = visibleChannels.filter(c => {
        const pointCloud = loadedChannels.get(c.channelIndex);
        return pointCloud && scene.children.includes(pointCloud);
      }).length;
      const hiddenCount = channels.length - visibleChannels.length;
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Main_View:  Channel update complete`);
      console.log(`Main_View: Visible channels in scene: ${visibleCount}/${visibleChannels.length}`);
      if (hiddenCount > 0) {
        console.log(`Main_View: Hidden channels (unchecked): ${hiddenCount}`);
      }
      console.log(`${'='.repeat(60)}\n`);
      
      // Final render after all channels loaded
      renderScene();
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
