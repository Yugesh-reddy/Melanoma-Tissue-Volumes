import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { loadChannelData } from '../hooks/useChannelData';
import { computeRegionSummary } from '../utils/regionStats';
import { runEngine } from '../services/phenotypeEngine';
import AskTissueButton from './AskTissueButton';
import { useAgentActions } from '../services/agentActions';

const OPACITY_FLOOR = 0.35;
const OPACITY_BOOST = 1.3;
const EDGE_FEATHER = 0.99;
const JITTER_SCALE = 0.1;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Component for rendering a single local view
const LocalViewContent = ({ selectedRegionData, channels = [], onCloseTab, regionId }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const animationRef = useRef(null);
  const voxelMeshesRef = useRef([]);
  const boundingBoxRef = useRef(null);
  const axesHelperRef = useRef(null);
  // Incremental rendering: track each channel's mesh + config signature so we
  // only (re)build what actually changed, instead of disposing and reloading
  // every marker on each channel/region change.
  const channelMeshesRef = useRef(new Map()); // channelIndex -> { mesh, signature }
  const regionCtxRef = useRef(null);          // cached bounding-box / scaling / centerOffset per region
  const renderTokenRef = useRef(0);           // bumped each run to cancel superseded async builds

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
  // Signature of a channel's visual config — if these are unchanged, the mesh
  // is identical, so we keep it instead of disposing and rebuilding.
  const channelSignature = (c) =>
    [c.thresholdMin ?? '', c.thresholdMax ?? '', c.color ?? '', c.opacity ?? '', c.visible !== false].join('|');

  // Signature of a region's geometry — changes only when the region itself does.
  const regionSignature = (region) => {
    const b = region?.bounds;
    return b ? [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].join(',') : '';
  };

  // Incremental per-region renderer. Builds only channels that are new or whose
  // config changed, and leaves unchanged markers untouched — so toggling a
  // channel or selecting another region never makes existing markers disappear
  // or reload. Bounding box / axes / camera framing are computed once per region.
  const createLocalVisualization = async (selectedData, channelsOverride = null) => {
    const scene = sceneRef.current;
    if (!scene || !selectedData || !selectedData.bounds) return;

    let channelsToUse = channelsOverride && channelsOverride.length > 0 ? channelsOverride : selectedData.channels;
    if (!channelsToUse || channelsToUse.length === 0) channelsToUse = selectedData.channels || [];
    const visibleChannels = (channelsToUse || []).filter((c) => c.visible !== false);

    const channelMeshes = channelMeshesRef.current;
    const token = ++renderTokenRef.current; // any newer run supersedes this one

    const dropMesh = (mesh) => {
      if (!mesh) return;
      if (scene.children.includes(mesh)) scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    };
    const renderNow = () => {
      if (rendererRef.current && cameraRef.current) rendererRef.current.render(scene, cameraRef.current);
    };
    const syncState = () => {
      const meshes = Array.from(channelMeshes.values()).map((e) => e.mesh).filter(Boolean);
      voxelMeshesRef.current = meshes;
      setCellCount(meshes.reduce((sum, m) => sum + (m.geometry?.instanceCount || 0), 0));
    };

    // No visible channels → remove all channel meshes (keep the box for the region).
    if (visibleChannels.length === 0) {
      channelMeshes.forEach((e) => dropMesh(e.mesh));
      channelMeshes.clear();
      syncState();
      renderNow();
      return;
    }

    // --- Region geometry: build once per region -----------------------------
    const regionSig = regionSignature(selectedData);
    if (!regionCtxRef.current || regionCtxRef.current.regionSig !== regionSig) {
      // Region changed: drop everything tied to the previous region.
      channelMeshes.forEach((e) => dropMesh(e.mesh));
      channelMeshes.clear();
      if (boundingBoxRef.current) { dropMesh(boundingBoxRef.current); boundingBoxRef.current = null; }
      if (axesHelperRef.current) {
        if (scene.children.includes(axesHelperRef.current)) scene.remove(axesHelperRef.current);
        axesHelperRef.current = null;
      }
      regionCtxRef.current = null;

      const { bounds, scaling } = selectedData;

      // Need any one channel's metadata for the volume shape.
      let referenceData = null;
      for (const channelConfig of visibleChannels) {
        try {
          const data = await loadChannelData(channelConfig.channelIndex);
          if (token !== renderTokenRef.current) return; // superseded
          if (data) { referenceData = data; break; }
        } catch (err) {
          console.warn(`Local_View: reference load failed for channel ${channelConfig.channelIndex}`, err);
        }
      }
      if (!referenceData) return;

      const [zSize, ySize, xSize] = referenceData.metadata.shape;
      let scaleXData, scaleYData, scaleZData;
      if (scaling) {
        scaleXData = scaling.scaleX; scaleYData = scaling.scaleY; scaleZData = scaling.scaleZ;
      } else {
        const maxDimData = Math.max(zSize, ySize, xSize);
        scaleXData = xSize / maxDimData;
        scaleYData = ySize / maxDimData;
        scaleZData = (zSize / maxDimData) / 4;
      }

      const boundsWidth = bounds.max.x - bounds.min.x + 1;
      const boundsHeight = bounds.max.y - bounds.min.y + 1;
      const boundsDepth = bounds.max.z - bounds.min.z + 1;
      const boundsCenterX = (bounds.min.x + bounds.max.x) / 2;
      const boundsCenterY = (bounds.min.y + bounds.max.y) / 2;
      const boundsCenterZ = (bounds.min.z + bounds.max.z) / 2;
      const boxCenter = {
        x: -((boundsCenterX / xSize) * 2 - 1) * scaleXData,
        y: ((boundsCenterY / ySize) * 2 - 1) * scaleYData,
        z: ((boundsCenterZ / zSize) * 2 - 1) * scaleZData
      };
      const boxSize = {
        x: (boundsWidth / xSize) * 2 * scaleXData,
        y: (boundsHeight / ySize) * 2 * scaleYData,
        z: (boundsDepth / zSize) * 2 * scaleZData
      };

      // Bounding box (channel geometry is centered at origin via centerOffset).
      const boxGeometry = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
      const boxEdges = new THREE.EdgesGeometry(boxGeometry);
      const boxMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
      const boxWireframe = new THREE.LineSegments(boxEdges, boxMaterial);
      boxWireframe.position.set(0, 0, 0);
      scene.add(boxWireframe);
      boundingBoxRef.current = boxWireframe;

      const axesSize = Math.max(boxSize.x, boxSize.y, boxSize.z) * 0.3;
      const axesHelper = new THREE.AxesHelper(axesSize);
      axesHelper.position.set(0, 0, 0);
      scene.add(axesHelper);
      axesHelperRef.current = axesHelper;

      // Frame the camera once for this region (don't disturb it on channel edits).
      cameraStateRef.current.panOffset = { x: 0, y: 0, z: 0 };
      const maxDimension = Math.max(Math.abs(boxSize.x), Math.abs(boxSize.y), Math.abs(boxSize.z));
      if (maxDimension > 0 && Number.isFinite(maxDimension)) {
        const fovRad = (60 * Math.PI) / 180;
        const baseDistance = (maxDimension / 2) / Math.tan(fovRad / 2);
        cameraStateRef.current.distance = Math.max(0.1, Math.min(10.0, baseDistance * 2.0));
      } else {
        cameraStateRef.current.distance = 0.5;
      }
      cameraStateRef.current.rotation = { x: 0.5, y: 0.5 };
      initialCameraStateRef.current = {
        rotation: { ...cameraStateRef.current.rotation },
        distance: cameraStateRef.current.distance,
        panOffset: { ...cameraStateRef.current.panOffset }
      };
      updateCameraPosition();
      updateLighting();

      regionCtxRef.current = {
        regionSig,
        bounds,
        scaling,
        centerOffset: { x: boxCenter.x, y: boxCenter.y, z: boxCenter.z }
      };
    }

    const { bounds, scaling, centerOffset } = regionCtxRef.current;

    // --- Diff channels against what's already rendered ----------------------
    const desired = new Map();
    visibleChannels.forEach((c) => desired.set(c.channelIndex, c));

    // Remove channels that are no longer present/visible.
    channelMeshes.forEach((entry, idx) => {
      if (!desired.has(idx)) {
        dropMesh(entry.mesh);
        channelMeshes.delete(idx);
      }
    });

    // Determine which channels actually need (re)building.
    const toBuild = [];
    desired.forEach((channelConfig, idx) => {
      const sig = channelSignature(channelConfig);
      const existing = channelMeshes.get(idx);
      if (!existing) {
        toBuild.push({ channelConfig, idx, sig });
      } else if (existing.signature !== sig) {
        dropMesh(existing.mesh);
        channelMeshes.delete(idx);
        toBuild.push({ channelConfig, idx, sig });
      }
      // else: unchanged → leave the existing mesh in place
    });

    syncState();
    renderNow();

    // Build only the needed channels, yielding between each so the UI stays
    // responsive and already-rendered markers remain visible throughout.
    for (const { channelConfig, idx, sig } of toBuild) {
      if (token !== renderTokenRef.current) return; // superseded by a newer run
      try {
        const channelData = await loadChannelData(idx);
        if (token !== renderTokenRef.current) return;
        if (!channelData) continue;

        const mesh = createRegionVisualization(channelData, channelConfig, bounds, scene, scaling, centerOffset);
        if (mesh) {
          mesh.visible = true;
          mesh.frustumCulled = false;
          scene.add(mesh);
          channelMeshes.set(idx, { mesh, signature: sig });
        }
      } catch (error) {
        console.error(`Local_View: Error building channel ${idx}:`, error);
      }

      syncState();
      renderNow();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    syncState();
    renderNow();
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
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    // Observe the container so maximizing the panel (no window resize) refits the scene.
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
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
      renderTokenRef.current += 1; // cancel any in-flight incremental build
      const scene = sceneRef.current;
      if (scene) {
        channelMeshesRef.current.forEach(({ mesh }) => {
          if (mesh) {
            if (scene.children.includes(mesh)) scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
          }
        });
        channelMeshesRef.current.clear();
        if (boundingBoxRef.current) {
          if (scene.children.includes(boundingBoxRef.current)) scene.remove(boundingBoxRef.current);
          boundingBoxRef.current.geometry?.dispose();
          boundingBoxRef.current.material?.dispose();
          boundingBoxRef.current = null;
        }
        if (axesHelperRef.current) {
          if (scene.children.includes(axesHelperRef.current)) scene.remove(axesHelperRef.current);
          axesHelperRef.current = null;
        }
        voxelMeshesRef.current = [];
        regionCtxRef.current = null;
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

  // Reset camera view to its initial framing.
  // This ONLY restores the camera position/zoom/pan — it does NOT remove the
  // selection or close the tab (closing is handled by the tab's × button).
  const resetView = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();

    if (initialCameraStateRef.current) {
      cameraStateRef.current = {
        rotation: { ...initialCameraStateRef.current.rotation },
        distance: initialCameraStateRef.current.distance,
        panOffset: { ...initialCameraStateRef.current.panOffset }
      };
      updateCameraPosition();
      console.log('Local_View: Camera reset to initial position');
    } else {
      console.log('Local_View: No initial camera state to reset to');
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
      {/* Reset View Button - top-left floating control */}
      {selectedRegionData && (
        <button
          id="reset-view-btn"
          className="mtv-press"
          onClick={resetView}
          style={{
            position: 'absolute',
            top: '6px',
            left: '6px',
            zIndex: 100,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 10px',
            fontSize: '11px',
            fontWeight: 600,
            color: '#fff',
            background: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'background-color 160ms var(--ease-out), border-color 160ms var(--ease-out), transform 140ms var(--ease-out)',
            outline: 'none',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            lineHeight: 1
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-soft)';
            e.currentTarget.style.borderColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0,0,0,0.6)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
          }}
          title="Reset camera view to initial position"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 3.5v4.5h4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Reset
        </button>
      )}

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
const Local_View = ({ selectedRegionsData, selectedRegionData, channels = [], onRemoveSelection, onClearAllSelections, onRestoreSelections, onToggleMaximize, isMaximized = false }) => {
  // Support both array and single selection for backward compatibility
  const regionsArray = selectedRegionsData || (selectedRegionData ? [selectedRegionData] : []);
  const selectedDataRef = useRef(selectedRegionsData);
  useEffect(() => { selectedDataRef.current = selectedRegionsData; }, [selectedRegionsData]);
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

  // Agent tool: switch the active Box tab. Accepts 1-based `box` (matching the
  // "Box N" tab labels) or 0-based `index`.
  const { registerActions, unregisterActions, registerState, unregisterState } = useAgentActions();
  const activeTabIndexRef = useRef(activeTabIndex);
  useEffect(() => { activeTabIndexRef.current = activeTabIndex; }, [activeTabIndex]);
  const visibleRegionsRef = useRef(visibleRegions);
  useEffect(() => { visibleRegionsRef.current = visibleRegions; }, [visibleRegions]);
  const visibleCountRef = useRef(visibleRegions.length);
  useEffect(() => { visibleCountRef.current = visibleRegions.length; }, [visibleRegions]);
  const channelsRef = useRef(channels);
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  useEffect(() => {
    const resolveTarget = (box, index) => {
      const count = visibleCountRef.current;
      if (count === 0) return null;
      let target = typeof box === 'number' ? box - 1
        : (typeof index === 'number' ? index : NaN);
      if (Number.isNaN(target)) return null;
      return Math.max(0, Math.min(count - 1, target));
    };

    registerActions({
      switchBox: ({ box, index } = {}) => {
        if (visibleCountRef.current === 0) return { message: 'No boxes to switch to.' };
        const target = resolveTarget(box, index);
        if (target === null) return { message: 'Specify which box (e.g. box 2).' };
        const prev = activeTabIndexRef.current;
        setActiveTabIndex(target);
        return { message: `Switched to Box ${target + 1}`, undo: () => setActiveTabIndex(prev) };
      },
      closeBox: ({ box, index } = {}) => {
        if (visibleCountRef.current === 0) return { message: 'No boxes to close.' };
        const target = resolveTarget(box, index);
        if (target === null) return { message: 'Specify which box to close (e.g. box 2).' };
        const region = visibleRegionsRef.current[target];
        if (!region) return { message: 'No such box.' };
        const prevData = (selectedDataRef.current || []).slice();
        if (onRemoveSelection) onRemoveSelection(region.id);
        return {
          message: `Closed Box ${target + 1}`,
          undo: onRestoreSelections ? () => onRestoreSelections(prevData) : null
        };
      },
      clearAllBoxes: () => {
        if (visibleCountRef.current === 0) return { message: 'No boxes to clear.' };
        if (!onClearAllSelections) return { message: 'Clear-all is not available.' };
        const prevData = (selectedDataRef.current || []).slice();
        onClearAllSelections();
        return {
          message: 'Cleared all boxes',
          undo: onRestoreSelections ? () => onRestoreSelections(prevData) : null
        };
      },
      // Read-only: compute deterministic stats for a box and hand them to the
      // model (no state change). Powers "read → compute → act" via the loop.
      getRegionStats: async ({ box, index } = {}) => {
        if (visibleCountRef.current === 0) return { message: 'No boxes to read.' };
        const target = resolveTarget(box, index);
        if (target === null) return { message: 'Specify which box (e.g. box 2).' };
        const region = visibleRegionsRef.current[target];
        if (!region) return { message: 'No such box.' };
        try {
          const summary = await computeRegionSummary({ region, channels: channelsRef.current });
          const engine = runEngine(summary);
          const topMarkers = (summary.markers || []).slice(0, 8)
            .map((m) => `${m.name}=${(m.relativeExpression ?? 0).toFixed(2)}`).join(', ') || 'none';
          const phenos = (engine.topPhenotypes || []).slice(0, 3)
            .map((p) => `${p.label} (${Math.round((p.proportion || 0) * 100)}%)`).join(', ') || 'none';
          const detail =
            `Box ${target + 1} stats — TME: ${engine.tme?.label || 'n/a'}; ` +
            `top phenotypes: ${phenos}; top markers by relative expression: ${topMarkers}.`;
          return { ok: true, message: `Read Box ${target + 1} stats`, detail };
        } catch (e) {
          return { message: `Could not compute Box ${target + 1} stats: ${e.message}` };
        }
      }
    });

    registerState('localView', () => {
      const n = visibleCountRef.current;
      if (n === 0) return 'Local View: no boxes selected.';
      const active = Math.min(activeTabIndexRef.current, n - 1) + 1;
      return `Local View: ${n} box(es), active = Box ${active}.`;
    });

    return () => {
      unregisterActions(['switchBox', 'closeBox', 'clearAllBoxes', 'getRegionStats']);
      unregisterState('localView');
    };
  }, [registerActions, unregisterActions, registerState, unregisterState, onRemoveSelection, onClearAllSelections, onRestoreSelections]);

  // Update active tab when new selection is added or when tabs are closed
  useEffect(() => {
    if (visibleRegions.length > 0) {
      // Ensure activeTabIndex is valid
      if (activeTabIndex >= visibleRegions.length) {
        // If active index is out of bounds, set to last tab
        setActiveTabIndex(visibleRegions.length - 1);
      } else if (activeTabIndex < 0) {
        // If active index is negative, set to first tab
        setActiveTabIndex(0);
      }
    } else {
      // If no visible regions, reset active tab index
      setActiveTabIndex(0);
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
    
    if (currentVisibleIndex === -1) return; // Tab not found
    
    const remainingCount = visibleRegions.length - 1;
    
    // Adjust active tab index BEFORE closing
    if (activeTabIndex === currentVisibleIndex) {
      // We're closing the active tab
      if (remainingCount > 0) {
        // Switch to the previous tab, or stay at the same index if it becomes the last
        const newIndex = Math.min(currentVisibleIndex, remainingCount - 1);
        setActiveTabIndex(newIndex);
      } else {
        // If this is the last tab, reset to 0
        setActiveTabIndex(0);
      }
    } else if (activeTabIndex > currentVisibleIndex) {
      // If we're closing a tab before the active one, decrease the active index
      setActiveTabIndex(prev => Math.max(0, prev - 1));
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
    '#60a5fa', '#facc15', '#e879f9', '#4ade80', '#fb923c',
    '#f472b6', '#22d3d8', '#f87171', '#a78bfa', '#84cc16'
  ];
  const getSelectionColorFallback = (index) => SELECTION_COLORS[index % SELECTION_COLORS.length];

  // Header component (shared between empty and filled states)
  const Header = () => (
    <div
      onDoubleClick={onToggleMaximize}
      title="Double-click to expand"
      style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      cursor: onToggleMaximize ? 'pointer' : 'default',
      userSelect: 'none',
      padding: '6px 10px',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      zIndex: 10
    }}>
      {/* Title with composite glyph */}
      <h3 style={{
        margin: 0,
        fontSize: '15px',
        color: 'var(--text-1)',
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0
      }}>
        {/* Glyph: 3D cube + magnifier (uniform blue accent) */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 0 3px rgba(59,130,246,0.5))' }}>
          <path d="M12 2L4 6v8l8 4 8-4V6l-8-4z" stroke="#3b82f6" strokeWidth="1.6" fill="rgba(59,130,246,0.12)" />
          <path d="M4 6l8 4 8-4M12 10v8" stroke="#3b82f6" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="17" cy="17" r="4" stroke="#3b82f6" strokeWidth="1.6" fill="rgba(10,11,14,0.6)" />
          <line x1="20" y1="20" x2="23" y2="23" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span style={{ color: 'var(--text-1)' }}>Local View</span>
        {onToggleMaximize && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }}
            title={isMaximized ? 'Restore' : 'Expand'}
            style={{
              padding: '3px 7px',
              fontSize: '12px',
              color: '#9aa0ad',
              background: 'transparent',
              border: '1px solid #2a2f3a',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            {isMaximized ? '⤡' : '⤢'}
          </button>
        )}
      </h3>

      {/* Tabs/Toggle buttons - same line as title */}
      {regionsArray.length > 0 && (
        <div className="mtv-no-scrollbar" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px',
          background: 'transparent',
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
                  transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
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
                transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)'
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
        borderTop: '1px solid var(--border)',
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
      borderTop: '1px solid var(--border)',
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
        {/* Ask AI - floating top-right of the body */}
        {(() => {
          const activeBox = regionsArray[activeTabIndex] || regionsArray[0] || null;
          if (!activeBox) return null;
          return (
            <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 5 }}>
              <AskTissueButton
                variant="chip"
                descriptor={{
                  id: `region:${activeBox.id}`,
                  kind: 'region',
                  title: `Box ${(activeBox.index ?? activeTabIndex) + 1}`,
                  resolve: async () => {
                    const summary = await computeRegionSummary({ region: activeBox, channels });
                    return { summary, engine: runEngine(summary) };
                  }
                }}
              />
            </div>
          );
        })()}
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
                onCloseTab={handleCloseTab}
                regionId={regionIdMap.get(region)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Local_View;
