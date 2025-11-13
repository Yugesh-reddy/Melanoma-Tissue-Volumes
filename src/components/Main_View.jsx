import React, { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

const CAMERA_INITIAL_STATE = {
  rotation: { x: 0, y: Math.PI },
  distance: 0.75,
  panOffset: { x: 0, y: 0, z: 0 }
};

const MOVE_SPEED = 0.05;
const FAST_MOVE_SPEED = 0.15;
const LOD_COOLDOWN_MS = 200;
const MAX_POINTS_PER_CHANNEL = 5_000_000;
const OPACITY_FLOOR = 0.35;
const OPACITY_BOOST = 1.3;
const EDGE_FEATHER = 0.99;
const JITTER_SCALE = 0.1;
const AMBIENT_COLOR = new THREE.Color(0.9, 0.9, 0.95);
const DEFAULT_THRESHOLD_MIN_FRACTION = 0.1;
const DEFAULT_THRESHOLD_MAX_FRACTION = 0.9;

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

const Main_View = ({ channels = [], activeRegions = [] }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
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

  const cameraStateRef = useRef({ ...CAMERA_INITIAL_STATE });

  const getDesiredSampling = useCallback((distance = 3) => {
    if (distance >= 8) return 6;
    if (distance >= 5.5) return 4;
    if (distance >= 3.5) return 3;
    if (distance >= 2) return 2;
    return 1;
  }, []);

  const loadChannelData = useCallback(async (channelIndex) => {
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

        console.log(`Channel ${channelIndex}: Successfully loaded from ${path.data}`);
        return { data, metadata };
      } catch (error) {
        if (!error.message.includes('Unexpected token') && !error.message.includes('JSON')) {
          console.log(`Channel ${channelIndex}: Error trying ${path.data}:`, error.message);
        }
      }
    }

    console.warn(`Channel ${channelIndex}: Could not find data file in expected locations`);
    return null;
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
      if (totalVoxels > 1_000_000) {
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
    const state = cameraStateRef.current;
    let moved = false;

    const forward = new THREE.Vector3();
    const offset = new THREE.Vector3();

    const applyOffset = (vector) => {
      state.panOffset.x += vector.x;
      state.panOffset.y += vector.y;
      state.panOffset.z += vector.z;
    };

    if (keys.w || keys.arrowup) {
      camera.getWorldDirection(forward);
      applyOffset(forward.multiplyScalar(speed));
      moved = true;
    }
    if (keys.s || keys.arrowdown) {
      camera.getWorldDirection(forward);
      applyOffset(forward.multiplyScalar(-speed));
      moved = true;
    }
    if (keys.a || keys.arrowleft) {
      camera.getWorldDirection(forward);
      offset.crossVectors(camera.up, forward).normalize().multiplyScalar(speed);
      applyOffset(offset);
      moved = true;
    }
    if (keys.d || keys.arrowright) {
      camera.getWorldDirection(forward);
      offset.crossVectors(camera.up, forward).normalize().multiplyScalar(-speed);
      applyOffset(offset);
      moved = true;
    }
    if (keys.q) {
      offset.copy(camera.up).normalize().multiplyScalar(speed);
      applyOffset(offset);
      moved = true;
    }
    if (keys.e) {
      offset.copy(camera.up).normalize().multiplyScalar(-speed);
      applyOffset(offset);
      moved = true;
    }

    if (moved) {
      updateCameraPosition();
      updateChannelLOD();
    }
  }, [updateCameraPosition, updateChannelLOD]);

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

    const handleMouseDown = (event) => {
      if (event.button === 0) isRotating = true;
      if (event.button === 2) isPanning = true;
      mouseX = event.clientX;
      mouseY = event.clientY;
    };

    const handleMouseUp = () => {
      isRotating = false;
      isPanning = false;
    };

    const handleMouseMove = (event) => {
      const state = cameraStateRef.current;
      if (isRotating) {
        state.rotation.y += (event.clientX - mouseX) * 0.01;
        state.rotation.x = clamp(state.rotation.x + (event.clientY - mouseY) * 0.01, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
        updateCameraPosition();
        updateChannelLOD();
      }
      if (isPanning) {
        state.panOffset.x += (event.clientX - mouseX) * 0.001;
        state.panOffset.y -= (event.clientY - mouseY) * 0.001;
        updateCameraPosition();
      }
      mouseX = event.clientX;
      mouseY = event.clientY;
    };

    const handleWheel = (event) => {
      const state = cameraStateRef.current;
      state.distance *= 1 + event.deltaY * 0.001;
      state.distance = clamp(state.distance, 0.1, 20);
      updateCameraPosition();
      updateChannelLOD();
    };

    const handleContextMenu = (event) => event.preventDefault();

    const handleKeyDown = (event) => {
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

    const activeChannelIndices = new Set(channels.map((cfg) => cfg.channelIndex));

    loadedChannels.forEach((entry, channelIndex) => {
      if (!activeChannelIndices.has(channelIndex)) {
        const mesh = entry?.mesh;
        if (mesh && scene.children.includes(mesh)) {
          scene.remove(mesh);
        }
        disposeMesh(mesh);
        removeMeshFromCollection(mesh, pointCloudsRef.current);
        loadedChannels.delete(channelIndex);
        channelDataCache.delete(channelIndex);
        console.log(`Main_View: 🗑️ Removed channel ${channelIndex} (no longer selected)`);
      }
    });

    channelConfigsRef.current.clear();

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
        console.log(`Main_View: ♻️ Channel ${channelIndex} flagged for reload due to configuration change`);
      }

      if (mesh) {
        const isVisible = channelConfig.visible !== false;
        const currentlyInScene = scene.children.includes(mesh);
        if (isVisible && !currentlyInScene) {
          scene.add(mesh);
          console.log(`Main_View: ✅ Channel ${channelIndex} turned ON`);
          renderScene();
        } else if (!isVisible && currentlyInScene) {
          scene.remove(mesh);
          console.log(`Main_View: ⚠️ Channel ${channelIndex} turned OFF`);
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
          let channelData = channelDataCache.get(channelConfig.channelIndex);
          if (!channelData) {
            channelData = await loadChannelData(channelConfig.channelIndex);
            if (channelData) {
              channelDataCache.set(channelConfig.channelIndex, channelData);
            }
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
              console.log(`Main_View: ✅ Channel ${channelConfig.channelIndex} added (sampling=${sampling})`);
            } else {
              console.log(`Main_View: ⚠️ Channel ${channelConfig.channelIndex} prepared but not visible`);
            }

            renderScene();
          } else {
            console.warn(`Main_View: ⚠️ Channel ${channelConfig.channelIndex} produced no voxels`);
          }
        } catch (error) {
          console.error(`Main_View: ❌ Error loading channel ${channelConfig.channelIndex}:`, error);
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const visibleCount = visibleChannels.filter((cfg) => {
        const entry = loadedChannels.get(cfg.channelIndex);
        return entry?.mesh && scene.children.includes(entry.mesh);
      }).length;
      console.log(`Main_View: Channel update complete. Visible ${visibleCount}/${visibleChannels.length}`);
      renderScene();
    };

    loadChannels();
  }, [channels, createChannelVisualization, getDesiredSampling, loadChannelData, renderScene]);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative', backgroundColor: '#000000' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />
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

