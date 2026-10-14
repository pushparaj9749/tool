import {
  DetailStyle,
  GeminiConfig,
  GenerationPair,
  Model3DSpec,
  Part3D,
  PrimitiveType,
} from '../types/model3d';
import { generate3DReliefPartsFromImage } from '../utils/geometryBuilder';
import { PRESET_GENERATION_PAIRS } from '../utils/presetModels';

const VALID_PRIMITIVES: PrimitiveType[] = [
  'box',
  'rounded_box',
  'sphere',
  'hemisphere',
  'cylinder',
  'cone',
  'capsule',
  'torus',
  'octahedron',
  'dodecahedron',
  'icosahedron',
  'ring',
  'lathe',
  'extrude',
];

export function normalizeModelName(rawModel: string): string {
  const trimmed = (rawModel || 'gemini-2.5-flash').trim();
  return trimmed.replace(/^models\//i, '') || 'gemini-2.5-flash';
}

function clamp(val: number, min: number, max: number): number {
  if (typeof val !== 'number' || isNaN(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function sanitizeHex(color: unknown, fallback = '#6366f1'): string {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function toVec3(val: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(val) && val.length >= 3) {
    return [
      Number(val[0]) || fallback[0],
      Number(val[1]) || fallback[1],
      Number(val[2]) || fallback[2],
    ];
  }
  return fallback;
}

export function sanitizePart(raw: any, index: number): Part3D {
  const rawType = typeof raw?.type === 'string' ? raw.type.toLowerCase().trim() : 'rounded_box';
  const type: PrimitiveType = VALID_PRIMITIVES.includes(rawType as PrimitiveType)
    ? (rawType as PrimitiveType)
    : 'rounded_box';

  const pos = toVec3(raw?.position, [0, 0.5 + index * 0.2, 0]);
  const rot = toVec3(raw?.rotation, [0, 0, 0]);
  const sclRaw = toVec3(raw?.scale, [0.8, 0.8, 0.8]);
  const scale: [number, number, number] = [
    clamp(Math.abs(sclRaw[0]), 0.04, 8),
    clamp(Math.abs(sclRaw[1]), 0.04, 8),
    clamp(Math.abs(sclRaw[2]), 0.04, 8),
  ];

  const color = sanitizeHex(raw?.color, '#6366f1');
  const emissiveIntensity = clamp(Number(raw?.emissiveIntensity ?? 0), 0, 3);
  const emissive =
    emissiveIntensity > 0.05
      ? sanitizeHex(raw?.emissive, color)
      : sanitizeHex(raw?.emissive, '#000000');

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `part_${index + 1}_${Date.now()}`,
    name: typeof raw?.name === 'string' && raw.name ? raw.name : `Component ${index + 1}`,
    type,
    position: [clamp(pos[0], -6, 6), clamp(pos[1], -2, 8), clamp(pos[2], -6, 6)],
    rotation: [clamp(rot[0], -360, 360), clamp(rot[1], -360, 360), clamp(rot[2], -360, 360)],
    scale,
    color,
    metalness: clamp(Number(raw?.metalness ?? 0.4), 0, 1),
    roughness: clamp(Number(raw?.roughness ?? 0.35), 0.04, 1),
    emissive,
    emissiveIntensity,
    opacity: clamp(Number(raw?.opacity ?? 1), 0.15, 1),
    transparent: Boolean(
      raw?.transparent || (raw?.opacity !== undefined && Number(raw.opacity) < 0.95)
    ),
    mirrorX: Boolean(raw?.mirrorX),
    mirrorZ: Boolean(raw?.mirrorZ),
    radialCount: raw?.radialCount ? clamp(Math.round(Number(raw.radialCount)), 2, 16) : undefined,
    radialRadius:
      raw?.radialRadius !== undefined ? clamp(Number(raw.radialRadius), 0.1, 4) : undefined,
    role: ['primary', 'secondary', 'accent', 'dark', 'glow', 'glass'].includes(raw?.role)
      ? raw.role
      : undefined,
    params: raw?.params || undefined,
    visible: true,
  };
}

function extractJsonObject(text: string): any {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Could not parse valid 3D model JSON from Gemini response.');
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64Data: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    base64Data: match[2],
  };
}

/**
 * Tests whether the user's Gemini API key and selected/custom model work
 */
export async function testGeminiApiKey(config: GeminiConfig): Promise<{
  ok: boolean;
  message: string;
}> {
  const key = config.apiKey.trim();
  if (!key) {
    return { ok: false, message: 'Please enter your Gemini API Key first.' };
  }

  const model = normalizeModelName(config.model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with OK' }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || `HTTP ${res.status}`;
      return { ok: false, message: `Error (${model}): ${msg}` };
    }

    return { ok: true, message: `Connected to "${model}" successfully!` };
  } catch (err: any) {
    return {
      ok: false,
      message: `Network Error: ${err?.message || 'Failed to reach Google Gemini API'}`,
    };
  }
}

/**
 * Fetches all generateContent-capable Gemini models available for the user's API key
 */
export async function fetchAvailableGeminiModels(apiKey: string): Promise<string[]> {
  const key = apiKey.trim();
  if (!key) return [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.models)) return [];
    return data.models
      .filter(
        (m: any) =>
          Array.isArray(m?.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes('generateContent') &&
          typeof m?.name === 'string' &&
          m.name.includes('gemini')
      )
      .map((m: any) => String(m.name).replace(/^models\//i, ''));
  } catch {
    return [];
  }
}

const DUAL_GENERATION_SYSTEM_PROMPT = `You are Forge3D AI, a master 3D CAD & Three.js procedural model architect.
Given a user's text prompt and/or reference image, you MUST design TWO DISTINCT, HIGHLY DETAILED 3D model variations ("variationA" and "variationB") so the user can compare both side-by-side and choose their favorite before opening the final preview.

CRITICAL DESIGN RULES FOR REALISTIC, MULTI-PART 3D MODELS:
1. Each variation ("variationA" and "variationB") MUST have between 14 and 24 well-structured 3D parts in its "parts" array.
2. Make "variationA" and "variationB" genuinely distinct designs:
   - Variation A: Precision, sleek, classic, or realistic structural build.
   - Variation B: Stylized, armored, ornate, or creative alternative build.
3. Coordinate System:
   - Y is UP (ground is y = 0.0, build upward between y = 0.1 and y = 4.5).
   - X is Left/Right (-3.0 to +3.0). Center spine is x = 0.
   - Z is Front/Back (-3.0 to +3.0). Front faces +Z.
4. Available Primitive Types ("type"):
   - "rounded_box" (hulls, armor plates, torsos, bodies, cabins, limbs, blocks)
   - "box" (sharp panels, blades, strips, screens)
   - "cylinder" (wheels, barrels, pillars, thrusters, necks, grips, legs; rotate [0,0,90] for X-axis wheels or [90,0,0] for Z-axis barrels)
   - "sphere" (heads, joints, energy cores, domes, eyes, cockpit bubbles)
   - "hemisphere" (domes, helmets, caps, shoulders)
   - "cone" (tips, horns, spikes, noses, roofs, nozzles)
   - "capsule" (organic limbs, fuselage pods, fuel tanks)
   - "torus" (glowing rings, halos, wheel rims, thruster shrouds)
   - "octahedron" | "dodecahedron" | "icosahedron" (crystals, gems, pommels)
5. USE SYMMETRY & RADIAL MODIFIERS:
   - Set "mirrorX": true on any part with position[0] > 0.05 (wheels, arms, legs, wings, eyes, headlights, shoulders) to automatically create the symmetrical left/right pair!
   - Set "mirrorZ": true when front/back symmetry is needed.
   - Set "radialCount": N (e.g. 4, 6, 8) and "radialRadius": R for circular arrays around Y=0.
6. RICH COLORS & PBR MATERIALS:
   - Give every part an accurate, vibrant hex "color" (#RRGGBB).
   - Set "metalness" (0.0 to 0.95) and "roughness" (0.05 to 0.9).
   - For glowing parts, set "emissive": "#RRGGBB", "emissiveIntensity": 1.8, and "role": "glow".
   - For glass/visors/windshields, set "opacity": 0.48, "transparent": true, and "role": "glass".
   - Assign "role" to each part from: "primary" | "secondary" | "accent" | "dark" | "glow" | "glass".

Return ONLY valid JSON matching this exact structure:
{
  "variationA": {
    "name": "Model A Name",
    "subtitle": "Variation A — Precision Build",
    "description": "Short description of Variation A",
    "styleTag": "Precision 3D",
    "parts": [
      {
        "id": "part_1",
        "name": "Main Body",
        "type": "rounded_box",
        "position": [0, 1.2, 0],
        "rotation": [0, 0, 0],
        "scale": [1.6, 0.8, 2.4],
        "color": "#4f46e5",
        "metalness": 0.8,
        "roughness": 0.2,
        "emissive": "#000000",
        "emissiveIntensity": 0,
        "opacity": 1.0,
        "transparent": false,
        "mirrorX": false,
        "mirrorZ": false,
        "role": "primary"
      }
    ]
  },
  "variationB": {
    "name": "Model B Name",
    "subtitle": "Variation B — Stylized Build",
    "description": "Short description of Variation B",
    "styleTag": "Stylized 3D",
    "parts": [ ...14 to 24 parts... ]
  }
}`;

export async function generateDual3DModelsWithGemini(params: {
  prompt: string;
  imageDataUrl?: string;
  detailStyle: DetailStyle;
  preferredColorHex?: string;
  geminiConfig: GeminiConfig;
}): Promise<GenerationPair> {
  const { prompt, imageDataUrl, detailStyle, preferredColorHex, geminiConfig } = params;
  const apiKey = geminiConfig.apiKey.trim();

  if (!apiKey) {
    throw new Error('Please enter your Gemini API Key first.');
  }

  const modelName = normalizeModelName(geminiConfig.model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelName
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const styleInstruction =
    detailStyle === 'voxel-blocky'
      ? 'Style preference: Voxel / Blocky cubic proportions.'
      : detailStyle === 'stylized-lowpoly'
      ? 'Style preference: Clean Stylized Game Asset.'
      : 'Style preference: High-Detail Smooth Studio 3D Model.';

  const colorHint = preferredColorHex
    ? `Primary Color Preference requested by user: ${preferredColorHex} (harmonize accent, secondary, dark, and glow parts around this color).`
    : '';

  const userPromptText = prompt.trim()
    ? `User Prompt: "${prompt.trim()}"\n${styleInstruction}\n${colorHint}\n${
        imageDataUrl
          ? 'Analyze the attached reference image carefully and combine it with the prompt to build two detailed 3D variations (variationA and variationB).'
          : 'Build two detailed, multi-part 3D model variations (variationA and variationB).'
      }`
    : `Analyze the attached reference image carefully and build two detailed multi-part 3D model variations (variationA and variationB) matching the object in the image.\n${styleInstruction}\n${colorHint}`;

  const contentParts: any[] = [{ text: DUAL_GENERATION_SYSTEM_PROMPT }, { text: userPromptText }];

  if (imageDataUrl) {
    const parsed = parseDataUrl(imageDataUrl);
    if (parsed) {
      contentParts.push({
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.base64Data,
        },
      });
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: contentParts }],
      generationConfig: {
        temperature: 0.65,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const errMsg = errData?.error?.message || `HTTP Error ${response.status}`;
    throw new Error(`Gemini API Error (${modelName}): ${errMsg}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response. Please try again.');
  }

  const parsedJson = extractJsonObject(rawText);
  const rawA = parsedJson.variationA || parsedJson.modelA || parsedJson;
  const rawB = parsedJson.variationB || parsedJson.modelB || parsedJson.variationA;

  const partsA: Part3D[] = Array.isArray(rawA?.parts)
    ? rawA.parts.map((p: any, idx: number) => sanitizePart(p, idx))
    : [];

  const partsB: Part3D[] = Array.isArray(rawB?.parts)
    ? rawB.parts.map((p: any, idx: number) => sanitizePart(p, idx))
    : [];

  if (partsA.length === 0) {
    throw new Error('Gemini did not return valid 3D parts. Please try again.');
  }

  const variationASpec: Model3DSpec = {
    id: `model_a_${Date.now()}`,
    name: rawA?.name || 'Variation A',
    subtitle: rawA?.subtitle || 'Option A — Precision 3D Build',
    description:
      rawA?.description || 'Multi-part 3D model with balanced proportions and PBR materials.',
    styleTag: rawA?.styleTag || 'Option A',
    createdAt: new Date().toISOString(),
    promptUsed: prompt,
    sourceImageUrl: imageDataUrl,
    parts: partsA,
  };

  const variationBSpec: Model3DSpec = {
    id: `model_b_${Date.now()}`,
    name: rawB?.name || 'Variation B',
    subtitle: rawB?.subtitle || 'Option B — Stylized 3D Build',
    description:
      rawB?.description || 'Alternative structural 3D interpretation with distinct detailing.',
    styleTag: rawB?.styleTag || 'Option B',
    createdAt: new Date().toISOString(),
    promptUsed: prompt,
    sourceImageUrl: imageDataUrl,
    parts: partsB.length > 0 ? partsB : partsA,
  };

  return {
    id: `pair_${Date.now()}`,
    prompt: prompt || 'Image-to-3D Model',
    imageUrl: imageDataUrl,
    detailStyle,
    createdAt: new Date().toISOString(),
    variationA: variationASpec,
    variationB: variationBSpec,
  };
}

export async function refineModelWithGemini(params: {
  currentModel: Model3DSpec;
  instruction: string;
  geminiConfig: GeminiConfig;
}): Promise<Model3DSpec> {
  const { currentModel, instruction, geminiConfig } = params;
  const apiKey = geminiConfig.apiKey.trim();

  if (!apiKey) {
    throw new Error('Please enter your Gemini API Key first.');
  }

  const modelName = normalizeModelName(geminiConfig.model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelName
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const systemPrompt = `You are Forge3D AI Editor. You will receive the current 3D model JSON ("name", "description", "parts") and a user modification instruction.
Modify existing parts and/or add new parts to fulfill the user's instruction accurately while keeping the rest of the model intact.
Return ONLY valid JSON with:
{
  "name": "Updated Model Name",
  "description": "Updated description",
  "parts": [ ...full updated parts array... ]
}`;

  const compactCurrent = {
    name: currentModel.name,
    description: currentModel.description,
    parts: currentModel.parts.slice(0, 45),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: systemPrompt },
            {
              text: `Current 3D Model JSON:\n${JSON.stringify(
                compactCurrent
              )}\n\nUser Modification Instruction: "${instruction}"`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.45,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Gemini API Error ${response.status}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Empty response from Gemini during refinement.');
  }

  const parsed = extractJsonObject(rawText);
  const updatedParts: Part3D[] = Array.isArray(parsed?.parts)
    ? parsed.parts.map((p: any, idx: number) => sanitizePart(p, idx))
    : currentModel.parts;

  return {
    ...currentModel,
    name: parsed?.name || currentModel.name,
    description: parsed?.description || currentModel.description,
    parts: updatedParts,
  };
}

export async function generateFallbackPair(params: {
  prompt: string;
  imageDataUrl?: string;
  detailStyle: DetailStyle;
}): Promise<GenerationPair> {
  const { prompt, imageDataUrl, detailStyle } = params;
  const lower = prompt.toLowerCase();

  if (imageDataUrl) {
    const voxelParts = await generate3DReliefPartsFromImage(imageDataUrl, 'voxel-sculpture', 22);
    const reliefParts = await generate3DReliefPartsFromImage(imageDataUrl, 'bas-relief-emblem', 22);

    if (voxelParts.length > 0 && reliefParts.length > 0) {
      return {
        id: `img_pair_${Date.now()}`,
        prompt: prompt || 'Image 3D Model',
        imageUrl: imageDataUrl,
        detailStyle,
        createdAt: new Date().toISOString(),
        variationA: {
          id: `img_a_${Date.now()}`,
          name: prompt ? `${prompt.slice(0, 24)} (Option A)` : '3D Voxel Model',
          subtitle: 'Option A — Free-Standing 3D Mesh',
          description: 'Extruded 3D geometry generated from your uploaded image.',
          styleTag: '3D Mesh',
          createdAt: new Date().toISOString(),
          sourceImageUrl: imageDataUrl,
          parts: voxelParts,
        },
        variationB: {
          id: `img_b_${Date.now()}`,
          name: prompt ? `${prompt.slice(0, 24)} (Option B)` : '3D Relief Model',
          subtitle: 'Option B — Embossed 3D Relief with Stand',
          description: 'Beveled 3D relief mounted on a metallic display stand.',
          styleTag: '3D Relief',
          createdAt: new Date().toISOString(),
          sourceImageUrl: imageDataUrl,
          parts: reliefParts,
        },
      };
    }
  }

  let basePair = PRESET_GENERATION_PAIRS[0];
  if (
    lower.includes('robot') ||
    lower.includes('mech') ||
    lower.includes('gundam') ||
    lower.includes('warrior') ||
    lower.includes('character') ||
    lower.includes('iron')
  ) {
    basePair = PRESET_GENERATION_PAIRS[1];
  } else if (
    lower.includes('sword') ||
    lower.includes('blade') ||
    lower.includes('weapon') ||
    lower.includes('axe') ||
    lower.includes('dagger') ||
    lower.includes('katana')
  ) {
    basePair = PRESET_GENERATION_PAIRS[2];
  } else if (
    lower.includes('drone') ||
    lower.includes('ship') ||
    lower.includes('ufo') ||
    lower.includes('orb') ||
    lower.includes('plane') ||
    lower.includes('helicopter')
  ) {
    basePair = PRESET_GENERATION_PAIRS[3];
  }

  const clonePair: GenerationPair = JSON.parse(JSON.stringify(basePair));
  clonePair.id = `pair_${Date.now()}`;
  clonePair.prompt = prompt || basePair.prompt;
  clonePair.detailStyle = detailStyle;
  clonePair.createdAt = new Date().toISOString();
  return clonePair;
}
