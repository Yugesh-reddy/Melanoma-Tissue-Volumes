import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { loadChannelData } from '../hooks/useChannelData';

const OPACITY_FLOOR = 0.35;
const OPACITY_BOOST = 1.3;
const EDGE_FEATHER = 0.99;
const JITTER_SCALE = 0.1;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Component for rendering a single local view
const LocalViewContent = ({ selectedRegionData, channels = [] }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const animationRef = useRef(null);
  const voxelMeshesRef = useRef([]);
  const boundingBoxRef = useRef(null);
  const axesHelperRef = useRef(null);

  // State for UI display
  const [cellCount, setCellCount] = useState(0);
  const [showInfoModal, setShowInfoModal] = useState(false);

  // Debug: Log props changes
  useEffect(() => {
    console.log('LocalViewContent: Props received - selectedRegionData:', selectedRegionData);
    console.log('LocalViewContent: Props received - channels:', channels);
  }, [selectedRegionData, channels]);

  // Camera state for local view (super zoomed)
  const cameraStateRef = useRef({
    rotation: { x: 0.5, y: 0.5 },
    distance: 0.3, // Much closer for super zoom
    panOffset: { x: 0, y: 0, z: 0 }
  });

  // Store initial camera state for reset
  const initialCameraStateRef = useRef(null);

  // Ref for debouncing channel updates
  const updateTimeoutRef = useRef(null);

  // Load channel data using utility
  // Note: loadChannelData is now imported from hooks/useChannelData

  // Create voxel visualization for a channel region (similar to Main_View but for selected region)
  // Uses scaling factors from Main_View to maintain exact 3D positions
  // centerOffset: offset to center geometry at origin (0,0,0) without scaling
  const createRegionVisualization = (channelData, channelConfig, bounds, scene, scalingFactors = null, centerOffset = null) => {
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

    // Use scaling factors from Main_View if provided, otherwise calculate them
    // This ensures exact 3D position matching between Main_View and Local_View
    let scaleX, scaleY, scaleZ;
    if (scalingFactors) {
      scaleX = scalingFactors.scaleX;
      scaleY = scalingFactors.scaleY;
      scaleZ = scalingFactors.scaleZ;
      console.log(`Local_View: Using scaling factors from Main_View: scaleX=${scaleX}, scaleY=${scaleY}, scaleZ=${scaleZ}`);
    } else {
      const maxDim = Math.max(zSize, ySize, xSize);
      scaleX = xSize / maxDim;
      scaleY = ySize / maxDim;
      scaleZ = (zSize / maxDim) / 4;
      console.log(`Local_View: Calculated scaling factors: scaleX=${scaleX}, scaleY=${scaleY}, scaleZ=${scaleZ}`);
    }

    // Extract region within bounds (use sampling=1 for maximum detail in local view)
    const voxelSampling = 1;
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

    // CRITICAL: Calculate step sizes BEFORE the loop so they can be used for jitter
    // Use EXACT same voxel step size calculation as Main_View
    // This ensures 1:1 spatial scale matching - NO additional scaling!
    const stepX = (2 / xSize) * scaleX * Math.max(1, voxelSampling);
    const stepY = (2 / ySize) * scaleY * Math.max(1, voxelSampling);
    const stepZ = (2 / zSize) * scaleZ * Math.max(1, voxelSampling);

    console.log(`Local_View: Voxel step sizes (1:1 with Main_View): X=${stepX.toFixed(6)}, Y=${stepY.toFixed(6)}, Z=${stepZ.toFixed(6)}`);
    console.log(`Local_View: Using sampling=${voxelSampling} (full resolution)`);

    for (let z = voxelMinZ; z <= voxelMaxZ; z += voxelSampling) {
      for (let y = voxelMinY; y <= voxelMaxY; y += voxelSampling) {
        for (let x = voxelMinX; x <= voxelMaxX; x += voxelSampling) {
          const idx = z * ySize * xSize + y * xSize + x;
          if (idx >= data.length) {
            console.warn(`Local_View: Index ${idx} out of bounds (data length: ${data.length})`);
            continue;
          }

          const normalizedValue = data[idx];
          const actualValue = (normalizedValue / 255) * (dataMax - dataMin) + dataMin;

          if (actualValue >= minThreshold && actualValue <= maxThreshold) {
            thresholdPassCount++;
            // Use EXACT same coordinate calculation as Main_View
            // This ensures 1:1 spatial position matching
            // Fix Mirror Image: Invert X axis to match Main_View's coordinate system
            let nx = ((x / xSize) * 2 - 1) * scaleX;
            let ny = ((y / ySize) * 2 - 1) * scaleY;
            let nz = ((z / zSize) * 2 - 1) * scaleZ;

            nx = -nx; // Flip X to fix mirror image

            // Apply jitter to match Main_View visual style (reduces aliasing/moire)
            const jitterX = (Math.random() - 0.5) * stepX * JITTER_SCALE;
            const jitterY = (Math.random() - 0.5) * stepY * JITTER_SCALE;
            const jitterZ = (Math.random() - 0.5) * stepZ * JITTER_SCALE;

            // Apply center offset to center geometry at origin (0,0,0) without scaling
            if (centerOffset) {
              nx -= centerOffset.x;
              ny -= centerOffset.y;
              nz -= centerOffset.z;
            }

            points.push(nx + jitterX, ny + jitterY, nz + jitterZ);

            // Match Main_View opacity calculation EXACTLY
            const thresholdSpan = Math.max(1, maxThreshold - minThreshold);
            const normalizedOpacity = (actualValue - minThreshold) / thresholdSpan;
            const scaledOpacity = clamp(normalizedOpacity, 0, 1);
            const finalOpacity = OPACITY_FLOOR + (1 - OPACITY_FLOOR) * scaledOpacity * OPACITY_BOOST;

            opacities.push(clamp(finalOpacity, OPACITY_FLOOR, 1));
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

    // Step sizes already calculated above
    // const stepX = ...
    // const stepY = ...
    // const stepZ = ...

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
        edgeFeather: { value: EDGE_FEATHER }
      },
      vertexShader: `
        attribute vec3 instanceOffset;
        attribute float instanceOpacity;
        varying float vOpacity;
        varying vec3 vLocalPos;
        void main() {
          vOpacity = instanceOpacity;
          vec3 transformed = position + instanceOffset;
          vLocalPos = position;
          vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float edgeFeather;
        varying float vOpacity;
        varying vec3 vLocalPos;
        void main() {
          float base = clamp(vOpacity, 0.0, 1.0);
          float edge = max(max(abs(vLocalPos.x), abs(vLocalPos.y)), abs(vLocalPos.z));
          float edgeFade = smoothstep(0.5 - edgeFeather, 0.5, edge);
          base *= (1.0 - edgeFade);
          if (base <= 0.01) discard;
          
          // Match Main_View color processing
          vec3 finalColor = pow(color, vec3(0.55));
          
          // Additive blending expects pre-multiplied alpha
          gl_FragColor = vec4(finalColor * base, base);
        }
      `,
      transparent: true,
      depthWrite: false, // Disable depth write for additive blending
      depthTest: false,  // Disable depth test to see through volume
      blending: THREE.AdditiveBlending
    });

    const mesh = new THREE.Mesh(geometry, voxelMaterial);
    mesh.frustumCulled = false;
    mesh.userData = { channelIndex: channelConfig.channelIndex };

    return mesh;
  };

  // Update camera position - use useCallback to ensure it's stable
  const updateCameraPosition = useCallback(() => {
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
  }, []);

  // Update lighting based on camera direction - NO OP for unlit shader
  const updateLighting = useCallback(() => {
    // No lighting to update
  }, []);

  // Create visualization from selected region data
  // channelsOverride: optional array of current channel configs to use instead of stored channels
  const createLocalVisualization = async (selectedData, channelsOverride = null) => {
    if (!sceneRef.current || !selectedData || !selectedData.bounds) {
      console.log('Local_View: Invalid selected data', selectedData);
      return;
    }

    // Use current channels (channelsOverride) as the source of truth
    // This ensures that any globally selected/visible channel is shown in the local view,
    // regardless of whether it was active when the region was originally selected.
    // CRITICAL: Always prefer channelsOverride (live state) over selectedData.channels (stale state)
    let channelsToUse = channelsOverride && channelsOverride.length > 0 ? channelsOverride : selectedData.channels;

    // If no current channels provided (shouldn't happen in normal flow), fallback to stored channels
    if (!channelsToUse || channelsToUse.length === 0) {
      console.log('Local_View: No current channels provided, falling back to stored channels');
      channelsToUse = selectedData.channels || [];
    }

    console.log(`Local_View: Using ${channelsToUse.length} channel(s) for visualization`);

    if (channelsToUse.length === 0) {
      console.log('Local_View: No channels available');
      // Clear scene if no channels
      voxelMeshesRef.current.forEach(mesh => {
        sceneRef.current.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      });
      voxelMeshesRef.current = [];
      setCellCount(0);
      return;
    }

    // Filter to only visible channels
    const visibleChannels = channelsToUse.filter(c => c.visible !== false);
    if (visibleChannels.length === 0) {
      console.log('Local_View: No visible channels');
      // Clear scene if no visible channels
      voxelMeshesRef.current.forEach(mesh => {
        sceneRef.current.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      });
      voxelMeshesRef.current = [];
      setCellCount(0);
      return;
    }

    console.log('Local_View: Creating visualization for selected region', selectedData);
    console.log(`Local_View: Using ${visibleChannels.length} visible channel(s) (${channelsOverride ? 'current' : 'stored'} channels)`);

    const scene = sceneRef.current;

    // Clear existing meshes
    // Clear existing meshes - ROBUST CLEANUP
    // Iterate backwards to safely remove
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const child = scene.children[i];
      // Remove meshes and helpers, but keep lights
      if (child.isMesh || child.isLineSegments || child.isAxesHelper) {
        scene.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      }
    }
    voxelMeshesRef.current = [];
    boundingBoxRef.current = null;
    axesHelperRef.current = null;

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

    const { bounds, scaling } = selectedData;

    // Find a reference channel with loaded data to calculate bounding box
    let referenceChannelConfig = null;
    let referenceData = null;

    for (const channelConfig of visibleChannels) {
      try {
        const data = await loadChannelData(channelConfig.channelIndex);
        if (data) {
          referenceChannelConfig = channelConfig;
          referenceData = data;
          break; // Found a valid reference
        }
      } catch (err) {
        console.warn(`Local_View: Failed to load channel ${channelConfig.channelIndex} for reference`, err);
      }
    }

    if (!referenceData) {
      console.warn('Local_View: Failed to load data for ANY visible channel - cannot create visualization');
      return;
    }

    const { metadata: firstMetadata } = referenceData;
    const [zSize, ySize, xSize] = firstMetadata.shape;

    // Use scaling factors from Main_View if available to maintain exact 3D positions
    let scaleXData, scaleYData, scaleZData;
    if (scaling) {
      scaleXData = scaling.scaleX;
      scaleYData = scaling.scaleY;
      scaleZData = scaling.scaleZ;
      console.log('Local_View: Using scaling factors from Main_View for bounding box');
    } else {
      const maxDimData = Math.max(zSize, ySize, xSize);
      scaleXData = xSize / maxDimData;
      scaleYData = ySize / maxDimData;
      scaleZData = (zSize / maxDimData) / 4;
      console.log('Local_View: Calculated scaling factors for bounding box');
    }

    // Calculate bounding box size in normalized coordinates
    const boundsWidth = bounds.max.x - bounds.min.x + 1;
    const boundsHeight = bounds.max.y - bounds.min.y + 1;
    const boundsDepth = bounds.max.z - bounds.min.z + 1;

    // Calculate center in normalized coordinates (same as Main_View)
    const boundsCenterX = (bounds.min.x + bounds.max.x) / 2;
    const boundsCenterY = (bounds.min.y + bounds.max.y) / 2;
    const boundsCenterZ = (bounds.min.z + bounds.max.z) / 2;

    const boxCenter = {
      x: -((boundsCenterX / xSize) * 2 - 1) * scaleXData, // Flip X center too
      y: ((boundsCenterY / ySize) * 2 - 1) * scaleYData,
      z: ((boundsCenterZ / zSize) * 2 - 1) * scaleZData
    };

    // Calculate bounding box size in normalized space (exact same calculation as Main_View)
    const boxSize = {
      x: (boundsWidth / xSize) * 2 * scaleXData,
      y: (boundsHeight / ySize) * 2 * scaleYData,
      z: (boundsDepth / zSize) * 2 * scaleZData
    };

    console.log('Local_View: Bounding box center', boxCenter, 'size', boxSize);
    console.log('Local_View: Bounds dimensions (voxels)', boundsWidth, boundsHeight, boundsDepth);
    console.log('Local_View: Using exact same scaling as Main_View - maintaining 1:1 spatial scale');

    const boxGeometry = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
    const boxEdges = new THREE.EdgesGeometry(boxGeometry);
    const boxMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
    const boxWireframe = new THREE.LineSegments(boxEdges, boxMaterial);
    boxWireframe.position.set(boxCenter.x, boxCenter.y, boxCenter.z);
    scene.add(boxWireframe);
    boundingBoxRef.current = boxWireframe;

    // Create voxel meshes for each channel
    // Pass scaling factors to maintain exact 3D positions
    let meshCount = 0;
    let totalCellCount = 0;

    // Calculate center offset BEFORE creating meshes so we can adjust positions
    // Use the same center calculation as boxCenter
    const centerOffset = {
      x: boxCenter.x,
      y: boxCenter.y,
      z: boxCenter.z
    };

    console.log(`Local_View: Center offset to apply: (${centerOffset.x.toFixed(4)}, ${centerOffset.y.toFixed(4)}, ${centerOffset.z.toFixed(4)})`);

    console.log(`Local_View: Processing ${visibleChannels.length} visible channel(s)`);
    for (const channelConfig of visibleChannels) {
      try {
        console.log(`Local_View: Loading channel ${channelConfig.channelIndex}...`);
        const channelData = await loadChannelData(channelConfig.channelIndex);
        if (!channelData) {
          console.warn(`Local_View: Failed to load channel ${channelConfig.channelIndex}`);
          continue;
        }
        console.log(`Local_View: Channel ${channelConfig.channelIndex} loaded, creating visualization...`);

        const mesh = createRegionVisualization(channelData, channelConfig, bounds, scene, scaling, centerOffset);
        if (mesh) {
          console.log(`Local_View: Mesh created for channel ${channelConfig.channelIndex}, adding to scene...`);

          // Ensure mesh is visible and properly configured
          mesh.visible = true;
          mesh.frustumCulled = false;

          scene.add(mesh);
          voxelMeshesRef.current.push(mesh);
          meshCount++;
          totalCellCount += mesh.geometry.instanceCount;
          console.log(`Local_View: ✓ Added mesh for channel ${channelConfig.channelIndex} with ${mesh.geometry.instanceCount} instances`);
          console.log(`Local_View: Mesh position:`, mesh.position);
          console.log(`Local_View: Mesh visible:`, mesh.visible);
          console.log(`Local_View: Mesh in scene:`, scene.children.includes(mesh));
        } else {
          console.warn(`Local_View: ✗ No mesh created for channel ${channelConfig.channelIndex} (no points in bounds)`);
        }
      } catch (error) {
        console.error(`Local_View: Error processing channel ${channelConfig.channelIndex}:`, error);
        console.error(`Local_View: Error stack:`, error.stack);
      }
    }

    // Store cell count for UI display
    setCellCount(totalCellCount);

    console.log(`Local_View: Created ${meshCount} meshes`);

    // Add coordinate axes helper - scale based on bounding box size
    const axesSize = Math.max(boxSize.x, boxSize.y, boxSize.z) * 0.3;
    const axesHelper = new THREE.AxesHelper(axesSize);
    axesHelper.position.set(boxCenter.x, boxCenter.y, boxCenter.z);
    scene.add(axesHelper);
    axesHelperRef.current = axesHelper;

    // Geometry is already centered at origin (0,0,0) via centerOffset applied during creation
    // Center bounding box and axes helper at origin
    if (boundingBoxRef.current) {
      boundingBoxRef.current.position.set(0, 0, 0);
    }

    if (axesHelperRef.current) {
      axesHelperRef.current.position.set(0, 0, 0);
    }

    // Set camera to look at origin (where geometry is centered)
    cameraStateRef.current.panOffset = { x: 0, y: 0, z: 0 };

    // Calculate camera distance based on ACTUAL cuboid dimensions (not auto-fit)
    // Use the maximum dimension of the bounding box to determine appropriate distance
    const maxDimension = Math.max(Math.abs(boxSize.x), Math.abs(boxSize.y), Math.abs(boxSize.z));

    // Ensure we have a valid dimension
    if (maxDimension > 0 && Number.isFinite(maxDimension)) {
      // Calculate camera distance to show the cuboid with appropriate padding
      // Formula: distance = (maxDimension / 2) / tan(fov/2) * paddingFactor
      const fovRad = (60 * Math.PI) / 180; // Camera FOV in radians
      const paddingFactor = 2.0; // Increased padding for better view
      const baseDistance = (maxDimension / 2) / Math.tan(fovRad / 2);
      cameraStateRef.current.distance = baseDistance * paddingFactor;

      // Clamp distance to reasonable bounds
      cameraStateRef.current.distance = Math.max(0.1, Math.min(10.0, cameraStateRef.current.distance));
    } else {
      // Fallback to a reasonable default distance
      // console.warn('Local_View: Invalid maxDimension, using default camera distance');
      cameraStateRef.current.distance = 0.5;
    }

    // Reset camera rotation to a good viewing angle
    cameraStateRef.current.rotation = { x: 0.5, y: 0.5 };

    console.log(`Local_View: Geometry centered at origin (offset: ${centerOffset.x.toFixed(4)}, ${centerOffset.y.toFixed(4)}, ${centerOffset.z.toFixed(4)})`);
    console.log(`Local_View: Camera distance: ${cameraStateRef.current.distance.toFixed(4)} (based on max dimension: ${maxDimension.toFixed(4)})`);

    // Store initial camera state for reset functionality
    initialCameraStateRef.current = {
      rotation: { ...cameraStateRef.current.rotation },
      distance: cameraStateRef.current.distance,
      panOffset: { ...cameraStateRef.current.panOffset }
    };

    updateCameraPosition();
    updateLighting();

    // Force multiple renders to ensure visualization is displayed immediately
    if (rendererRef.current && cameraRef.current && sceneRef.current) {
      // Update camera and lighting first
      updateCameraPosition();
      updateLighting();

      // Render immediately
      rendererRef.current.render(sceneRef.current, cameraRef.current);

      // Also render on next frame to ensure it's visible
      requestAnimationFrame(() => {
        if (rendererRef.current && cameraRef.current && sceneRef.current) {
          updateCameraPosition();
          updateLighting();
          rendererRef.current.render(sceneRef.current, cameraRef.current);

          // One more render after a short delay to ensure everything is displayed
          setTimeout(() => {
            if (rendererRef.current && cameraRef.current && sceneRef.current) {
              rendererRef.current.render(sceneRef.current, cameraRef.current);
            }
          }, 50);
        }
      });
    }

    console.log('Local_View: Camera positioned at distance', cameraStateRef.current.distance, 'looking at', boxCenter);
    console.log(`Local_View: Visualization complete - ${meshCount} meshes added to scene, ${totalCellCount} total cells`);
    console.log(`Local_View: Scene children count: ${sceneRef.current.children.length}`);
    console.log(`Local_View: Voxel meshes count: ${voxelMeshesRef.current.length}`);
    console.log(`Local_View: Renderer exists:`, !!rendererRef.current);
    console.log(`Local_View: Camera exists:`, !!cameraRef.current);

    // Log mesh details for debugging
    voxelMeshesRef.current.forEach((mesh, idx) => {
      console.log(`Local_View: Mesh ${idx}: visible=${mesh.visible}, position=`, mesh.position, `instances=${mesh.geometry.instanceCount}, inScene=${sceneRef.current.children.includes(mesh)}`);
    });

    // Verify renderer is working
    if (rendererRef.current && rendererRef.current.domElement) {
      console.log(`Local_View: Renderer canvas size: ${rendererRef.current.domElement.width}x${rendererRef.current.domElement.height}`);
      console.log(`Local_View: Renderer canvas visible:`, rendererRef.current.domElement.offsetWidth > 0 && rendererRef.current.domElement.offsetHeight > 0);
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

    // Ensure canvas is visible and properly styled
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';

    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    console.log('Local_View: Renderer initialized, canvas size:', width, 'x', height);
    console.log('Local_View: Canvas element:', renderer.domElement);
    console.log('Local_View: Canvas visible:', renderer.domElement.offsetWidth > 0 && renderer.domElement.offsetHeight > 0);

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

    // Animation loop - ensure it always renders
    const animate = () => {
      if (cameraRef.current && sceneRef.current && rendererRef.current) {
        try {
          updateLighting();
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        } catch (err) {
          console.error('Local_View: Error in animation loop:', err);
        }
      }
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();

    // Initial render to ensure something is displayed
    console.log('Local_View: Scene initialized, rendering initial frame');
    console.log('Local_View: Scene children:', scene.children.length);
    console.log('Local_View: Camera position:', camera.position);
    console.log('Local_View: Camera distance:', cameraStateRef.current.distance);

    if (cameraRef.current && sceneRef.current && rendererRef.current) {
      try {
        updateCameraPosition();
        updateLighting();
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      } catch (err) {
        console.error('Local_View: Error in initial render:', err);
      }
    }

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

      // Clear refs
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [updateCameraPosition, updateLighting]);

  // Combined effect to handle both selectedRegionData and channels changes
  // This ensures Local_View always shows the exact same thing as Main_View
  useEffect(() => {
    // Clear any pending updates
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }

    // If no selection, clear visualization
    if (!selectedRegionData || !selectedRegionData.bounds) {
      console.log('Local_View: No selected region data, clearing visualization');
      if (sceneRef.current) {
        voxelMeshesRef.current.forEach(mesh => {
          sceneRef.current.remove(mesh);
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) mesh.material.dispose();
        });
        voxelMeshesRef.current = [];
        setCellCount(0);
      }
      return;
    }

    // Determine which channels to use - ALWAYS prefer current channels if available
    // Current channels have the latest filter settings that match Main_View
    // Match current channels to selected channels by channelIndex to ensure we only show channels from the original selection
    let channelsToUse = [];

    if (channels && channels.length > 0 && selectedRegionData.channels && selectedRegionData.channels.length > 0) {
      // Match current channels to selected channels by channelIndex
      const selectedChannelIndices = new Set(selectedRegionData.channels.map(c => c.channelIndex));
      console.log('Local_View: Selected channel indices:', Array.from(selectedChannelIndices));
      console.log('Local_View: Current channel indices:', channels.map(c => c.channelIndex));

      channelsToUse = channels.filter(c => selectedChannelIndices.has(c.channelIndex));
      console.log(`Local_View: Matched ${channelsToUse.length} current channel(s) to selection`);

      // Fallback to stored channels if no matches
      if (channelsToUse.length === 0) {
        console.warn('Local_View: No current channels matched, using stored channels');
        channelsToUse = selectedRegionData.channels || [];
      }
    } else {
      // Use stored channels if current channels not available
      channelsToUse = (channels && channels.length > 0) ? channels : (selectedRegionData.channels || []);
      console.log(`Local_View: Using ${channelsToUse.length} ${(channels && channels.length > 0) ? 'current' : 'stored'} channel(s)`);
    }

    if (!channelsToUse || channelsToUse.length === 0) {
      console.log('Local_View: No channels available, waiting...');
      return;
    }

    console.log('Local_View: Updating visualization');
    console.log(`Local_View: Using ${channelsToUse.length} channel(s) - ${(channels && channels.length > 0) ? 'current' : 'stored'}`);
    console.log('Local_View: SelectedRegionData:', selectedRegionData);
    console.log('Local_View: Channels:', channelsToUse);

    // Retry mechanism if scene isn't ready yet
    const tryCreateVisualization = (retries = 10) => {
      if (!sceneRef.current || !rendererRef.current || !cameraRef.current) {
        if (retries > 0) {
          console.warn(`Local_View: Scene/renderer not initialized yet, retrying... (${retries} retries left)`);
          setTimeout(() => tryCreateVisualization(retries - 1), 200);
          return;
        } else {
          console.error('Local_View: Scene/renderer not initialized after retries');
          return;
        }
      }

      console.log('Local_View: Creating visualization now...');
      createLocalVisualization(selectedRegionData, channelsToUse).catch(error => {
        console.error('Local_View: Error creating visualization:', error);
        console.error('Local_View: Error stack:', error.stack);
      });
    };

    // Small delay to ensure state is settled, then try to create visualization
    updateTimeoutRef.current = setTimeout(() => {
      tryCreateVisualization();
    }, 100);

    // Cleanup timeout on unmount or when dependencies change
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
    };
  }, [selectedRegionData, channels]); // Watch both - this ensures updates when either changes

  // Close info modal when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showInfoModal) {
        const modal = document.getElementById('info-modal');
        const infoButton = event.target.closest('button');
        // Check if click is outside modal and not on the info button
        if (modal && !modal.contains(event.target)) {
          // Check if clicked button is the info button (ⓘ)
          if (!infoButton || !infoButton.textContent.includes('ⓘ')) {
            setShowInfoModal(false);
          }
        }
      }
    };

    if (showInfoModal) {
      // Use setTimeout to avoid immediate closure when clicking the button
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showInfoModal]);

  // Reset camera view to initial position with visual feedback
  const resetView = () => {
    if (initialCameraStateRef.current) {
      // Add visual feedback - briefly highlight button
      const button = document.getElementById('reset-view-btn');
      if (button) {
        button.style.transform = 'scale(0.95)';
        button.style.backgroundColor = '#4CAF50';
        setTimeout(() => {
          button.style.transform = 'scale(1)';
          button.style.backgroundColor = '#555';
        }, 150);
      }

      // Reset camera state
      cameraStateRef.current.rotation = { ...initialCameraStateRef.current.rotation };
      cameraStateRef.current.distance = initialCameraStateRef.current.distance;
      cameraStateRef.current.panOffset = { ...initialCameraStateRef.current.panOffset };
      updateCameraPosition();
      updateLighting();

      console.log('Local_View: Camera reset to initial position');
    }
  };

  // Calculate section depth and volume from selected region data
  const getSectionInfo = () => {
    if (!selectedRegionData || !selectedRegionData.bounds) return null;

    const bounds = selectedRegionData.bounds;
    const widthVoxels = bounds.max.x - bounds.min.x + 1;
    const heightVoxels = bounds.max.y - bounds.min.y + 1;
    const depthVoxels = bounds.max.z - bounds.min.z + 1;

    // Estimate physical size (assuming 1 µm per voxel, adjust based on your data)
    const voxelSize = 1; // µm per voxel (adjust as needed)
    const widthMicrons = widthVoxels * voxelSize;
    const heightMicrons = heightVoxels * voxelSize;
    const depthMicrons = depthVoxels * voxelSize;
    const volumeMicrons3 = widthMicrons * heightMicrons * depthMicrons;

    return {
      width: Math.round(widthMicrons),
      height: Math.round(heightMicrons),
      depth: Math.round(depthMicrons),
      volume: Math.round(volumeMicrons3)
    };
  };

  const sectionInfo = getSectionInfo();

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
      {/* Info Button - Floating in top right */}
      {selectedRegionData && sectionInfo && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowInfoModal(!showInfoModal);
          }}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            zIndex: 100,
            background: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            cursor: 'pointer',
            color: '#fff',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            transition: 'all 0.2s',
            lineHeight: '1'
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'rgba(74, 222, 128, 0.3)';
            e.target.style.borderColor = '#4ade80';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'rgba(0,0,0,0.6)';
            e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
          }}
          title="Show selection information"
        >
          ⓘ
        </button>
      )}

      {/* Info Modal */}
      {selectedRegionData && sectionInfo && showInfoModal && (
        <div
          id="info-modal"
          style={{
            position: 'absolute',
            top: '40px',
            left: '10px',
            backgroundColor: 'rgba(20, 20, 20, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '6px',
            padding: '12px',
            zIndex: 1000,
            fontSize: '12px',
            fontFamily: 'monospace',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            minWidth: '200px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{
            fontWeight: 'bold',
            marginBottom: '8px',
            fontSize: '13px',
            color: '#fff',
            borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
            paddingBottom: '6px'
          }}>
            3D Selection Info
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 0', gap: '16px' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Dimensions (μm³):</span>
            <span style={{ color: '#4ade80', fontWeight: '500' }}>
              {sectionInfo.width} × {sectionInfo.height} × {sectionInfo.depth}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 0', gap: '16px' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Volume:</span>
            <span style={{ color: '#4ade80', fontWeight: '500' }}>
              {sectionInfo.volume.toLocaleString()} μm³
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 0', gap: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.2)', paddingTop: '6px' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Cells:</span>
            <span style={{ color: '#4ade80', fontWeight: '500' }}>
              {cellCount.toLocaleString()}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 0', gap: '16px' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Scale:</span>
            <span style={{ color: '#4ade80', fontWeight: '500', fontStyle: 'italic' }}>
              1:1 with main view
            </span>
          </div>
        </div>
      )}

      {/* Reset View Button - Consistent with Region_Selection */}
      {selectedRegionData && (
        <button
          id="reset-view-btn"
          onClick={resetView}
          style={{
            position: 'absolute',
            bottom: '10px',
            right: '10px',
            zIndex: 100,
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#fff',
            background: '#2d7ff9',
            border: '1px solid #2d7ff9',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            outline: 'none'
          }}
          onMouseEnter={(e) => {
            e.target.style.background = '#4a90ff';
            e.target.style.borderColor = '#4a90ff';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = '#2d7ff9';
            e.target.style.borderColor = '#2d7ff9';
          }}
          title="Reset camera view to initial position"
        >
          Reset
        </button>
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

// Main wrapper component with tabs support - UI similar to Graph Panel
const Local_View = ({ selectedRegionsData, selectedRegionData, channels = [], onRemoveSelection, onClearAllSelections }) => {
  // Support both array and single selection for backward compatibility
  const regionsArray = selectedRegionsData || (selectedRegionData ? [selectedRegionData] : []);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [closedTabIds, setClosedTabIds] = useState(new Set());

  // Create mapping from region to regionId for consistent identification
  const regionIdMap = useMemo(() => {
    const map = new Map();
    regionsArray.forEach((region, index) => {
      const regionId = region.id || index;
      map.set(region, regionId);
    });
    return map;
  }, [regionsArray]);

  // Filter out closed tabs
  const visibleRegions = useMemo(() => {
    return regionsArray.filter((region) => {
      const regionId = regionIdMap.get(region);
      return regionId !== undefined && !closedTabIds.has(regionId);
    });
  }, [regionsArray, closedTabIds, regionIdMap]);

  // Debug: Log regions array
  useEffect(() => {
    console.log('Local_View: regionsArray length:', regionsArray.length);
  }, [regionsArray]);

  // Update active tab when new selection is added
  useEffect(() => {
    if (visibleRegions.length > 0) {
      // Set active tab to the newest selection (last in visible array)
      const newIndex = visibleRegions.length - 1;
      setActiveTabIndex(newIndex);
    }
  }, [visibleRegions.length]);

  // Handle closing a tab
  const handleCloseTab = (e, region) => {
    e.stopPropagation(); // Prevent tab activation when clicking close button
    
    const regionId = regionIdMap.get(region);
    if (regionId === undefined) return;
    
    // Find current visible index of this tab
    const currentVisibleIndex = visibleRegions.findIndex(r => {
      const rId = regionIdMap.get(r);
      return rId === regionId;
    });
    
    // Adjust active tab index if we're closing the active tab
    if (activeTabIndex === currentVisibleIndex) {
      const remainingCount = visibleRegions.length - 1;
      if (remainingCount > 0) {
        // Switch to the previous tab, or stay at the same index if it becomes the last
        const newIndex = Math.min(currentVisibleIndex, remainingCount - 1);
        setActiveTabIndex(newIndex);
      }
    } else if (activeTabIndex > currentVisibleIndex) {
      // If we're closing a tab before the active one, decrease the active index
      setActiveTabIndex(prev => prev - 1);
    }
    
    // Add to closed tabs
    setClosedTabIds(prev => new Set([...prev, regionId]));
    
    // Notify parent to remove the region (which will also remove the box in Main View)
    if (onRegionRemove) {
      onRegionRemove(regionId);
    }
  };

  // Ensure activeTabIndex is valid
  useEffect(() => {
    if (activeTabIndex >= regionsArray.length && regionsArray.length > 0) {
      setActiveTabIndex(regionsArray.length - 1);
    }
  }, [activeTabIndex, regionsArray.length]);

  // Handle removing a selection
  const handleRemoveTab = (e, selectionId, index) => {
    e.stopPropagation();
    if (onRemoveSelection) {
      onRemoveSelection(selectionId);
      // Adjust active tab if needed
      if (index <= activeTabIndex && activeTabIndex > 0) {
        setActiveTabIndex(activeTabIndex - 1);
      }
    }
  };

  // Selection colors fallback (synced with App.jsx)
  const SELECTION_COLORS = [
    '#4ade80', '#60a5fa', '#f472b6', '#facc15', '#a78bfa',
    '#fb923c', '#22d3d8', '#f87171', '#84cc16', '#e879f9'
  ];
  const getSelectionColorFallback = (index) => SELECTION_COLORS[index % SELECTION_COLORS.length];

  // Header component (shared between empty and filled states)
  const Header = () => (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 12px',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      flexShrink: 0,
      zIndex: 10
    }}>
      {/* Title with composite glyph */}
      <h3 style={{
        margin: 0,
        fontSize: '14px',
        color: 'white',
        fontWeight: '500',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0
      }}>
        {/* Composite Glyph: Magnifying glass + 3D Cube */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 0 3px rgba(74, 222, 128, 0.5))' }}>
          <path d="M12 2L4 6v8l8 4 8-4V6l-8-4z" stroke="#4ade80" strokeWidth="1.5" fill="rgba(74, 222, 128, 0.15)" />
          <path d="M4 6l8 4 8-4M12 10v8" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="17" cy="17" r="4" stroke="#fff" strokeWidth="1.5" fill="rgba(0,0,0,0.5)" />
          <line x1="20" y1="20" x2="23" y2="23" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span style={{ color: '#4ade80' }}>Local View</span>
      </h3>

      {/* Tabs/Toggle buttons - same line as title */}
      {regionsArray.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px',
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
          maxWidth: '60%',
          overflowX: 'auto',
          overflowY: 'hidden'
        }}>
          {regionsArray.map((region, index) => {
            // Use selection color from region data, or fallback to index-based color
            const selectionColor = region.color || getSelectionColorFallback(index);
            const isActive = activeTabIndex === index;
            
            return (
              <div
                key={region.id || index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  background: isActive ? `${selectionColor}33` : 'transparent', // 33 = 20% opacity in hex
                  borderRadius: '3px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  border: isActive ? `1px solid ${selectionColor}` : '1px solid transparent'
                }}
                onClick={() => setActiveTabIndex(index)}
              >
                {/* Box indicator - colored square */}
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  backgroundColor: selectionColor,
                  flexShrink: 0,
                  boxShadow: isActive ? `0 0 6px ${selectionColor}` : 'none'
                }} />
                <span style={{ 
                  fontSize: '11px', 
                  color: isActive ? selectionColor : 'rgba(255,255,255,0.7)',
                  fontWeight: isActive ? '600' : '400',
                  whiteSpace: 'nowrap'
                }}>
                  Box {index + 1}
                </span>
                {/* Close button */}
                <button
                  onClick={(e) => handleRemoveTab(e, region.id, index)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '0 2px',
                    cursor: 'pointer',
                    color: isActive ? selectionColor : 'rgba(255,255,255,0.5)',
                    fontSize: '14px',
                    lineHeight: '1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.7,
                    transition: 'opacity 0.2s'
                  }}
                  onMouseEnter={(e) => e.target.style.opacity = '1'}
                  onMouseLeave={(e) => e.target.style.opacity = '0.7'}
                  title={`Remove Box ${index + 1}`}
                >
                  ×
                </button>
              </div>
            );
          })}
          
          {/* Clear All button - only show if more than 1 selection */}
          {regionsArray.length > 1 && onClearAllSelections && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearAllSelections();
              }}
              style={{
                background: 'rgba(255, 100, 100, 0.2)',
                border: 'none',
                borderRadius: '3px',
                padding: '4px 8px',
                cursor: 'pointer',
                color: '#ff6b6b',
                fontSize: '10px',
                fontWeight: '500',
                marginLeft: '4px',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.background = 'rgba(255, 100, 100, 0.4)'}
              onMouseLeave={(e) => e.target.style.background = 'rgba(255, 100, 100, 0.2)'}
              title="Clear all selections"
            >
              Clear All
            </button>
          )}
        </div>
      )}
    </div>
  );

  // If no selections, show placeholder with header
  if (regionsArray.length === 0) {
    return (
      <div style={{
        height: '100%',
        width: '100%',
        backgroundColor: '#000000',
        border: '1px solid #444',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}>
        <Header />
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            color: '#666',
            fontSize: '12px',
            textAlign: 'center',
            pointerEvents: 'none'
          }}>
            <div>No selection made</div>
            <div style={{ fontSize: '10px', marginTop: '5px' }}>Select a region in Main View</div>
          </div>
        </div>
      </div>
    );
  }

  // Selections available - show header with tabs and content
  return (
    <div style={{
      height: '100%',
      width: '100%',
      backgroundColor: '#000000',
      border: '1px solid #444',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      <Header />

      {/* Tab Content */}
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden'
      }}>
        {visibleRegions.map((region, index) => {
          const isActive = activeTabIndex === index;
          return (
            <div
              key={region.id || `region-${index}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: isActive ? 1 : 0,
                opacity: isActive ? 1 : 0,
                pointerEvents: isActive ? 'auto' : 'none',
                transition: 'opacity 0.2s'
              }}
            >
              <LocalViewContent 
                key={`content-${region.id || index}`}
                selectedRegionData={region} 
                channels={channels} 
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Local_View;
