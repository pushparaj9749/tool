import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { DetailStyle, Model3DSpec } from '../types/model3d';
import { buildThreeModelGroup } from './geometryBuilder';

function slugifyFileName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'forge3d-model'
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Exports the Model3DSpec as a binary .GLB or JSON .GLTF file (with full colors & PBR materials!)
 */
export async function exportModelToGLTF(
  model: Model3DSpec,
  binary = true,
  detailStyle: DetailStyle = 'high-detail'
): Promise<void> {
  const { group } = buildThreeModelGroup(model, {
    detailStyle,
    globalWireframe: false,
    xrayMode: false,
  });

  // Convert MeshPhysicalMaterial to standard MeshStandardMaterial for maximum GLTF compatibility across all viewers
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      if (mat) {
        mesh.material = new THREE.MeshStandardMaterial({
          color: mat.color,
          metalness: mat.metalness,
          roughness: mat.roughness,
          emissive: mat.emissive,
          emissiveIntensity: mat.emissiveIntensity,
          transparent: mat.transparent,
          opacity: mat.opacity,
          side: THREE.DoubleSide,
        });
      }
    }
  });

  const exporter = new GLTFExporter();
  const baseName = slugifyFileName(model.name);

  return new Promise((resolve, reject) => {
    exporter.parse(
      group,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          triggerDownload(blob, `${baseName}.glb`);
        } else {
          const jsonText = JSON.stringify(result, null, 2);
          const blob = new Blob([jsonText], { type: 'model/gltf+json' });
          triggerDownload(blob, `${baseName}.gltf`);
        }
        resolve();
      },
      (err) => reject(err),
      { binary }
    );
  });
}

/**
 * Exports the Model3DSpec as a Wavefront .OBJ file
 */
export function exportModelToOBJ(
  model: Model3DSpec,
  detailStyle: DetailStyle = 'high-detail'
): void {
  const { group } = buildThreeModelGroup(model, {
    detailStyle,
    globalWireframe: false,
    xrayMode: false,
  });
  group.updateMatrixWorld(true);

  const exporter = new OBJExporter();
  const objString = exporter.parse(group);
  const blob = new Blob([objString], { type: 'text/plain;charset=utf-8' });
  const baseName = slugifyFileName(model.name);
  triggerDownload(blob, `${baseName}.obj`);
}

/**
 * Exports the Model3DSpec as a Binary .STL file (ready for 3D Printing slicers)
 */
export function exportModelToSTL(
  model: Model3DSpec,
  detailStyle: DetailStyle = 'high-detail'
): void {
  const { group } = buildThreeModelGroup(model, {
    detailStyle,
    globalWireframe: false,
    xrayMode: false,
  });
  group.updateMatrixWorld(true);

  const exporter = new STLExporter();
  const stlBuffer = exporter.parse(group, { binary: true });
  const blob = new Blob([stlBuffer as unknown as BlobPart], {
    type: 'application/octet-stream',
  });
  const baseName = slugifyFileName(model.name);
  triggerDownload(blob, `${baseName}.stl`);
}

/**
 * Exports the editable Model3DSpec project JSON so user can reload & edit later
 */
export function exportProjectJSON(model: Model3DSpec): void {
  const jsonText = JSON.stringify(model, null, 2);
  const blob = new Blob([jsonText], { type: 'application/json' });
  const baseName = slugifyFileName(model.name);
  triggerDownload(blob, `${baseName}.forge3d.json`);
}
