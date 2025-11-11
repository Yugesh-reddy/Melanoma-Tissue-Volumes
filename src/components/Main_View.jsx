  const updateChannelLOD = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const state = cameraStateRef.current;
    if (!state) return;

    const desiredSampling = getDesiredSampling(state.distance || 3);
    const lodState = lodStateRef.current;
    const now = Date.now();

    if (now - lodState.lastUpdate < lodCooldownMs) {
      return;
    }

    lodState.lastUpdate = now;
    console.log(`Main_View LOD: distance=${(state.distance || 0).toFixed(2)}, desiredSampling=${desiredSampling}`);

    const loadedChannels = loadedChannelsRef.current;
    loadedChannels.forEach((entry, channelIndex) => {
      if (!entry) return;
      if (entry.sampling === desiredSampling || entry.lastRequestedSampling === desiredSampling) {
        return;
      }

      const channelData = channelDataCacheRef.current.get(channelIndex);
      const channelConfig = channelConfigsRef.current.get(channelIndex);
      if (!channelData || !channelConfig) return;

      const previousMesh = entry.mesh;
      const wasVisible = previousMesh ? scene.children.includes(previousMesh) : false;

      if (wasVisible && previousMesh) {
        scene.remove(previousMesh);
      }

      const result = createChannelVisualization(channelData, channelConfig, scene, {
        samplingOverride: desiredSampling,
        addToScene: false
      });

      if (!result) {
        if (wasVisible && previousMesh && channelConfig.visible !== false) {
          scene.add(previousMesh);
        }
        entry.lastRequestedSampling = desiredSampling;
        return;
      }

      const { mesh, sampling } = result;

      if (previousMesh) {
        const index = pointCloudsRef.current.indexOf(previousMesh);
        if (index !== -1) {
          pointCloudsRef.current[index] = mesh;
        } else {
          pointCloudsRef.current.push(mesh);
        }
        if (previousMesh.geometry) previousMesh.geometry.dispose();
        if (previousMesh.material) previousMesh.material.dispose();
      } else {
        pointCloudsRef.current.push(mesh);
      }

      loadedChannels.set(channelIndex, {
        mesh,
        sampling,
        lastRequestedSampling: desiredSampling
      });

      if (wasVisible && channelConfig.visible !== false) {
        scene.add(mesh);
      }

      console.log(`Main_View LOD: Channel ${channelIndex} updated from sampling=${entry.sampling ?? 'n/a'} to sampling=${sampling}`);
    });

    lodState.lastSampling = desiredSampling;
    renderScene();
  };
import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

const Main_View = ({ channels = [], onSelectionChange }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const composerRef = useRef(null);
  const aaPassRef = useRef(null);
  const msaaRenderTargetRef = useRef(null);
  const animationRef = useRef(null);
  const pointCloudsRef = useRef([]);
  const loadedChannelsRef = useRef(new Map()); // Store loaded channels by channelIndex
  const channelDataCacheRef = useRef(new Map());
  const channelConfigsRef = useRef(new Map());
  const lodStateRef = useRef({ lastSampling: null, lastUpdate: 0 });
  const keysRef = useRef({});
  const selectionModeRef = useRef(false);
  
  // Selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  
  // Sync ref with state
  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);
  
  // Camera state
  const cameraStateRef = useRef({
    rotation: { x:0, y: Math.PI },
    distance: 0.75,
    panOffset: { x: 0, y: 0, z: 0 }
  });

  const moveSpeed = 0.05;
  const fastMoveSpeed = 0.15;
  const lodCooldownMs = 200;

  const getDesiredSampling = (distance = 3) => {
    if (distance >= 8) return 6;
    if (distance >= 5.5) return 4;
    if (distance >= 3.5) return 3;
    if (distance >= 2) return 2;
    return 1;
  };

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
  const createChannelVisualization = (channelData, channelConfig, scene, options = {}) => {
    const { samplingOverride, addToScene = true } = options;
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

    // Create voxel data
    const points = [];
    const opacities = [];
    const baseOpacityFloor = 0.35;
    const opacityBoost = 1.3;
    const maxDim = Math.max(zSize, ySize, xSize);
    const scaleX = xSize / maxDim;
    const scaleY = ySize / maxDim;
    const scaleZ = (zSize / maxDim) / 4; // Maintain existing Z compression
    
    // Adaptive sampling based on data size to prevent memory issues
    // Target: ~1 million points max per channel
    const totalVoxels = zSize * ySize * xSize;
    const maxPoints = 5000000000; // Max points per channel (higher for smoother visuals)
    let sampling = 1;
    
    // Calculate optimal sampling to stay under max points
    // Estimate: roughly 10-20% of voxels pass threshold
    const estimatedPassing = totalVoxels * 0.5;
    if (estimatedPassing > maxPoints) {
      // Calculate cubic root for 3D sampling (sample every Nth voxel in each dimension)
      const ratio = estimatedPassing / maxPoints;
      const neededSampling = Math.ceil(Math.cbrt(ratio * 1.5)); // Extra safety margin
      sampling = Math.max(2, neededSampling); // At least 2x downsampling
      
      // For very large datasets, use more aggressive downsampling
      if (totalVoxels > 5000000000) {
        sampling = Math.max(sampling, 4);
      }
    }

    if (samplingOverride !== undefined) {
      sampling = Math.max(1, Math.round(samplingOverride));
    }
    
    console.log(`Channel visualization: shape=${shape}, sampling=${sampling}, totalVoxels=${totalVoxels}`);
    console.log(`Channel ${channelConfig.channelIndex}: Data range [${dataMin}, ${dataMax}], Threshold range [${minThreshold}, ${maxThreshold}]`);

    const stepX = (2 / xSize) * scaleX * Math.max(1, sampling);
    const stepY = (2 / ySize) * scaleY * Math.max(1, sampling);
    const stepZ = (2 / zSize) * scaleZ * Math.max(1, sampling);

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
            // Normalize to [-1, 1] with aspect ratio
            const nx = ((x / xSize) * 2 - 1) * scaleX;
            const ny = ((y / ySize) * 2 - 1) * scaleY;
            const nz = ((z / zSize) * 2 - 1) * scaleZ;
            points.push(nx, ny, nz);

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
    
    console.log(`Channel ${channelConfig.channelIndex}: Created ${pointCount} voxels with sampling=${sampling}`);

    // Create voxel geometry
    const numPoints = points.length / 3;
    if (numPoints === 0) {
      console.warn(`Channel ${channelConfig.channelIndex}: No points pass the threshold range [${minThreshold.toLocaleString()}, ${maxThreshold.toLocaleString()}]`);
      console.warn(`Channel ${channelConfig.channelIndex}: Data range is [${dataMin.toLocaleString()}, ${dataMax.toLocaleString()}]`);
      console.warn(`Channel ${channelConfig.channelIndex}: Try adjusting threshold range to match data values`);
      return null;
    }
    
    console.log(`Channel ${channelConfig.channelIndex}: Preparing instanced voxel mesh (${numPoints} instances, sampling=${sampling})`);

    const baseGeometry = new THREE.BoxGeometry(stepX, stepY, stepZ);
    baseGeometry.translate(0, 0, 0);
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

    const pointsObject = new THREE.Mesh(geometry, voxelMaterial);
    pointsObject.frustumCulled = false;
    pointsObject.userData = { channelIndex: channelConfig.channelIndex, sampling };

    if (addToScene) {
      scene.add(pointsObject);
      console.log(`Channel ${channelConfig.channelIndex}: Voxel mesh added to scene (${numPoints} instances, sampling=${sampling})`);
    } else {
      console.log(`Channel ${channelConfig.channelIndex}: Voxel mesh created off-scene (${numPoints} instances, sampling=${sampling})`);
    }
    
    // Clear arrays to free memory
    points.length = 0;
    opacities.length = 0;
    
    return { mesh: pointsObject, sampling };
  };

  const updateLighting = () => {
    const camera = cameraRef.current;
    if (!camera) return;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    pointCloudsRef.current.forEach(mesh => {
      const material = mesh?.material;
      if (material && material.uniforms && material.uniforms.lightDirection) {
        material.uniforms.lightDirection.value.copy(direction);
      }
    });
  };

  const renderScene = () => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    updateLighting();
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
    cameraRef.current.up.set(0, -1, 0);
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
      updateChannelLOD();
    }
  };

  // Convert screen coordinates to normalized device coordinates (-1 to 1)
  const screenToNDC = (x, y, width, height) => {
    return {
      x: (x / width) * 2 - 1,
      y: -(y / height) * 2 + 1
    };
  };

  // Get 3D world bounds from screen selection box
  const getWorldBoundsFromSelection = (startX, startY, endX, endY) => {
    if (!cameraRef.current || !rendererRef.current) return null;
    
    const rect = rendererRef.current.domElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    
    // Convert to NDC
    const startNDC = screenToNDC(startX - rect.left, startY - rect.top, width, height);
    const endNDC = screenToNDC(endX - rect.left, endY - rect.top, width, height);
    
    // Create raycaster to get world positions
    const raycaster = new THREE.Raycaster();
    const camera = cameraRef.current;
    
    // Get corners of selection box in world space
    // Use a plane at z=0 (center of the scene) to intersect
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    
    // Calculate world positions for corners
    const corners = [
      new THREE.Vector2(startNDC.x, startNDC.y),
      new THREE.Vector2(endNDC.x, startNDC.y),
      new THREE.Vector2(endNDC.x, endNDC.y),
      new THREE.Vector2(startNDC.x, endNDC.y)
    ];
    
    const worldPositions = [];
    corners.forEach(ndc => {
      raycaster.setFromCamera(ndc, camera);
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersection);
      worldPositions.push(intersection);
    });
    
    if (worldPositions.length === 0) return null;
    
    // Calculate bounding box
    const minX = Math.min(...worldPositions.map(p => p.x));
    const maxX = Math.max(...worldPositions.map(p => p.x));
    const minY = Math.min(...worldPositions.map(p => p.y));
    const maxY = Math.max(...worldPositions.map(p => p.y));
    const minZ = Math.min(...worldPositions.map(p => p.z));
    const maxZ = Math.max(...worldPositions.map(p => p.z));
    
    return {
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ)
    };
  };

  // Extract selected region data from all visible channels
  const extractSelectedRegion = async (worldBounds) => {
    if (!worldBounds) return null;
    
    const selectedData = {
      channels: [],
      bounds: null
    };
    
    // Get first channel metadata to calculate voxel bounds
    const visibleChannels = channels.filter(c => c.visible !== false);
    if (visibleChannels.length === 0) return null;
    
    const firstChannel = visibleChannels[0];
    const channelData = channelDataCacheRef.current.get(firstChannel.channelIndex);
    if (!channelData) return null;
    
    const { metadata } = channelData;
    const shape = metadata.shape;
    const [zSize, ySize, xSize] = shape;
    const maxDim = Math.max(zSize, ySize, xSize);
    const scaleX = xSize / maxDim;
    const scaleY = ySize / maxDim;
    const scaleZ = (zSize / maxDim) / 4;
    
    // Convert world bounds to voxel coordinates
    let voxelMinX = Math.max(0, Math.floor(((worldBounds.min.x / scaleX + 1) / 2) * xSize));
    let voxelMaxX = Math.min(xSize - 1, Math.ceil(((worldBounds.max.x / scaleX + 1) / 2) * xSize));
    let voxelMinY = Math.max(0, Math.floor(((worldBounds.min.y / scaleY + 1) / 2) * ySize));
    let voxelMaxY = Math.min(ySize - 1, Math.ceil(((worldBounds.max.y / scaleY + 1) / 2) * ySize));
    let voxelMinZ = Math.max(0, Math.floor(((worldBounds.min.z / scaleZ + 1) / 2) * zSize));
    let voxelMaxZ = Math.min(zSize - 1, Math.ceil(((worldBounds.max.z / scaleZ + 1) / 2) * zSize));
    
    // Ensure min <= max (swap if needed)
    if (voxelMinX > voxelMaxX) [voxelMinX, voxelMaxX] = [voxelMaxX, voxelMinX];
    if (voxelMinY > voxelMaxY) [voxelMinY, voxelMaxY] = [voxelMaxY, voxelMinY];
    if (voxelMinZ > voxelMaxZ) [voxelMinZ, voxelMaxZ] = [voxelMaxZ, voxelMinZ];
    
    // Ensure minimum size (at least 1 voxel in each dimension)
    if (voxelMaxX === voxelMinX) voxelMaxX = Math.min(xSize - 1, voxelMinX + 1);
    if (voxelMaxY === voxelMinY) voxelMaxY = Math.min(ySize - 1, voxelMinY + 1);
    if (voxelMaxZ === voxelMinZ) voxelMaxZ = Math.min(zSize - 1, voxelMinZ + 1);
    
    selectedData.bounds = {
      min: { x: voxelMinX, y: voxelMinY, z: voxelMinZ },
      max: { x: voxelMaxX, y: voxelMaxY, z: voxelMaxZ }
    };
    
    console.log(`Main_View: Calculated voxel bounds: X[${voxelMinX}, ${voxelMaxX}], Y[${voxelMinY}, ${voxelMaxY}], Z[${voxelMinZ}, ${voxelMaxZ}]`);
    console.log(`Main_View: Bounds size: ${voxelMaxX - voxelMinX + 1} x ${voxelMaxY - voxelMinY + 1} x ${voxelMaxZ - voxelMinZ + 1} voxels`);
    
    // Add all visible channels
    visibleChannels.forEach(channelConfig => {
      selectedData.channels.push({
        channelIndex: channelConfig.channelIndex,
        color: channelConfig.color,
        thresholdMin: channelConfig.thresholdMin,
        thresholdMax: channelConfig.thresholdMax,
        opacity: channelConfig.opacity
      });
    });
    
    console.log(`Main_View: Added ${selectedData.channels.length} channels to selection`);
    
    return selectedData;
  };

  // Handle selection completion
  const handleSelectionComplete = async (startX, startY, endX, endY) => {
    console.log(`Main_View: Selection completed: [${startX}, ${startY}] to [${endX}, ${endY}]`);
    const worldBounds = getWorldBoundsFromSelection(startX, startY, endX, endY);
    if (!worldBounds) {
      console.warn('Main_View: Failed to get world bounds from selection');
      return;
    }
    
    console.log('Main_View: World bounds:', worldBounds);
    const selectedData = await extractSelectedRegion(worldBounds);
    if (selectedData) {
      console.log('Main_View: Extracted selected region data:', selectedData);
      console.log('Main_View: Bounds:', selectedData.bounds);
      console.log('Main_View: Channels:', selectedData.channels.length);
      if (onSelectionChange) {
        onSelectionChange(selectedData);
      }
    } else {
      console.warn('Main_View: Failed to extract selected region data');
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

    // Post-processing composer (MSAA when available, otherwise FXAA fallback)
    let renderTarget = null;
    if (renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget) {
      const samples = window.devicePixelRatio > 1 ? 4 : 2;
      renderTarget = new THREE.WebGLMultisampleRenderTarget(width, height, {
        format: THREE.RGBAFormat,
        encoding: renderer.outputEncoding
      });
      renderTarget.samples = samples;
      msaaRenderTargetRef.current = renderTarget;
      console.log(`Main_View: MSAA render target enabled with ${samples}x samples`);
    } else {
      msaaRenderTargetRef.current = null;
      console.log('Main_View: MSAA not available, using FXAA fallback');
    }

    const composer = renderTarget
      ? new EffectComposer(renderer, renderTarget)
      : new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    let aaPass = null;
    if (!renderTarget) {
      try {
        aaPass = new SMAAPass(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
        composer.addPass(aaPass);
        console.log('Main_View: SMAA pass enabled');
      } catch (error) {
        console.warn('Main_View: SMAA unavailable, falling back to FXAA', error);
        aaPass = new ShaderPass(FXAAShader);
        aaPass.material.uniforms['resolution'].value.set(1 / width, 1 / height);
        composer.addPass(aaPass);
        console.log('Main_View: FXAA pass enabled');
      }
    }

    composerRef.current = composer;
    aaPassRef.current = aaPass;

    // Note: Since we're using a completely unlit shader, lights don't affect the visualization
    // But we keep ambient light for other potential objects in the scene
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    // Mouse controls
    let isRotating = false;
    let isPanning = false;
    let mouseX = 0, mouseY = 0;
    let selectionStartPos = null;

    const handleMouseDown = (e) => {
      if (selectionModeRef.current && e.button === 0) {
        // Start selection
        const rect = renderer.domElement.getBoundingClientRect();
        selectionStartPos = { x: e.clientX, y: e.clientY };
        setIsSelecting(true);
        setSelectionStart(selectionStartPos);
        setSelectionEnd(selectionStartPos);
      } else {
        if (e.button === 0) isRotating = true;
        if (e.button === 2) isPanning = true;
        mouseX = e.clientX;
        mouseY = e.clientY;
      }
    };

    const handleMouseUp = (e) => {
      if (selectionModeRef.current && selectionStartPos) {
        // Complete selection
        const endX = e.clientX;
        const endY = e.clientY;
        handleSelectionComplete(selectionStartPos.x, selectionStartPos.y, endX, endY);
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionEnd(null);
        selectionStartPos = null;
      } else {
        isRotating = false;
        isPanning = false;
      }
    };

    const handleMouseMove = (e) => {
      if (selectionModeRef.current && selectionStartPos) {
        // Update selection box
        setSelectionEnd({ x: e.clientX, y: e.clientY });
      } else {
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
      }
    };

    const handleWheel = (e) => {
      const state = cameraStateRef.current;
      state.distance *= (1 + e.deltaY * 0.001);
      state.distance = Math.max(0.1, Math.min(20, state.distance));
      updateCameraPosition();
      updateChannelLOD();
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
      renderScene();
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
      if (msaaRenderTargetRef.current) {
        msaaRenderTargetRef.current.setSize(width, height);
      }
      if (aaPassRef.current) {
        if (aaPassRef.current.setSize) {
          aaPassRef.current.setSize(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
        } else if (aaPassRef.current.material && aaPassRef.current.material.uniforms && aaPassRef.current.material.uniforms['resolution']) {
          aaPassRef.current.material.uniforms['resolution'].value.set(1 / width, 1 / height);
        }
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
      channelDataCacheRef.current.clear();
      channelConfigsRef.current.clear();
      lodStateRef.current = { lastSampling: null, lastUpdate: 0 };
      if (msaaRenderTargetRef.current) {
        msaaRenderTargetRef.current.dispose();
        msaaRenderTargetRef.current = null;
      }
      composerRef.current = null;
      aaPassRef.current = null;
      
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
    const channelDataCache = channelDataCacheRef.current;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Main_View: Updating channels`);
    console.log(`Main_View: Total channels: ${channels.length}, Visible: ${visibleChannels.length}`);
    console.log(`${'='.repeat(60)}\n`);

    // Clean up meshes for channels no longer present
    const activeChannelIndices = new Set(channels.map(c => c.channelIndex));
    loadedChannels.forEach((entry, channelIndex) => {
      if (!activeChannelIndices.has(channelIndex)) {
        const mesh = entry?.mesh;
        if (mesh && scene.children.includes(mesh)) {
          scene.remove(mesh);
        }
        if (mesh) {
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) mesh.material.dispose();
          const listIndex = pointCloudsRef.current.indexOf(mesh);
          if (listIndex !== -1) {
            pointCloudsRef.current.splice(listIndex, 1);
          }
        }
        loadedChannels.delete(channelIndex);
        channelDataCache.delete(channelIndex);
        console.log(`Main_View: 🗑️ Removed channel ${channelIndex} (no longer in selection)`);
      }
    });

    // Update visibility for existing channels (already loaded)
    const configMap = channelConfigsRef.current;
    configMap.clear();
    channels.forEach(channelConfig => {
      const channelIndex = channelConfig.channelIndex;
      configMap.set(channelIndex, channelConfig);
      const entry = loadedChannels.get(channelIndex);
      const mesh = entry ? entry.mesh : null;
      
      if (mesh) {
        // Channel already loaded, just update visibility based on checkbox state
        if (channelConfig.visible !== false) {
          // Checkbox is checked - should be visible
          if (!scene.children.includes(mesh)) {
            scene.add(mesh);
            console.log(`Main_View: ✅ Channel ${channelIndex} turned ON (checkbox checked)`);
            // Force renderer update
            renderScene();
          }
        } else {
          // Checkbox is unchecked - should be hidden
          if (scene.children.includes(mesh)) {
            scene.remove(mesh);
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
            channelDataCacheRef.current.set(channelConfig.channelIndex, channelData);
            const desiredSampling = getDesiredSampling(cameraStateRef.current?.distance || 3);
            const addToScene = channelConfig.visible !== false;
            const result = createChannelVisualization(channelData, channelConfig, scene, {
              samplingOverride: desiredSampling,
              addToScene
            });
            if (result) {
              const { mesh, sampling } = result;
              // Store in map (even if not visible, so we can quickly add it later)
              loadedChannels.set(channelConfig.channelIndex, { mesh, sampling, lastRequestedSampling: desiredSampling });
              lodStateRef.current.lastSampling = sampling;
              pointCloudsRef.current.push(mesh);
              
              if (addToScene) {
                if (!scene.children.includes(mesh)) {
                  scene.add(mesh);
                }
                console.log(`Main_View:  Channel ${channelConfig.channelIndex} (color: ${channelConfig.color}) added to scene with sampling=${sampling}`);
              } else {
                if (scene.children.includes(mesh)) {
                  scene.remove(mesh);
                }
                console.log(`Main_View: ⚠️ Channel ${channelConfig.channelIndex} loaded but not added (checkbox unchecked, sampling=${sampling})`);
              }
              
              // Force renderer to update
              renderScene();
            } else {
              console.warn(`Main_View: ⚠️ Channel ${channelConfig.channelIndex} visualization creation returned null (no voxels created)`);
            }
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
        const entry = loadedChannels.get(c.channelIndex);
        return entry && entry.mesh && scene.children.includes(entry.mesh);
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
      
      {/* Selection Mode Toggle Button */}
      <button
        onClick={() => setSelectionMode(!selectionMode)}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 1000,
          padding: '8px 16px',
          backgroundColor: selectionMode ? '#4CAF50' : '#555',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 'bold',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
          transition: 'background-color 0.2s'
        }}
        title={selectionMode ? 'Click to disable selection mode' : 'Click to enable selection mode'}
      >
        {selectionMode ? '✓ Selection Mode' : 'Selection Box'}
      </button>
      
      {/* Selection Box Overlay */}
      {isSelecting && selectionStart && selectionEnd && rendererRef.current && mountRef.current && (() => {
        const rect = rendererRef.current.domElement.getBoundingClientRect();
        const containerRect = mountRef.current.getBoundingClientRect();
        
        const startX = Math.min(selectionStart.x, selectionEnd.x);
        const startY = Math.min(selectionStart.y, selectionEnd.y);
        const width = Math.abs(selectionEnd.x - selectionStart.x);
        const height = Math.abs(selectionEnd.y - selectionStart.y);
        
        // Convert window coordinates to container-relative coordinates
        const left = startX - containerRect.left;
        const top = startY - containerRect.top;
        
        return (
          <div
            style={{
              position: 'absolute',
              border: '2px solid #00ff00',
              backgroundColor: 'rgba(0, 255, 0, 0.1)',
              pointerEvents: 'none',
              zIndex: 999,
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`
            }}
          />
        );
      })()}
    </div>
  );
};

export default Main_View;
