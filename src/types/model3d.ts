export type PrimitiveType =
  | 'box'
  | 'rounded_box'
  | 'sphere'
  | 'hemisphere'
  | 'cylinder'
  | 'cone'
  | 'capsule'
  | 'torus'
  | 'octahedron'
  | 'dodecahedron'
  | 'icosahedron'
  | 'ring'
  | 'lathe'
  | 'extrude'
  | 'image_relief';

export type MaterialFinishPreset =
  | 'standard'
  | 'metallic'
  | 'chrome'
  | 'gold'
  | 'matte'
  | 'glossy'
  | 'neon'
  | 'glass'
  | 'wood'
  | 'carbon';

export type DetailStyle = 'high-detail' | 'stylized-lowpoly' | 'voxel-blocky';

export type LightingPreset = 'studio' | 'cyberpunk' | 'sunset' | 'showroom' | 'dramatic';

export interface Part3D {
  id: string;
  name: string;
  type: PrimitiveType;
  position: [number, number, number];
  rotation: [number, number, number]; // Euler degrees [x, y, z]
  scale: [number, number, number];

  // Color & PBR Material
  color: string; // Hex #RRGGBB
  metalness: number; // 0.0 to 1.0
  roughness: number; // 0.0 to 1.0
  emissive?: string; // Hex #RRGGBB
  emissiveIntensity?: number; // 0.0 to 3.0
  opacity?: number; // 0.1 to 1.0
  transparent?: boolean;
  wireframe?: boolean;
  finishPreset?: MaterialFinishPreset;

  // Optional geometry parameters
  params?: {
    radiusTop?: number;
    radiusBottom?: number;
    tubeRadius?: number;
    bevel?: number;
    segments?: number;
    // For lathe: 2D profile points [[r, y], ...]
    lathePoints?: [number, number][];
    // For extrude: 2D polygon points [[x, y], ...] and depth
    polygonPoints?: [number, number][];
    extrudeDepth?: number;
    // For image_relief: dataURL & settings
    imageDataUrl?: string;
    reliefDepth?: number;
    reliefResolution?: number;
    voxelMode?: boolean;
  };

  // Symmetry & Instancing Modifiers
  mirrorX?: boolean;
  mirrorZ?: boolean;
  radialCount?: number; // e.g., 4, 6, 8 radial copies around Y axis
  radialRadius?: number;

  // Editor state
  visible?: boolean;
  locked?: boolean;
  role?: 'primary' | 'secondary' | 'accent' | 'dark' | 'glow' | 'glass';
}

export interface Model3DSpec {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  styleTag: string;
  createdAt: string;
  promptUsed?: string;
  sourceImageUrl?: string;
  parts: Part3D[];
  backgroundColor?: string;
}

export interface GenerationPair {
  id: string;
  prompt: string;
  imageUrl?: string;
  detailStyle: DetailStyle;
  createdAt: string;
  variationA: Model3DSpec;
  variationB: Model3DSpec;
  selectedVariation?: 'A' | 'B';
}

export interface ColorTheme {
  id: string;
  name: string;
  description: string;
  swatches: [string, string, string, string, string];
  mapping: {
    primary: { color: string; metalness: number; roughness: number };
    secondary: { color: string; metalness: number; roughness: number };
    accent: { color: string; metalness: number; roughness: number };
    dark: { color: string; metalness: number; roughness: number };
    glow: { color: string; emissive: string; emissiveIntensity: number };
    glass: { color: string; opacity: number };
  };
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
}
