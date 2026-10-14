import React, { useRef, useState } from 'react';
import {
  Box,
  Cpu,
  FolderOpen,
  History,
  ImagePlus,
  KeyRound,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { DetailStyle, GenerationPair } from '../types/model3d';
import { PRESET_GENERATION_PAIRS } from '../utils/presetModels';

interface LeftGeneratorPanelProps {
  prompt: string;
  imageDataUrl?: string;
  detailStyle: DetailStyle;
  imageMode: 'dual-ai' | 'ai-plus-voxel';
  isGenerating: boolean;
  isRefining: boolean;
  hasApiKey: boolean;
  historyPairs: GenerationPair[];
  activePairId: string;
  onPromptChange: (val: string) => void;
  onImageChange: (dataUrl: string | undefined) => void;
  onDetailStyleChange: (style: DetailStyle) => void;
  onImageModeChange: (mode: 'dual-ai' | 'ai-plus-voxel') => void;
  onGenerateWithGemini: () => void;
  onGenerateLocalDemo: () => void;
  onRefineWithGemini: (instruction: string) => void;
  onSelectPresetPair: (pair: GenerationPair, openModal: boolean) => void;
  onOpenApiKeyModal: () => void;
  onImportProjectJson: (file: File) => void;
}

const SAMPLE_REFERENCE_IMAGES: { label: string; prompt: string; svgDataUrl: string }[] = [
  {
    label: 'Cyber Rocket',
    prompt: 'Futuristic Interstellar Rocket Ship with triple booster engines & cockpit window',
    svgDataUrl:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
          <rect width="160" height="160" fill="#090d16"/>
          <polygon points="80,16 108,65 108,118 52,118 52,65" fill="#e2e8f0"/>
          <polygon points="80,14 104,54 56,54" fill="#ef4444"/>
          <polygon points="52,85 26,126 52,118" fill="#ef4444"/>
          <polygon points="108,85 134,126 108,118" fill="#ef4444"/>
          <circle cx="80" cy="76" r="14" fill="#38bdf8" stroke="#1e293b" stroke-width="5"/>
          <polygon points="64,118 80,148 96,118" fill="#f59e0b"/>
        </svg>`
      ),
  },
  {
    label: 'Energy Shield',
    prompt: 'Royal Paladin Aegis Shield with glowing cyan crystal emblem & golden wings',
    svgDataUrl:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
          <rect width="160" height="160" fill="#090d16"/>
          <polygon points="80,18 134,40 122,106 80,144 38,106 26,40" fill="#f59e0b"/>
          <polygon points="80,28 122,46 112,100 80,132 48,100 38,46" fill="#1e3a8a"/>
          <polygon points="80,50 100,80 80,110 60,80" fill="#06b6d4"/>
        </svg>`
      ),
  },
  {
    label: 'Mecha Head',
    prompt: 'Armored Cyberpunk Mecha Helmet with glowing neon visor & golden V-fin horns',
    svgDataUrl:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
          <rect width="160" height="160" fill="#090d16"/>
          <rect x="40" y="42" width="80" height="86" rx="16" fill="#6366f1"/>
          <polygon points="80,52 20,22 32,38 80,62" fill="#f59e0b"/>
          <polygon points="80,52 140,22 128,38 80,62" fill="#f59e0b"/>
          <rect x="48" y="68" width="64" height="18" rx="4" fill="#06b6d4"/>
          <rect x="62" y="98" width="36" height="22" rx="4" fill="#1e293b"/>
        </svg>`
      ),
  },
];

export const LeftGeneratorPanel: React.FC<LeftGeneratorPanelProps> = ({
  prompt,
  imageDataUrl,
  detailStyle,
  imageMode,
  isGenerating,
  isRefining,
  hasApiKey,
  historyPairs,
  activePairId,
  onPromptChange,
  onImageChange,
  onDetailStyleChange,
  onImageModeChange,
  onGenerateWithGemini,
  onGenerateLocalDemo,
  onRefineWithGemini,
  onSelectPresetPair,
  onOpenApiKeyModal,
  onImportProjectJson,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const [refineText, setRefineText] = useState('');
  const [leftSection, setLeftSection] = useState<'create' | 'library'>('create');

  const handleImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onImageChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSampleSelect = (sample: (typeof SAMPLE_REFERENCE_IMAGES)[0]) => {
    // Convert SVG dataURL to PNG dataURL via canvas so Gemini inlineData & Voxel sampler both get standard image/png
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, 256, 256);
        onImageChange(canvas.toDataURL('image/png'));
        onPromptChange(sample.prompt);
      }
    };
    img.src = sample.svgDataUrl;
  };

  return (
    <aside className="w-[360px] shrink-0 bg-[#0e121c] border-r border-slate-800/90 flex flex-col h-full overflow-hidden">
      {/* Top Mode Switcher */}
      <div className="grid grid-cols-2 p-1.5 gap-1 bg-[#0a0d14] border-b border-slate-800">
        <button
          onClick={() => setLeftSection('create')}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            leftSection === 'create'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI 3D Generator
        </button>
        <button
          onClick={() => setLeftSection('library')}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            leftSection === 'library'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Presets & History
        </button>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {leftSection === 'create' ? (
          <>
            {/* 1. Reference Image Input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <ImagePlus className="w-3.5 h-3.5 text-indigo-400" />
                  1. Reference Image (Optional)
                </label>
                {imageDataUrl && (
                  <button
                    onClick={() => onImageChange(undefined)}
                    className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageFile(file);
                }}
              />

              {!imageDataUrl ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleImageFile(file);
                  }}
                  className="p-4 rounded-xl border-2 border-dashed border-slate-700/80 hover:border-indigo-500/70 bg-[#121726]/70 hover:bg-[#151b2d] transition flex flex-col items-center justify-center text-center cursor-pointer group"
                >
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition mb-2">
                    <ImagePlus className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-semibold text-slate-200">
                    Click or Drag & Drop Image Here
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    PNG, JPG, WEBP — Gemini Vision + 3D Voxel Extruder
                  </div>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-[#141928] border border-indigo-500/40 space-y-2.5">
                  <div className="flex items-center gap-3">
                    <img
                      src={imageDataUrl}
                      alt="Uploaded reference"
                      className="w-16 h-16 rounded-lg object-cover border border-slate-700 bg-slate-950 shrink-0"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-xs font-bold text-emerald-300">
                        Reference Image Ready
                      </div>
                      <p className="text-[10px] text-slate-400 leading-snug">
                        Choose how Option A & Option B should be generated from this image:
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onImageModeChange('dual-ai')}
                      className={`p-2 rounded-lg border text-[10px] font-semibold text-left transition cursor-pointer ${
                        imageMode === 'dual-ai'
                          ? 'bg-indigo-600/25 border-indigo-500 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div>2x AI 3D Models</div>
                      <div className="text-[9px] text-slate-400 font-normal">
                        Full 360° parts (A & B)
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onImageModeChange('ai-plus-voxel')}
                      className={`p-2 rounded-lg border text-[10px] font-semibold text-left transition cursor-pointer ${
                        imageMode === 'ai-plus-voxel'
                          ? 'bg-cyan-600/25 border-cyan-500 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div>AI 3D + Voxel Relief</div>
                      <div className="text-[9px] text-slate-400 font-normal">
                        360° Model (A) + Voxel (B)
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Sample Reference Images */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="text-[10px] text-slate-400 shrink-0">Try Sample Image:</span>
                {SAMPLE_REFERENCE_IMAGES.map((sample) => (
                  <button
                    key={sample.label}
                    type="button"
                    onClick={() => handleSampleSelect(sample)}
                    className="px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-300 hover:text-white transition cursor-pointer truncate"
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Text Prompt Input */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider">
                2. 3D Model Prompt (English / Hinglish)
              </label>
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="Describe what 3D model you want... e.g. 'Futuristic glowing cyberpunk hover car with spoiler' or 'Golden royal sword with blue crystal'"
                className="w-full p-3 rounded-xl bg-[#090c14] border border-slate-700/90 focus:border-indigo-500 focus:outline-none text-xs text-white placeholder-slate-500 resize-none leading-relaxed"
              />

              {/* Quick Prompt Chips */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Cyberpunk Hover Supercar',
                  'Mecha Guardian Robot',
                  'Royal Crystal Greatsword',
                  'Sci-Fi Hex-Rotor Drone',
                  'Steampunk Locomotion Tank',
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => onPromptChange(chip)}
                    className="px-2 py-1 rounded-md bg-[#141928] hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-500/40 text-[10px] text-slate-300 hover:text-indigo-200 transition cursor-pointer"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Mesh Style / Detail Level */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider">
                3. 3D Mesh Style
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'high-detail', label: 'High Detail', sub: 'Smooth Studio' },
                    { id: 'stylized-lowpoly', label: 'Low-Poly', sub: 'Game Ready' },
                    { id: 'voxel-blocky', label: 'Voxel Cube', sub: 'Blocky Style' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => onDetailStyleChange(st.id)}
                    className={`p-2 rounded-xl border text-center transition cursor-pointer ${
                      detailStyle === st.id
                        ? 'bg-indigo-600/25 border-indigo-500 text-white'
                        : 'bg-[#141928] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-bold">{st.label}</div>
                    <div className="text-[9px] opacity-75">{st.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Generate Dual Models CTA */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={isGenerating}
                onClick={onGenerateWithGemini}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-600 hover:from-indigo-500 hover:via-violet-500 hover:to-cyan-500 disabled:opacity-60 text-white font-bold text-xs shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 transition cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating 2 Variations (A & B)...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate 2 Variations (A vs B) with Gemini
                  </>
                )}
              </button>

              <div className="flex items-center justify-between gap-2">
                {!hasApiKey ? (
                  <button
                    type="button"
                    onClick={onOpenApiKeyModal}
                    className="flex-1 py-2 px-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-[11px] font-semibold text-amber-300 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Set Your Gemini API Key
                  </button>
                ) : null}

                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={onGenerateLocalDemo}
                  className="flex-1 py-2 px-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="Instant offline dual generation (no API key needed)"
                >
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  Instant Offline A/B Demo
                </button>
              </div>
            </div>

            {/* 5. AI Refine / Edit Selected Model */}
            <div className="p-3.5 rounded-xl bg-[#131826] border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
                  AI Modify Current 3D Model
                </span>
                <span className="text-[10px] text-slate-400">Gemini Edit</span>
              </div>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={refineText}
                  onChange={(e) => setRefineText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && refineText.trim() && !isRefining) {
                      onRefineWithGemini(refineText.trim());
                      setRefineText('');
                    }
                  }}
                  placeholder="e.g. 'Add wings on back' or 'Color gold aur black kar do'"
                  className="flex-1 px-2.5 py-2 rounded-lg bg-[#090c14] border border-slate-700 text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isRefining || !refineText.trim()}
                  onClick={() => {
                    if (refineText.trim()) {
                      onRefineWithGemini(refineText.trim());
                      setRefineText('');
                    }
                  }}
                  className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-xs font-bold text-white transition cursor-pointer shrink-0"
                >
                  {isRefining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Apply'}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* ==================== LIBRARY & PRESET PAIRS TAB ==================== */
          <div className="space-y-4">
            {/* Import Project JSON */}
            <div>
              <input
                ref={jsonInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportProjectJson(file);
                }}
              />
              <button
                onClick={() => jsonInputRef.current?.click()}
                className="w-full py-2.5 px-3 rounded-xl bg-[#141928] hover:bg-[#1a2135] border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-indigo-400" />
                Load Saved .forge3d.json Project from PC
              </button>
            </div>

            {/* Built-in Dual Variations Showcase */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Ready-to-Compare Dual 3D Models (A vs B)
              </div>
              {PRESET_GENERATION_PAIRS.map((pair) => {
                const isCurrent = pair.id === activePairId;
                return (
                  <div
                    key={pair.id}
                    className={`p-3 rounded-xl border transition space-y-2 ${
                      isCurrent
                        ? 'bg-indigo-950/30 border-indigo-500/60'
                        : 'bg-[#141928] border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{pair.variationA.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                        A vs B Ready
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{pair.prompt}</p>
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <button
                        onClick={() => onSelectPresetPair(pair, true)}
                        className="py-1.5 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11px] font-semibold text-white transition cursor-pointer"
                      >
                        Compare A vs B
                      </button>
                      <button
                        onClick={() => onSelectPresetPair(pair, false)}
                        className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition cursor-pointer"
                      >
                        Open Direct
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recent PC Generations History */}
            {historyPairs.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Your Local PC Generation History ({historyPairs.length})
                </div>
                {historyPairs.map((pair) => (
                  <div
                    key={pair.id}
                    className="p-3 rounded-xl bg-[#141928] border border-slate-800 space-y-2"
                  >
                    <div className="text-xs font-bold text-white truncate">
                      {pair.variationA.name} / {pair.variationB.name}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">"{pair.prompt}"</div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => onSelectPresetPair(pair, true)}
                        className="flex-1 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-[11px] font-semibold text-indigo-200 cursor-pointer"
                      >
                        Compare A vs B
                      </button>
                      <button
                        onClick={() => onSelectPresetPair(pair, false)}
                        className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300 cursor-pointer"
                      >
                        Load Model
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
