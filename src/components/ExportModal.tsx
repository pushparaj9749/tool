import React, { useState } from 'react';
import {
  Box,
  Camera,
  CheckCircle2,
  Download,
  FileCode2,
  FileJson,
  Layers,
  Loader2,
  PackageCheck,
  Printer,
  X,
} from 'lucide-react';
import { DetailStyle, Model3DSpec } from '../types/model3d';
import {
  exportModelToGLTF,
  exportModelToOBJ,
  exportModelToSTL,
  exportProjectJSON,
} from '../utils/exporters';

interface ExportModalProps {
  model: Model3DSpec;
  detailStyle: DetailStyle;
  onCaptureScreenshot: () => void;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  model,
  detailStyle,
  onCaptureScreenshot,
  onClose,
}) => {
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [doneFormat, setDoneFormat] = useState<string | null>(null);

  const handleExport = async (format: 'glb' | 'gltf' | 'obj' | 'stl' | 'png' | 'json') => {
    setExportingFormat(format);
    setDoneFormat(null);
    try {
      if (format === 'glb') {
        await exportModelToGLTF(model, true, detailStyle);
      } else if (format === 'gltf') {
        await exportModelToGLTF(model, false, detailStyle);
      } else if (format === 'obj') {
        exportModelToOBJ(model, detailStyle);
      } else if (format === 'stl') {
        exportModelToSTL(model, detailStyle);
      } else if (format === 'png') {
        onCaptureScreenshot();
      } else if (format === 'json') {
        exportProjectJSON(model);
      }
      setDoneFormat(format);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExportingFormat(null);
    }
  };

  const exportFormats = [
    {
      id: 'glb' as const,
      title: 'Download .GLB (3D Model + Colors)',
      badge: 'Recommended',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      desc: 'Industry-standard binary glTF 2.0 with all colors, metallic/roughness PBR materials & parts baked in. Opens in Blender, Unity, Unreal & Windows 3D Viewer.',
      icon: PackageCheck,
      accent: 'from-indigo-600 to-violet-600',
    },
    {
      id: 'obj' as const,
      title: 'Download .OBJ (Wavefront 3D Mesh)',
      badge: 'Universal Mesh',
      badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
      desc: 'Universal polygonal mesh format supported by Maya, 3ds Max, Cinema4D, ZBrush, and Blender.',
      icon: Box,
      accent: 'from-cyan-600 to-blue-600',
    },
    {
      id: 'stl' as const,
      title: 'Download .STL (3D Printing Ready)',
      badge: '3D Print',
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      desc: 'Binary stereolithography CAD mesh ready for Cura, Bambu Studio, PrusaSlicer, and resin/FDM 3D printers.',
      icon: Printer,
      accent: 'from-amber-600 to-orange-600',
    },
    {
      id: 'gltf' as const,
      title: 'Download .GLTF (JSON 3D Scene)',
      badge: 'Web / Three.js',
      badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      desc: 'Human-readable JSON glTF 2.0 format for web 3D engines, React Three Fiber, and Babylon.js.',
      icon: FileCode2,
      accent: 'from-purple-600 to-pink-600',
    },
    {
      id: 'png' as const,
      title: 'Download High-Res .PNG Render',
      badge: '2D Snapshot',
      badgeColor: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
      desc: 'Instant studio-lit PNG image capture of your current 3D camera angle.',
      icon: Camera,
      accent: 'from-pink-600 to-rose-600',
    },
    {
      id: 'json' as const,
      title: 'Save .forge3d.json Project File',
      badge: 'Editable Project',
      badgeColor: 'bg-slate-700 text-slate-300 border-slate-600',
      desc: 'Save the editable part hierarchy & colors to your PC so you can re-open and edit this model anytime.',
      icon: FileJson,
      accent: 'from-slate-700 to-slate-600',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#101420] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-950/70 via-[#121726] to-cyan-950/50 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Export & Download 3D Model
              </h2>
              <p className="text-xs text-slate-400 flex items-center gap-2">
                <span>Model: <strong className="text-slate-200">{model.name}</strong></span>
                <span>•</span>
                <span className="flex items-center gap-1 text-indigo-300">
                  <Layers className="w-3 h-3" /> {model.parts.length} Colored Parts
                </span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Formats Grid */}
        <div className="p-6 grid grid-cols-2 gap-3.5 max-h-[75vh] overflow-y-auto">
          {exportFormats.map((fmt) => {
            const Icon = fmt.icon;
            const isBusy = exportingFormat === fmt.id;
            const isDone = doneFormat === fmt.id;

            return (
              <div
                key={fmt.id}
                onClick={() => handleExport(fmt.id)}
                className="group p-4 rounded-xl bg-[#151a2a] hover:bg-[#1a2136] border border-slate-800 hover:border-indigo-500/60 transition flex flex-col justify-between cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-center text-indigo-400 group-hover:text-white group-hover:bg-indigo-600 transition">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${fmt.badgeColor}`}
                    >
                      {fmt.badge}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-white group-hover:text-indigo-200 transition">
                    {fmt.title}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{fmt.desc}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-indigo-400 group-hover:text-indigo-300 flex items-center gap-1.5">
                    {isBusy ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Generating file...
                      </>
                    ) : isDone ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Downloaded to PC!
                      </span>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        Click to Download
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
