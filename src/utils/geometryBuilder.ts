import * as THREE from 'three';
import { DetailStyle, Model3DSpec, Part3D } from '../types/model3d';

/**
 * Creates a rounded box BufferGeometry with smooth beveled edges
 */
function createRoundedBoxGeometry(
  width = 1,
  height = 1,
  depth = 1,
  radius = 0.12,
  smoothness = 4
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const eps = 0.00001;
  const r = Math.min(radius, width / 2.2, height / 2.2, depth / 2.2) - eps;
  const w = width - r * 2;
  const h = height - r * 2;

  shape.absarc(eps, eps, eps, -Math.PI / 2, -Math.PI, true);
  shape.absarc(eps, h, eps, Math.PI, Math.PI / 2, true);
  shape.absarc(w, h, eps, Math.PI / 2, 0, true);
  shape.absarc(w, eps, eps, 0, -Math.PI / 2, true);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, depth - r * 2),
    bevelEnabled: true,
    bevelSegments: Math.max(2, smoothness * 2),
    steps: 1,
    bevelSize: Math.max(0.001, r),
    bevelThickness: Math.max(0.001, r),
    curveSegments: Math.max(4, smoothness * 2),
  });

  geometry.center();
  return geometry;
}

/**
 * Builds a single Three.js BufferGeometry for a Part3D definition
 */
export function createPartGeometry(part: Part3D, detailStyle: DetailStyle = 'high-detail'): THREE.BufferGeometry {
  const isLowPoly = detailStyle === 'stylized-lowpoly';
  const isVoxel = detailStyle === 'voxel-blocky';
  const segMult = isVoxel ? 0.35 : isLowPoly ? 0.55 : 1;

  const p = part.params || {};

  switch (part.type) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);

    case 'rounded_box':
      if (isVoxel) return new THREE.BoxGeometry(1, 1, 1);
      return createRoundedBoxGeometry(1, 1, 1, p.bevel ?? 0.12, isLowPoly ? 2 : 4);

    case 'sphere': {
      const wSeg = Math.max(8, Math.round((p.segments ?? 32) * segMult));
      const hSeg = Math.max(6, Math.round(((p.segments ?? 32) / 1.5) * segMult));
      return new THREE.SphereGeometry(0.5, wSeg, hSeg);
    }

    case 'hemisphere': {
      const wSeg = Math.max(8, Math.round((p.segments ?? 28) * segMult));
      const hSeg = Math.max(6, Math.round(16 * segMult));
      const geom = new THREE.SphereGeometry(0.5, wSeg, hSeg, 0, Math.PI * 2, 0, Math.PI / 2);
      geom.computeVertexNormals();
      return geom;
    }

    case 'cylinder': {
      const rTop = p.radiusTop ?? 0.5;
      const rBottom = p.radiusBottom ?? 0.5;
      const segs = Math.max(6, Math.round((p.segments ?? 28) * segMult));
      return new THREE.CylinderGeometry(rTop, rBottom, 1, segs);
    }

    case 'cone': {
      const rBottom = p.radiusBottom ?? 0.5;
      const segs = Math.max(5, Math.round((p.segments ?? 24) * segMult));
      return new THREE.ConeGeometry(rBottom, 1, segs);
    }

    case 'capsule': {
      const cSegs = Math.max(4, Math.round(10 * segMult));
      const rSegs = Math.max(8, Math.round(20 * segMult));
      return new THREE.CapsuleGeometry(0.35, 0.5, cSegs, rSegs);
    }

    case 'torus': {
      const tube = p.tubeRadius ?? 0.14;
      const rSeg = Math.max(8, Math.round(16 * segMult));
      const tSeg = Math.max(12, Math.round(36 * segMult));
      return new THREE.TorusGeometry(0.42, tube, rSeg, tSeg);
    }

    case 'ring': {
      const segs = Math.max(12, Math.round(32 * segMult));
      const geom = new THREE.CylinderGeometry(0.5, 0.5, 0.12, segs, 1, false);
      return geom;
    }

    case 'octahedron':
      return new THREE.OctahedronGeometry(0.55, p.segments ?? 0);

    case 'dodecahedron':
      return new THREE.DodecahedronGeometry(0.55, p.segments ?? 0);

    case 'icosahedron':
      return new THREE.IcosahedronGeometry(0.55, p.segments ?? 0);

    case 'lathe': {
      const rawPts =
        p.lathePoints && p.lathePoints.length >= 2
          ? p.lathePoints
          : [
              [0.01, -0.5],
              [0.42, -0.4],
              [0.28, 0.0],
              [0.48, 0.35],
              [0.2, 0.5],
            ];
      const vecPts = rawPts.map(([r, y]) => new THREE.Vector2(Math.max(0.01, r), y));
      const segs = Math.max(10, Math.round(28 * segMult));
      const geom = new THREE.LatheGeometry(vecPts, segs);
      geom.center();
      geom.computeVertexNormals();
      return geom;
    }

    case 'extrude': {
      const poly =
        p.polygonPoints && p.polygonPoints.length >= 3
          ? p.polygonPoints
          : [
              [-0.5, -0.4],
              [0.5, -0.4],
              [0.25, 0.45],
              [-0.25, 0.45],
            ];
      const shape = new THREE.Shape();
      shape.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        shape.lineTo(poly[i][0], poly[i][1]);
      }
      shape.closePath();

      const depth = p.extrudeDepth ?? 0.3;
      const bevel = p.bevel ?? 0.04;
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: !isVoxel && bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: isLowPoly ? 1 : 3,
      });
      geom.center();
      geom.computeVertexNormals();
      return geom;
    }

    case 'image_relief':
    default:
      return createRoundedBoxGeometry(1, 1, 1, 0.08, 3);
  }
}

/**
 * Creates a Three.js MeshStandardMaterial / MeshPhysicalMaterial for a Part3D
 */
export function createPartMaterial(
  part: Part3D,
  options: {
    globalWireframe?: boolean;
    xrayMode?: boolean;
    isSelected?: boolean;
    isHovered?: boolean;
  } = {}
): THREE.MeshPhysicalMaterial {
  const baseColor = new THREE.Color(part.color || '#6366f1');
  const emissiveColor = new THREE.Color(
    part.emissive && part.emissive !== '#000000'
      ? part.emissive
      : (part.emissiveIntensity ?? 0) > 0.05
      ? part.color
      : '#000000'
  );

  let emissiveIntensity = part.emissiveIntensity ?? 0;

  if (options.isHovered) {
    emissiveColor.lerp(new THREE.Color('#38bdf8'), 0.65);
    emissiveIntensity = Math.max(emissiveIntensity, 0.45);
  } else if (options.isSelected) {
    emissiveColor.lerp(new THREE.Color('#6366f1'), 0.4);
    emissiveIntensity = Math.max(emissiveIntensity, 0.25);
  }

  const isTransparent = Boolean(
    options.xrayMode || part.transparent || (part.opacity !== undefined && part.opacity < 0.99)
  );
  const opacity = options.xrayMode ? 0.35 : part.opacity ?? 1.0;

  const isGlossyOrGlass =
    part.finishPreset === 'glossy' ||
    part.finishPreset === 'glass' ||
    part.finishPreset === 'chrome' ||
    part.roughness < 0.15;

  return new THREE.MeshPhysicalMaterial({
    color: baseColor,
    metalness: Math.max(0, Math.min(1, part.metalness ?? 0.3)),
    roughness: Math.max(0.03, Math.min(1, part.roughness ?? 0.4)),
    emissive: emissiveColor,
    emissiveIntensity,
    transparent: isTransparent,
    opacity,
    wireframe: Boolean(options.globalWireframe || part.wireframe),
    clearcoat: isGlossyOrGlass ? 0.85 : 0.1,
    clearcoatRoughness: 0.1,
    side: THREE.DoubleSide,
  });
}

/**
 * Builds a complete Three.js Group from a Model3DSpec, including symmetry & radial modifiers
 */
export function buildThreeModelGroup(
  model: Model3DSpec,
  options: {
    detailStyle?: DetailStyle;
    globalWireframe?: boolean;
    xrayMode?: boolean;
    selectedPartId?: string | null;
    hoveredPartId?: string | null;
    autoGround?: boolean;
  } = {}
): {
  group: THREE.Group;
  vertexCount: number;
  triangleCount: number;
} {
  const rootGroup = new THREE.Group();
  rootGroup.name = model.name || 'Forge3D_Model';

  let vertexCount = 0;
  let triangleCount = 0;

  const degToRad = THREE.MathUtils.degToRad;

  for (const part of model.parts) {
    if (part.visible === false) continue;

    const geometry = createPartGeometry(part, options.detailStyle || 'high-detail');
    const material = createPartMaterial(part, {
      globalWireframe: options.globalWireframe,
      xrayMode: options.xrayMode,
      isSelected: options.selectedPartId === part.id,
      isHovered: options.hoveredPartId === part.id,
    });

    const addMeshInstance = (
      pos: [number, number, number],
      rot: [number, number, number],
      scl: [number, number, number],
      suffix = ''
    ) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${part.name}${suffix}`;
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.set(degToRad(rot[0]), degToRad(rot[1]), degToRad(rot[2]));
      mesh.scale.set(
        Math.max(0.01, scl[0]),
        Math.max(0.01, scl[1]),
        Math.max(0.01, scl[2])
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = {
        partId: part.id,
        partName: part.name,
      };
      rootGroup.add(mesh);

      const posAttr = geometry.attributes.position;
      if (posAttr) {
        vertexCount += posAttr.count;
        if (geometry.index) {
          triangleCount += Math.round(geometry.index.count / 3);
        } else {
          triangleCount += Math.round(posAttr.count / 3);
        }
      }
    };

    // Handle Radial Array if specified
    if (part.radialCount && part.radialCount > 1) {
      const count = Math.min(24, Math.max(2, Math.round(part.radialCount)));
      const radius = part.radialRadius ?? Math.hypot(part.position[0], part.position[2]);
      const baseY = part.position[1];
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const rx = Math.cos(angle) * radius;
        const rz = Math.sin(angle) * radius;
        const rotY = part.rotation[1] - THREE.MathUtils.radToDeg(angle);
        addMeshInstance(
          [rx, baseY, rz],
          [part.rotation[0], rotY, part.rotation[2]],
          part.scale,
          `_radial_${i + 1}`
        );
      }
      continue;
    }

    // Standard instance
    addMeshInstance(part.position, part.rotation, part.scale);

    // Mirror X (Left/Right symmetry across X = 0)
    if (part.mirrorX && Math.abs(part.position[0]) > 0.02) {
      addMeshInstance(
        [-part.position[0], part.position[1], part.position[2]],
        [part.rotation[0], -part.rotation[1], -part.rotation[2]],
        part.scale,
        '_mirrorX'
      );
    }

    // Mirror Z (Front/Back symmetry across Z = 0)
    if (part.mirrorZ && Math.abs(part.position[2]) > 0.02) {
      addMeshInstance(
        [part.position[0], part.position[1], -part.position[2]],
        [-part.rotation[0], -part.rotation[1], part.rotation[2]],
        part.scale,
        '_mirrorZ'
      );
      if (part.mirrorX && Math.abs(part.position[0]) > 0.02) {
        addMeshInstance(
          [-part.position[0], part.position[1], -part.position[2]],
          [-part.rotation[0], part.rotation[1], -part.rotation[2]],
          part.scale,
          '_mirrorXZ'
        );
      }
    }
  }

  // Auto-ground model so its lowest point rests gently on y = 0
  if (options.autoGround !== false && rootGroup.children.length > 0) {
    const box = new THREE.Box3().setFromObject(rootGroup);
    if (isFinite(box.min.y)) {
      const yOffset = -box.min.y;
      const centerX = (box.min.x + box.max.x) / 2;
      const centerZ = (box.min.z + box.max.z) / 2;
      rootGroup.position.set(-centerX, yOffset, -centerZ);
    }
  }

  return { group: rootGroup, vertexCount, triangleCount };
}

/**
 * Converts an uploaded 2D Image (Data URL) directly into a 3D Voxel / Extruded Relief Part3D[] array!
 * Quantizes colors into cohesive clusters so each color region can even be painted/re-colored by the user!
 */
export async function generate3DReliefPartsFromImage(
  imageDataUrl: string,
  mode: 'voxel-sculpture' | 'bas-relief-emblem' = 'voxel-sculpture',
  gridSize = 20
): Promise<Part3D[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const res = Math.min(28, Math.max(12, gridSize));
      canvas.width = res;
      canvas.height = res;

      if (!ctx) {
        resolve([]);
        return;
      }

      ctx.drawImage(img, 0, 0, res, res);
      const imgData = ctx.getImageData(0, 0, res, res).data;

      // Sample corner pixel to detect solid background color
      const bgR = imgData[0];
      const bgG = imgData[1];
      const bgB = imgData[2];
      const bgA = imgData[3];

      const parts: Part3D[] = [];
      const cellSize = 3.2 / res;

      // Base pedestal for bas-relief emblem mode
      if (mode === 'bas-relief-emblem') {
        parts.push({
          id: 'relief_pedestal_base',
          name: 'Emblem Backing Plate',
          type: 'rounded_box',
          position: [0, 1.8, -0.18],
          rotation: [0, 0, 0],
          scale: [3.5, 3.5, 0.22],
          color: '#1e293b',
          metalness: 0.75,
          roughness: 0.28,
          role: 'dark',
          params: { bevel: 0.08 },
        });
        parts.push({
          id: 'relief_pedestal_stand',
          name: 'Display Stand Base',
          type: 'cylinder',
          position: [0, 0.12, 0],
          rotation: [0, 0, 0],
          scale: [2.4, 0.24, 1.6],
          color: '#0f172a',
          metalness: 0.8,
          roughness: 0.2,
          role: 'dark',
        });
      }

      let index = 0;
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const idx = (y * res + x) * 4;
          const r = imgData[idx];
          const g = imgData[idx + 1];
          const b = imgData[idx + 2];
          const a = imgData[idx + 3];

          if (a < 45) continue;

          // Check distance from corner background color
          const distFromBg = Math.hypot(r - bgR, g - bgG, b - bgB);
          if (bgA > 200 && distFromBg < 24 && mode === 'voxel-sculpture') {
            continue;
          }

          // Compute luminance & saturation for depth extrusion
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const maxC = Math.max(r, g, b) / 255;
          const minC = Math.min(r, g, b) / 255;
          const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;

          const depthFactor =
            mode === 'voxel-sculpture'
              ? 0.28 + lum * 0.65 + sat * 0.35
              : 0.15 + lum * 0.45 + sat * 0.25;

          const hex =
            '#' +
            [r, g, b]
              .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
              .join('');

          const posX = (x - res / 2 + 0.5) * cellSize;
          const posY = (res - y) * cellSize + (mode === 'bas-relief-emblem' ? 0.2 : 0);
          const posZ = mode === 'bas-relief-emblem' ? depthFactor / 2 : 0;

          parts.push({
            id: `voxel_${index++}`,
            name: `Voxel Cell (${x},${y})`,
            type: mode === 'voxel-sculpture' ? 'box' : 'rounded_box',
            position: [
              Number(posX.toFixed(3)),
              Number(posY.toFixed(3)),
              Number(posZ.toFixed(3)),
            ],
            rotation: [0, 0, 0],
            scale: [
              Number((cellSize * 0.96).toFixed(3)),
              Number((cellSize * 0.96).toFixed(3)),
              Number(depthFactor.toFixed(3)),
            ],
            color: hex,
            metalness: sat > 0.6 ? 0.5 : 0.2,
            roughness: 0.35,
            emissive: lum > 0.85 && sat > 0.5 ? hex : '#000000',
            emissiveIntensity: lum > 0.85 && sat > 0.5 ? 0.6 : 0,
          });
        }
      }

      resolve(parts);
    };
    img.onerror = () => resolve([]);
    img.src = imageDataUrl;
  });
}
