import React, { useState } from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  FlipHorizontal,
  Layers,
  Paintbrush,
  Palette,
  Plus,
  Sliders,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  ColorTheme,
  MaterialFinishPreset,
  Model3DSpec,
  Part3D,
  PrimitiveType,
} from '../types/model3d';
import {
  COLOR_THEMES,
  FinishDefinition,
  MATERIAL_FINISHES,
  QUICK_PAINT_SWATCHES,
} from '../utils/colorThemes';

interface RightStudioPanelProps {
  model: Model3DSpec;
  selectedPartId: string | null;
  interactionMode: 'select' | 'paint';
  activePaintColor: string;
  activePaintFinish: MaterialFinishPreset;
  onSelectPart: (partId: string | null) => void;
  onSetInteractionMode: (mode: 'select' | 'paint') => void;
  onSetActivePaintColor: (hex: string) => void;
  onSetActivePaintFinish: (finish: MaterialFinishPreset) => void;
  onApplyPaintToPart: (partId: string, hex: string, finish: MaterialFinishPreset) => void;
  onApplyColorToAllParts: (hex: string, finish: MaterialFinishPreset) => void;
  onApplyTheme: (theme: ColorTheme) => void;
  onUpdatePart: (partId: string, updater: (p: Part3D) => Part3D) => void;
  onAddPart: (type: PrimitiveType) => void;
  onDuplicatePart: (partId: string) => void;
  onDeletePart: (partId: string) => void;
}

const PRIMITIVE_OPTIONS: { id: PrimitiveType; label: string }[] = [
  { id: 'rounded_box', label: 'Rounded Box' },
  { id: 'box', label: 'Sharp Box' },
  { id: 'sphere', label: 'Sphere' },
  { id: 'hemisphere', label: 'Hemisphere Dome' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'cone', label: 'Cone / Spike' },
  { id: 'capsule', label: 'Capsule' },
  { id: 'torus', label: 'Torus Ring' },
  { id: 'octahedron', label: 'Crystal Octahedron' },
  { id: 'dodecahedron', label: 'Dodecahedron' },
  { id: 'extrude', label: 'Extruded Wing/Bevel' },
  { id: 'lathe', label: 'Lathe Revolved' },
];

export const RightStudioPanel: React.FC<RightStudioPanelProps> = ({
  model,
  selectedPartId,
  interactionMode,
  activePaintColor,
  activePaintFinish,
  onSelectPart,
  onSetInteractionMode,
  onSetActivePaintColor,
  onSetActivePaintFinish,
  onApplyPaintToPart,
  onApplyColorToAllParts,
  onApplyTheme,
  onUpdatePart,
  onAddPart,
  onDuplicatePart,
  onDeletePart,
}) => {
  const [activeTab, setActiveTab] = useState<'paint' | 'parts' | 'transform'>('paint');

  const selectedPart = model.parts.find((p) => p.id === selectedPartId) || null;

  const handleFinishSelect = (finish: FinishDefinition) => {
    onSetActivePaintFinish(finish.id);
    if (finish.defaultColor) {
      onSetActivePaintColor(finish.defaultColor);
    }
    if (selectedPart) {
      onUpdatePart(selectedPart.id, (p) => ({
        ...p,
        finishPreset: finish.id,
        color: finish.defaultColor || p.color,
        metalness: finish.metalness,
        roughness: finish.roughness,
        emissive: finish.emissiveIntensity > 0 ? finish.defaultColor || p.color : '#000000',
        emissiveIntensity: finish.emissiveIntensity,
        opacity: finish.opacity,
        transparent: finish.transparent,
      }));
    }
  };

  return (
    <aside className="w-[360px] shrink-0 bg-[#0e121c] border-l border-slate-800/90 flex flex-col h-full overflow-hidden">
      {/* Top Studio Tabs */}
      <div className="grid grid-cols-3 p-1.5 gap-1 bg-[#0a0d14] border-b border-slate-800">
        <button
          onClick={() => setActiveTab('paint')}
          className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeTab === 'paint'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          Color & Paint
        </button>

        <button
          onClick={() => setActiveTab('parts')}
          className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeTab === 'parts'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Parts ({model.parts.length})
        </button>

        <button
          onClick={() => setActiveTab('transform')}
          className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeTab === 'transform'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Inspector
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* ==================== TAB 1: COLOR & PAINT STUDIO ==================== */}
        {activeTab === 'paint' && (
          <>
            {/* Interactive Click-to-Paint Mode Banner */}
            <div
              className={`p-3.5 rounded-xl border transition ${
                interactionMode === 'paint'
                  ? 'bg-cyan-950/35 border-cyan-500/60 shadow-[0_0_20px_rgba(6,182,212,0.12)]'
                  : 'bg-[#141928] border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      interactionMode === 'paint'
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    <Paintbrush className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">3D Click-to-Paint Brush</div>
                    <div className="text-[11px] text-slate-400">
                      {interactionMode === 'paint'
                        ? 'Click any part on the 3D model to paint it!'
                        : 'Enable to paint directly on the 3D model'}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() =>
                    onSetInteractionMode(interactionMode === 'paint' ? 'select' : 'paint')
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    interactionMode === 'paint'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  {interactionMode === 'paint' ? 'Active (ON)' : 'Turn ON'}
                </button>
              </div>
            </div>

            {/* Active Brush Color Picker & Swatches */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  1. Pick Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={activePaintColor}
                    onChange={(e) => {
                      const hex = e.target.value;
                      onSetActivePaintColor(hex);
                      if (selectedPart) {
                        onApplyPaintToPart(selectedPart.id, hex, activePaintFinish);
                      }
                    }}
                    className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                  />
                  <input
                    type="text"
                    value={activePaintColor}
                    onChange={(e) => onSetActivePaintColor(e.target.value)}
                    className="w-20 px-2 py-1 rounded bg-[#090c12] border border-slate-700 text-xs font-mono text-white"
                  />
                </div>
              </div>

              {/* Quick Swatches Grid */}
              <div className="grid grid-cols-8 gap-1.5">
                {QUICK_PAINT_SWATCHES.map((sw) => {
                  const isSelected = activePaintColor.toLowerCase() === sw.hex.toLowerCase();
                  return (
                    <button
                      key={sw.hex}
                      onClick={() => {
                        onSetActivePaintColor(sw.hex);
                        if (selectedPart) {
                          onApplyPaintToPart(selectedPart.id, sw.hex, activePaintFinish);
                        }
                      }}
                      title={sw.name}
                      className={`h-7 rounded-lg border transition cursor-pointer ${
                        isSelected
                          ? 'border-white scale-110 ring-2 ring-indigo-500/60'
                          : 'border-white/15 hover:scale-105'
                      }`}
                      style={{ backgroundColor: sw.hex }}
                    />
                  );
                })}
              </div>

              {/* Apply to Selected Part or Entire Model */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  disabled={!selectedPart}
                  onClick={() =>
                    selectedPart &&
                    onApplyPaintToPart(selectedPart.id, activePaintColor, activePaintFinish)
                  }
                  className="px-3 py-2 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 disabled:opacity-40 border border-indigo-500/40 text-xs font-semibold text-indigo-200 transition cursor-pointer"
                >
                  {selectedPart ? `Paint "${selectedPart.name.slice(0, 12)}"` : 'Select a Part First'}
                </button>
                <button
                  onClick={() => onApplyColorToAllParts(activePaintColor, activePaintFinish)}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer"
                >
                  Paint Entire Model
                </button>
              </div>
            </div>

            {/* Material Finish Presets */}
            <div className="space-y-2.5">
              <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider">
                2. Surface Material Finish
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {MATERIAL_FINISHES.map((fin) => {
                  const isAct = activePaintFinish === fin.id;
                  return (
                    <button
                      key={fin.id}
                      onClick={() => handleFinishSelect(fin)}
                      className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                        isAct
                          ? 'bg-indigo-600/25 border-indigo-500 text-white'
                          : 'bg-[#141928] border-slate-800/90 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-bold">{fin.label}</div>
                      <div className="text-[10px] text-slate-400 truncate">{fin.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* One-Click Full Model Color Themes */}
            <div className="space-y-2.5 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  3. One-Click AI Color Themes
                </label>
                <span className="text-[10px] text-slate-400">Auto-colors all parts</span>
              </div>

              <div className="space-y-2">
                {COLOR_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => onApplyTheme(theme)}
                    className="w-full p-2.5 rounded-xl bg-[#141928] hover:bg-[#1a2135] border border-slate-800 hover:border-indigo-500/50 transition flex items-center justify-between gap-2 cursor-pointer text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white">{theme.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {theme.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {theme.swatches.map((hex, i) => (
                        <span
                          key={i}
                          className="w-3.5 h-3.5 rounded-full border border-white/25"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ==================== TAB 2: PARTS OUTLINER ==================== */}
        {activeTab === 'parts' && (
          <div className="space-y-3">
            {/* Add New Part Bar */}
            <div className="p-3 rounded-xl bg-[#141928] border border-slate-800 space-y-2">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-indigo-400" />
                Add New 3D Component to Model
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'rounded_box', label: '+ Box' },
                    { id: 'sphere', label: '+ Sphere' },
                    { id: 'cylinder', label: '+ Cylinder' },
                    { id: 'cone', label: '+ Cone' },
                    { id: 'torus', label: '+ Ring' },
                    { id: 'capsule', label: '+ Capsule' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onAddPart(item.id)}
                    className="py-1.5 px-2 rounded-lg bg-slate-900 hover:bg-indigo-600/30 border border-slate-700/80 hover:border-indigo-500/50 text-[11px] font-semibold text-slate-200 transition cursor-pointer"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Parts Hierarchy List */}
            <div className="space-y-1.5">
              {model.parts.map((part) => {
                const isSel = part.id === selectedPartId;
                return (
                  <div
                    key={part.id}
                    onClick={() => onSelectPart(part.id)}
                    className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 transition cursor-pointer ${
                      isSel
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-[#131826] border-slate-800/80 text-slate-300 hover:bg-[#171d2e]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="color"
                        value={part.color}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          onUpdatePart(part.id, (p) => ({ ...p, color: e.target.value }))
                        }
                        className="w-4 h-4 rounded-full cursor-pointer border-0 bg-transparent shrink-0"
                        title="Change Part Color"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">{part.name}</div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                          <span className="uppercase">{part.type}</span>
                          {part.mirrorX && (
                            <span className="text-indigo-400 font-medium">• MirrorX</span>
                          )}
                          {part.radialCount && (
                            <span className="text-cyan-400 font-medium">
                              • {part.radialCount}x Radial
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() =>
                          onUpdatePart(part.id, (p) => ({
                            ...p,
                            visible: p.visible === false ? true : false,
                          }))
                        }
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                        title="Toggle Visibility"
                      >
                        {part.visible === false ? (
                          <EyeOff className="w-3.5 h-3.5 text-rose-400" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => onDuplicatePart(part.id)}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                        title="Duplicate Part"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {model.parts.length > 1 && (
                        <button
                          onClick={() => onDeletePart(part.id)}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400"
                          title="Delete Part"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ==================== TAB 3: PART TRANSFORM & PBR INSPECTOR ==================== */}
        {activeTab === 'transform' && (
          <>
            {!selectedPart ? (
              <div className="p-6 rounded-xl bg-[#141928] border border-slate-800 text-center space-y-2">
                <Sliders className="w-7 h-7 text-indigo-400 mx-auto" />
                <div className="text-xs font-bold text-white">No 3D Part Selected</div>
                <p className="text-[11px] text-slate-400">
                  Click any part directly on the 3D model in the viewport (or pick one from the
                  Parts tab) to adjust its Color, Material, Position, Rotation, Scale & Symmetry.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Part Name & Type */}
                <div className="p-3.5 rounded-xl bg-[#141928] border border-slate-800 space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Selected Part Name
                    </label>
                    <input
                      type="text"
                      value={selectedPart.name}
                      onChange={(e) =>
                        onUpdatePart(selectedPart.id, (p) => ({ ...p, name: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#0a0d14] border border-slate-700 text-xs text-white font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      3D Shape / Geometry
                    </label>
                    <select
                      value={selectedPart.type}
                      onChange={(e) =>
                        onUpdatePart(selectedPart.id, (p) => ({
                          ...p,
                          type: e.target.value as PrimitiveType,
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#0a0d14] border border-slate-700 text-xs text-white"
                    >
                      {PRIMITIVE_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id} className="bg-[#0e121c]">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Fine Material Sliders */}
                <div className="p-3.5 rounded-xl bg-[#141928] border border-slate-800 space-y-3">
                  <div className="text-xs font-bold text-white">PBR Surface & Glow</div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-300">Base Color</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={selectedPart.color}
                        onChange={(e) =>
                          onUpdatePart(selectedPart.id, (p) => ({ ...p, color: e.target.value }))
                        }
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <span className="text-xs font-mono text-slate-300">{selectedPart.color}</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>Metalness</span>
                      <span>{Math.round(selectedPart.metalness * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={selectedPart.metalness}
                      onChange={(e) =>
                        onUpdatePart(selectedPart.id, (p) => ({
                          ...p,
                          metalness: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>Roughness (Gloss vs Matte)</span>
                      <span>{Math.round(selectedPart.roughness * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.04"
                      max="1"
                      step="0.02"
                      value={selectedPart.roughness}
                      onChange={(e) =>
                        onUpdatePart(selectedPart.id, (p) => ({
                          ...p,
                          roughness: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>Neon Glow (Emissive)</span>
                      <span>{(selectedPart.emissiveIntensity ?? 0).toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="0.1"
                      value={selectedPart.emissiveIntensity ?? 0}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        onUpdatePart(selectedPart.id, (p) => ({
                          ...p,
                          emissive: val > 0 ? p.color : '#000000',
                          emissiveIntensity: val,
                        }));
                      }}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>Opacity (Glass Transparency)</span>
                      <span>{Math.round((selectedPart.opacity ?? 1) * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.15"
                      max="1"
                      step="0.05"
                      value={selectedPart.opacity ?? 1}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        onUpdatePart(selectedPart.id, (p) => ({
                          ...p,
                          opacity: val,
                          transparent: val < 0.98,
                        }));
                      }}
                      className="w-full"
                    />
                  </div>
                </div>

                {/* Transform Controls (Position, Rotation, Scale) */}
                <div className="p-3.5 rounded-xl bg-[#141928] border border-slate-800 space-y-3">
                  <div className="text-xs font-bold text-white">3D Transform (X / Y / Z)</div>

                  {(
                    [
                      { key: 'position', label: 'Position', step: 0.1 },
                      { key: 'rotation', label: 'Rotation (°)', step: 5 },
                      { key: 'scale', label: 'Scale / Size', step: 0.1 },
                    ] as const
                  ).map((tf) => (
                    <div key={tf.key}>
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                        {tf.label}
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                          <div
                            key={axis}
                            className="flex items-center bg-[#0a0d14] border border-slate-700 rounded-lg px-2 py-1"
                          >
                            <span
                              className={`text-[10px] font-bold mr-1.5 ${
                                idx === 0
                                  ? 'text-rose-400'
                                  : idx === 1
                                  ? 'text-emerald-400'
                                  : 'text-sky-400'
                              }`}
                            >
                              {axis}
                            </span>
                            <input
                              type="number"
                              step={tf.step}
                              value={selectedPart[tf.key][idx]}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                onUpdatePart(selectedPart.id, (p) => {
                                  const next = [...p[tf.key]] as [number, number, number];
                                  next[idx] = tf.key === 'scale' ? Math.max(0.05, val) : val;
                                  return { ...p, [tf.key]: next };
                                });
                              }}
                              className="w-full bg-transparent text-xs text-white focus:outline-none font-mono"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Symmetry Modifiers */}
                <div className="p-3.5 rounded-xl bg-[#141928] border border-slate-800 space-y-2.5">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <FlipHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                    Symmetry & Array Modifiers
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-[#0a0d14] border border-slate-800 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedPart.mirrorX)}
                        onChange={(e) =>
                          onUpdatePart(selectedPart.id, (p) => ({
                            ...p,
                            mirrorX: e.target.checked,
                          }))
                        }
                      />
                      Mirror Left/Right (X)
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg bg-[#0a0d14] border border-slate-800 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedPart.mirrorZ)}
                        onChange={(e) =>
                          onUpdatePart(selectedPart.id, (p) => ({
                            ...p,
                            mirrorZ: e.target.checked,
                          }))
                        }
                      />
                      Mirror Front/Back (Z)
                    </label>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
