import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DetailStyle, LightingPreset, Model3DSpec } from '../types/model3d';
import { buildThreeModelGroup } from '../utils/geometryBuilder';

interface Viewport3DProps {
  model: Model3DSpec;
  detailStyle?: DetailStyle;
  lightingPreset?: LightingPreset;
  autoRotate?: boolean;
  wireframe?: boolean;
  xrayMode?: boolean;
  showGrid?: boolean;
  backgroundColor?: string;
  selectedPartId?: string | null;
  interactionMode?: 'select' | 'paint';
  activePaintColor?: string;
  compact?: boolean;
  onSelectPart?: (partId: string | null) => void;
  onPaintPart?: (partId: string) => void;
  onStatsUpdate?: (stats: { vertices: number; triangles: number; parts: number }) => void;
   cameraViewTrigger?: { view: 'iso' | 'front' | 'side' | 'top' | 'reset'; ts: number } | null;
  screenshotTrigger?: number;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  model,
  detailStyle = 'high-detail',
  lightingPreset = 'studio',
  autoRotate = false,
  wireframe = false,
  xrayMode = false,
  showGrid = true,
  backgroundColor = '#0c0f17',
  selectedPartId = null,
  interactionMode = 'select',
  activePaintColor = '#06b6d4',
  compact = false,
  onSelectPart,
  onPaintPart,
  onStatsUpdate,
  cameraViewTrigger,
  screenshotTrigger,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const lightsGroupRef = useRef<THREE.Group | null>(null);

  const [hoveredPart, setHoveredPart] = useState<{
    id: string;
    name: string;
    x: number;
    y: number;
  } | null>(null);

  const pointerDownPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoveredPartIdRef = useRef<string | null>(null);

  // Initialize Three.js Scene, Camera, Renderer, Environment
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
    camera.position.set(4.2, 3.1, 4.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Studio PMREM reflection environment for realistic metallic/glass surfaces
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 1.2, 0);
    controls.minDistance = 1.2;
    controls.maxDistance = 28;
    controls.maxPolarAngle = Math.PI / 2 + 0.15;
    controlsRef.current = controls;

    // Studio Floor Grid & Shadow Catcher
    const gridGroup = new THREE.Group();
    const grid = new THREE.GridHelper(16, 32, 0x4f46e5, 0x1e2536);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    gridGroup.add(grid);

    const floorGeo = new THREE.CircleGeometry(8, 48);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.005;
    floorMesh.receiveShadow = true;
    gridGroup.add(floorMesh);

    scene.add(gridGroup);
    gridHelperRef.current = grid;

    // Lights Group
    const lightsGroup = new THREE.Group();
    scene.add(lightsGroup);
    lightsGroupRef.current = lightsGroup;

    // Resize observer
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Animation Loop
    let reqId = 0;
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(reqId);
      resizeObserver.disconnect();
      controls.dispose();
      envTexture.dispose();
      renderer.dispose();
    };
  }, []);

  // Update background color & grid visibility
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(backgroundColor);
    }
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = showGrid;
    }
  }, [backgroundColor, showGrid]);

  // Update autoRotate
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = compact ? 2.4 : 1.8;
    }
  }, [autoRotate, compact]);

  // Update Lighting Preset
  useEffect(() => {
    const lightsGroup = lightsGroupRef.current;
    if (!lightsGroup) return;

    while (lightsGroup.children.length > 0) {
      lightsGroup.remove(lightsGroup.children[0]);
    }

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(6, 10, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 1.0);
    fillLight.position.set(-6, 5, -4);

    const rimLight = new THREE.PointLight(0x818cf8, 2.0, 20);
    rimLight.position.set(0, 5, -6);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);

    if (lightingPreset === 'cyberpunk') {
      keyLight.color.setHex(0x06b6d4);
      keyLight.intensity = 2.6;
      fillLight.color.setHex(0xec4899);
      fillLight.intensity = 2.2;
      rimLight.color.setHex(0xa855f7);
      rimLight.intensity = 3.0;
      ambient.intensity = 0.35;
    } else if (lightingPreset === 'sunset') {
      keyLight.color.setHex(0xf97316);
      keyLight.intensity = 2.8;
      fillLight.color.setHex(0xec4899);
      fillLight.intensity = 1.4;
      rimLight.color.setHex(0xfacc15);
      rimLight.intensity = 2.2;
    } else if (lightingPreset === 'showroom') {
      keyLight.color.setHex(0xffffff);
      keyLight.intensity = 2.8;
      fillLight.color.setHex(0xe2e8f0);
      fillLight.intensity = 1.6;
      ambient.intensity = 0.85;
    } else if (lightingPreset === 'dramatic') {
      keyLight.color.setHex(0xf8fafc);
      keyLight.intensity = 3.2;
      fillLight.color.setHex(0x1e293b);
      fillLight.intensity = 0.4;
      rimLight.color.setHex(0x38bdf8);
      rimLight.intensity = 3.5;
      ambient.intensity = 0.2;
    }

    lightsGroup.add(keyLight, fillLight, rimLight, ambient);
  }, [lightingPreset]);

  // Rebuild 3D Model Group whenever model, detailStyle, wireframe, xrayMode, or selected/hovered part changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (modelGroupRef.current) {
      scene.remove(modelGroupRef.current);
      modelGroupRef.current.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material?.dispose();
          }
        }
      });
    }

    const { group, vertexCount, triangleCount } = buildThreeModelGroup(model, {
      detailStyle,
      globalWireframe: wireframe,
      xrayMode,
      selectedPartId,
      hoveredPartId: hoveredPart?.id || null,
    });

    scene.add(group);
    modelGroupRef.current = group;

    if (onStatsUpdate) {
      onStatsUpdate({
        vertices: vertexCount,
        triangles: triangleCount,
        parts: model.parts.length,
      });
    }
  }, [model, detailStyle, wireframe, xrayMode, selectedPartId, hoveredPart?.id]);

  // Handle Camera View Triggers
  useEffect(() => {
    if (!cameraViewTrigger || !cameraRef.current || !controlsRef.current) return;
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    ctrl.target.set(0, 1.3, 0);

    switch (cameraViewTrigger.view) {
      case 'front':
        cam.position.set(0, 1.6, 5.8);
        break;
      case 'side':
        cam.position.set(5.8, 1.6, 0);
        break;
      case 'top':
        cam.position.set(0, 6.8, 0.01);
        break;
      case 'iso':
      case 'reset':
      default:
        cam.position.set(4.2, 3.1, 4.8);
        break;
    }
    ctrl.update();
  }, [cameraViewTrigger]);

  // Handle PNG Screenshot Capture
  useEffect(() => {
    if (!screenshotTrigger || !rendererRef.current || !sceneRef.current || !cameraRef.current)
      return;

    const renderer = rendererRef.current;
    renderer.render(sceneRef.current, cameraRef.current);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${(model.name || 'forge3d-render')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}-render.png`;
    link.click();
  }, [screenshotTrigger]);

  // Raycast helper for hover and click-to-select / click-to-paint
  const performRaycast = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    const camera = cameraRef.current;
    const modelGroup = modelGroupRef.current;
    if (!container || !camera || !modelGroup) return null;

    const rect = container.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(modelGroup.children, true);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const partId = hit.userData?.partId as string | undefined;
      const partName = hit.userData?.partName as string | undefined;
      if (partId) {
        return {
          id: partId,
          name: partName || 'Part',
          x: clientX - rect.left,
          y: clientY - rect.top,
        };
      }
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (compact) return;
    const hit = performRaycast(e.clientX, e.clientY);
    if (hit) {
      hoveredPartIdRef.current = hit.id;
      setHoveredPart(hit);
    } else if (hoveredPartIdRef.current !== null) {
      hoveredPartIdRef.current = null;
      setHoveredPart(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (compact) return;
    const dist = Math.hypot(
      e.clientX - pointerDownPos.current.x,
      e.clientY - pointerDownPos.current.y
    );
    // Only trigger click if user didn't drag to orbit
    if (dist > 6) return;

    const hit = performRaycast(e.clientX, e.clientY);
    if (hit) {
      if (interactionMode === 'paint' && onPaintPart) {
        onPaintPart(hit.id);
      } else if (onSelectPart) {
        onSelectPart(hit.id);
      }
    } else if (interactionMode === 'select' && onSelectPart) {
      onSelectPart(null);
    }
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        hoveredPartIdRef.current = null;
        setHoveredPart(null);
      }}
      style={{
        cursor: compact
          ? 'grab'
          : hoveredPart
          ? interactionMode === 'paint'
            ? 'crosshair'
            : 'pointer'
          : 'grab',
      }}
    >
      <div ref={containerRef} className="w-full h-full" />

      {/* Floating Hover Tooltip in Main Studio Viewport */}
      {!compact && hoveredPart && (
        <div
          className="pointer-events-none absolute z-20 px-2.5 py-1.5 rounded-lg bg-slate-900/95 border border-slate-700/80 shadow-xl text-xs text-slate-100 flex items-center gap-2 backdrop-blur-md"
          style={{
            left: Math.min(hoveredPart.x + 14, (containerRef.current?.clientWidth || 500) - 180),
            top: Math.max(12, hoveredPart.y - 34),
          }}
        >
          {interactionMode === 'paint' ? (
            <>
              <span
                className="w-3 h-3 rounded-full border border-white/40 shrink-0"
                style={{ backgroundColor: activePaintColor }}
              />
              <span className="font-medium text-cyan-300">Click to Paint:</span>
              <span className="text-white font-semibold">{hoveredPart.name}</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
              <span className="font-semibold">{hoveredPart.name}</span>
              <span className="text-slate-400 text-[10px]">(Click to inspect)</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
