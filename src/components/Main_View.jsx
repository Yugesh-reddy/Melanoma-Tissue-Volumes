import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass';
import { Line2 } from 'three/examples/jsm/lines/Line2';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial';
import { loadChannelData } from '../hooks/useChannelData';
import { computeRegionSummary } from '../utils/regionStats';
import { runEngine } from '../services/phenotypeEngine';
import { useTissueIntelligence } from '../services/tissueIntelligenceContext';
import AskTissueButton from './AskTissueButton';

const CAMERA_INITIAL_STATE = {
  rotation: { x: 0, y: Math.PI },
  distance: 0.75,
  panOffset: { x: 0, y: 0, z: 0 }
};

const MOVE_SPEED = 0.05;
const FAST_MOVE_SPEED = 0.15;
const LOD_COOLDOWN_MS = 200;
const MAX_POINTS_PER_CHANNEL = 16000000;
const OPACITY_FLOOR = 0.35;
const OPACITY_BOOST = 1.3;
const EDGE_FEATHER = 0.99;
const JITTER_SCALE = 0.1;
const AMBIENT_COLOR = new THREE.Color(0.9, 0.9, 0.95);
const DEFAULT_THRESHOLD_MIN_FRACTION = 0.1;
const DEFAULT_THRESHOLD_MAX_FRACTION = 0.9;

// Color map for selection boxes
const BOX_COLOR_MAP = [
  '#ca0020', // First box - Red
  '#f4a582', // Second box - Light orange
  '#f7f7f7', // Third box - Light gray
  '#92c5de', // Fourth box - Light blue
  '#0571b0'  // Fifth box - Dark blue
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const disposeMesh = (mesh) => {
  if (!mesh) return;
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) mesh.material.dispose();
};

const removeMeshFromCollection = (mesh, collection) => {
  const index = collection.indexOf(mesh);
  if (index !== -1) {
    collection.splice(index, 1);
  }
};

const buildLoadPaths = (channelIndex) => [
  {
    data: `./visualization_data/channel_${channelIndex}_napari_data.raw`,
    metadata: `./visualization_data/channel_${channelIndex}_napari_metadata.json`
  },
  {
    data: `visualization_data/channel_${channelIndex}_napari_data.raw`,
    metadata: `visualization_data/channel_${channelIndex}_napari_metadata.json`
  },
  {
    data: `./visualization_data/channel_${channelIndex}_data.raw`,
    metadata: `./visualization_data/channel_${channelIndex}_metadata.json`
  },
  {
    data: `visualization_data/channel_${channelIndex}_data.raw`,
    metadata: `visualization_data/channel_${channelIndex}_metadata.json`
  }
];

const getConfigSignature = (config) =>
  [
    config.thresholdMin ?? '',
    config.thresholdMax ?? '',
    config.color ?? '',
    config.opacity ?? ''
  ].join('|');

const Main_View = ({ channels = [], activeRegions = [], onSelectionChange, initialSelectionBounds, selectedRegionsData = [] }) => {
  const { openGeneral } = useTissueIntelligence();
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const tissueBadgeRefs = useRef({}); // box id -> badge DOM node (3D-anchored AI triggers)
  const composerRef = useRef(null);
  const aaPassRef = useRef(null);
  const msaaRenderTargetRef = useRef(null);
  const animationRef = useRef(null);

  const pointCloudsRef = useRef([]);
  const loadedChannelsRef = useRef(new Map());
  const channelDataCacheRef = useRef(new Map());
  const channelConfigsRef = useRef(new Map());
  const lodStateRef = useRef({ lastSampling: null, lastUpdate: 0 });
  const keysRef = useRef({});
  const selectionModeRef = useRef(false);
  const cuboidRef = useRef(null);
  const cuboidWireframeRef = useRef(null);
  const cuboidWireframesRef = useRef([]); // Array to store multiple selection boxes
  const wireframeRegionMapRef = useRef(new Map()); // Map wireframe to regionId
  const isSelectingRef = useRef(false);
  const selectionEndRef = useRef(null);
  const isTogglingRef = useRef(false);
  const currentSelectionBoundsRef = useRef(initialSelectionBounds || null); // Store current selection bounds for refreshing on channel change
  const handleSelectionCompleteRef = useRef(null); // Ref to store handleSelectionComplete to avoid scene re-init
  const [dataLoadVersion, setDataLoadVersion] = useState(0); // Track data loading updates

  // 3D Cuboid selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [cuboidDepth, setCuboidDepth] = useState(0.1); // Z-depth in normalized coordinates
  const [cuboidCenter, setCuboidCenter] = useState(null);
  const [cuboidSize, setCuboidSize] = useState(null);

  // Sync refs with state
  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    isSelectingRef.current = isSelecting;
  }, [isSelecting]);

  useEffect(() => {
    selectionEndRef.current = selectionEnd;
  }, [selectionEnd]);

  // Sync wireframes with selectedRegionsData from App.jsx
  // When selections are removed from Local View, remove corresponding wireframes here
  useEffect(() => {
    if (!sceneRef.current) return;

    const currentWireframeCount = cuboidWireframesRef.current.length;
    const selectionCount = selectedRegionsData ? selectedRegionsData.length : 0;

    console.log(`Main_View: Syncing wireframes - wireframes: ${currentWireframeCount}, selections: ${selectionCount}`);

    // If selections were cleared (reset or clear all)
    if (selectionCount === 0 && currentWireframeCount > 0) {
      console.log('Main_View: All selections cleared, removing all wireframes');
      cuboidWireframesRef.current.forEach((wireframe) => {
        try {
          if (wireframe && sceneRef.current) {
            if (sceneRef.current.children.includes(wireframe)) {
              sceneRef.current.remove(wireframe);
            }
            if (wireframe.geometry) wireframe.geometry.dispose();
            if (wireframe.material) wireframe.material.dispose();
          }
        } catch (err) {
          console.error('Main_View: Error removing wireframe:', err);
        }
      });
      cuboidWireframesRef.current = [];
      cuboidWireframeRef.current = null;
      cuboidRef.current = null;
      currentSelectionBoundsRef.current = null;
      setCuboidCenter(null);
      setCuboidSize(null);
    }
    // If some selections were removed (tab closed)
    else if (selectionCount < currentWireframeCount) {
      console.log(`Main_View: ${currentWireframeCount - selectionCount} selection(s) removed, trimming wireframes`);
      // Remove excess wireframes from the end
      const wireframesToRemove = cuboidWireframesRef.current.slice(selectionCount);
      wireframesToRemove.forEach((wireframe) => {
        try {
          if (wireframe && sceneRef.current) {
            if (sceneRef.current.children.includes(wireframe)) {
              sceneRef.current.remove(wireframe);
            }
            if (wireframe.geometry) wireframe.geometry.dispose();
            if (wireframe.material) wireframe.material.dispose();
          }
        } catch (err) {
          console.error('Main_View: Error removing wireframe:', err);
        }
      });
      cuboidWireframesRef.current = cuboidWireframesRef.current.slice(0, selectionCount);

      // Update current wireframe ref to last remaining one
      if (cuboidWireframesRef.current.length > 0) {
        cuboidWireframeRef.current = cuboidWireframesRef.current[cuboidWireframesRef.current.length - 1];
      } else {
        cuboidWireframeRef.current = null;
        cuboidRef.current = null;
        currentSelectionBoundsRef.current = null;
        setCuboidCenter(null);
        setCuboidSize(null);
      }
    }
  }, [selectedRegionsData]);

  // Sync wireframe visibility with selection mode
  useEffect(() => {
    // Set all wireframes visibility based on selection mode
    cuboidWireframesRef.current.forEach((wireframe) => {
      if (wireframe) {
        wireframe.visible = selectionMode;
      }
    });
    if (cuboidWireframeRef.current) {
      cuboidWireframeRef.current.visible = selectionMode;
    }
    console.log(`Main_View: Selection mode changed to ${selectionMode}, wireframes visibility updated`);
  }, [selectionMode]);

  const cameraStateRef = useRef({ ...CAMERA_INITIAL_STATE });

  // Orientation gizmo (bottom-left HUD): refs updated directly each frame from
  // the camera so it never triggers React re-renders or touches the render loop.
  const gizmoXLineRef = useRef(null);
  const gizmoYLineRef = useRef(null);
  const gizmoZLineRef = useRef(null);
  const gizmoXLabRef = useRef(null);
  const gizmoYLabRef = useRef(null);
  const gizmoZLabRef = useRef(null);

  useEffect(() => {
    let raf;
    const C = 27; // gizmo center
    const R = 18; // axis length
    const tmp = new THREE.Vector3();
    const axes = [
      { v: [1, 0, 0], line: gizmoXLineRef, lab: gizmoXLabRef },
      { v: [0, 1, 0], line: gizmoYLineRef, lab: gizmoYLabRef },
      { v: [0, 0, 1], line: gizmoZLineRef, lab: gizmoZLabRef }
    ];
    const tick = () => {
      const cam = cameraRef.current;
      if (cam && cam.quaternion) {
        const q = cam.quaternion.clone().invert();
        for (const a of axes) {
          tmp.set(a.v[0], a.v[1], a.v[2]).applyQuaternion(q);
          const ex = C + tmp.x * R;
          const ey = C - tmp.y * R;
          const op = (tmp.z > 0 ? 1 : 0.4).toString();
          if (a.line.current) {
            a.line.current.setAttribute('x2', ex.toFixed(1));
            a.line.current.setAttribute('y2', ey.toFixed(1));
            a.line.current.setAttribute('opacity', op);
          }
          if (a.lab.current) {
            a.lab.current.setAttribute('x', (C + tmp.x * (R + 6)).toFixed(1));
            a.lab.current.setAttribute('y', (C - tmp.y * (R + 6) + 3).toFixed(1));
            a.lab.current.setAttribute('opacity', op);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const getDesiredSampling = useCallback((distance = 3) => {
    if (distance >= 8) return 6;
    if (distance >= 5.5) return 4;
    if (distance >= 3.5) return 3;
    if (distance >= 2) return 2;
    return 1;
  }, []);

  const createChannelVisualization = useCallback((channelData, channelConfig, samplingOverride) => {
    if (!channelData || !channelConfig) return null;

    const { data, metadata } = channelData;
    const { color, thresholdMin, thresholdMax } = channelConfig;
    const [zSize, ySize, xSize] = metadata.shape || [];
    if (!zSize || !ySize || !xSize) return null;

    const [dataMin = 0, dataMax = 65535] = metadata.dataRange || [];
    const rangeSpan = Math.max(1, dataMax - dataMin);
    const autoMin = Math.round(dataMin + rangeSpan * DEFAULT_THRESHOLD_MIN_FRACTION);
    const autoMax = Math.round(dataMin + rangeSpan * DEFAULT_THRESHOLD_MAX_FRACTION);

    let minThreshold = thresholdMin ?? autoMin;
    let maxThreshold = thresholdMax ?? autoMax;
    if (minThreshold > maxThreshold) {
      [minThreshold, maxThreshold] = [maxThreshold, minThreshold];
    }
    minThreshold = clamp(minThreshold, dataMin, dataMax);
    maxThreshold = clamp(maxThreshold, dataMin, dataMax);

    const hexColor = color.replace('#', '');
    const r = parseInt(hexColor.substring(0, 2), 16) / 255;
    const g = parseInt(hexColor.substring(2, 4), 16) / 255;
    const b = parseInt(hexColor.substring(4, 6), 16) / 255;

    const points = [];
    const opacities = [];
    const baseOpacityFloor = 0.35;

    const maxDim = Math.max(zSize, ySize, xSize);
    const scaleX = xSize / maxDim;
    const scaleY = ySize / maxDim;
    const scaleZ = (zSize / maxDim) / 4;

    const totalVoxels = zSize * ySize * xSize;
    const estimatedPassing = totalVoxels * 0.08;
    let sampling = 1;

    if (estimatedPassing > MAX_POINTS_PER_CHANNEL) {
      const ratio = estimatedPassing / MAX_POINTS_PER_CHANNEL;
      sampling = Math.max(2, Math.ceil(Math.cbrt(Math.max(ratio, 1) * 2)));
      if (totalVoxels > 20_000_000) {
        sampling = Math.max(sampling, 4);
      }
    }

    if (samplingOverride !== undefined) {
      const overrideValue = Math.max(1, Math.round(samplingOverride));
      sampling = Math.max(sampling, overrideValue);
    }

    console.log(`Channel visualization: shape=${metadata.shape}, sampling=${sampling}, totalVoxels=${totalVoxels}`);
    console.log(`Channel ${channelConfig.channelIndex}: Data range [${dataMin}, ${dataMax}], Threshold range [${minThreshold}, ${maxThreshold}]`);

    const stepX = (2 / xSize) * scaleX * sampling;
    const stepY = (2 / ySize) * scaleY * sampling;
    const stepZ = (2 / zSize) * scaleZ * sampling;

    let pointCount = 0;
    const thresholdSpan = Math.max(1, maxThreshold - minThreshold);
    for (let z = 0; z < zSize; z += sampling) {
      for (let y = 0; y < ySize; y += sampling) {
        for (let x = 0; x < xSize; x += sampling) {
          const idx = z * ySize * xSize + y * xSize + x;
          const normalized = data[idx];
          const value = (normalized / 255) * (dataMax - dataMin) + dataMin;

          if (value >= minThreshold && value <= maxThreshold) {
            if (pointCount >= MAX_POINTS_PER_CHANNEL) {
              console.warn(`Channel ${channelConfig.channelIndex}: Reached max points limit (${MAX_POINTS_PER_CHANNEL})`);
              break;
            }
            pointCount += 1;

            const nx = ((x / xSize) * 2 - 1) * scaleX;
            const ny = ((y / ySize) * 2 - 1) * scaleY;
            const nz = ((z / zSize) * 2 - 1) * scaleZ;

            const jitterX = (Math.random() - 0.5) * stepX * JITTER_SCALE;
            const jitterY = (Math.random() - 0.5) * stepY * JITTER_SCALE;
            const jitterZ = (Math.random() - 0.5) * stepZ * JITTER_SCALE;
            points.push(nx + jitterX, ny + jitterY, nz + jitterZ);

            const normalizedOpacity = (value - minThreshold) / thresholdSpan;
            const scaledOpacity = clamp(normalizedOpacity, 0, 1);
            const finalOpacity = baseOpacityFloor + (1 - baseOpacityFloor) * scaledOpacity * OPACITY_BOOST;
            opacities.push(clamp(finalOpacity, baseOpacityFloor, 1));
          }
        }
      }
    }

    console.log(`Channel ${channelConfig.channelIndex}: Created ${pointCount} voxels with sampling=${sampling}`);

    const numPoints = points.length / 3;
    if (numPoints === 0) {
      console.warn(`Channel ${channelConfig.channelIndex}: No voxels within threshold range`);
      return null;
    }

    const baseGeometry = new THREE.BoxGeometry(stepX, stepY, stepZ);
    const geometry = new THREE.InstancedBufferGeometry().copy(baseGeometry);
    baseGeometry.dispose();

    geometry.instanceCount = numPoints;
    geometry.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(new Float32Array(points), 3));
    geometry.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(new Float32Array(opacities), 1));

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
          vec3 finalColor = pow(color, vec3(0.55));
          gl_FragColor = vec4(finalColor * base, base);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    const mesh = new THREE.Mesh(geometry, voxelMaterial);
    mesh.frustumCulled = false;
    mesh.userData = { channelIndex: channelConfig.channelIndex, sampling };

    return { mesh, sampling };
  }, []);

  const renderScene = useCallback(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    if (composerRef.current) {
      composerRef.current.render();
    } else if (rendererRef.current) {
      rendererRef.current.render(scene, camera);
    }
  }, []);

  const updateCameraPosition = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    const state = cameraStateRef.current;
    const lookAtPoint = new THREE.Vector3(
      state.panOffset.x || 0,
      state.panOffset.y || 0,
      state.panOffset.z || 0
    );

    const radius = state.distance;
    const theta = state.rotation.y;
    const phi = state.rotation.x;

    camera.position.x = lookAtPoint.x + radius * Math.sin(theta) * Math.cos(phi);
    camera.position.y = lookAtPoint.y + radius * Math.sin(phi);
    camera.position.z = lookAtPoint.z + radius * Math.cos(theta) * Math.cos(phi);
    camera.up.set(0, -1, 0);
    camera.lookAt(lookAtPoint);
  }, []);

  const updateChannelLOD = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const state = cameraStateRef.current;
    if (!state) return;

    const desiredSampling = getDesiredSampling(state.distance || 3);
    const now = Date.now();
    const lodState = lodStateRef.current;

    if (now - lodState.lastUpdate < LOD_COOLDOWN_MS) return;
    lodState.lastUpdate = now;

    const loadedChannels = loadedChannelsRef.current;
    loadedChannels.forEach((entry, channelIndex) => {
      if (!entry) return;
      if (entry.sampling === desiredSampling || entry.lastRequestedSampling === desiredSampling) return;

      const channelData = channelDataCacheRef.current.get(channelIndex);
      const channelConfig = channelConfigsRef.current.get(channelIndex);
      if (!channelData || !channelConfig) return;

      const previousMesh = entry.mesh;
      const wasVisible = previousMesh ? scene.children.includes(previousMesh) : false;

      const result = createChannelVisualization(channelData, channelConfig, desiredSampling);
      entry.lastRequestedSampling = desiredSampling;

      if (!result) {
        if (wasVisible && previousMesh) scene.remove(previousMesh);
        disposeMesh(previousMesh);
        removeMeshFromCollection(previousMesh, pointCloudsRef.current);
        loadedChannels.delete(channelIndex);
        return;
      }

      const { mesh, sampling } = result;

      if (previousMesh) {
        if (scene.children.includes(previousMesh)) scene.remove(previousMesh);
        disposeMesh(previousMesh);
        removeMeshFromCollection(previousMesh, pointCloudsRef.current);
      }

      pointCloudsRef.current.push(mesh);
      loadedChannels.set(channelIndex, { mesh, sampling, lastRequestedSampling: desiredSampling });

      if (wasVisible && channelConfig.visible !== false) {
        scene.add(mesh);
      }
    });

    lodState.lastSampling = desiredSampling;
    renderScene();
  }, [createChannelVisualization, getDesiredSampling, renderScene]);

  // Clear selection helper function - clears ALL selection boxes
  const clearSelection = useCallback(() => {
    // Remove ALL wireframes from scene (the array of all selections)
    if (cuboidWireframesRef.current && cuboidWireframesRef.current.length > 0 && sceneRef.current) {
      console.log(`Main_View: Clearing ${cuboidWireframesRef.current.length} selection box(es)`);
      cuboidWireframesRef.current.forEach((wireframe, index) => {
        try {
          if (wireframe && sceneRef.current) {
            if (sceneRef.current.children.includes(wireframe)) {
              sceneRef.current.remove(wireframe);
            }
            if (wireframe.geometry) {
              wireframe.geometry.dispose();
            }
            if (wireframe.material) {
              wireframe.material.dispose();
            }
          }
        } catch (err) {
          console.error(`Main_View: Error clearing wireframe ${index}:`, err);
        }
      });
      cuboidWireframesRef.current = [];
    }

    // Also remove single wireframe reference if it exists separately
    if (cuboidWireframeRef.current && sceneRef.current) {
      try {
        if (sceneRef.current.children.includes(cuboidWireframeRef.current)) {
          sceneRef.current.remove(cuboidWireframeRef.current);
        }
        if (cuboidWireframeRef.current.geometry) {
          cuboidWireframeRef.current.geometry.dispose();
        }
        if (cuboidWireframeRef.current.material) {
          cuboidWireframeRef.current.material.dispose();
        }
      } catch (err) {
        console.error('Main_View: Error clearing single wireframe:', err);
      }
      cuboidWireframeRef.current = null;
    }

    // Clear all selection state
    cuboidRef.current = null;
    currentSelectionBoundsRef.current = null;
    setCuboidCenter(null);
    setCuboidSize(null);
    setSelectionMode(false);
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);

    // Notify parent that selection is cleared
    if (onSelectionChange) {
      onSelectionChange(null);
    }

    console.log('Main_View: All selections cleared');
  }, [onSelectionChange]);

  // Reset camera to initial state AND clear selection
  const resetCameraView = useCallback(() => {
    // Reset camera state
    cameraStateRef.current = {
      rotation: { x: 0, y: Math.PI },
      distance: 0.75,
      panOffset: { x: 0, y: 0, z: 0 }
    };

    // Clear the selection
    clearSelection();

    // Update camera position
    if (cameraRef.current) {
      // Update camera position to show default view
      updateCameraPosition();

      // Force LOD update to show data at appropriate quality for default view
      lodStateRef.current.lastUpdate = 0; // Reset LOD cooldown to force update
      updateChannelLOD();
    }

    // Force render
    renderScene();

    console.log('Main_View: Camera AND selection reset to initial state');
  }, [updateCameraPosition, updateChannelLOD, renderScene, clearSelection]);

  const handleMovement = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    const keys = keysRef.current;
    const isFast =
      keys.shift ||
      keys.shiftleft ||
      keys.shiftright ||
      keys['shiftleft'] ||
      keys['shiftright'];
    const speed = isFast ? FAST_MOVE_SPEED : MOVE_SPEED;
    const zoomSpeed = isFast ? 0.03 : 0.015;
    const state = cameraStateRef.current;
    let moved = false;

    const forward = new THREE.Vector3();
    const offset = new THREE.Vector3();

    const applyOffset = (vector) => {
      state.panOffset.x += vector.x;
      state.panOffset.y += vector.y;
      state.panOffset.z += vector.z;
    };

    // Camera controls:
    // Left/Right arrows: move left/right
    // Up/Down arrows: move up/down
    // Ctrl+Z / Ctrl+X: zoom in/out

    const ctrlHeld = keys.control || keys.controlleft || keys.controlright;

    // Left - Move Left
    if (keys.arrowleft) {
      camera.getWorldDirection(forward);
      offset.crossVectors(camera.up, forward).normalize().multiplyScalar(speed);
      applyOffset(offset);
      moved = true;
    }
    // Right - Move Right
    if (keys.arrowright) {
      camera.getWorldDirection(forward);
      offset.crossVectors(camera.up, forward).normalize().multiplyScalar(-speed);
      applyOffset(offset);
      moved = true;
    }
    // Up - Move Up
    if (keys.arrowup) {
      offset.copy(camera.up).normalize().multiplyScalar(speed);
      applyOffset(offset);
      moved = true;
    }
    // Down - Move Down
    if (keys.arrowdown) {
      offset.copy(camera.up).normalize().multiplyScalar(-speed);
      applyOffset(offset);
      moved = true;
    }
    // Ctrl+Z - Zoom In
    if (ctrlHeld && keys.z) {
      state.distance = clamp(state.distance - zoomSpeed, 0.1, 20);
      moved = true;
    }
    // Ctrl+X - Zoom Out
    if (ctrlHeld && keys.x) {
      state.distance = clamp(state.distance + zoomSpeed, 0.1, 20);
      moved = true;
    }
    // Q - Move Forward (into screen)
    if (keys.q) {
      camera.getWorldDirection(forward);
      applyOffset(forward.multiplyScalar(speed));
      moved = true;
    }
    // E - Move Backward (out of screen)
    if (keys.e) {
      camera.getWorldDirection(forward);
      applyOffset(forward.multiplyScalar(-speed));
      moved = true;
    }

    if (moved) {
      updateCameraPosition();
      updateChannelLOD();
    }
  }, [updateCameraPosition, updateChannelLOD]);

  // Convert screen coordinates to normalized device coordinates (-1 to 1)
  const screenToNDC = (x, y, width, height) => {
    return {
      x: (x / width) * 2 - 1,
      y: -(y / height) * 2 + 1
    };
  };

  // Get 3D world bounds from screen selection box (for XY plane)
  const getWorldBoundsFromSelection = (startX, startY, endX, endY, zDepth = 0) => {
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
    // Use a plane at z=zDepth to intersect
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -zDepth);

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

    // Calculate Z bounds based on depth
    const zHalfDepth = Math.abs(zDepth) / 2;
    const minZ = -zHalfDepth;
    const maxZ = zHalfDepth;

    return {
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ),
      center: new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0),
      size: new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ)
    };
  };

  // Selection box colors - synced with App.jsx
  const SELECTION_COLORS = [
    '#60a5fa', // Blue (first selection)
    '#facc15', // Yellow
    '#e879f9', // Magenta
    '#4ade80', // Green
    '#fb923c', // Orange
    '#f472b6', // Pink
    '#22d3d8', // Cyan
    '#f87171', // Red
    '#a78bfa', // Purple
    '#84cc16', // Lime
  ];

  const getSelectionColor = (index) => SELECTION_COLORS[index % SELECTION_COLORS.length];

  // Create or update 3D cuboid wireframe in scene - adds new box to array
  const updateCuboidWireframe = (worldBounds, isTemporary = false, colorOverride = null) => {
    try {
      if (!sceneRef.current || !worldBounds) {
        console.warn('Main_View: Cannot update wireframe - scene or bounds missing');
        return;
      }

      if (!worldBounds.size || !worldBounds.center) {
        console.warn('Main_View: Invalid worldBounds structure:', worldBounds);
        return;
      }

      // Create new wireframe cuboid
      const size = worldBounds.size;
      const center = worldBounds.center;

      // Validate size values
      if (!size.x || !size.y || !size.z ||
        isNaN(size.x) || isNaN(size.y) || isNaN(size.z) ||
        !isFinite(size.x) || !isFinite(size.y) || !isFinite(size.z) ||
        size.x <= 0 || size.y <= 0 || size.z <= 0) {
        console.warn('Main_View: Invalid size values:', size);
        return;
      }

      // Ensure minimum size
      const minSize = 0.001;
      const safeSizeX = Math.max(minSize, Math.abs(size.x));
      const safeSizeY = Math.max(minSize, Math.abs(size.y));
      const safeSizeZ = Math.max(minSize, Math.abs(size.z));

      // Determine color - use override, or get from current selection count
      const wireframeColor = colorOverride || getSelectionColor(cuboidWireframesRef.current.length);

      // Create thick line box using Line2 (supports actual line width)
      const halfX = safeSizeX / 2;
      const halfY = safeSizeY / 2;
      const halfZ = safeSizeZ / 2;

      // Define the 12 edges of a box as line segments
      const boxEdgePositions = [
        // Bottom face edges
        -halfX, -halfY, -halfZ, halfX, -halfY, -halfZ,
        halfX, -halfY, -halfZ, halfX, halfY, -halfZ,
        halfX, halfY, -halfZ, -halfX, halfY, -halfZ,
        -halfX, halfY, -halfZ, -halfX, -halfY, -halfZ,
        // Top face edges
        -halfX, -halfY, halfZ, halfX, -halfY, halfZ,
        halfX, -halfY, halfZ, halfX, halfY, halfZ,
        halfX, halfY, halfZ, -halfX, halfY, halfZ,
        -halfX, halfY, halfZ, -halfX, -halfY, halfZ,
        // Vertical edges connecting top and bottom
        -halfX, -halfY, -halfZ, -halfX, -halfY, halfZ,
        halfX, -halfY, -halfZ, halfX, -halfY, halfZ,
        halfX, halfY, -halfZ, halfX, halfY, halfZ,
        -halfX, halfY, -halfZ, -halfX, halfY, halfZ
      ];

      // Create a group to hold all edge lines
      const wireframe = new THREE.Group();
      wireframe.userData.color = wireframeColor;
      wireframe.renderOrder = 999;

      // Parse color to get RGB values
      const color = new THREE.Color(wireframeColor);

      // Create each edge as a thick Line2
      for (let i = 0; i < boxEdgePositions.length; i += 6) {
        const lineGeometry = new LineGeometry();
        lineGeometry.setPositions([
          boxEdgePositions[i], boxEdgePositions[i + 1], boxEdgePositions[i + 2],
          boxEdgePositions[i + 3], boxEdgePositions[i + 4], boxEdgePositions[i + 5]
        ]);

        // Get renderer size for LineMaterial resolution
        const renderer = rendererRef.current;
        const resolution = renderer
          ? new THREE.Vector2(renderer.domElement.clientWidth, renderer.domElement.clientHeight)
          : new THREE.Vector2(window.innerWidth, window.innerHeight);

        const lineMaterial = new LineMaterial({
          color: color.getHex(),
          linewidth: isTemporary ? 2 : 3, // Pixel width - thinner but visible
          transparent: true,
          opacity: isTemporary ? 0.7 : 1.0,
          depthTest: false,
          depthWrite: false,
          resolution: resolution
        });

        const line = new Line2(lineGeometry, lineMaterial);
        line.computeLineDistances();
        line.renderOrder = 999;
        wireframe.add(line);
      }

      // Validate center values
      if (center && !isNaN(center.x) && !isNaN(center.y) && !isNaN(center.z)) {
        wireframe.position.copy(center);
      } else {
        wireframe.position.set(0, 0, 0);
      }

      // Mark as temporary if needed
      if (isTemporary) {
        wireframe.userData.isTemporary = true;
      } else {
        // Store worldBounds in userData for matching with selectedRegionsData
        wireframe.userData.worldBounds = worldBounds;
        // Store color for reference
        wireframe.userData.boxColor = wireframeColor;
        wireframe.userData.selectionId = null; // Will be set when selection is complete
      }

      sceneRef.current.add(wireframe);

      // If not temporary, add to array (keep all boxes visible)
      if (!isTemporary) {
        cuboidWireframesRef.current.push(wireframe);
        cuboidWireframeRef.current = wireframe;
      } else {
        // For temporary wireframes during selection, replace the previous temporary one
        if (cuboidWireframeRef.current && cuboidWireframeRef.current.userData.isTemporary) {
          try {
            if (sceneRef.current.children.includes(cuboidWireframeRef.current)) {
              sceneRef.current.remove(cuboidWireframeRef.current);
            }
            if (cuboidWireframeRef.current.geometry) {
              cuboidWireframeRef.current.geometry.dispose();
            }
            if (cuboidWireframeRef.current.material) {
              cuboidWireframeRef.current.material.dispose();
            }
          } catch (err) {
            console.error('Main_View: Error removing temporary wireframe:', err);
          }
        }
        cuboidWireframeRef.current = wireframe;
      }

      // Store cuboid info
      cuboidRef.current = {
        center: center ? center.clone() : new THREE.Vector3(0, 0, 0),
        size: size.clone(),
        min: worldBounds.min ? worldBounds.min.clone() : new THREE.Vector3(-safeSizeX / 2, -safeSizeY / 2, -safeSizeZ / 2),
        max: worldBounds.max ? worldBounds.max.clone() : new THREE.Vector3(safeSizeX / 2, safeSizeY / 2, safeSizeZ / 2)
      };

      // Force render to show the new wireframe
      renderScene();
    } catch (err) {
      console.error('Main_View: Error in updateCuboidWireframe:', err);
      console.error('Main_View: worldBounds:', worldBounds);
    }
  };

  // Extract selected region data from all visible channels using 3D cuboid bounds
  const extractSelectedRegion = useCallback(async (worldBounds) => {
    if (!worldBounds || !worldBounds.min || !worldBounds.max) {
      console.warn('Main_View: extractSelectedRegion - Invalid world bounds:', worldBounds);
      return null;
    }

    const selectedData = {
      channels: [],
      bounds: null,
      worldBounds: worldBounds // Store world bounds for reference
    };

    // Get first channel metadata to calculate voxel bounds
    const visibleChannels = channels.filter(c => c.visible !== false);
    if (visibleChannels.length === 0) {
      console.warn('Main_View: extractSelectedRegion - No visible channels');
      return null;
    }

    // Find a reference channel with loaded data to calculate bounds
    let referenceChannel = null;
    let referenceData = null;

    for (const channel of visibleChannels) {
      let data = channelDataCacheRef.current.get(channel.channelIndex);

      // If not in cache, try to fetch
      if (!data) {
        console.log(`Main_View: extractSelectedRegion - Data missing for channel ${channel.channelIndex}, fetching...`);
        try {
          data = await loadChannelData(channel.channelIndex);
          if (data) {
            channelDataCacheRef.current.set(channel.channelIndex, data);
          }
        } catch (err) {
          console.warn(`Main_View: extractSelectedRegion - Failed to fetch channel ${channel.channelIndex}`, err);
        }
      }

      if (data) {
        referenceChannel = channel;
        referenceData = data;
        break; // Found a valid reference
      }
    }

    if (!referenceData) {
      console.warn('Main_View: extractSelectedRegion - Failed to obtain data for ANY visible channel');
      return null;
    }

    const { metadata } = referenceData;
    const shape = metadata.shape;
    const [zSize, ySize, xSize] = shape;
    const maxDim = Math.max(zSize, ySize, xSize);
    const scaleX = xSize / maxDim;
    const scaleY = ySize / maxDim;
    const scaleZ = (zSize / maxDim) / 4; // Z compression factor

    // Convert world bounds to voxel coordinates
    // World coordinates are in normalized [-1, 1] space
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

    // Store scaling factors for Local_View to maintain 3D positions
    selectedData.scaling = {
      scaleX,
      scaleY,
      scaleZ,
      xSize,
      ySize,
      zSize
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
  }, [channels]);

  // Handle selection completion with 3D cuboid bounds
  const handleSelectionComplete = useCallback(async (worldBounds) => {
    if (!worldBounds) {
      console.warn('Main_View: Invalid world bounds');
      return;
    }

    // Store bounds for refreshing selection when channels change
    currentSelectionBoundsRef.current = worldBounds;

    console.log('Main_View: ===== SELECTION COMPLETED =====');
    console.log('Main_View: 3D Cuboid selection completed');
    console.log('Main_View: World bounds:', worldBounds);
    console.log('Main_View: Cuboid center:', worldBounds.center);
    console.log('Main_View: Cuboid size:', worldBounds.size);
    console.log('Main_View: Current channels:', channels);
    console.log('Main_View: onSelectionChange callback exists:', !!onSelectionChange);

    try {
      const selectedData = await extractSelectedRegion(worldBounds);
      if (selectedData) {
        // Get the color from the last added wireframe (for consistency across components)
        const lastWireframe = cuboidWireframesRef.current[cuboidWireframesRef.current.length - 1];
        const wireframeColor = lastWireframe?.userData?.color || getSelectionColor(cuboidWireframesRef.current.length - 1);

        // Include wireframe color in selection data for consistency
        selectedData.color = wireframeColor;

        console.log('Main_View: ✓ Extracted selected region data:', selectedData);
        console.log('Main_View: Voxel bounds:', selectedData.bounds);
        console.log('Main_View: Channels count:', selectedData.channels.length);
        console.log('Main_View: Channels:', selectedData.channels);
        console.log('Main_View: Scaling factors:', selectedData.scaling);
        console.log('Main_View: Assigned color:', wireframeColor);

        if (onSelectionChange) {
          onSelectionChange(selectedData);
        } else {
          console.warn('Main_View: onSelectionChange prop is missing');
        }
      } else {
        console.error('Main_View: ✗ Failed to extract selected region data');
        console.error('Main_View: World bounds were:', worldBounds);
        console.error('Main_View: Visible channels:', channels.filter(c => c.visible !== false));
      }
    } catch (error) {
      console.error('Main_View: Error in handleSelectionComplete:', error);
      console.error('Main_View: Error stack:', error.stack);
    }
  }, [channels, onSelectionChange, extractSelectedRegion]);

  // Keep the ref updated with the latest handleSelectionComplete
  useEffect(() => {
    handleSelectionCompleteRef.current = handleSelectionComplete;
  }, [handleSelectionComplete]);

  // Refresh selection when channels change or data loads
  useEffect(() => {
    if (currentSelectionBoundsRef.current) {
      // Trigger selection refresh
      // We no longer need to wait for isDataLoaded here because extractSelectedRegion
      // will now fetch data if needed.
      console.log('Main_View: Channels changed, triggering selection refresh...');

      // Debounce to avoid rapid updates
      const timer = setTimeout(() => {
        handleSelectionComplete(currentSelectionBoundsRef.current);
      }, 200);

      return () => clearTimeout(timer);
    } else {
      console.log('Main_View: No currentSelectionBoundsRef to refresh');
    }
  }, [channels, handleSelectionComplete]);

  // Restore selection from initial bounds if provided
  useEffect(() => {
    if (initialSelectionBounds && !currentSelectionBoundsRef.current) {
      console.log('Main_View: Restoring selection from initial bounds:', initialSelectionBounds);
      currentSelectionBoundsRef.current = initialSelectionBounds;
      setSelectionMode(true);

      // Restore wireframe
      if (sceneRef.current) {
        updateCuboidWireframe(initialSelectionBounds);
        setCuboidCenter(initialSelectionBounds.center);
        setCuboidSize(initialSelectionBounds.size);
      }

      // Trigger data extraction
      handleSelectionComplete(initialSelectionBounds);
    }
  }, [initialSelectionBounds, handleSelectionComplete]);

  // Manage wireframes based on selectedRegionsData - remove boxes when regions are deleted
  useEffect(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    const wireframes = cuboidWireframesRef.current;
    const regionMap = wireframeRegionMapRef.current;

    // Helper function to compare worldBounds (with tolerance for floating point)
    const worldBoundsMatch = (wb1, wb2) => {
      if (!wb1 || !wb2) return false;
      const tolerance = 0.0001;
      const centerMatch = wb1.center && wb2.center &&
        Math.abs(wb1.center.x - wb2.center.x) < tolerance &&
        Math.abs(wb1.center.y - wb2.center.y) < tolerance &&
        Math.abs(wb1.center.z - wb2.center.z) < tolerance;
      const sizeMatch = wb1.size && wb2.size &&
        Math.abs(wb1.size.x - wb2.size.x) < tolerance &&
        Math.abs(wb1.size.y - wb2.size.y) < tolerance &&
        Math.abs(wb1.size.z - wb2.size.z) < tolerance;
      return centerMatch && sizeMatch;
    };

    // Get array of worldBounds from selectedRegionsData
    const activeWorldBounds = selectedRegionsData
      .filter(region => region.worldBounds)
      .map(region => region.worldBounds);

    // Remove wireframes that don't match any active region
    const wireframesToRemove = [];
    wireframes.forEach((wireframe, index) => {
      if (!wireframe || wireframe.userData.isTemporary) return;

      const wireframeWorldBounds = wireframe.userData.worldBounds;
      if (!wireframeWorldBounds) return;

      // Check if this wireframe's worldBounds matches any active region
      const isActive = activeWorldBounds.some(activeWB =>
        worldBoundsMatch(wireframeWorldBounds, activeWB)
      );

      if (!isActive) {
        wireframesToRemove.push({ wireframe, index });
      }
    });

    // Remove wireframes that are no longer in selectedRegionsData
    wireframesToRemove.forEach(({ wireframe, index }) => {
      try {
        if (scene.children.includes(wireframe)) {
          scene.remove(wireframe);
        }
        if (wireframe.geometry) wireframe.geometry.dispose();
        if (wireframe.material) wireframe.material.dispose();
        wireframes.splice(index, 1);
        regionMap.delete(wireframe);
        console.log('Main_View: Removed wireframe for deleted region');
      } catch (err) {
        console.error('Main_View: Error removing wireframe:', err);
      }
    });

    if (wireframesToRemove.length > 0) {
      renderScene();
    }
  }, [selectedRegionsData, renderScene]);

  // Setup Three.js scene
  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    cameraRef.current = camera;
    updateCameraPosition();

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (renderer.outputColorSpace !== undefined) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

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
      console.log('Main_View: MSAA not available, using post-process AA');
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
        aaPass.material.uniforms.resolution.value.set(1 / width, 1 / height);
        composer.addPass(aaPass);
        console.log('Main_View: FXAA pass enabled');
      }
    }

    composerRef.current = composer;
    aaPassRef.current = aaPass;

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    let isRotating = false;
    let isPanning = false;
    let mouseX = 0;
    let mouseY = 0;
    let selectionStartPos = null;
    let currentCuboidDepth = 0.1;

    const handleMouseDown = (e) => {
      try {
        console.log('Main_View: Mouse down - selectionMode:', selectionModeRef.current, 'button:', e.button);
        if (selectionModeRef.current && e.button === 0) {
          // Start 3D cuboid selection
          console.log('Main_View: Starting 3D cuboid selection...');
          if (!rendererRef.current || !rendererRef.current.domElement) {
            console.error('Main_View: Renderer not initialized');
            return;
          }
          const rect = rendererRef.current.domElement.getBoundingClientRect();
          selectionStartPos = { x: e.clientX, y: e.clientY };
          setIsSelecting(true);
          setSelectionStart(selectionStartPos);
          setSelectionEnd(selectionStartPos);
          currentCuboidDepth = cuboidDepth;
          console.log('Main_View: Selection started at:', selectionStartPos, 'depth:', currentCuboidDepth);

          // Don't clear previous cuboids - we want to keep all selections visible
          // Only clear temporary wireframe if it exists
          if (cuboidWireframeRef.current && cuboidWireframeRef.current.userData.isTemporary && sceneRef.current) {
            try {
              sceneRef.current.remove(cuboidWireframeRef.current);
              if (cuboidWireframeRef.current.geometry) cuboidWireframeRef.current.geometry.dispose();
              if (cuboidWireframeRef.current.material) cuboidWireframeRef.current.material.dispose();
              cuboidWireframeRef.current = null;
            } catch (err) {
              console.error('Main_View: Error clearing temporary cuboid:', err);
            }
          }
        } else {
          if (e.button === 0) isRotating = true;
          if (e.button === 2) isPanning = true;
          mouseX = e.clientX;
          mouseY = e.clientY;
        }
      } catch (err) {
        console.error('Main_View: Error in handleMouseDown:', err);
      }
    };

    const handleMouseUp = (e) => {
      try {
        console.log('Main_View: Mouse up - selectionMode:', selectionModeRef.current, 'selectionStartPos:', selectionStartPos);
        if (selectionModeRef.current && selectionStartPos) {
          // Complete 3D cuboid selection
          const endX = e.clientX;
          const endY = e.clientY;

          console.log('Main_View: Selection completed - start:', selectionStartPos, 'end:', { x: endX, y: endY }, 'depth:', currentCuboidDepth);

          // Get final world bounds with current depth
          const worldBounds = getWorldBoundsFromSelection(
            selectionStartPos.x,
            selectionStartPos.y,
            endX,
            endY,
            currentCuboidDepth
          );

          console.log('Main_View: World bounds from selection:', worldBounds);

          if (worldBounds) {
            try {
              // Remove temporary wireframe first
              if (cuboidWireframeRef.current && cuboidWireframeRef.current.userData.isTemporary) {
                try {
                  if (sceneRef.current && sceneRef.current.children.includes(cuboidWireframeRef.current)) {
                    sceneRef.current.remove(cuboidWireframeRef.current);
                  }
                  if (cuboidWireframeRef.current.geometry) cuboidWireframeRef.current.geometry.dispose();
                  if (cuboidWireframeRef.current.material) cuboidWireframeRef.current.material.dispose();
                  cuboidWireframeRef.current = null;
                } catch (err) {
                  console.error('Main_View: Error removing temporary wireframe:', err);
                }
              }

              // Keep wireframe visible (add to array, not temporary)
              updateCuboidWireframe(worldBounds, false);

              // Extract and send selection data
              console.log('Main_View: Calling handleSelectionComplete...');
              if (handleSelectionCompleteRef.current) {
                handleSelectionCompleteRef.current(worldBounds).catch(err => {
                  console.error('Main_View: Error in handleSelectionComplete:', err);
                });
              }
            } catch (err) {
              console.error('Main_View: Error updating cuboid wireframe:', err);
            }
          } else {
            console.warn('Main_View: No world bounds calculated from selection');
          }

          setIsSelecting(false);
          setSelectionStart(null);
          setSelectionEnd(null);
          selectionStartPos = null;
        } else {
          isRotating = false;
          isPanning = false;
        }
      } catch (err) {
        console.error('Main_View: Error in handleMouseUp:', err);
        setIsSelecting(false);
        isRotating = false;
        isPanning = false;
      }
    };

    const handleMouseMove = (e) => {
      // Use requestAnimationFrame to throttle heavy updates
      requestAnimationFrame(() => {
        try {
          if (selectionModeRef.current && selectionStartPos) {
            // Update 3D cuboid selection box
            setSelectionEnd({ x: e.clientX, y: e.clientY });

            // Update wireframe in real-time
            const worldBounds = getWorldBoundsFromSelection(
              selectionStartPos.x,
              selectionStartPos.y,
              e.clientX,
              e.clientY,
              currentCuboidDepth
            );

            if (worldBounds) {
              try {
                // Update temporary wireframe during selection (will be replaced on completion)
                updateCuboidWireframe(worldBounds, true);
                setCuboidCenter(worldBounds.center);
                setCuboidSize(worldBounds.size);
              } catch (err) {
                console.error('Main_View: Error updating wireframe:', err);
              }
            }
          } else {
            const state = cameraStateRef.current;
            if (isRotating) {
              state.rotation.y += (e.clientX - mouseX) * 0.01;
              state.rotation.x = clamp(state.rotation.x + (e.clientY - mouseY) * 0.01, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
              updateCameraPosition();
              updateChannelLOD();
            }
            if (isPanning) {
              state.panOffset.x += (e.clientX - mouseX) * 0.001;
              state.panOffset.y -= (e.clientY - mouseY) * 0.001;
              updateCameraPosition();
            }
          }
          mouseX = e.clientX;
          mouseY = e.clientY;
        } catch (err) {
          console.error('Main_View: Error in handleMouseMove:', err);
        }
      });
    };

    const handleWheel = (e) => {
      try {
        if (selectionModeRef.current && isSelectingRef.current && selectionStartPos) {
          // Adjust Z-depth during selection
          e.preventDefault();
          const depthDelta = e.deltaY * 0.0001;
          currentCuboidDepth = Math.max(0.01, Math.min(1.0, currentCuboidDepth + depthDelta));
          setCuboidDepth(currentCuboidDepth);

          // Update wireframe with new depth (temporary only)
          const endPos = selectionEndRef.current || selectionStartPos;
          const worldBounds = getWorldBoundsFromSelection(
            selectionStartPos.x,
            selectionStartPos.y,
            endPos.x || selectionStartPos.x,
            endPos.y || selectionStartPos.y,
            currentCuboidDepth
          );

          if (worldBounds) {
            try {
              // Only update temporary wireframe during selection, don't add to array
              updateCuboidWireframe(worldBounds, true);
              setCuboidCenter(worldBounds.center);
              setCuboidSize(worldBounds.size);
            } catch (err) {
              console.error('Main_View: Error updating wireframe on wheel:', err);
            }
          }
        } else {
          // Normal zoom - scroll always zooms (except during active selection drawing above)
          // Zoom toward mouse position (proper implementation)
          const state = cameraStateRef.current;
          const camera = cameraRef.current;
          const renderer = rendererRef.current;

          if (camera && renderer) {
            const rect = renderer.domElement.getBoundingClientRect();

            // Get mouse position in NDC (-1 to 1)
            const mouseNDC = new THREE.Vector2(
              ((e.clientX - rect.left) / rect.width) * 2 - 1,
              -((e.clientY - rect.top) / rect.height) * 2 + 1
            );

            // Create a ray from camera through mouse position
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouseNDC, camera);

            // Find intersection point with a plane at the current lookAt distance
            const lookAtPoint = new THREE.Vector3(
              state.panOffset.x,
              state.panOffset.y,
              state.panOffset.z
            );

            // Create plane perpendicular to camera direction at lookAt point
            const cameraDirection = new THREE.Vector3();
            camera.getWorldDirection(cameraDirection);
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDirection, lookAtPoint);

            // Get the 3D point under the mouse before zoom
            const pointBeforeZoom = new THREE.Vector3();
            raycaster.ray.intersectPlane(plane, pointBeforeZoom);

            // Apply zoom
            const zoomFactor = 1 + e.deltaY * 0.001;
            const oldDistance = state.distance;
            state.distance *= zoomFactor;
            state.distance = clamp(state.distance, 0.1, 20);

            // Calculate how much the point would shift after zoom
            // and adjust panOffset to keep the point under the cursor
            if (pointBeforeZoom) {
              const zoomRatio = state.distance / oldDistance;

              // Calculate the offset from lookAt to the mouse point
              const offsetX = pointBeforeZoom.x - state.panOffset.x;
              const offsetY = pointBeforeZoom.y - state.panOffset.y;
              const offsetZ = pointBeforeZoom.z - state.panOffset.z;

              // Move the pan offset toward the mouse point based on zoom change
              const panAdjust = 1 - zoomRatio;
              state.panOffset.x += offsetX * panAdjust * 0.5;
              state.panOffset.y += offsetY * panAdjust * 0.5;
              state.panOffset.z += offsetZ * panAdjust * 0.5;
            }
          } else {
            // Fallback: simple zoom without mouse position adjustment
            const zoomFactor = 1 + e.deltaY * 0.001;
            state.distance *= zoomFactor;
            state.distance = clamp(state.distance, 0.1, 20);
          }

          updateCameraPosition();
          updateChannelLOD();
        }
      } catch (err) {
        console.error('Main_View: Error in handleWheel:', err);
      }
    };

    const handleContextMenu = (event) => event.preventDefault();

    const isEditableTarget = (target) => {
      if (!target) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    };

    const handleKeyDown = (event) => {
      // Ignore camera shortcuts while typing in the chat box or any text field
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      keysRef.current[key] = true;
      keysRef.current[event.code.toLowerCase()] = true;
    };

    const handleKeyUp = (event) => {
      const key = event.key.toLowerCase();
      keysRef.current[key] = false;
      keysRef.current[event.code.toLowerCase()] = false;
    };

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('wheel', handleWheel);
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);

    renderer.domElement.setAttribute('tabindex', '0');
    renderer.domElement.style.outline = 'none';
    renderer.domElement.addEventListener('click', () => {
      renderer.domElement.focus();
    });

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const animate = () => {
      handleMovement();
      renderScene();
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
      if (composerRef.current) {
        composerRef.current.setSize(newWidth, newHeight);
      }
      if (msaaRenderTargetRef.current) {
        msaaRenderTargetRef.current.setSize(newWidth, newHeight);
      }
      if (aaPassRef.current) {
        if (typeof aaPassRef.current.setSize === 'function') {
          aaPassRef.current.setSize(newWidth * renderer.getPixelRatio(), newHeight * renderer.getPixelRatio());
        } else if (aaPassRef.current.material?.uniforms?.resolution) {
          aaPassRef.current.material.uniforms.resolution.value.set(1 / newWidth, 1 / newHeight);
        }
      }
    };

    window.addEventListener('resize', handleResize);

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

      pointCloudsRef.current.forEach(disposeMesh);
      pointCloudsRef.current = [];
      loadedChannelsRef.current.clear();
      channelDataCacheRef.current.clear();
      channelConfigsRef.current.clear();
      lodStateRef.current = { lastSampling: null, lastUpdate: 0 };

      // Cleanup all selection boxes
      cuboidWireframesRef.current.forEach((wireframe) => {
        if (wireframe && sceneRef.current) {
          try {
            if (sceneRef.current.children.includes(wireframe)) {
              sceneRef.current.remove(wireframe);
            }
            if (wireframe.geometry) wireframe.geometry.dispose();
            if (wireframe.material) wireframe.material.dispose();
          } catch (err) {
            console.error('Main_View: Error disposing wireframe:', err);
          }
        }
      });
      cuboidWireframesRef.current = [];

      if (msaaRenderTargetRef.current) {
        msaaRenderTargetRef.current.dispose();
        msaaRenderTargetRef.current = null;
      }
      composerRef.current = null;
      aaPassRef.current = null;

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [handleMovement, renderScene, updateCameraPosition, updateChannelLOD]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (channels.length === 0) {
      const loadedChannels = loadedChannelsRef.current;
      loadedChannels.forEach((entry) => {
        const mesh = entry?.mesh;
        if (mesh && scene.children.includes(mesh)) {
          scene.remove(mesh);
        }
        disposeMesh(mesh);
      });
      loadedChannels.clear();
      channelDataCacheRef.current.clear();
      channelConfigsRef.current.clear();
      pointCloudsRef.current = [];
      renderScene();
      return;
    }

    const loadedChannels = loadedChannelsRef.current;
    const channelDataCache = channelDataCacheRef.current;

    // Create a map of channel indices to their configs for quick lookup
    const channelConfigMap = new Map();
    channels.forEach((cfg) => {
      channelConfigMap.set(cfg.channelIndex, cfg);
    });

    // First pass: Remove channels that are no longer in the list or are not visible
    let needsRender = false;
    loadedChannels.forEach((entry, channelIndex) => {
      const channelConfig = channelConfigMap.get(channelIndex);

      if (!channelConfig) {
        // Channel completely removed from list - dispose everything
        const mesh = entry?.mesh;
        if (mesh && scene.children.includes(mesh)) {
          scene.remove(mesh);
          needsRender = true;
        }
        disposeMesh(mesh);
        removeMeshFromCollection(mesh, pointCloudsRef.current);
        loadedChannels.delete(channelIndex);
        channelDataCache.delete(channelIndex);
        console.log(`Main_View: 🗑️ Removed channel ${channelIndex} (no longer selected)`);
      } else {
        // Channel still exists - check visibility and remove from scene if not visible
        const isVisible = channelConfig.visible !== false;
        const mesh = entry?.mesh;
        if (mesh && scene.children.includes(mesh) && !isVisible) {
          scene.remove(mesh);
          needsRender = true;
          console.log(`Main_View: ⚠️ Channel ${channelIndex} removed from scene (not visible)`);
        }
      }
    });

    if (needsRender) {
      renderScene();
    }

    channelConfigsRef.current.clear();

    // Second pass: Update channel configs and handle visibility changes
    channels.forEach((channelConfig) => {
      const channelIndex = channelConfig.channelIndex;
      channelConfigsRef.current.set(channelIndex, channelConfig);

      const entry = loadedChannels.get(channelIndex);
      const channelData = channelDataCache.get(channelIndex);
      let mesh = entry?.mesh ?? null;

      const newSignature = getConfigSignature(channelConfig);
      const configChanged = entry?.configSignature !== newSignature;

      if (entry && configChanged) {
        if (mesh && scene.children.includes(mesh)) {
          scene.remove(mesh);
        }
        disposeMesh(mesh);
        removeMeshFromCollection(mesh, pointCloudsRef.current);
        loadedChannels.delete(channelIndex);
        channelDataCache.delete(channelIndex);
        mesh = null;
        console.log(`Main_View:  Channel ${channelIndex} flagged for reload due to configuration change`);
      }

      // Handle visibility changes for existing meshes
      if (mesh) {
        const isVisible = channelConfig.visible !== false;
        const currentlyInScene = scene.children.includes(mesh);
        if (isVisible && !currentlyInScene) {
          scene.add(mesh);
          console.log(`Main_View:  Channel ${channelIndex} turned ON`);
          renderScene();
        } else if (!isVisible && currentlyInScene) {
          scene.remove(mesh);
          console.log(`Main_View:  Channel ${channelIndex} turned OFF`);
          renderScene();
        }
      }
    });

    const loadChannels = async () => {
      const visibleChannels = channels.filter((cfg) => cfg.visible !== false);
      const toLoad = visibleChannels.filter((cfg) => !loadedChannels.has(cfg.channelIndex));
      if (toLoad.length === 0) {
        renderScene();
        return;
      }

      console.log(`Main_View: Loading ${toLoad.length} channel(s)`);

      for (const channelConfig of toLoad) {
        if (channelConfig.visible === false) continue;

        try {
          const currentConfig = channelConfigsRef.current.get(channelConfig.channelIndex);
          if (!currentConfig || getConfigSignature(currentConfig) !== getConfigSignature(channelConfig)) {
            console.log(`Main_View:  Skipping stale load for channel ${channelConfig.channelIndex}`);
            continue;
          }

          let channelData = channelDataCache.get(channelConfig.channelIndex);
          if (!channelData) {
            channelData = await loadChannelData(channelConfig.channelIndex);
            if (channelData) {
              channelDataCache.set(channelConfig.channelIndex, channelData);
            }
          }

          const latestConfig = channelConfigsRef.current.get(channelConfig.channelIndex);
          if (!latestConfig || getConfigSignature(latestConfig) !== getConfigSignature(channelConfig)) {
            console.log(`Main_View:  Loaded data discarded for channel ${channelConfig.channelIndex} (stale)`);
            continue;
          }

          if (!channelData) continue;

          const desiredSampling = getDesiredSampling(cameraStateRef.current?.distance || 3);
          const result = createChannelVisualization(channelData, channelConfig, desiredSampling);

          if (result) {
            const { mesh, sampling } = result;
            loadedChannels.set(channelConfig.channelIndex, {
              mesh,
              sampling,
              lastRequestedSampling: desiredSampling,
              configSignature: getConfigSignature(channelConfig)
            });
            lodStateRef.current.lastSampling = sampling;
            pointCloudsRef.current.push(mesh);

            if (channelConfig.visible !== false) {
              scene.add(mesh);
              mesh.renderOrder = 1;
              console.log(`Main_View:  Channel ${channelConfig.channelIndex} added (sampling=${sampling})`);
            } else {
              console.log(`Main_View:  Channel ${channelConfig.channelIndex} prepared but not visible`);
            }

            renderScene();
          } else {
            console.warn(`Main_View:  Channel ${channelConfig.channelIndex} produced no voxels`);
          }
        } catch (error) {
          console.error(`Main_View:  Error loading channel ${channelConfig.channelIndex}:`, error);
        }

        // Yield to main thread to allow UI updates and prevent freezing
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      const visibleCount = visibleChannels.filter((cfg) => {
        const entry = loadedChannels.get(cfg.channelIndex);
        return entry?.mesh && scene.children.includes(entry.mesh);
      }).length;
      console.log(`Main_View: Channel update complete. Visible ${visibleCount}/${visibleChannels.length}`);
      renderScene();
      // Signal that data loading/processing has occurred
      setDataLoadVersion(v => v + 1);
    };

    loadChannels();
  }, [channels, createChannelVisualization, getDesiredSampling, loadChannelData, renderScene]);

  // Calculate dimensions in micrometers (assuming 1 voxel = 1 μm, adjust as needed)
  const getCuboidDimensions = () => {
    try {
      if (!cuboidSize || !cuboidRef.current) return null;

      // Get first channel metadata for voxel-to-μm conversion
      const visibleChannels = channels.filter(c => c.visible !== false);
      if (visibleChannels.length === 0) return null;

      const firstChannel = visibleChannels[0];
      const channelData = channelDataCacheRef.current.get(firstChannel.channelIndex);
      if (!channelData) return null;

      const { metadata } = channelData;
      const [zSize, ySize, xSize] = metadata.shape;

      // Calculate voxel dimensions from world bounds
      // Convert world bounds back to voxel coordinates
      const maxDim = Math.max(zSize, ySize, xSize);
      const scaleX = xSize / maxDim;
      const scaleY = ySize / maxDim;
      const scaleZ = (zSize / maxDim) / 4;

      // Convert world bounds to voxel coordinates
      const worldMin = cuboidRef.current.min;
      const worldMax = cuboidRef.current.max;

      if (!worldMin || !worldMax) return null;

      let voxelMinX = Math.max(0, Math.floor(((worldMin.x / scaleX + 1) / 2) * xSize));
      let voxelMaxX = Math.min(xSize - 1, Math.ceil(((worldMax.x / scaleX + 1) / 2) * xSize));
      let voxelMinY = Math.max(0, Math.floor(((worldMin.y / scaleY + 1) / 2) * ySize));
      let voxelMaxY = Math.min(ySize - 1, Math.ceil(((worldMax.y / scaleY + 1) / 2) * ySize));
      let voxelMinZ = Math.max(0, Math.floor(((worldMin.z / scaleZ + 1) / 2) * zSize));
      let voxelMaxZ = Math.min(zSize - 1, Math.ceil(((worldMax.z / scaleZ + 1) / 2) * zSize));

      // Ensure min <= max
      if (voxelMinX > voxelMaxX) [voxelMinX, voxelMaxX] = [voxelMaxX, voxelMinX];
      if (voxelMinY > voxelMaxY) [voxelMinY, voxelMaxY] = [voxelMaxY, voxelMinY];
      if (voxelMinZ > voxelMaxZ) [voxelMinZ, voxelMaxZ] = [voxelMaxZ, voxelMinZ];

      const voxelWidth = voxelMaxX - voxelMinX + 1;
      const voxelHeight = voxelMaxY - voxelMinY + 1;
      const voxelDepth = voxelMaxZ - voxelMinZ + 1;

      // Convert to micrometers (assuming 1 voxel = 1 μm, adjust if needed)
      const voxelSize = 1; // μm per voxel
      return {
        width: (voxelWidth * voxelSize).toFixed(1),
        height: (voxelHeight * voxelSize).toFixed(1),
        depth: (voxelDepth * voxelSize).toFixed(1),
        volume: ((voxelWidth * voxelHeight * voxelDepth) * voxelSize * voxelSize * voxelSize).toFixed(1)
      };
    } catch (err) {
      console.error('Main_View: Error calculating cuboid dimensions:', err);
      return null;
    }
  };

  const cuboidDimensions = getCuboidDimensions();

  // Keep the per-box "Ask Tissue Intelligence" badges glued to the top of each
  // drawn cuboid by projecting its world-space center to screen every frame.
  useEffect(() => {
    let raf;
    const tmp = new THREE.Vector3();
    const update = () => {
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (camera && renderer) {
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        selectedRegionsData.forEach((box) => {
          const el = tissueBadgeRefs.current[box.id];
          const wb = box.worldBounds;
          if (!el || !wb || !wb.center) return;
          const halfY = (wb.size?.y || 0) / 2;
          tmp.set(wb.center.x, wb.center.y + halfY, wb.center.z);
          tmp.project(camera);
          const x = (tmp.x * 0.5 + 0.5) * w;
          const y = (-tmp.y * 0.5 + 0.5) * h;
          const onScreen = tmp.z < 1 && x >= -40 && x <= w + 40 && y >= -40 && y <= h + 40;
          el.style.transform = `translate(-50%, -130%) translate(${x}px, ${y}px)`;
          el.style.opacity = onScreen ? '1' : '0';
          el.style.pointerEvents = onScreen ? 'auto' : 'none';
        });
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [selectedRegionsData]);

  return (
    <div style={{
      height: '100%',
      width: '100%',
      position: 'relative',
      backgroundColor: '#000000',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
      {/* 3D-anchored Tissue Intelligence badges, one per drawn cuboid */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none' }}>
        {selectedRegionsData.map((box) => (
          <div
            key={box.id}
            ref={(el) => { if (el) tissueBadgeRefs.current[box.id] = el; else delete tissueBadgeRefs.current[box.id]; }}
            style={{ position: 'absolute', top: 0, left: 0, opacity: 0, transition: 'opacity 150ms var(--ease-out)', willChange: 'transform' }}
          >
            <AskTissueButton
              variant="badge"
              title={`Ask Tissue Intelligence about Box ${(box.index ?? 0) + 1}`}
              descriptor={{
                id: `region:${box.id}`,
                kind: 'region',
                title: `Box ${(box.index ?? 0) + 1}`,
                resolve: async () => {
                  const summary = await computeRegionSummary({ region: box, channels });
                  return { summary, engine: runEngine(summary) };
                }
              }}
            />
          </div>
        ))}
      </div>
      <div ref={mountRef} style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: 'hidden'
      }} />

      {/* Orientation gizmo - bottom left (axis directions track the camera) */}
      <div style={{
        position: 'absolute',
        left: '14px',
        bottom: '14px',
        width: '54px',
        height: '54px',
        borderRadius: '50%',
        background: 'rgba(8,9,12,0.55)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(3px)',
        pointerEvents: 'none',
        zIndex: 5
      }}>
        <svg width="54" height="54" viewBox="0 0 54 54">
          <circle cx="27" cy="27" r="1.6" fill="#6b7280" />
          <line ref={gizmoZLineRef} x1="27" y1="27" x2="45" y2="27" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
          <line ref={gizmoYLineRef} x1="27" y1="27" x2="27" y2="9" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
          <line ref={gizmoXLineRef} x1="27" y1="27" x2="45" y2="27" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          <text ref={gizmoXLabRef} x="49" y="30" fill="#ef4444" fontSize="9" fontFamily="var(--font-mono)" textAnchor="middle">X</text>
          <text ref={gizmoYLabRef} x="27" y="6" fill="#22c55e" fontSize="9" fontFamily="var(--font-mono)" textAnchor="middle">Y</text>
          <text ref={gizmoZLabRef} x="49" y="30" fill="#3b82f6" fontSize="9" fontFamily="var(--font-mono)" textAnchor="middle">Z</text>
        </svg>
      </div>

      {/* Selection Mode Toggle Button - Top Right */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();

          // Prevent rapid clicking
          if (isTogglingRef.current) {
            console.log('Main_View: Toggle already in progress, ignoring click');
            return;
          }

          try {
            isTogglingRef.current = true;
            const newMode = !selectionMode;
            console.log('Main_View: Selection mode toggled:', newMode);

            // Update state immediately
            setSelectionMode(newMode);

            // Toggle wireframe visibility (don't dispose - just hide/show)
            if (sceneRef.current) {
              requestAnimationFrame(() => {
                try {
                  // Toggle visibility of all wireframes
                  cuboidWireframesRef.current.forEach((wireframe) => {
                    if (wireframe) {
                      wireframe.visible = newMode;
                    }
                  });

                  // Also handle single wireframe ref
                  if (cuboidWireframeRef.current) {
                    cuboidWireframeRef.current.visible = newMode;
                  }

                  console.log(`Main_View: Wireframes visibility set to ${newMode}`);
                } catch (err) {
                  console.error('Main_View: Error toggling wireframe visibility:', err);
                } finally {
                  isTogglingRef.current = false;
                }
              });
            } else {
              isTogglingRef.current = false;
            }
          } catch (err) {
            console.error('Main_View: Error toggling selection mode:', err);
            isTogglingRef.current = false;
            // Still update state even if cleanup fails
            try {
              setSelectionMode(!selectionMode);
            } catch (stateErr) {
              console.error('Main_View: Failed to update state:', stateErr);
            }
          }
        }}
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          zIndex: 1000,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '7px',
          padding: '8px 14px',
          background: selectionMode ? 'var(--accent)' : 'rgba(16,18,24,0.72)',
          color: selectionMode ? '#ffffff' : 'var(--text-1)',
          border: `1px solid ${selectionMode ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: '9px',
          cursor: 'pointer',
          fontSize: '13px',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          letterSpacing: '0.2px',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          boxShadow: selectionMode
            ? '0 0 0 3px rgba(59,130,246,0.25), 0 4px 14px rgba(59,130,246,0.35)'
            : '0 2px 8px rgba(0,0,0,0.35)',
          transition: 'background 180ms var(--ease-out), box-shadow 180ms var(--ease-out), border-color 180ms var(--ease-out), transform 140ms var(--ease-out)'
        }}
        className="mtv-press"
        onMouseEnter={(e) => {
          if (!selectionMode) {
            e.currentTarget.style.background = 'var(--bg-3)';
            e.currentTarget.style.borderColor = 'var(--accent)';
          }
        }}
        onMouseLeave={(e) => {
          if (!selectionMode) {
            e.currentTarget.style.background = 'rgba(16,18,24,0.72)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }
        }}
        title={selectionMode ? 'Click to disable 3D selection' : 'Click to enable 3D selection'}
      >
        {selectionMode ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L4 6v8l8 4 8-4V6l-8-4z" stroke="currentColor" strokeWidth="1.7" fill="none" />
            <path d="M4 6l8 4 8-4M12 10v8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        )}
        3D Selection
      </button>

      {/* Tissue Intelligence launcher — opens the general, app-wide AI assistant */}
      <button
        type="button"
        className="mtv-press"
        onClick={() => openGeneral()}
        style={{
          position: 'absolute',
          top: '12px',
          right: '160px',
          zIndex: 1000,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '7px',
          padding: '8px 14px',
          background: 'rgba(16,18,24,0.72)',
          color: 'var(--text-1)',
          border: '1px solid var(--border)',
          borderRadius: '9px',
          cursor: 'pointer',
          fontSize: '13px',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          letterSpacing: '0.2px',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          transition: 'border-color 180ms var(--ease-out), background 180ms var(--ease-out), transform 140ms var(--ease-out)'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(145,104,192,0.85)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        title="Open Tissue Intelligence"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ filter: 'drop-shadow(0 0 3px rgba(120,90,200,0.55))' }}>
          <path d="M12 0c0 6.627 5.373 12 12 12-6.627 0-12 5.373-12 12 0-6.627-5.373-12-12-12 6.627 0 12-5.373 12-12z" fill="#9168C0" />
        </svg>
        Tissue Intelligence
      </button>

      {/* Reset View Button - Bottom Right - Consistent with Region_Selection */}
      <button
        className="mtv-press"
        onClick={resetCameraView}
        style={{
          position: 'absolute',
          bottom: '20px',
          right: '10px',
          zIndex: 1000,
          padding: '6px 12px',
          fontSize: '12px',
          fontWeight: 500,
          color: '#fff',
          background: 'var(--accent)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          transition: 'background 150ms var(--ease-out), border-color 150ms var(--ease-out), transform 140ms var(--ease-out)',
          outline: 'none'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--accent-strong)';
          e.currentTarget.style.borderColor = 'var(--accent-strong)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent)';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        title="Reset camera and clear all selections"
      >
        Reset
      </button>

      {/* Selection Box Help Tooltip - Black & Green Theme */}
      {selectionMode && !isSelecting && !cuboidDimensions && (
        <div style={{
          position: 'absolute',
          top: '60px',
          right: '10px',
          zIndex: 1000,
          background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.95) 0%, rgba(20, 40, 20, 0.95) 100%)',
          border: '1px solid rgba(74, 222, 128, 0.5)',
          color: 'white',
          padding: '14px 16px',
          borderRadius: '10px',
          fontSize: '13px',
          maxWidth: '240px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 20px rgba(74, 222, 128, 0.1)',
          lineHeight: '1.6'
        }}>
          <div style={{
            fontWeight: 'bold',
            marginBottom: '10px',
            fontSize: '15px',
            color: '#4ade80',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>📦</span> How to Select:
          </div>
          <div style={{ marginBottom: '6px' }}>
            <span style={{ color: '#4ade80' }}>•</span> <strong>Click & drag</strong> to draw selection box
          </div>
          <div style={{ marginBottom: '6px' }}>
            <span style={{ color: '#4ade80' }}>•</span> <strong>Scroll</strong> while drawing to adjust Z-depth
          </div>
          <div>
            <span style={{ color: '#4ade80' }}>•</span> Release to confirm selection
          </div>
        </div>
      )}

      {/* Cuboid Dimensions Display */}
      {selectionMode && cuboidDimensions && (
        <div style={{
          position: 'absolute',
          top: '60px',
          right: '10px',
          zIndex: 1000,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '10px',
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: 'monospace',
          minWidth: '200px'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '5px', borderBottom: '1px solid #555', paddingBottom: '5px' }}>
            3D Cuboid Selection
          </div>
          <div>Width: {cuboidDimensions.width} μm</div>
          <div>Height: {cuboidDimensions.height} μm</div>
          <div>Depth: {cuboidDimensions.depth} μm</div>
          <div style={{ marginTop: '5px', borderTop: '1px solid #555', paddingTop: '5px' }}>
            Volume: {cuboidDimensions.volume} μm³
          </div>
          {isSelecting && (
            <div style={{ marginTop: '5px', color: '#00ff00', fontSize: '11px' }}>
              Scroll to adjust Z-depth
            </div>
          )}
        </div>
      )}

      {/* Active Regions HUD */}
      {activeRegions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            background: 'rgba(0, 0, 0, 0.65)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            borderRadius: '8px',
            padding: '12px 14px',
            color: '#FFFFFF',
            pointerEvents: 'none',
            backdropFilter: 'blur(6px)',
            maxWidth: '260px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
        >
          {activeRegions.map((region) => (
            <div key={`hud-${region.id}`} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>
                {region.title}
              </div>
              {region.topMarkers.map((marker) => (
                <div
                  key={`${region.id}-${marker.name}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    lineHeight: 1.4
                  }}
                >
                  <span
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '3px',
                      backgroundColor: marker.color,
                      border: '1px solid rgba(255,255,255,0.25)',
                      flexShrink: 0
                    }}
                  />
                  <span>{marker.name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Main_View;

