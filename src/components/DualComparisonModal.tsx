import React, { useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Grid,
  Layers,
  RotateCw,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import { GenerationPair } from '../types/model3d';
import { Viewport3D } from './Viewport3D';

interface DualComparisonModalProps {
  pair: GenerationPair;
  onSelectVariation: (choice: 'A' | 'B') => void;
  onClose: () => void;
}

export const DualComparisonModal: React.FC<DualComparisonModalProps> = ({
  pair,
  onSelectVariation,
  onClose,
}) => {
  const [autoRotate, setAutoRotate] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<'A' | 'B' | null>(null);

  const getUniqueSwatches = (parts: GenerationPair['variationA']['parts']) => {
    const colors = Array.from(new Set(parts.map((p) => p.color)));
    return colors.slice(0, 6);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6">
      <div className="w-full max-w-[1440px] h-[88vh] bg-[#0e111a] border border-indigo-500/30 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-950/60 via-[#111522] to-purple-950/60 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Choose Your Best 3D Model Variation (A vs B)
                </h2>
                <span className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Interactive 3D Preview
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                Prompt: <span className="text-slate-200 font-medium">"{pair.prompt}"</span> — Rotate
                both 3D models with your mouse and select the one you want to customize & download!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {pair.imageUrl && (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/70">
                <img
                  src={pair.imageUrl}
                  alt="Reference"
                  className="w-7 h-7 rounded object-cover border border-slate-600"
                />
                <span className="text-[11px] text-slate-300">Reference Image</span>
              </div>
            )}

            <button
              onClick={() => setAutoRotate((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition ${
                autoRotate
                  ? 'bg-indigo-600/25 border-indigo-500/50 text-indigo-200'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <RotateCw className={`w-3.5 h-3.5 ${autoRotate ? 'animate-spin' : ''}`} />
              Auto-Spin
            </button>

            <button
              onClick={() => setWireframe((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition ${
                wireframe
                  ? 'bg-cyan-600/25 border-cyan-500/50 text-cyan-200'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              Wireframe
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition"
              title="Close Comparison"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Side-by-Side 3D Comparison Grid */}
        <div className="flex-1 grid grid-cols-2 gap-5 p-5 overflow-hidden bg-[#090b10]">
          {(['A', 'B'] as const).map((key) => {
            const spec = key === 'A' ? pair.variationA : pair.variationB;
            const isCurrentSelected = pair.selectedVariation === key;
            const swatches = getUniqueSwatches(spec.parts);
            const isA = key === 'A';

            return (
              <div
                key={key}
                onMouseEnter={() => setHoveredCard(key)}
                onMouseLeave={() => setHoveredCard(null)}
                className={`flex flex-col rounded-2xl border-2 transition-all duration-200 overflow-hidden bg-[#111520] ${
                  hoveredCard === key
                    ? isA
                      ? 'border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.2)]'
                      : 'border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.2)]'
                    : isCurrentSelected
                    ? 'border-emerald-500/70'
                    : 'border-slate-800'
                }`}
              >
                {/* Card Top Bar */}
                <div className="px-4 py-3 bg-[#151a28] border-b border-slate-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                        isA
                          ? 'bg-indigo-600 text-white'
                          : 'bg-cyan-600 text-white'
                      }`}
                    >
                      Option {key}
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-white leading-tight">{spec.name}</h3>
                      <p className="text-[11px] text-slate-400">{spec.subtitle}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] text-slate-300 flex items-center gap-1">
                      <Layers className="w-3 h-3 text-indigo-400" />
                      {spec.parts.length} Parts
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] text-cyan-300">
                      {spec.styleTag}
                    </span>
                  </div>
                </div>

                {/* Live Interactive 3D Viewport */}
                <div className="relative flex-1 min-h-0 bg-[#0b0e17]">
                  <Viewport3D
                    model={spec}
                    detailStyle={pair.detailStyle}
                    lightingPreset={isA ? 'studio' : 'cyberpunk'}
                    autoRotate={autoRotate}
                    wireframe={wireframe}
                    compact={true}
                    backgroundColor="#0b0e17"
                  />

                  {/* Top-left hint badge */}
                  <div className="pointer-events-none absolute top-3 left-3 px-2.5 py-1 rounded-md bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-indigo-400" />
                    Drag to Rotate 360° • Scroll to Zoom
                  </div>

                  {/* Color Swatches Preview */}
                  <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 mr-1">Colors:</span>
                    {swatches.map((hex, i) => (
                      <span
                        key={i}
                        className="w-3.5 h-3.5 rounded-full border border-white/25"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </div>

                {/* Card Bottom Info & Select Button */}
                <div className="p-4 bg-[#141927] border-t border-slate-800/90 flex items-center justify-between gap-4">
                  <p className="text-xs text-slate-300 line-clamp-2 flex-1">{spec.description}</p>

                  <button
                    onClick={() => onSelectVariation(key)}
                    className={`shrink-0 px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition shadow-lg cursor-pointer ${
                      isA
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-indigo-600/25'
                        : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-600/25'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Select Option {key} & Open Preview
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
