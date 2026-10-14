import React, { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { GeminiConfig } from '../types/model3d';
import {
  fetchAvailableGeminiModels,
  normalizeModelName,
  testGeminiApiKey,
} from '../services/geminiService';

interface ApiKeyModalProps {
  config: GeminiConfig;
  onSave: (newConfig: GeminiConfig) => void;
  onClose: () => void;
}

const DEFAULT_PRESET_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ config, onSave, onClose }) => {
  const [apiKey, setApiKey] = useState(config.apiKey || '');
  const [model, setModel] = useState(config.model || 'gemini-2.5-flash');
  const [customModels, setCustomModels] = useState<string[]>(config.customModels || []);
  const [newCustomModelInput, setNewCustomModelInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const allModels = Array.from(new Set([...DEFAULT_PRESET_MODELS, ...customModels]));

  const handleAddCustomModel = () => {
    const cleaned = normalizeModelName(newCustomModelInput);
    if (!cleaned) return;
    if (!customModels.includes(cleaned) && !DEFAULT_PRESET_MODELS.includes(cleaned)) {
      setCustomModels((prev) => [...prev, cleaned]);
    }
    setModel(cleaned);
    setNewCustomModelInput('');
    setTestResult({
      ok: true,
      message: `Custom model "${cleaned}" added and selected!`,
    });
  };

  const handleRemoveCustomModel = (target: string) => {
    const next = customModels.filter((m) => m !== target);
    setCustomModels(next);
    if (model === target) {
      setModel('gemini-2.5-flash');
    }
  };

  const handleFetchModelsFromApi = async () => {
    if (!apiKey.trim()) {
      setTestResult({ ok: false, message: 'Enter your Gemini API Key first to load models.' });
      return;
    }
    setFetchingModels(true);
    const fetched = await fetchAvailableGeminiModels(apiKey);
    setFetchingModels(false);
    if (fetched.length > 0) {
      const merged = Array.from(
        new Set([
          ...customModels,
          ...fetched.filter((m) => !DEFAULT_PRESET_MODELS.includes(m)),
        ])
      );
      setCustomModels(merged);
      setTestResult({
        ok: true,
        message: `Loaded ${fetched.length} Gemini models from your API key!`,
      });
    } else {
      setTestResult({
        ok: false,
        message: 'Could not fetch model list. Check your API key or type a custom model name below.',
      });
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const activeModel = normalizeModelName(model);
    const res = await testGeminiApiKey({ apiKey, model: activeModel, customModels });
    setTestResult(res);
    setTesting(false);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const finalModel = normalizeModelName(newCustomModelInput.trim() || model);
    const updatedCustom =
      newCustomModelInput.trim() &&
      !DEFAULT_PRESET_MODELS.includes(finalModel) &&
      !customModels.includes(finalModel)
        ? [...customModels, finalModel]
        : customModels;

    onSave({
      apiKey: apiKey.trim(),
      model: finalModel,
      customModels: updatedCustom,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-[#101420] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-950/80 to-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Gemini API Key &amp; Custom Model Settings
              </h2>
              <p className="text-xs text-slate-400">
                Enter your API Key &amp; choose or add any custom Gemini model name
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* 1. API Key Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                1. Your Google Gemini API Key
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                Get Free API Key
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="relative flex items-center">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder="AIzaSy..."
                className="w-full px-3.5 py-2.5 pr-20 rounded-xl bg-[#090c14] border border-slate-700 focus:border-indigo-500 focus:outline-none text-sm text-white font-mono"
              />
              <div className="absolute right-2 flex items-center gap-1">
                {apiKey && (
                  <button
                    type="button"
                    onClick={() => {
                      setApiKey('');
                      setTestResult(null);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 transition cursor-pointer"
                    title="Clear Key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* 2. Select or Add Custom Gemini Model */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                2. Select Gemini Model
              </label>
              <button
                type="button"
                onClick={handleFetchModelsFromApi}
                disabled={fetchingModels || !apiKey.trim()}
                className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${fetchingModels ? 'animate-spin' : ''}`} />
                Auto-Fetch Models from API
              </button>
            </div>

            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#090c14] border border-slate-700 focus:border-indigo-500 focus:outline-none text-sm text-white font-medium"
            >
              {allModels.map((m) => (
                <option key={m} value={m} className="bg-[#0e111a] text-white">
                  {m} {customModels.includes(m) ? '(Custom)' : ''}
                </option>
              ))}
            </select>

            {/* Add Custom Model Input Box */}
            <div className="p-3.5 rounded-xl bg-[#141928] border border-slate-800 space-y-2.5">
              <label className="block text-xs font-bold text-indigo-300">
                + Add Your Own Custom Gemini Model Name:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCustomModelInput}
                  onChange={(e) => setNewCustomModelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomModel();
                    }
                  }}
                  placeholder="e.g. gemini-2.5-flash-preview-05-20 or gemini-2.0-pro-exp"
                  className="flex-1 px-3 py-2 rounded-lg bg-[#090c14] border border-slate-700 focus:border-indigo-500 focus:outline-none text-xs text-white font-mono"
                />
                <button
                  type="button"
                  onClick={handleAddCustomModel}
                  disabled={!newCustomModelInput.trim()}
                  className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold text-white flex items-center gap-1.5 transition cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Model
                </button>
              </div>

              {/* Saved Custom Models Pills */}
              {customModels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {customModels.map((cm) => (
                    <span
                      key={cm}
                      onClick={() => setModel(cm)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono cursor-pointer border transition ${
                        model === cm
                          ? 'bg-indigo-600/30 border-indigo-400 text-white'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                      }`}
                    >
                      {cm}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveCustomModel(cm);
                        }}
                        className="text-slate-400 hover:text-rose-400"
                        title="Remove custom model"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Privacy Note */}
          <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/25 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0" />
            <div className="text-xs text-slate-300">
              Saved 100% locally on your PC. Active Model:{' '}
              <code className="text-indigo-300 font-bold">
                {normalizeModelName(newCustomModelInput.trim() || model)}
              </code>
            </div>
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                testResult.ok
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || !apiKey.trim()}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-slate-200 border border-slate-700 flex items-center gap-2 transition cursor-pointer"
            >
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Test Key &amp; Model
                </>
              )}
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-400 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition cursor-pointer"
              >
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
