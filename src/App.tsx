import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Box,
  Camera,
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  Grid,
  Keyboard,
  KeyRound,
  MousePointerClick,
  Paintbrush,
  Redo2,
  RotateCw,
  Sun,
  Trophy,
  Undo2,
  X,
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
  PrimitiveType,
} from './types/model3d';
import { PRESET_GENERATION_PAIRS } from './utils/presetModels';
import { applyColorThemeToParts, MATERIAL_FINISHES } from './utils/colorThemes';
import {
  generateDual3DModelsWithGemini,
  generateSmartLocalDualPair,
  refineModelWithGemini,
  sanitizePart,
} from './services/geminiService';
import { exportModelToGLTF } from './utils/exporters';
import { Viewport3D } from './components/Viewport3D';
import { LeftGeneratorPanel } from './components/LeftGeneratorPanel';
import { RightStudioPanel } from './components/RightStudioPanel';
import { DualComparisonModal } from './components/DualComparisonModal';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ExportModal } from './components/ExportModal';

const STORAGE_KEY_API = 'forge3d_gemini_config_v1';
const STORAGE_KEY_HISTORY = 'forge3d_history_pairs_v1';

export function App() {
  // Gemini API Key Config (stored strictly on User's PC in localStorage)
  const [geminiConfig, setGeminiConfig] = useState<GeminiConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_API);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return { apiKey: '', model: 'gemini-2.5-flash' };
  });

  // Saved Generation Pairs History on PC
  const [historyPairs, setHistoryPairs] = useState<GenerationPair[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [];
  });

  // Active Generation Pair & Active Selected Model (A or B)
  const [activePair, setActivePair] = useState<GenerationPair>(() => {
    return JSON.parse(JSON.stringify(PRESET_GENERATION_PAIRS[0]));
  });
  const [activeVariationKey, setActiveVariationKey] = useState<'A' | 'B'>('A');
  const [activeModel, setActiveModel] = useState<Model3DSpec>(() => {
    return JSON.parse(JSON.stringify(PRESET_GENERATION_PAIRS[0].variationA));
  });

  // Undo / Redo Stack for Active Model Edits & Painting
  const [undoStack, setUndoStack] = useState<Model3DSpec[]>([]);
  const [redoStack, setRedoStack] = useState<Model3DSpec[]>([]);

  // Generator Inputs
  const [prompt, setPrompt] = useState(
    'Futuristic Cyberpunk Hover Supercar with glowing neon thrusters & aero spoiler'
  );
  const [imageDataUrl, setImageDataUrl] = useState<string | undefined>(undefined);
  const [detailStyle, setDetailStyle] = useState<DetailStyle>('high-detail');
  const [imageMode, setImageMode] = useState<'dual-ai' | 'ai-plus-voxel'>('dual-ai');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  // Viewport & Paint Studio State
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'select' | 'paint'>('select');
  const [activePaintColor, setActivePaintColor] = useState<string>('#06b6d4');
  const [activePaintFinish, setActivePaintFinish] = useState<MaterialFinishPreset>('metallic');

  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('studio');
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [xrayMode, setXrayMode] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [bgColor, setBgColor] = useState<string>('#0b0e17');
  const [cameraTrigger, setCameraTrigger] = useState<{
    view: 'iso' | 'front' | 'side' | 'top' | 'reset';
    ts: number;
  } | null>(null);
  const [screenshotTrigger, setScreenshotTrigger] = useState<number>(0);
  const [meshStats, setMeshStats] = useState({ vertices: 0, triangles: 0, parts: 0 });

  // Modals
  const [showComparisonModal, setShowComparisonModal] = useState<boolean>(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);

  // Toast Notification
  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const notify = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ text, type });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Save Gemini config to localStorage
  const handleSaveGeminiConfig = (newCfg: GeminiConfig) => {
    setGeminiConfig(newCfg);
    try {
      localStorage.setItem(STORAGE_KEY_API, JSON.stringify(newCfg));
    } catch {
      // ignore
    }
    notify(
      newCfg.apiKey
        ? `Gemini API Key saved locally on your PC (${newCfg.model}).`
        : 'Gemini API Key cleared.',
      'success'
    );
  };

  // Save generation pair to local history
  const pushPairToHistory = (pair: GenerationPair) => {
    setHistoryPairs((prev) => {
      const next = [pair, ...prev.filter((p) => p.id !== pair.id)].slice(0, 12);
      try {
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Helper to commit a change to activeModel with Undo history
  const commitModelChange = (updater: (current: Model3DSpec) => Model3DSpec) => {
    setActiveModel((prev) => {
      const next = updater(prev);
      setUndoStack((u) => [...u.slice(-20), prev]);
      setRedoStack([]);
      setActivePair((pairPrev) => ({
        ...pairPrev,
        variationA: activeVariationKey === 'A' ? next : pairPrev.variationA,
        variationB: activeVariationKey === 'B' ? next : pairPrev.variationB,
      }));
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

  // PC Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, P, V, W, R, Ctrl+E)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setShowExportModal(true);
      } else if (e.key.toLowerCase() === 'p') {
        setInteractionMode((m) => (m === 'paint' ? 'select' : 'paint'));
      } else if (e.key.toLowerCase() === 'v') {
        setInteractionMode('select');
      } else if (e.key.toLowerCase() === 'w') {
        setWireframe((w) => !w);
      } else if (e.key.toLowerCase() === 'r') {
        setAutoRotate((r) => !r);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoStack, redoStack, activeModel]);

  // Generate 2 Variations (A & B) with User's Gemini API Key
  const handleGenerateWithGemini = async () => {
    if (!geminiConfig.apiKey.trim()) {
      setShowApiKeyModal(true);
      notify(
        'Please enter your Google Gemini API Key first (or click Instant Offline Demo).',
        'info'
      );
      return;
    }

    if (!prompt.trim() && !imageDataUrl) {
      notify('Please enter a prompt or upload a reference image first!', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      const newPair = await generateDual3DModelsWithGemini({
        prompt,
        imageDataUrl,
        detailStyle,
        imageMode,
        geminiConfig,
      });

      setActivePair(newPair);
      pushPairToHistory(newPair);
      setShowComparisonModal(true);
      notify(
        'Generated 2 3D Model Variations (Option A & Option B)! Choose your favorite.',
        'success'
      );
    } catch (err: any) {
      notify(err?.message || 'Failed to generate 3D models with Gemini API.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // Generate Instant Offline / Demo Dual Pair
  const handleGenerateLocalDemo = async () => {
    setIsGenerating(true);
    try {
      const demoPair = await generateSmartLocalDualPair({
        prompt,
        imageDataUrl,
        detailStyle,
      });
      setActivePair(demoPair);
      pushPairToHistory(demoPair);
      setShowComparisonModal(true);
      notify('2 Variations (Option A & Option B) ready! Compare & pick the best one.', 'success');
    } catch (err: any) {
      notify(err?.message || 'Demo generation error', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // Choose Option A or Option B from the Dual Comparison Modal
  const handleSelectVariation = (choice: 'A' | 'B') => {
    const chosenSpec =
      choice === 'A'
        ? JSON.parse(JSON.stringify(activePair.variationA))
        : JSON.parse(JSON.stringify(activePair.variationB));

    setActiveVariationKey(choice);
    setActivePair((prev) => ({ ...prev, selectedVariation: choice }));
    setActiveModel(chosenSpec);
    setSelectedPartId(chosenSpec.parts[0]?.id || null);
    setUndoStack([]);
    setRedoStack([]);
    setShowComparisonModal(false);
    notify(
      `Selected Option ${choice} ("${chosenSpec.name}")! You can now customize colors, parts & download.`,
      'success'
    );
  };

  // AI Refine Current Model
  const handleRefineWithGemini = async (instruction: string) => {
    const lower = instruction.toLowerCase();

    if (!geminiConfig.apiKey.trim()) {
      if (lower.includes('gold')) {
        commitModelChange((m) => ({
          ...m,
          parts: applyColorThemeToParts(m.parts, {
            id: 'gold',
            name: 'Gold',
            description: '',
            swatches: ['#111827', '#f59e0b', '#fbbf24', '#1f2937', '#fef3c7'],
            mapping: {
              primary: { color: '#f59e0b', metalness: 0.95, roughness: 0.14 },
              secondary: { color: '#111827', metalness: 0.6, roughness: 0.3 },
              accent: { color: '#fbbf24', metalness: 0.95, roughness: 0.12 },
              dark: { color: '#030712', metalness: 0.4, roughness: 0.6 },
              glow: { color: '#38bdf8', emissive: '#38bdf8', emissiveIntensity: 1.8 },
              glass: { color: '#fde68a', opacity: 0.45 },
            },
          }),
        }));
        notify('Applied Royal Gold & Black styling to current 3D model!', 'success');
        return;
      }
      setShowApiKeyModal(true);
      notify('Enter your Gemini API Key to use AI natural-language model editing!', 'info');
      return;
    }

    setIsRefining(true);
    try {
      const updated = await refineModelWithGemini({
        currentModel: activeModel,
        instruction,
        geminiConfig,
      });
      commitModelChange(() => updated);
      notify(`Refined 3D model: "${instruction}"`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Failed to refine model with Gemini.', 'error');
    } finally {
      setIsRefining(false);
    }
  };

  // Paint & Material Handlers
  const getFinishDef = (finishId: MaterialFinishPreset) =>
    MATERIAL_FINISHES.find((f) => f.id === finishId) || MATERIAL_FINISHES[0];

  const handleApplyPaintToPart = (
    partId: string,
    hex: string,
    finishId: MaterialFinishPreset = activePaintFinish
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

  const handleApplyColorToAllParts = (hex: string, finishId: MaterialFinishPreset) => {
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
    notify(`Applied ${fin.label} (${hex}) to all parts!`, 'success');
  };

  const handleApplyTheme = (theme: ColorTheme) => {
    commitModelChange((m) => ({
      ...m,
      parts: applyColorThemeToParts(m.parts, theme),
    }));
    notify(`Applied "${theme.name}" color palette across all parts!`, 'success');
  };

  const handleUpdatePart = (partId: string, updater: (p: Part3D) => Part3D) => {
    commitModelChange((m) => ({
      ...m,
      parts: m.parts.map((p) => (p.id === partId ? updater(p) : p)),
    }));
  };

  const handleAddPart = (type: PrimitiveType) => {
    const newId = `part_${Date.now()}`;
    const newPart: Part3D = {
      id: newId,
      name: `New ${type.replace('_', ' ')}`,
      type,
      position: [0, 1.5, 0],
      rotation: [0, 0, 0],
      scale: [0.7, 0.7, 0.7],
      color: activePaintColor,
      metalness: 0.6,
      roughness: 0.25,
      visible: true,
    };
    commitModelChange((m) => ({
      ...m,
      parts: [...m.parts, newPart],
    }));
    setSelectedPartId(newId);
    notify(`Added new ${type} part to 3D model.`, 'success');
  };

  const handleDuplicatePart = (partId: string) => {
    const target = activeModel.parts.find((p) => p.id === partId);
    if (!target) return;
    const copyId = `part_${Date.now()}`;
    const copyPart: Part3D = {
      ...JSON.parse(JSON.stringify(target)),
      id: copyId,
      name: `${target.name} (Copy)`,
      position: [target.position[0] + 0.25, target.position[1] + 0.15, target.position[2]],
    };
    commitModelChange((m) => ({
      ...m,
      parts: [...m.parts, copyPart],
    }));
    setSelectedPartId(copyId);
  };

  const handleDeletePart = (partId: string) => {
    if (activeModel.parts.length <= 1) return;
    commitModelChange((m) => ({
      ...m,
      parts: m.parts.filter((p) => p.id !== partId),
    }));
    if (selectedPartId === partId) {
      setSelectedPartId(null);
    }
  };

  const handleImportProjectJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed?.parts) && parsed.parts.length > 0) {
          const loadedModel: Model3DSpec = {
            id: parsed.id || `imported_${Date.now()}`,
            name: parsed.name || 'Imported 3D Model',
            subtitle: parsed.subtitle || 'Loaded from Local PC JSON',
            description: parsed.description || 'Custom imported Forge3D project',
            styleTag: parsed.styleTag || 'Custom Project',
            createdAt: parsed.createdAt || new Date().toISOString(),
            parts: parsed.parts.map((p: any, idx: number) => sanitizePart(p, idx)),
          };
          setActiveModel(loadedModel);
          setSelectedPartId(loadedModel.parts[0]?.id || null);
          notify(`Loaded "${loadedModel.name}" project successfully!`, 'success');
        } else {
          notify('Invalid project file: missing parts array.', 'error');
        }
      } catch {
        notify('Failed to parse .json project file.', 'error');
      }
    };
    reader.readAsText(file);
  };

  const hasApiKey = Boolean(geminiConfig.apiKey.trim());

  return (
    <div className="w-screen h-screen bg-[#090b10] text-slate-100 flex flex-col overflow-hidden select-none">
      {/* ==================== TOP PC STUDIO HEADER BAR ==================== */}
      <header className="h-14 shrink-0 px-4 bg-[#0d1018] border-b border-slate-800/90 flex items-center justify-between gap-4">
        {/* Left: Brand & Desktop Badge */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Box className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-tight text-white">
                Forge3D <span className="text-indigo-400">AI Studio</span>
              </span>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                PC Desktop .EXE Ready
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Image + Prompt to 3D Model • Dual A/B Selection • Interactive Paint & GLB/OBJ/STL Export
            </p>
          </div>
        </div>

        {/* Center: Active Variation A vs B Switcher & Compare Modal Button */}
        <div className="flex items-center gap-2 bg-[#131826] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => handleSelectVariation('A')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeVariationKey === 'A'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Variation A
          </button>
          <button
            onClick={() => handleSelectVariation('B')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeVariationKey === 'B'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Variation B
          </button>
          <div className="h-4 w-[1px] bg-slate-700 mx-0.5" />
          <button
            onClick={() => setShowComparisonModal(true)}
            className="px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/30 border border-indigo-500/30 text-xs font-semibold text-indigo-200 flex items-center gap-1.5 transition cursor-pointer"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            Compare Both (A vs B)
          </button>
        </div>

        {/* Right: Undo/Redo, Shortcuts, Gemini API Key Button, Easy Download Button */}
        <div className="flex items-center gap-2">
          {/* Undo / Redo */}
          <div className="flex items-center bg-[#131826] rounded-xl border border-slate-800 p-0.5">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="p-2 rounded-lg text-slate-300 hover:text-white disabled:opacity-30 transition cursor-pointer"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="p-2 rounded-lg text-slate-300 hover:text-white disabled:opacity-30 transition cursor-pointer"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          {/* PC Shortcuts & .EXE Info */}
          <button
            onClick={() => setShowShortcutsModal(true)}
            className="p-2 rounded-xl bg-[#131826] hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
            title="PC Keyboard Shortcuts & .EXE Info"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          {/* User's Own Gemini API Key Button */}
          <button
            onClick={() => setShowApiKeyModal(true)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 transition cursor-pointer ${
              hasApiKey
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/60'
                : 'bg-amber-950/50 border-amber-500/50 text-amber-300 hover:bg-amber-900/50 animate-pulse'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            {hasApiKey ? `Gemini Key Active (${geminiConfig.model})` : 'Enter Gemini API Key'}
          </button>

          {/* Instant 1-Click .GLB Download */}
          <button
            onClick={async () => {
              await exportModelToGLTF(activeModel, true, detailStyle);
              notify(`Downloaded "${activeModel.name}.glb" with colors!`, 'success');
            }}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-100 flex items-center gap-1.5 transition cursor-pointer"
            title="Quick 1-Click Download .GLB"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            Quick .GLB
          </button>

          {/* Full Export Modal Button */}
          <button
            onClick={() => setShowExportModal(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 flex items-center gap-2 transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Download 3D Model
          </button>
        </div>
      </header>

      {/* ==================== MAIN 3-COLUMN DESKTOP WORKSPACE ==================== */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT PANEL: Image + Prompt Generator & Presets */}
        <LeftGeneratorPanel
          prompt={prompt}
          imageDataUrl={imageDataUrl}
          detailStyle={detailStyle}
          imageMode={imageMode}
          isGenerating={isGenerating}
          isRefining={isRefining}
          hasApiKey={hasApiKey}
          historyPairs={historyPairs}
          activePairId={activePair.id}
          onPromptChange={setPrompt}
          onImageChange={setImageDataUrl}
          onDetailStyleChange={setDetailStyle}
          onImageModeChange={setImageMode}
          onGenerateWithGemini={handleGenerateWithGemini}
          onGenerateLocalDemo={handleGenerateLocalDemo}
          onRefineWithGemini={handleRefineWithGemini}
          onSelectPresetPair={(pair, openModal) => {
            const cloned: GenerationPair = JSON.parse(JSON.stringify(pair));
            setActivePair(cloned);
            setActiveVariationKey('A');
            setActiveModel(cloned.variationA);
            setSelectedPartId(cloned.variationA.parts[0]?.id || null);
            if (openModal) {
              setShowComparisonModal(true);
            } else {
              notify(`Loaded "${cloned.variationA.name}" into 3D Studio!`, 'info');
            }
          }}
          onOpenApiKeyModal={() => setShowApiKeyModal(true)}
          onImportProjectJson={handleImportProjectJson}
        />

        {/* CENTER PANEL: Interactive 3D Viewport & Floating Toolbars */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#0b0e17] relative">
          {/* Top Floating Overlay inside 3D Viewport */}
          <div className="absolute top-3.5 left-4 right-4 z-10 flex items-start justify-between pointer-events-none gap-4">
            {/* Active Model Card & Tool Mode Switcher */}
            <div className="pointer-events-auto flex flex-col gap-2">
              <div className="px-3.5 py-2 rounded-xl bg-slate-950/85 border border-slate-800/90 backdrop-blur-md shadow-xl flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      Option {activeVariationKey}
                    </span>
                    <h1 className="text-sm font-bold text-white">{activeModel.name}</h1>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 max-w-md truncate">
                    {activeModel.description}
                  </p>
                </div>
              </div>

              {/* Quick Cursor Mode Toggle (Select vs Click-to-Paint Brush) */}
              <div className="inline-flex self-start p-1 rounded-xl bg-slate-950/85 border border-slate-800/90 backdrop-blur-md shadow-lg gap-1">
                <button
                  onClick={() => setInteractionMode('select')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    interactionMode === 'select'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <MousePointerClick className="w-3.5 h-3.5" />
                  Select & Inspect (V)
                </button>
                <button
                  onClick={() => setInteractionMode('paint')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    interactionMode === 'paint'
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Paintbrush className="w-3.5 h-3.5" />
                  Click-to-Paint (P)
                  <span
                    className="w-3 h-3 rounded-full border border-white/50 ml-0.5"
                    style={{ backgroundColor: activePaintColor }}
                  />
                </button>
              </div>
            </div>

            {/* Right Floating Viewport Controls */}
            <div className="pointer-events-auto flex flex-col items-end gap-2">
              {/* View & Shader Toggles */}
              <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-950/85 border border-slate-800/90 backdrop-blur-md shadow-xl">
                <button
                  onClick={() => setAutoRotate((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                    autoRotate
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Auto-Spin Turntable (R)"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${autoRotate ? 'animate-spin' : ''}`} />
                  Spin
                </button>

                <button
                  onClick={() => setWireframe((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                    wireframe
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Toggle 3D Wireframe (W)"
                >
                  <Grid className="w-3.5 h-3.5" />
                  Wireframe
                </button>

                <button
                  onClick={() => setXrayMode((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                    xrayMode
                      ? 'bg-purple-600 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Toggle X-Ray Translucent View"
                >
                  <Eye className="w-3.5 h-3.5" />
                  X-Ray
                </button>

                <button
                  onClick={() => setShowGrid((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    showGrid
                      ? 'bg-slate-800 text-slate-200'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Floor Grid
                </button>

                <div className="h-4 w-[1px] bg-slate-800 mx-0.5" />

                {/* Studio Lighting Selector */}
                <div className="flex items-center gap-1 px-2">
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <select
                    value={lightingPreset}
                    onChange={(e) => setLightingPreset(e.target.value as LightingPreset)}
                    className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
                  >
                    <option value="studio" className="bg-slate-900">
                      Studio Softbox
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
                    <option value="dramatic" className="bg-slate-900">
                      Dramatic Rim
                    </option>
                  </select>
                </div>

                {/* Viewport Background Color */}
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                  title="Viewport Background Color"
                />

                {/* Snapshot PNG */}
                <button
                  onClick={() => setScreenshotTrigger((n) => n + 1)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white transition cursor-pointer"
                  title="Capture PNG Render Screenshot"
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Camera Angle Presets */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/80 border border-slate-800/80 backdrop-blur-md">
                {(
                  [
                    { id: 'iso', label: 'Perspective' },
                    { id: 'front', label: 'Front' },
                    { id: 'side', label: 'Side' },
                    { id: 'top', label: 'Top' },
                    { id: 'reset', label: 'Reset Cam' },
                  ] as const
                ).map((cam) => (
                  <button
                    key={cam.id}
                    onClick={() => setCameraTrigger({ view: cam.id, ts: Date.now() })}
                    className="px-2 py-1 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  >
                    {cam.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Toast Notification Banner */}
          {toast && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl flex items-center gap-2.5 text-xs font-medium text-white backdrop-blur-md">
              {toast.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span>{toast.text}</span>
            </div>
          )}

          {/* Three.js Main 3D Viewport */}
          <div className="flex-1 min-h-0">
            <Viewport3D
              model={activeModel}
              detailStyle={detailStyle}
              lightingPreset={lightingPreset}
              autoRotate={autoRotate}
              wireframe={wireframe}
              xrayMode={xrayMode}
              showGrid={showGrid}
              backgroundColor={bgColor}
              selectedPartId={selectedPartId}
              interactionMode={interactionMode}
              activePaintColor={activePaintColor}
              onSelectPart={(id) => setSelectedPartId(id)}
              onPaintPart={(id) => handleApplyPaintToPart(id, activePaintColor, activePaintFinish)}
              onStatsUpdate={setMeshStats}
              cameraViewTrigger={cameraTrigger}
              screenshotTrigger={screenshotTrigger}
            />
          </div>

          {/* Bottom 3D Viewport Status Bar */}
          <div className="h-9 px-4 bg-[#0a0d14] border-t border-slate-800/90 flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-4">
              <span>
                Vertices:{' '}
                <strong className="text-slate-200 font-mono">
                  {meshStats.vertices.toLocaleString()}
                </strong>
              </span>
              <span>
                Triangles:{' '}
                <strong className="text-slate-200 font-mono">
                  {meshStats.triangles.toLocaleString()}
                </strong>
              </span>
              <span>
                3D Components:{' '}
                <strong className="text-indigo-300 font-mono">{meshStats.parts}</strong>
              </span>
              <span>
                Mesh Mode: <strong className="text-cyan-300 uppercase">{detailStyle}</strong>
              </span>
            </div>

            <div className="flex items-center gap-4">
              <span>Left-Click Drag: Rotate • Right-Click Drag: Pan • Scroll: Zoom</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                100% Local PC Execution (Zero Backend)
              </span>
            </div>
          </div>
        </main>

        {/* RIGHT PANEL: Color, Paint & Part Inspector Studio */}
        <RightStudioPanel
          model={activeModel}
          selectedPartId={selectedPartId}
          interactionMode={interactionMode}
          activePaintColor={activePaintColor}
          activePaintFinish={activePaintFinish}
          onSelectPart={setSelectedPartId}
          onSetInteractionMode={setInteractionMode}
          onSetActivePaintColor={setActivePaintColor}
          onSetActivePaintFinish={setActivePaintFinish}
          onApplyPaintToPart={handleApplyPaintToPart}
          onApplyColorToAllParts={handleApplyColorToAllParts}
          onApplyTheme={handleApplyTheme}
          onUpdatePart={handleUpdatePart}
          onAddPart={handleAddPart}
          onDuplicatePart={handleDuplicatePart}
          onDeletePart={handleDeletePart}
        />
      </div>

      {/* ==================== MODALS ==================== */}
      {showComparisonModal && (
        <DualComparisonModal
          pair={activePair}
          onSelectVariation={handleSelectVariation}
          onClose={() => setShowComparisonModal(false)}
        />
      )}

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

      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#101420] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-indigo-950/70 to-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    PC Desktop Shortcuts & Windows .EXE Build
                  </h2>
                  <p className="text-xs text-slate-400">
                    Standalone Windows x64 Desktop Application
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                {[
                  { key: 'V', desc: 'Select & Inspect Part Mode' },
                  { key: 'P', desc: 'Click-to-Paint Color Brush' },
                  { key: 'W', desc: 'Toggle 3D Wireframe' },
                  { key: 'R', desc: 'Toggle Auto-Spin Turntable' },
                  { key: 'Ctrl + Z', desc: 'Undo Last Paint / Edit' },
                  { key: 'Ctrl + Y', desc: 'Redo Last Paint / Edit' },
                  { key: 'Ctrl + E', desc: 'Open Download / Export Window' },
                  { key: 'Mouse Wheel', desc: 'Zoom In / Out 3D Viewport' },
                ].map((sc) => (
                  <div
                    key={sc.key}
                    className="p-2.5 rounded-xl bg-[#151a2a] border border-slate-800 flex items-center justify-between"
                  >
                    <span className="text-slate-300">{sc.desc}</span>
                    <kbd className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-indigo-300 font-mono text-[11px]">
                      {sc.key}
                    </kbd>
                  </div>
                ))}
              </div>

              <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs text-slate-300 space-y-1.5 leading-relaxed">
                <div className="font-bold text-white">
                  Windows .EXE Build (GitHub Actions Automated Pipeline):
                </div>
                <p>
                  This repository includes <code className="text-indigo-300">.github/workflows/build-exe.yml</code> which automatically builds both a <strong>Portable Windows .EXE</strong> (no install required) and a <strong>Windows Setup Installer .EXE</strong> on GitHub Actions (<code className="text-indigo-300">windows-latest</code>) and uploads them as downloadable artifacts!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
