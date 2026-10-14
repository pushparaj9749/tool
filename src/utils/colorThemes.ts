import { ColorTheme, MaterialFinishPreset, Part3D } from '../types/model3d';

export interface FinishDefinition {
  id: MaterialFinishPreset;
  label: string;
  desc: string;
  metalness: number;
  roughness: number;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  defaultColor?: string;
}

export const MATERIAL_FINISHES: FinishDefinition[] = [
  {
    id: 'standard',
    label: 'Standard PBR',
    desc: 'Balanced satin surface',
    metalness: 0.2,
    roughness: 0.45,
    emissiveIntensity: 0,
    opacity: 1,
    transparent: false,
  },
  {
    id: 'metallic',
    label: 'Anodized Metal',
    desc: 'Brushed metallic armor finish',
    metalness: 0.85,
    roughness: 0.22,
    emissiveIntensity: 0,
    opacity: 1,
    transparent: false,
  },
  {
    id: 'chrome',
    label: 'Mirror Chrome',
    desc: 'Ultra-reflective liquid metal',
    metalness: 0.98,
    roughness: 0.06,
    emissiveIntensity: 0,
    opacity: 1,
    transparent: false,
  },
  {
    id: 'gold',
    label: 'Royal Gold',
    desc: 'High-polish precious metal',
    metalness: 0.95,
    roughness: 0.14,
    emissiveIntensity: 0.08,
    opacity: 1,
    transparent: false,
    defaultColor: '#f59e0b',
  },
  {
    id: 'glossy',
    label: 'Car Paint Gloss',
    desc: 'Showroom clearcoat sheen',
    metalness: 0.35,
    roughness: 0.08,
    emissiveIntensity: 0,
    opacity: 1,
    transparent: false,
  },
  {
    id: 'matte',
    label: 'Matte Clay / Polymer',
    desc: 'Soft non-reflective surface',
    metalness: 0.05,
    roughness: 0.88,
    emissiveIntensity: 0,
    opacity: 1,
    transparent: false,
  },
  {
    id: 'neon',
    label: 'Neon Emissive Glow',
    desc: 'Self-illuminated energy core',
    metalness: 0.1,
    roughness: 0.2,
    emissiveIntensity: 1.6,
    opacity: 1,
    transparent: false,
  },
  {
    id: 'glass',
    label: 'Crystal Glass',
    desc: 'Translucent visor / canopy glass',
    metalness: 0.15,
    roughness: 0.05,
    emissiveIntensity: 0.1,
    opacity: 0.48,
    transparent: true,
  },
  {
    id: 'carbon',
    label: 'Tactical Carbon',
    desc: 'Dark semi-matte composite',
    metalness: 0.45,
    roughness: 0.55,
    emissiveIntensity: 0,
    opacity: 1,
    transparent: false,
    defaultColor: '#1e293b',
  },
  {
    id: 'wood',
    label: 'Crafted Timber',
    desc: 'Warm organic satin grain',
    metalness: 0.04,
    roughness: 0.72,
    emissiveIntensity: 0,
    opacity: 1,
    transparent: false,
    defaultColor: '#92400e',
  },
];

export const QUICK_PAINT_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Cyber Cyan', hex: '#06b6d4' },
  { name: 'Electric Indigo', hex: '#6366f1' },
  { name: 'Hyper Magenta', hex: '#ec4899' },
  { name: 'Crimson Racing', hex: '#ef4444' },
  { name: 'Solar Amber', hex: '#f59e0b' },
  { name: 'Emerald Neon', hex: '#10b981' },
  { name: 'Royal Purple', hex: '#8b5cf6' },
  { name: 'Pure Titanium', hex: '#f8fafc' },
  { name: 'Brushed Silver', hex: '#94a3b8' },
  { name: 'Gunmetal Grey', hex: '#334155' },
  { name: 'Obsidian Black', hex: '#0f172a' },
  { name: 'Cobalt Blue', hex: '#2563eb' },
  { name: 'Plasma Lime', hex: '#84cc16' },
  { name: 'Sunset Coral', hex: '#f97316' },
  { name: 'Rose Gold', hex: '#fb7185' },
  { name: 'Warm Bronze', hex: '#b45309' },
];

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'cyberpunk-2099',
    name: 'Cyberpunk Neon',
    description: 'Obsidian armor with electric cyan & magenta neon circuitry',
    swatches: ['#0f172a', '#1e293b', '#06b6d4', '#ec4899', '#38bdf8'],
    mapping: {
      primary: { color: '#1e293b', metalness: 0.8, roughness: 0.25 },
      secondary: { color: '#334155', metalness: 0.7, roughness: 0.3 },
      accent: { color: '#ec4899', metalness: 0.6, roughness: 0.2 },
      dark: { color: '#090d16', metalness: 0.5, roughness: 0.6 },
      glow: { color: '#06b6d4', emissive: '#06b6d4', emissiveIntensity: 1.8 },
      glass: { color: '#38bdf8', opacity: 0.45 },
    },
  },
  {
    id: 'royal-gold-obsidian',
    name: 'Imperial Gold & Black',
    description: 'Luxury matte obsidian plating with 24K mirror gold trim',
    swatches: ['#111827', '#f59e0b', '#fbbf24', '#1f2937', '#fef3c7'],
    mapping: {
      primary: { color: '#111827', metalness: 0.45, roughness: 0.35 },
      secondary: { color: '#1f2937', metalness: 0.6, roughness: 0.3 },
      accent: { color: '#f59e0b', metalness: 0.95, roughness: 0.12 },
      dark: { color: '#030712', metalness: 0.3, roughness: 0.7 },
      glow: { color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 1.4 },
      glass: { color: '#fde68a', opacity: 0.4 },
    },
  },
  {
    id: 'crimson-mecha',
    name: 'Apex Crimson & Gold',
    description: 'Hot-rod metallic red exosuit with titanium & gold accents',
    swatches: ['#dc2626', '#f59e0b', '#e2e8f0', '#1e293b', '#38bdf8'],
    mapping: {
      primary: { color: '#dc2626', metalness: 0.82, roughness: 0.18 },
      secondary: { color: '#f59e0b', metalness: 0.92, roughness: 0.16 },
      accent: { color: '#e2e8f0', metalness: 0.85, roughness: 0.22 },
      dark: { color: '#1e293b', metalness: 0.5, roughness: 0.5 },
      glow: { color: '#38bdf8', emissive: '#38bdf8', emissiveIntensity: 1.9 },
      glass: { color: '#7dd3fc', opacity: 0.48 },
    },
  },
  {
    id: 'arctic-mecha',
    name: 'Arctic Titanium',
    description: 'Clean ceramic white aerospace plating with cobalt energy cores',
    swatches: ['#f8fafc', '#cbd5e1', '#2563eb', '#0f172a', '#60a5fa'],
    mapping: {
      primary: { color: '#f1f5f9', metalness: 0.35, roughness: 0.2 },
      secondary: { color: '#94a3b8', metalness: 0.75, roughness: 0.25 },
      accent: { color: '#2563eb', metalness: 0.7, roughness: 0.2 },
      dark: { color: '#1e293b', metalness: 0.6, roughness: 0.45 },
      glow: { color: '#60a5fa', emissive: '#3b82f6', emissiveIntensity: 1.6 },
      glass: { color: '#93c5fd', opacity: 0.42 },
    },
  },
  {
    id: 'emerald-bio',
    name: 'Bio-Emerald Matrix',
    description: 'Jade metallic armor with radioactive plasma green cores',
    swatches: ['#065f46', '#10b981', '#a7f3d0', '#064e3b', '#34d399'],
    mapping: {
      primary: { color: '#065f46', metalness: 0.75, roughness: 0.25 },
      secondary: { color: '#047857', metalness: 0.65, roughness: 0.3 },
      accent: { color: '#10b981', metalness: 0.8, roughness: 0.2 },
      dark: { color: '#022c22', metalness: 0.4, roughness: 0.6 },
      glow: { color: '#34d399', emissive: '#10b981', emissiveIntensity: 1.8 },
      glass: { color: '#6ee7b7', opacity: 0.45 },
    },
  },
  {
    id: 'synthwave-sunset',
    name: 'Synthwave Outrun',
    description: 'Deep violet chrome with laser orange & hot pink highlights',
    swatches: ['#4c1d95', '#7c3aed', '#f97316', '#ec4899', '#fb923c'],
    mapping: {
      primary: { color: '#4c1d95', metalness: 0.82, roughness: 0.2 },
      secondary: { color: '#6d28d9', metalness: 0.7, roughness: 0.28 },
      accent: { color: '#f97316', metalness: 0.6, roughness: 0.22 },
      dark: { color: '#1e1b4b', metalness: 0.5, roughness: 0.5 },
      glow: { color: '#ec4899', emissive: '#ec4899', emissiveIntensity: 1.75 },
      glass: { color: '#f472b6', opacity: 0.45 },
    },
  },
  {
    id: 'tactical-ops',
    name: 'Military Spec-Ops',
    description: 'Matte olive drab & gunmetal composite with amber optics',
    swatches: ['#3f6212', '#365314', '#334155', '#18181b', '#f59e0b'],
    mapping: {
      primary: { color: '#3f6212', metalness: 0.2, roughness: 0.75 },
      secondary: { color: '#4d7c0f', metalness: 0.25, roughness: 0.7 },
      accent: { color: '#64748b', metalness: 0.65, roughness: 0.4 },
      dark: { color: '#18181b', metalness: 0.3, roughness: 0.8 },
      glow: { color: '#f59e0b', emissive: '#f59e0b', emissiveIntensity: 1.5 },
      glass: { color: '#fbbf24', opacity: 0.5 },
    },
  },
  {
    id: 'pastel-toy',
    name: 'Designer Vinyl Toy',
    description: 'Smooth matte pastel coral, mint & cream collector aesthetic',
    swatches: ['#fb7185', '#34d399', '#fef08a', '#334155', '#38bdf8'],
    mapping: {
      primary: { color: '#fb7185', metalness: 0.08, roughness: 0.55 },
      secondary: { color: '#34d399', metalness: 0.08, roughness: 0.55 },
      accent: { color: '#fde047', metalness: 0.15, roughness: 0.4 },
      dark: { color: '#334155', metalness: 0.1, roughness: 0.7 },
      glow: { color: '#38bdf8', emissive: '#38bdf8', emissiveIntensity: 1.1 },
      glass: { color: '#e0f2fe', opacity: 0.55 },
    },
  },
];

/**
 * Applies a ColorTheme intelligently across all parts of a 3D model
 * based on each part's role, material properties, or index.
 */
export function applyColorThemeToParts(parts: Part3D[], theme: ColorTheme): Part3D[] {
  return parts.map((part, idx) => {
    const lowerName = part.name.toLowerCase();

    // Detect glass/visor/canopy
    if (
      part.role === 'glass' ||
      part.transparent ||
      (part.opacity !== undefined && part.opacity < 0.85) ||
      lowerName.includes('glass') ||
      lowerName.includes('visor') ||
      lowerName.includes('canopy') ||
      lowerName.includes('windshield') ||
      lowerName.includes('window')
    ) {
      return {
        ...part,
        color: theme.mapping.glass.color,
        opacity: theme.mapping.glass.opacity,
        transparent: true,
        metalness: 0.2,
        roughness: 0.06,
      };
    }

    // Detect glow / emissive / thruster / neon / eye / core / blade edge
    if (
      part.role === 'glow' ||
      (part.emissiveIntensity && part.emissiveIntensity > 0.4) ||
      lowerName.includes('glow') ||
      lowerName.includes('neon') ||
      lowerName.includes('core') ||
      lowerName.includes('thruster') ||
      lowerName.includes('laser') ||
      lowerName.includes('light') ||
      lowerName.includes('eye') ||
      lowerName.includes('energy') ||
      lowerName.includes('screen') ||
      lowerName.includes('led')
    ) {
      return {
        ...part,
        color: theme.mapping.glow.color,
        emissive: theme.mapping.glow.emissive,
        emissiveIntensity: theme.mapping.glow.emissiveIntensity,
        metalness: 0.2,
        roughness: 0.15,
      };
    }

    // Detect dark structural parts (wheels, tires, joints, base, grip, chassis frame)
    if (
      part.role === 'dark' ||
      lowerName.includes('tire') ||
      lowerName.includes('wheel') ||
      lowerName.includes('joint') ||
      lowerName.includes('frame') ||
      lowerName.includes('base') ||
      lowerName.includes('grip') ||
      lowerName.includes('track') ||
      lowerName.includes('shadow')
    ) {
      return {
        ...part,
        color: theme.mapping.dark.color,
        metalness: theme.mapping.dark.metalness,
        roughness: theme.mapping.dark.roughness,
        emissive: '#000000',
        emissiveIntensity: 0,
      };
    }

    // Detect accent parts (trim, spoiler, guard, crest, emblem, antenna, cannon)
    if (
      part.role === 'accent' ||
      lowerName.includes('trim') ||
      lowerName.includes('spoiler') ||
      lowerName.includes('guard') ||
      lowerName.includes('crest') ||
      lowerName.includes('stripe') ||
      lowerName.includes('fin') ||
      lowerName.includes('cannon') ||
      lowerName.includes('pommel')
    ) {
      return {
        ...part,
        color: theme.mapping.accent.color,
        metalness: theme.mapping.accent.metalness,
        roughness: theme.mapping.accent.roughness,
        emissive: '#000000',
        emissiveIntensity: 0,
      };
    }

    // Alternate primary and secondary for remaining body/armor parts
    if (part.role === 'secondary' || idx % 3 === 1) {
      return {
        ...part,
        color: theme.mapping.secondary.color,
        metalness: theme.mapping.secondary.metalness,
        roughness: theme.mapping.secondary.roughness,
        emissive: '#000000',
        emissiveIntensity: 0,
      };
    }

    return {
      ...part,
      color: theme.mapping.primary.color,
      metalness: theme.mapping.primary.metalness,
      roughness: theme.mapping.primary.roughness,
      emissive: '#000000',
      emissiveIntensity: 0,
    };
  });
}
