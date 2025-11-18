import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

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

const loadChannelData = async (channelIndex) => {
  for (const path of buildLoadPaths(channelIndex)) {
    try {
      const metadataResponse = await fetch(path.metadata);
      if (!metadataResponse.ok) continue;

      const contentType = metadataResponse.headers.get('content-type');
      if (contentType && !contentType.includes('application/json')) continue;

      const metadataText = await metadataResponse.text();
      if (metadataText.trim().startsWith('<!DOCTYPE') || metadataText.trim().startsWith('<html')) continue;

      const metadata = JSON.parse(metadataText);

      const dataResponse = await fetch(path.data);
      if (!dataResponse.ok) continue;

      const dataContentType = dataResponse.headers.get('content-type');
      if (dataContentType && dataContentType.includes('text/html')) continue;

      const arrayBuffer = await dataResponse.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      return { data, metadata };
    } catch (error) {
      if (!error.message.includes('Unexpected token') && !error.message.includes('JSON')) {
        console.log(`Direction_view: Channel ${channelIndex} error trying ${path.data}:`, error.message);
      }
    }
  }
  return null;
};

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

const computePrincipalDirection = (points) => {
  if (points.length < 2) return null;

  const n = points.length;
  const mean = new THREE.Vector3();
  points.forEach((p) => mean.add(p));
  mean.divideScalar(n);

  const centered = points.map((p) => new THREE.Vector3().subVectors(p, mean));

  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  centered.forEach((p) => {
    xx += p.x * p.x;
    xy += p.x * p.y;
    xz += p.x * p.z;
    yy += p.y * p.y;
    yz += p.y * p.z;
    zz += p.z * p.z;
  });

  const cov = [
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz]
  ];

  const trace = xx + yy + zz;
  const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - xz * yz) + xz * (xy * yz - yy * xz);
  const q = (trace * trace - (xx * xx + yy * yy + zz * zz + 2 * (xy * xy + xz * xz + yz * yz))) / 2;

  if (q <= 0) {
    const minPoint = new THREE.Vector3(Infinity, Infinity, Infinity);
    const maxPoint = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    points.forEach((p) => {
      minPoint.min(p);
      maxPoint.max(p);
    });
    const direction = new THREE.Vector3().subVectors(maxPoint, minPoint).normalize();
    return { direction, center: mean };
  }

  const p = trace;
  const r = det;
  const phi = Math.acos(Math.max(-1, Math.min(1, (2 * p * p * p - 9 * p * q + 27 * r) / (2 * Math.pow(p * p - 3 * q, 1.5)))));
  
  const sqrtTerm = Math.sqrt(p * p - 3 * q);
  const lambda1 = p / 3 + (2 / 3) * sqrtTerm * Math.cos(phi / 3);
  const lambda2 = p / 3 + (2 / 3) * sqrtTerm * Math.cos((phi + 2 * Math.PI) / 3);
  const lambda3 = p / 3 + (2 / 3) * sqrtTerm * Math.cos((phi + 4 * Math.PI) / 3);

  const maxLambda = Math.max(lambda1, lambda2, lambda3);

  let direction = new THREE.Vector3(1, 0, 0);
  
  if (Math.abs(maxLambda - lambda1) < 0.001) {
    const denom = (yy - lambda1) * (zz - lambda1) - yz * yz;
    if (Math.abs(denom) > 1e-6) {
      const y = (xy * (zz - lambda1) - xz * yz) / denom;
      const z = (xz - yz * y) / (zz - lambda1);
      direction = new THREE.Vector3(1, y, z).normalize();
    }
  } else if (Math.abs(maxLambda - lambda2) < 0.001) {
    const denom = (xx - lambda2) * (zz - lambda2) - xz * xz;
    if (Math.abs(denom) > 1e-6) {
      const x = (xy * (zz - lambda2) - xz * yz) / denom;
      const z = (yz - xz * x) / (zz - lambda2);
      direction = new THREE.Vector3(x, 1, z).normalize();
    }
  } else {
    const denom = (xx - lambda3) * (yy - lambda3) - xy * xy;
    if (Math.abs(denom) > 1e-6) {
      const x = (xy * (yy - lambda3) - xz * xy) / denom;
      const y = (xz - xy * x) / (yy - lambda3);
      direction = new THREE.Vector3(x, y, 1).normalize();
    }
  }

  if (direction.length() < 0.1) {
    const minPoint = new THREE.Vector3(Infinity, Infinity, Infinity);
    const maxPoint = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    points.forEach((p) => {
      minPoint.min(p);
      maxPoint.max(p);
    });
    direction = new THREE.Vector3().subVectors(maxPoint, minPoint).normalize();
  }

  return { direction, center: mean };
};

const Direction_view = ({ channels = [] }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const animationRef = useRef(null);
  const arrowsRef = useRef([]);
  const channelDataCacheRef = useRef(new Map());
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0, z: 0 });

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
    let cameraDistance = 1.5;
    let cameraRotationX = 0;
    let cameraRotationY = 0;

    const updateCameraPosition = () => {
      const x = cameraDistance * Math.sin(cameraRotationY) * Math.cos(cameraRotationX);
      const y = cameraDistance * Math.sin(cameraRotationX);
      const z = cameraDistance * Math.cos(cameraRotationY) * Math.cos(cameraRotationX);
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    };

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
        cameraRotationY += deltaX;
        cameraRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraRotationX + deltaY));
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
      cameraDistance *= 1 + event.deltaY * 0.001;
      cameraDistance = Math.max(0.5, Math.min(5, cameraDistance));
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
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
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
            const principalResult = computePrincipalDirection(highIntensityPointsOriginal);
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
        border: '1px solid #444',
        padding: '1px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}
    >
      <h3
        style={{
          margin: '8px',
          fontSize: '14px',
          color: 'white',
          fontWeight: 500,
          flexShrink: 0
        }}
      >
        Direction View
      </h3>
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
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: 'rgba(0, 0, 0, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '4px',
            padding: '6px 10px',
            color: '#ffffff',
            fontSize: '12px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 1000
          }}
        >
          X: {mousePosition.x} | Y: {mousePosition.y} | Z: {mousePosition.z}
        </div>
      </div>
    </div>
  );
};

export default Direction_view;
