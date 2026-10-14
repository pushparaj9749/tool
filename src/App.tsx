import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Box,
  Camera,
  CheckCircle2,
  Download,
  Grid,
  ImagePlus,
  KeyRound,
  Layers,
  Loader2,
  Paintbrush,
  Palette,
  Redo2,
  RotateCw,
  Sparkles,
  Sun,
  Trash2,
  Trophy,
  Undo2,
  Wand2,
} from 'lucide-react';
import {
  ColorTheme,
  DetailStyle,
  GeminiConfig,
  GenerationPair,
  LightingPreset,
  MaterialFinishPreset,
  Model3DSpec,
  Part3D,
} from './types/model3d';
import { PRESET_GENERATION_PAIRS } from './utils/presetModels';
import {
  applyColorThemeToParts,
  COLOR_THEMES,
  MATERIAL_FINISHES,
  QUICK_PAINT_SWATCHES,
} from './utils/colorThemes';
import {
  generateDual3DModelsWithGemini,
  generateFallbackPair,
  refineModelWithGemini,
} from './services/geminiService';
import {
  exportModelToGLTF,
  exportModelToOBJ,
  exportModelToSTL,
} from './utils/exporters';
import { Viewport3D } from './components/Viewport3D';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ExportModal } from './components/ExportModal';

const STORAGE_KEY_API = 'forge3d_gemini_config_v1';

type WorkflowStep = 'create' | 'choose' | 'preview';

export function App() {
  // User's Gemini API Key & Custom Models (stored locally on PC)
  const [geminiConfig, setGeminiConfig] = useState<GeminiConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_API);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return { apiKey: '', model: 'gemini-2.5-flash', customModels: [] };
  });

  // Guided 3-Step Workflow State ('create' -> 'choose' -> 'preview')
  const [step, setStep] = useState<WorkflowStep>('create');

  // Step 1: Creation Inputs
  const [prompt, setPrompt] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | undefined>(undefined);
  const [detailStyle, setDetailStyle] = useState<DetailStyle>('high-detail');
  const [selectedThemeId, setSelectedThemeId] = useState<string>('cyberpunk-2099');
  const [preferredColor, setPreferredColor] = useState<string>('#6366f1');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [refineInput, setRefineInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Step 2 & 3: Generated Pair (Option A & Option B) + Chosen Model
  const [activePair, setActivePair] = useState<GenerationPair>(() =>
    JSON.parse(JSON.stringify(PRESET_GENERATION_PAIRS[0]))
  );
  const [chosenOption, setChosenOption] = useState<'A' | 'B'>('A');
  const [activeModel, setActiveModel] = useState<Model3DSpec>(() =>
    JSON.parse(JSON.stringify(PRESET_GENERATION_PAIRS[0].variationA))
  );

  // Undo / Redo Stack
  const [undoStack, setUndoStack] = useState<Model3DSpec[]>([]);
  const [redoStack, setRedoStack] = useState<Model3DSpec[]>([]);

  // Step 3: Preview & Easy Color Studio State
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [activePaintColor, setActivePaintColor] = useState<string>('#06b6d4');
  const [activePaintFinish, setActivePaintFinish] = useState<MaterialFinishPreset>('metallic');
  const [paintOnClick, setPaintOnClick] = useState<boolean>(true);
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('studio');
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [screenshotTrigger, setScreenshotTrigger] = useState<number>(0);

  // Modals & Toast
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const notify = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ text, type });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSaveGeminiConfig = (newCfg: GeminiConfig) => {
    setGeminiConfig(newCfg);
    try {
      localStorage.setItem(STORAGE_KEY_API, JSON.stringify(newCfg));
    } catch {
      // ignore
    }
    notify(`Saved API settings (Model: ${newCfg.model})`, 'success');
  };

  const commitModelChange = (updater: (current: Model3DSpec) => Model3DSpec) => {
    setActiveModel((prev) => {
      const next = updater(prev);
      setUndoStack((u) => [...u.slice(-20), prev]);
      setRedoStack([]);
      return next;
    });
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, activeModel]);
    setActiveModel(previous);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, activeModel]);
    setActiveModel(next);
  };

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // STEP 1 -> STEP 2: Generate 2 Models (Option A & Option B)
  const handleGenerateModels = async () => {
    if (!prompt.trim() && !imageDataUrl) {
      notify('Please enter a prompt or upload an image first!', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      let generatedPair: GenerationPair;

      if (geminiConfig.apiKey.trim()) {
        generatedPair = await generateDual3DModelsWithGemini({
          prompt,
          imageDataUrl,
          detailStyle,
          preferredColorHex: preferredColor,
          geminiConfig,
        });
      } else {
        generatedPair = await generateFallbackPair({
          prompt,
          imageDataUrl,
          detailStyle,
        });
      }

      // Apply selected starting color theme if chosen
      const chosenTheme = COLOR_THEMES.find((t) => t.id === selectedThemeId);
      if (chosenTheme && !geminiConfig.apiKey.trim()) {
        generatedPair.variationA.parts = applyColorThemeToParts(
          generatedPair.variationA.parts,
          chosenTheme
        );
      }

      setActivePair(generatedPair);
      setStep('choose');
      notify('2 Models generated! Compare Option A & Option B and choose the better one.', 'success');
    } catch (err: any) {
      notify(err?.message || 'Generation failed. Please check your Gemini API Key & Model name.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // STEP 2 -> STEP 3: User chooses Option A or Option B -> Opens 3D Preview & Color Studio
  const handleChooseOption = (option: 'A' | 'B') => {
    const selectedSpec: Model3DSpec = JSON.parse(
      JSON.stringify(option === 'A' ? activePair.variationA : activePair.variationB)
    );
    setChosenOption(option);
    setActiveModel(selectedSpec);
    setSelectedPartId(selectedSpec.parts[0]?.id || null);
    setUndoStack([]);
    setRedoStack([]);
    setAutoRotate(false);
    setStep('preview');
    notify(`Opened Option ${option} ("${selectedSpec.name}") in 3D Preview & Color Studio!`, 'success');
  };

  // Paint & Color helpers in Step 3
  const getFinishDef = (finishId: MaterialFinishPreset) =>
    MATERIAL_FINISHES.find((f) => f.id === finishId) || MATERIAL_FINISHES[0];

  const handlePaintPart = (
    partId: string,
    hex = activePaintColor,
    finishId = activePaintFinish
  ) => {
    const fin = getFinishDef(finishId);
    commitModelChange((m) => ({
      ...m,
      parts: m.parts.map((p) =>
        p.id === partId
          ? {
              ...p,
              color: hex,
              finishPreset: finishId,
              metalness: fin.metalness,
              roughness: fin.roughness,
              emissive: fin.emissiveIntensity > 0 ? hex : '#000000',
              emissiveIntensity: fin.emissiveIntensity,
              opacity: fin.opacity,
              transparent: fin.transparent,
            }
          : p
      ),
    }));
    setSelectedPartId(partId);
  };

  const handleColorAllParts = (hex = activePaintColor, finishId = activePaintFinish) => {
    const fin = getFinishDef(finishId);
    commitModelChange((m) => ({
      ...m,
      parts: m.parts.map((p) => ({
        ...p,
        color: hex,
        finishPreset: finishId,
        metalness: fin.metalness,
        roughness: fin.roughness,
        emissive: fin.emissiveIntensity > 0 ? hex : '#000000',
        emissiveIntensity: fin.emissiveIntensity,
        opacity: fin.opacity,
        transparent: fin.transparent,
      })),
    }));
    notify('Applied color & finish to the entire 3D model!', 'success');
  };

  const handleApplyTheme = (theme: ColorTheme) => {
    commitModelChange((m) => ({
      ...m,
      parts: applyColorThemeToParts(m.parts, theme),
    }));
    notify(`Applied "${theme.name}" color theme!`, 'success');
  };

  const handleAiRefine = async () => {
    if (!refineInput.trim()) return;
    if (!geminiConfig.apiKey.trim()) {
      setShowApiKeyModal(true);
      notify('Please enter your Gemini API Key to use AI Edit.', 'info');
      return;
    }
    setIsRefining(true);
    try {
      const updated = await refineModelWithGemini({
        currentModel: activeModel,
        instruction: refineInput.trim(),
        geminiConfig,
      });
      commitModelChange(() => updated);
      setRefineInput('');
      notify('3D Model updated with your changes!', 'success');
    } catch (err: any) {
      notify(err?.message || 'Could not refine model.', 'error');
    } finally {
      setIsRefining(false);
    }
  };

  const hasApiKey = Boolean(geminiConfig.apiKey.trim());
  const selectedPartObj = activeModel.parts.find((p) => p.id === selectedPartId) || null;

  return (
    <div className="w-screen h-screen bg-[#080b12] text-slate-100 flex flex-col overflow-hidden select-none">
      {/* ==================== CLEAN TOP NAVIGATION BAR ==================== */}
      <header className="h-16 shrink-0 px-6 bg-[#0c101b] border-b border-slate-800/80 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Box className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base tracking-tight text-white">
                Forge3D <span className="text-indigo-400">Studio</span>
              </span>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                v1.0.1
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              AI Image &amp; Prompt to 3D Model Generator
            </p>
          </div>
        </div>

        {/* Center 3-Step Progress Pill */}
        <div className="flex items-center gap-1.5 bg-[#121726] p-1.5 rounded-2xl border border-slate-800">
          <button
            onClick={() => setStep('create')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              step === 'create'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            1. Prompt &amp; Image
          </button>
          <span className="text-slate-600">→</span>
          <button
            onClick={() => setStep('choose')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              step === 'choose'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            2. Choose Best (A vs B)
          </button>
          <span className="text-slate-600">→</span>
          <button
            onClick={() => setStep('preview')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              step === 'preview'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            3. 3D Preview, Color &amp; Download
          </button>
        </div>

        {/* Right: Gemini API Key + Custom Model Button */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowApiKeyModal(true)}
            className={`px-4 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 transition cursor-pointer ${
              hasApiKey
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/60'
                : 'bg-indigo-600/20 border-indigo-500/50 text-indigo-200 hover:bg-indigo-600/30'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <div className="text-left">
              <div>{hasApiKey ? 'Gemini API Connected' : 'Set Gemini API Key & Model'}</div>
              <div className="text-[10px] font-mono opacity-80">{geminiConfig.model}</div>
            </div>
          </button>

          {step === 'preview' && (
            <button
              onClick={() => setShowExportModal(true)}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 flex items-center gap-2 transition cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download 3D Model
            </button>
          )}
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-slate-900/95 border border-slate-700 shadow-2xl flex items-center gap-2.5 text-xs font-semibold text-white backdrop-blur-md">
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* ==================== STEP 1: EASY CREATE SCREEN ==================== */}
      {step === 'create' && (
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-6 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.14),transparent_70%)]">
          <div className="w-full max-w-4xl space-y-6">
            {/* Title */}
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-extrabold text-white tracking-tight">
                Create Your 3D Model from Image &amp; Prompt
              </h1>
              <p className="text-sm text-slate-400">
                Upload an image and/or describe what you want — we will generate{' '}
                <strong className="text-indigo-300">2 3D Variations (Option A &amp; Option B)</strong>{' '}
                for you to choose from!
              </p>
            </div>

            {/* Main Creation Card */}
            <div className="p-7 rounded-3xl bg-[#0e1320] border border-slate-800/90 shadow-2xl space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                {/* Left: Reference Image Upload */}
                <div className="md:col-span-5 flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                      <ImagePlus className="w-4 h-4 text-indigo-400" />
                      Reference Image (Optional)
                    </label>
                    {imageDataUrl && (
                      <button
                        onClick={() => setImageDataUrl(undefined)}
                        className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
                      if (file) handleImageUpload(file);
                    }}
                  />

                  {!imageDataUrl ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleImageUpload(file);
                      }}
                      className="flex-1 min-h-[190px] p-6 rounded-2xl border-2 border-dashed border-slate-700/80 hover:border-indigo-500 bg-[#090d16]/70 hover:bg-[#111728] transition flex flex-col items-center justify-center text-center cursor-pointer group"
                    >
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition mb-3">
                        <ImagePlus className="w-6 h-6" />
                      </div>
                      <div className="text-sm font-bold text-white">
                        Upload or Drop Image Here
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        PNG, JPG, WEBP supported
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-[190px] p-3 rounded-2xl bg-[#090d16] border border-indigo-500/50 flex flex-col items-center justify-center relative">
                      <img
                        src={imageDataUrl}
                        alt="Uploaded Reference"
                        className="max-h-40 rounded-xl object-contain"
                      />
                      <span className="mt-2 text-xs text-emerald-400 font-semibold">
                        ✓ Image Ready for 3D Generation
                      </span>
                    </div>
                  )}
                </div>

                {/* Right: Prompt & Style Settings */}
                <div className="md:col-span-7 flex flex-col justify-between space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider mb-2">
                      Describe Your 3D Model (Prompt)
                    </label>
                    <textarea
                      rows={4}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Example: A futuristic cyberpunk sports car with glowing neon wheels and rear spoiler..."
                      className="w-full p-3.5 rounded-2xl bg-[#090d16] border border-slate-700/90 focus:border-indigo-500 focus:outline-none text-sm text-white placeholder-slate-500 resize-none leading-relaxed"
                    />

                    {/* Quick Idea Chips */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[
                        'Futuristic Cyberpunk Supercar',
                        'Armored Mecha Guardian Robot',
                        'Royal Golden Greatsword with Crystal',
                        'Sci-Fi Recon Quad-Drone',
                      ].map((idea) => (
                        <button
                          key={idea}
                          type="button"
                          onClick={() => setPrompt(idea)}
                          className="px-2.5 py-1 rounded-lg bg-[#141a2b] hover:bg-indigo-600/25 border border-slate-800 hover:border-indigo-500/40 text-[11px] text-slate-300 hover:text-white transition cursor-pointer"
                        >
                          {idea}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Color & Detail Row */}
                  <div className="grid grid-cols-2 gap-4 pt-1">
                    <div>
                      <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider mb-1.5">
                        Starting Color Style
                      </label>
                      <div className="flex items-center gap-2 p-2 rounded-xl bg-[#090d16] border border-slate-800">
                        <input
                          type="color"
                          value={preferredColor}
                          onChange={(e) => setPreferredColor(e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer bg-transparent border-0 shrink-0"
                        />
                        <select
                          value={selectedThemeId}
                          onChange={(e) => setSelectedThemeId(e.target.value)}
                          className="w-full bg-transparent text-xs text-white focus:outline-none"
                        >
                          {COLOR_THEMES.map((t) => (
                            <option key={t.id} value={t.id} className="bg-[#0e1320]">
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider mb-1.5">
                        3D Mesh Style
                      </label>
                      <select
                        value={detailStyle}
                        onChange={(e) => setDetailStyle(e.target.value as DetailStyle)}
                        className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-800 text-xs text-white focus:outline-none"
                      >
                        <option value="high-detail" className="bg-[#0e1320]">
                          High-Detail Smooth 3D
                        </option>
                        <option value="stylized-lowpoly" className="bg-[#0e1320]">
                          Stylized Low-Poly Game 3D
                        </option>
                        <option value="voxel-blocky" className="bg-[#0e1320]">
                          Voxel / Blocky 3D Style
                        </option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Big Generate CTA Button */}
              <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={handleGenerateModels}
                  className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-600 hover:from-indigo-500 hover:via-violet-500 hover:to-cyan-500 disabled:opacity-60 text-white font-extrabold text-sm shadow-xl shadow-indigo-600/25 flex items-center justify-center gap-2.5 transition cursor-pointer"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Generating 2 3D Models (Option A &amp; Option B)...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Generate 2 Models (Option A vs Option B)
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Ready Templates Bar */}
            <div className="p-4 rounded-2xl bg-[#0c101b] border border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-400">
                Or test immediately with a pre-built 3D Model Pair:
              </span>
              <div className="flex flex-wrap gap-2">
                {PRESET_GENERATION_PAIRS.map((pair) => (
                  <button
                    key={pair.id}
                    onClick={() => {
                      const cloned: GenerationPair = JSON.parse(JSON.stringify(pair));
                      setActivePair(cloned);
                      setPrompt(cloned.prompt);
                      setStep('choose');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-[#141a2b] hover:bg-indigo-600/30 border border-slate-700/80 hover:border-indigo-500/50 text-xs font-semibold text-slate-200 transition cursor-pointer"
                  >
                    {pair.variationA.name} (A vs B)
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== STEP 2: CHOOSE BETTER MODEL (A vs B) ==================== */}
      {step === 'choose' && (
        <div className="flex-1 flex flex-col p-6 overflow-hidden bg-[#080b12]">
          <div className="max-w-7xl w-full mx-auto flex-1 flex flex-col min-h-0">
            {/* Header Info */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep('create')}
                  className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
                <div>
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-400" />
                    Choose Which 3D Model Is Better (Option A vs Option B)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Rotate both 3D models with your mouse, then click{' '}
                    <strong className="text-white">Choose Model</strong> on the one you like best to
                    open its full preview &amp; color editor!
                  </p>
                </div>
              </div>

              <button
                onClick={() => setAutoRotate((v) => !v)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer ${
                  autoRotate
                    ? 'bg-indigo-600/25 border-indigo-500/50 text-indigo-200'
                    : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
              >
                <RotateCw className={`w-3.5 h-3.5 ${autoRotate ? 'animate-spin' : ''}`} />
                Auto-Spin Both
              </button>
            </div>

            {/* Side-by-Side 2 Cards */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 min-h-0">
              {(['A', 'B'] as const).map((key) => {
                const spec = key === 'A' ? activePair.variationA : activePair.variationB;
                const isA = key === 'A';
                return (
                  <div
                    key={key}
                    className={`flex flex-col rounded-3xl border-2 overflow-hidden bg-[#0e1320] transition ${
                      isA
                        ? 'border-indigo-500/60 hover:border-indigo-400'
                        : 'border-cyan-500/60 hover:border-cyan-400'
                    }`}
                  >
                    <div className="px-5 py-3.5 bg-[#13192b] border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`px-3 py-1 rounded-lg text-xs font-extrabold uppercase ${
                            isA ? 'bg-indigo-600 text-white' : 'bg-cyan-600 text-white'
                          }`}
                        >
                          Model {key}
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-white">{spec.name}</h3>
                          <p className="text-[11px] text-slate-400">{spec.subtitle}</p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5 text-indigo-400" />
                        {spec.parts.length} Parts
                      </span>
                    </div>

                    <div className="flex-1 min-h-0 relative bg-[#090c14]">
                      <Viewport3D
                        model={spec}
                        detailStyle={activePair.detailStyle}
                        lightingPreset={isA ? 'studio' : 'cyberpunk'}
                        autoRotate={autoRotate}
                        compact={true}
                        backgroundColor="#090c14"
                      />
                    </div>

                    <div className="p-5 bg-[#13192b] border-t border-slate-800 flex items-center justify-between gap-4">
                      <p className="text-xs text-slate-300 line-clamp-2 flex-1">
                        {spec.description}
                      </p>
                      <button
                        onClick={() => handleChooseOption(key)}
                        className={`shrink-0 px-6 py-3 rounded-xl font-extrabold text-xs text-white flex items-center gap-2 shadow-lg transition cursor-pointer ${
                          isA
                            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500'
                            : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Choose Model {key} &amp; Open Preview
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== STEP 3: FULL 3D PREVIEW, EASY COLOR & DOWNLOAD ==================== */}
      {step === 'preview' && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left/Center: Large 3D Interactive Viewport */}
          <main className="flex-1 flex flex-col min-w-0 bg-[#090c14] relative">
            {/* Top Floating Bar inside Viewport */}
            <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
              <div className="pointer-events-auto flex items-center gap-2.5">
                <button
                  onClick={() => setStep('choose')}
                  className="px-3.5 py-2 rounded-xl bg-slate-950/90 hover:bg-slate-900 border border-slate-800 text-xs font-bold text-slate-200 flex items-center gap-1.5 shadow-lg backdrop-blur-md cursor-pointer"
                >
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  Switch Option A / B
                </button>

                <div className="px-3.5 py-2 rounded-xl bg-slate-950/90 border border-slate-800 backdrop-blur-md shadow-lg flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">
                    Selected: Model {chosenOption}
                  </span>
                  <span className="text-xs font-bold text-white">{activeModel.name}</span>
                </div>
              </div>

              {/* Right Quick Controls */}
              <div className="pointer-events-auto flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-950/90 border border-slate-800 backdrop-blur-md shadow-lg">
                <button
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="p-2 rounded-lg text-slate-300 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Undo"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  className="p-2 rounded-lg text-slate-300 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Redo"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
                <div className="h-4 w-[1px] bg-slate-800 mx-0.5" />
                <button
                  onClick={() => setAutoRotate((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                    autoRotate ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <RotateCw className={`w-3.5 h-3.5 ${autoRotate ? 'animate-spin' : ''}`} />
                  Spin
                </button>
                <button
                  onClick={() => setWireframe((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                    wireframe ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Grid className="w-3.5 h-3.5" />
                  Wireframe
                </button>
                <div className="flex items-center gap-1 px-2">
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <select
                    value={lightingPreset}
                    onChange={(e) => setLightingPreset(e.target.value as LightingPreset)}
                    className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
                  >
                    <option value="studio" className="bg-slate-900">
                      Studio Light
                    </option>
                    <option value="cyberpunk" className="bg-slate-900">
                      Cyberpunk Neon
                    </option>
                    <option value="sunset" className="bg-slate-900">
                      Golden Sunset
                    </option>
                    <option value="showroom" className="bg-slate-900">
                      Bright Showroom
                    </option>
                  </select>
                </div>
                <button
                  onClick={() => setScreenshotTrigger((n) => n + 1)}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-indigo-600 text-white cursor-pointer"
                  title="Save PNG Screenshot"
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 3D Viewport */}
            <div className="flex-1 min-h-0">
              <Viewport3D
                model={activeModel}
                detailStyle={detailStyle}
                lightingPreset={lightingPreset}
                autoRotate={autoRotate}
                wireframe={wireframe}
                selectedPartId={selectedPartId}
                interactionMode={paintOnClick ? 'paint' : 'select'}
                activePaintColor={activePaintColor}
                onSelectPart={(id) => setSelectedPartId(id)}
                onPaintPart={(id) => handlePaintPart(id, activePaintColor, activePaintFinish)}
                screenshotTrigger={screenshotTrigger}
              />
            </div>

            {/* Bottom Hint Bar */}
            <div className="h-10 px-6 bg-[#0c101b] border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-2">
                <Paintbrush className="w-3.5 h-3.5 text-cyan-400" />
                <strong>Tip:</strong> Click directly on any part of the 3D model to paint it with
                your selected color!
              </span>
              <span>Mouse Drag: Rotate 360° • Scroll: Zoom • Right-Click: Pan</span>
            </div>
          </main>

          {/* Right Sidebar: Easy Color & 1-Click Download Panel */}
          <aside className="w-[380px] shrink-0 bg-[#0e1320] border-l border-slate-800/90 flex flex-col h-full overflow-y-auto p-5 space-y-6">
            {/* 1. Color & Paint Studio */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                  <Palette className="w-4 h-4 text-indigo-400" />
                  1. Add Colors &amp; Materials
                </h3>
                <button
                  onClick={() => setPaintOnClick((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                    paintOnClick
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {paintOnClick ? 'Click-to-Paint: ON' : 'Click-to-Paint: OFF'}
                </button>
              </div>

              {/* Color Swatches + Custom Color Picker */}
              <div className="p-3.5 rounded-2xl bg-[#13192b] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">
                    {selectedPartObj
                      ? `Part: ${selectedPartObj.name}`
                      : 'Choose Brush Color'}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={activePaintColor}
                      onChange={(e) => {
                        setActivePaintColor(e.target.value);
                        if (selectedPartObj) {
                          handlePaintPart(selectedPartObj.id, e.target.value, activePaintFinish);
                        }
                      }}
                      className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                    />
                    <span className="text-xs font-mono text-slate-300">{activePaintColor}</span>
                  </div>
                </div>

                <div className="grid grid-cols-8 gap-1.5">
                  {QUICK_PAINT_SWATCHES.map((sw) => (
                    <button
                      key={sw.hex}
                      onClick={() => {
                        setActivePaintColor(sw.hex);
                        if (selectedPartObj) {
                          handlePaintPart(selectedPartObj.id, sw.hex, activePaintFinish);
                        }
                      }}
                      title={sw.name}
                      className={`h-7 rounded-lg border transition cursor-pointer ${
                        activePaintColor.toLowerCase() === sw.hex.toLowerCase()
                          ? 'border-white scale-110 ring-2 ring-indigo-500'
                          : 'border-white/15 hover:scale-105'
                      }`}
                      style={{ backgroundColor: sw.hex }}
                    />
                  ))}
                </div>

                {/* Material Finish Pills */}
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  {MATERIAL_FINISHES.slice(0, 6).map((fin) => (
                    <button
                      key={fin.id}
                      onClick={() => {
                        setActivePaintFinish(fin.id);
                        if (selectedPartObj) {
                          handlePaintPart(selectedPartObj.id, activePaintColor, fin.id);
                        }
                      }}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                        activePaintFinish === fin.id
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-[#090d16] border-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {fin.label.split(' ')[0]}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => handleColorAllParts(activePaintColor, activePaintFinish)}
                  className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition cursor-pointer"
                >
                  Apply This Color to Entire Model
                </button>
              </div>

              {/* 1-Click Color Themes */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-300">
                  One-Click Color Themes (Auto-Colors All Parts)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {COLOR_THEMES.slice(0, 6).map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => handleApplyTheme(theme)}
                      className="p-2.5 rounded-xl bg-[#13192b] hover:bg-[#19223a] border border-slate-800 hover:border-indigo-500/50 text-left transition cursor-pointer"
                    >
                      <div className="text-xs font-bold text-white truncate">{theme.name}</div>
                      <div className="flex items-center gap-1 mt-1.5">
                        {theme.swatches.map((hex, i) => (
                          <span
                            key={i}
                            className="w-3.5 h-3.5 rounded-full border border-white/20"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 2. Quick AI Edit */}
            <div className="p-3.5 rounded-2xl bg-[#13192b] border border-slate-800 space-y-2">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
                AI Edit Model (Optional)
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAiRefine();
                  }}
                  placeholder="e.g. Add wings or make wheels bigger..."
                  className="flex-1 px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
                <button
                  onClick={handleAiRefine}
                  disabled={isRefining || !refineInput.trim()}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold text-white cursor-pointer"
                >
                  {isRefining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Apply'}
                </button>
              </div>
            </div>

            {/* 3. Easy 1-Click Download Section */}
            <div className="pt-2 border-t border-slate-800 space-y-2.5">
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                2. Easy 1-Click Download
              </h3>

              <button
                onClick={async () => {
                  await exportModelToGLTF(activeModel, true, detailStyle);
                  notify(`Downloaded "${activeModel.name}.glb" (with Colors)!`, 'success');
                }}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-xs font-extrabold text-white shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download .GLB (3D Model + Colors)
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    exportModelToOBJ(activeModel, detailStyle);
                    notify(`Downloaded "${activeModel.name}.obj"!`, 'success');
                  }}
                  className="py-2.5 px-3 rounded-xl bg-[#13192b] hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 transition cursor-pointer"
                >
                  Download .OBJ
                </button>
                <button
                  onClick={() => {
                    exportModelToSTL(activeModel, detailStyle);
                    notify(`Downloaded "${activeModel.name}.stl" (3D Print)!`, 'success');
                  }}
                  className="py-2.5 px-3 rounded-xl bg-[#13192b] hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 transition cursor-pointer"
                >
                  Download .STL
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ==================== MODALS ==================== */}
      {showApiKeyModal && (
        <ApiKeyModal
          config={geminiConfig}
          onSave={handleSaveGeminiConfig}
          onClose={() => setShowApiKeyModal(false)}
        />
      )}

      {showExportModal && (
        <ExportModal
          model={activeModel}
          detailStyle={detailStyle}
          onCaptureScreenshot={() => setScreenshotTrigger((n) => n + 1)}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}
export default App;
