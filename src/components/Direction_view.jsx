import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadChannelData } from '../hooks/useChannelData';
import { principalAxis, dominantAxisLabel } from '../services/directionStats';
import { getBiomarkerName } from '../utils/regionStats';
import AskTissueButton from './AskTissueButton';
import { useAgentActions } from '../services/agentActions';

// Load channel data using utility
// Note: loadChannelData is now imported from hooks/useChannelData

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    }
    : { r: 1, g: 1, b: 1 };
};

const Direction_view = ({ channels = [], onToggleMaximize, isMaximized = false }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const animationRef = useRef(null);
  const arrowsRef = useRef([]);
  const channelDataCacheRef = useRef(new Map());
  // Orbit state shared between manual drag/zoom and the agent camera tools, so
  // an AI-driven setView/reset stays in sync with the next manual interaction.
  const orbitRef = useRef({ distance: 1.658, rotX: 0.306, rotY: 0.322 });
  const applyOrbitRef = useRef(null); // set by the scene effect to updateCameraPosition
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0, z: 0 });
  // Per-channel orientation metrics, lifted for the Tissue Intelligence trigger.
  const [dirStats, setDirStats] = useState([]);

  const { registerActions, unregisterActions } = useAgentActions();
  useEffect(() => {
    const applies = (p) => p === 'direction' || p === undefined || p === null;
    // Write the orbit state and re-render via the scene's updateCameraPosition,
    // so a subsequent manual drag continues from where the AI left off.
    const applyOrbit = (orbit) => {
      orbitRef.current = { ...orbitRef.current, ...orbit };
      if (applyOrbitRef.current) applyOrbitRef.current();
    };
    const reset = ({ panel } = {}) => {
      if (!applies(panel) || !cameraRef.current) return { message: 'No Direction View camera here.' };
      applyOrbit({ distance: 1.658, rotX: 0.306, rotY: 0.322 });
      return { message: 'Reset Direction View camera' };
    };
    const setView = ({ panel, orientation } = {}) => {
      if (!applies(panel) || !cameraRef.current) return { message: 'No Direction View camera here.' };
      // (rotX, rotY) in the same spherical convention as the orbit controls.
      const poses = {
        front: { rotX: 0, rotY: 0 },
        side: { rotX: 0, rotY: Math.PI / 2 },
        top: { rotX: 1.55, rotY: 0 }, // just under PI/2 to avoid a degenerate look-down
        iso: { rotX: Math.PI / 6, rotY: Math.PI / 4 }
      };
      const pose = poses[orientation] || poses.iso;
      applyOrbit({ distance: 1.5, ...pose });
      return { message: `Direction View: ${orientation || 'iso'} view` };
    };
    registerActions({ resetCamera: reset, setView, focusCamera: reset });
    return () => unregisterActions(['resetCamera', 'setView', 'focusCamera']);
  }, [registerActions, unregisterActions]);

  const disposeArrow = (arrow) => {
    if (!arrow) return;
    if (arrow.line) {
      if (arrow.line.geometry) arrow.line.geometry.dispose();
      if (arrow.line.material) arrow.line.material.dispose();
    }
    if (arrow.cone) {
      if (arrow.cone.geometry) arrow.cone.geometry.dispose();
      if (arrow.cone.material) arrow.cone.material.dispose();
    }
  };

  const createArrow = useCallback((direction, center, color, length = 0.6, thickness = 0.05) => {
    const hexColor = color.replace('#', '');
    const r = parseInt(hexColor.substring(0, 2), 16) / 255;
    const g = parseInt(hexColor.substring(2, 4), 16) / 255;
    const b = parseInt(hexColor.substring(4, 6), 16) / 255;

    const normalizedDir = direction.clone().normalize();
    const start = new THREE.Vector3().copy(center).sub(normalizedDir.clone().multiplyScalar(length / 2));
    const end = new THREE.Vector3().copy(center).add(normalizedDir.clone().multiplyScalar(length / 2));

    const lineVector = new THREE.Vector3().subVectors(end, start);
    const lineLength = lineVector.length();
    const lineCenter = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

    const cylinderGeometry = new THREE.CylinderGeometry(thickness, thickness, lineLength, 16);
    const cylinderMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
    const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);

    cylinder.position.copy(lineCenter);
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(up, normalizedDir);
    cylinder.setRotationFromQuaternion(quaternion);

    const coneLength = length * 0.2;
    const coneRadius = thickness * 2.0;
    const coneGeometry = new THREE.ConeGeometry(coneRadius, coneLength, 16);
    const coneMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);

    const arrowDirection = normalizedDir.clone();
    const coneCenter = end.clone();
    cone.position.copy(coneCenter);

    const coneUp = new THREE.Vector3(0, 1, 0);
    const coneQuaternion = new THREE.Quaternion();
    coneQuaternion.setFromUnitVectors(coneUp, arrowDirection);
    cone.setRotationFromQuaternion(coneQuaternion);

    return { line: cylinder, cone };
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0.5, 0.5, 1.5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (renderer.outputColorSpace !== undefined) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    let isRotating = false;
    let isPanning = false;
    let mouseX = 0;
    let mouseY = 0;

    const updateCameraPosition = () => {
      const { distance, rotX, rotY } = orbitRef.current;
      const x = distance * Math.sin(rotY) * Math.cos(rotX);
      const y = distance * Math.sin(rotX);
      const z = distance * Math.cos(rotY) * Math.cos(rotX);
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    };
    // Expose to the agent camera tools, and align the initial camera with the
    // orbit state so the first manual drag doesn't jump.
    applyOrbitRef.current = updateCameraPosition;
    updateCameraPosition();

    const handleMouseDown = (event) => {
      if (event.button === 0) {
        isRotating = true;
        renderer.domElement.style.cursor = 'grabbing';
      }
      if (event.button === 2) isPanning = true;
      mouseX = event.clientX;
      mouseY = event.clientY;
    };

    const handleMouseUp = () => {
      isRotating = false;
      isPanning = false;
      renderer.domElement.style.cursor = 'grab';
    };

    const handleMouseMove = (event) => {
      if (isRotating) {
        const deltaX = (event.clientX - mouseX) * 0.01;
        const deltaY = (event.clientY - mouseY) * 0.01;
        const o = orbitRef.current;
        o.rotY += deltaX;
        o.rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, o.rotX + deltaY));
        updateCameraPosition();
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersection);

      setMousePosition({
        x: intersection.x.toFixed(3),
        y: intersection.y.toFixed(3),
        z: intersection.z.toFixed(3)
      });

      mouseX = event.clientX;
      mouseY = event.clientY;
    };

    const handleWheel = (event) => {
      event.preventDefault();
      const o = orbitRef.current;
      o.distance = Math.max(0.5, Math.min(5, o.distance * (1 + event.deltaY * 0.001)));
      updateCameraPosition();
    };

    const handleContextMenu = (event) => event.preventDefault();

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('wheel', handleWheel);
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    renderer.domElement.style.cursor = 'grab';

    const animate = () => {
      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      if (newWidth === 0 || newHeight === 0) return;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
      camera.lookAt(0, 0, 0); // keep arrows centered after a resize (e.g. maximize)
    };
    // Observe the container (not just the window) so maximizing the panel —
    // which changes the container size without a window resize — refits the scene.
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      arrowsRef.current.forEach(disposeArrow);
      arrowsRef.current = [];
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    arrowsRef.current.forEach((arrow) => {
      if (arrow.line && scene.children.includes(arrow.line)) {
        scene.remove(arrow.line);
      }
      if (arrow.cone && scene.children.includes(arrow.cone)) {
        scene.remove(arrow.cone);
      }
      disposeArrow(arrow);
    });
    arrowsRef.current = [];

    if (channels.length === 0) {
      if (rendererRef.current && cameraRef.current) {
        rendererRef.current.render(scene, cameraRef.current);
      }
      return;
    }

    const processChannels = async () => {
      const visibleChannels = channels.filter(ch => ch.visible !== false);
      console.log(`Direction_view: Processing ${visibleChannels.length} visible channel(s) out of ${channels.length} total`);
      console.log(`Direction_view: Visible channels:`, visibleChannels.map(ch => ({ index: ch.channelIndex, color: ch.color, visible: ch.visible })));

      const collectedStats = []; // per-channel orientation metrics for Tissue Intelligence

      for (const channelConfig of visibleChannels) {
        const channelIndex = channelConfig.channelIndex;
        if (channelIndex === undefined || channelIndex === null) {
          console.warn(`Direction_view: Channel config missing channelIndex:`, channelConfig);
          continue;
        }

        const colorHex = channelConfig.color || '#ffffff';
        console.log(`Direction_view: Processing channel ${channelIndex} (visible: ${channelConfig.visible !== false}) with color ${colorHex}`, {
          channelConfig: {
            channelIndex: channelConfig.channelIndex,
            color: channelConfig.color,
            visible: channelConfig.visible,
            id: channelConfig.id
          }
        });

        try {
          let channelData = channelDataCacheRef.current.get(channelIndex);
          if (!channelData) {
            channelData = await loadChannelData(channelIndex);
            if (channelData) {
              channelDataCacheRef.current.set(channelIndex, channelData);
            }
          }

          if (!channelData) {
            console.warn(`Direction_view: Could not load channel ${channelIndex}, creating default arrow`);
            const defaultDirection = new THREE.Vector3(1, 0, 0).normalize();
            const defaultCenter = new THREE.Vector3(0, 0, 0);
            const defaultThickness = 0.02;
            const defaultLength = 1.5;
            const defaultArrow = createArrow(defaultDirection, defaultCenter, colorHex, defaultLength, defaultThickness);
            scene.add(defaultArrow.line);
            scene.add(defaultArrow.cone);
            arrowsRef.current.push(defaultArrow);
            continue;
          }

          const { data, metadata } = channelData;
          const [zSize, ySize, xSize] = metadata.shape || [];
          if (!zSize || !ySize || !xSize) {
            console.warn(`Direction_view: Invalid shape for channel ${channelIndex}, creating default arrow`);
            const defaultDirection = new THREE.Vector3(1, 0, 0).normalize();
            const defaultCenter = new THREE.Vector3(0, 0, 0);
            const defaultThickness = 0.02;
            const defaultLength = 1.5;
            const defaultArrow = createArrow(defaultDirection, defaultCenter, colorHex, defaultLength, defaultThickness);
            scene.add(defaultArrow.line);
            scene.add(defaultArrow.cone);
            arrowsRef.current.push(defaultArrow);
            continue;
          }

          const [dataMin = 0, dataMax = 65535] = metadata.dataRange || [];
          const maxIntensity = dataMax;
          const threshold = dataMin + (maxIntensity - dataMin) * 0.6;

          const maxDim = Math.max(zSize, ySize, xSize);
          const scaleX = xSize / maxDim;
          const scaleY = ySize / maxDim;
          const scaleZ = zSize / maxDim;

          const totalVoxels = zSize * ySize * xSize;
          const highIntensityPointsOriginal = [];
          const highIntensityPointsScaled = [];
          const sampling = Math.max(1, Math.floor(Math.cbrt(totalVoxels) / 50));
          let highIntensityCount = 0;

          for (let z = 0; z < zSize; z += sampling) {
            for (let y = 0; y < ySize; y += sampling) {
              for (let x = 0; x < xSize; x += sampling) {
                const idx = z * ySize * xSize + y * xSize + x;
                if (idx >= data.length) continue;
                const normalized = data[idx];
                const value = (normalized / 255) * (dataMax - dataMin) + dataMin;

                if (value >= threshold) {
                  highIntensityCount += sampling * sampling * sampling;
                  highIntensityPointsOriginal.push(new THREE.Vector3(x, y, z));
                  const nx = ((x / xSize) * 2 - 1) * scaleX;
                  const ny = ((y / ySize) * 2 - 1) * scaleY;
                  const nz = ((z / zSize) * 2 - 1) * scaleZ;
                  highIntensityPointsScaled.push(new THREE.Vector3(nx, ny, nz));
                }
              }
            }
          }

          let direction, center;

          if (highIntensityPointsOriginal.length < 2) {
            console.warn(`Direction_view: Not enough high-intensity points (${highIntensityPointsOriginal.length}) for channel ${channelIndex}, using default direction`);
            direction = new THREE.Vector3(1, 0, 0).normalize();
            center = new THREE.Vector3(0, 0, 0);
          } else {
            const principalResult = principalAxis(highIntensityPointsOriginal);
            if (!principalResult) {
              console.warn(`Direction_view: Could not compute principal direction for channel ${channelIndex}, using default`);
              direction = new THREE.Vector3(1, 0, 0).normalize();
              center = new THREE.Vector3(0, 0, 0);
            } else {
              const originalDirection = principalResult.direction;
              const originalCenter = principalResult.center;

              const centerX = ((originalCenter.x / xSize) * 2 - 1) * scaleX;
              const centerY = ((originalCenter.y / ySize) * 2 - 1) * scaleY;
              const centerZ = ((originalCenter.z / zSize) * 2 - 1) * scaleZ;
              center = new THREE.Vector3(centerX, centerY, centerZ);

              const dirX = originalDirection.x * scaleX;
              const dirY = originalDirection.y * scaleY;
              const dirZ = originalDirection.z * scaleZ;
              direction = new THREE.Vector3(dirX, dirY, dirZ).normalize();

              // Grounding metrics use the raw (unscaled) voxel-space orientation.
              collectedStats.push({
                name: getBiomarkerName(channelIndex),
                direction: originalDirection,
                coherence: principalResult.coherence,
                dominantAxis: dominantAxisLabel(originalDirection)
              });

              console.log(`Direction_view: Channel ${channelIndex} - Original direction: (${originalDirection.x.toFixed(3)}, ${originalDirection.y.toFixed(3)}, ${originalDirection.z.toFixed(3)}), Scaled direction: (${direction.x.toFixed(3)}, ${direction.y.toFixed(3)}, ${direction.z.toFixed(3)})`);
            }
          }

          const voxelRatio = highIntensityCount / totalVoxels;
          const baseThickness = 0.02;
          const thickness = Math.max(baseThickness, Math.min(0.05, baseThickness + voxelRatio * 0.03));
          const arrowLength = 1.5;

          const arrow = createArrow(direction, center, colorHex, arrowLength, thickness);
          console.log(`Direction_view: Created arrow for channel ${channelIndex} with thickness ${thickness.toFixed(3)} and color ${colorHex}`);

          scene.add(arrow.line);
          scene.add(arrow.cone);
          arrowsRef.current.push(arrow);
        } catch (error) {
          console.error(`Direction_view: Error processing channel ${channelIndex}:`, error);
        }
      }

      console.log(`Direction_view: Created ${arrowsRef.current.length} arrow(s) for ${visibleChannels.length} visible channel(s)`);
      setDirStats(collectedStats);

      if (rendererRef.current && cameraRef.current) {
        rendererRef.current.render(scene, cameraRef.current);
      }
    };

    processChannels();
  }, [channels, createArrow]);

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        backgroundColor: '#000000',
        borderTop: '1px solid var(--border)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}
    >
      {/* Header - matches Graph Panel and Local View */}
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
        <h3
          style={{
            margin: 0,
            fontSize: '15px',
            color: 'var(--text-1)',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {/* Composite Glyph: Compass + Directional arrows (uniform blue accent) */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 0 3px rgba(59,130,246,0.5))' }}>
            {/* Compass circle */}
            <circle cx="12" cy="12" r="10" stroke="#3b82f6" strokeWidth="1.5" fill="rgba(59,130,246,0.12)" />
            {/* Cardinal direction markers */}
            <circle cx="12" cy="3" r="1.5" fill="#fff" />
            <circle cx="21" cy="12" r="1.5" fill="#3b82f6" />
            <circle cx="12" cy="21" r="1.5" fill="#fff" opacity="0.5" />
            <circle cx="3" cy="12" r="1.5" fill="#3b82f6" opacity="0.5" />
            {/* Direction arrow */}
            <path d="M12 7L16 12L12 17L8 12Z" fill="#3b82f6" stroke="#fff" strokeWidth="1" />
            <path d="M12 7L12 12" stroke="#fff" strokeWidth="1.5" />
          </svg>
          <span style={{ color: 'var(--text-1)' }}>Direction View</span>
          {onToggleMaximize && (
            <button
              type="button"
              className="mtv-press"
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
      </div>
      <div
        ref={mountRef}
        style={{
          width: '100%',
          flex: 1,
          overflow: 'hidden',
          boxSizing: 'border-box',
          position: 'relative'
        }}
      >
        {/* Ask AI - floating top-right of the body */}
        <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 6 }}>
          <AskTissueButton
            variant="chip"
            disabled={dirStats.length === 0}
            descriptor={{
              id: 'orientation',
              kind: 'orientation',
              title: 'Direction View',
              resolve: async () => dirStats
            }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            top: '6px',
            left: '6px',
            background: 'rgba(0, 0, 0, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '4px',
            padding: '4px 8px',
            color: '#ffffff',
            fontSize: '11px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 5
          }}
        >
          X: {mousePosition.x} | Y: {mousePosition.y} | Z: {mousePosition.z}
        </div>
      </div>
    </div>
  );
};

export default Direction_view;
