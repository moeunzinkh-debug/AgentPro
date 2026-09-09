import React, { useState, useEffect } from 'react';
import {
  Check,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Key,
  Sparkles,
  X,
  ExternalLink,
} from 'lucide-react';
import { ProviderConfig, ProviderType } from '../types';
import { PROVIDER_PRESETS } from '../data/defaultCatalog';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import { normalizeBaseUrl } from '../utils/url';

interface SaveModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  providers: Record<string, ProviderConfig>;
  onSaveModel: (data: {
    name: string;
    apiProvider: ProviderType;
    apiKey: string;
    baseUrl?: string;
    modelId: string;
    contextLength?: number;
  }) => void;
  prefill?: {
    name?: string;
    apiProvider?: ProviderType;
    modelId?: string;
  };
}

export const SaveModelModal: React.FC<SaveModelModalProps> = ({
  isOpen,
  onClose,
  onSaveModel,
  prefill,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>(
    prefill?.apiProvider || 'deepseek'
  );
  const [name, setName] = useState(prefill?.name || 'DeepSeek');
  const [url, setUrl] = useState(PROVIDER_PRESETS['deepseek']?.defaultUrl || 'https://api.deepseek.com/v1');
  const [api, setApi] = useState('');
  const [model, setModel] = useState(prefill?.modelId || PROVIDER_PRESETS['deepseek']?.defaultModel || 'deepseek-chat');
  const [showApiKey, setShowApiKey] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync state when prefill changes or modal opens
  useEffect(() => {
    if (isOpen) {
      const initialProvider = prefill?.apiProvider || 'deepseek';
      const preset = PROVIDER_PRESETS[initialProvider] || PROVIDER_PRESETS['deepseek'];
      setSelectedProvider(initialProvider);
      setName(prefill?.name || preset.name);
      setUrl(preset.defaultUrl);
      setModel(prefill?.modelId || preset.defaultModel);
      setApi('');
      setErrorMsg(null);
    }
  }, [isOpen, prefill]);

  if (!isOpen) return null;

  const handleSelectPreset = (providerKey: ProviderType) => {
    const preset = PROVIDER_PRESETS[providerKey];
    if (!preset) return;
    setSelectedProvider(providerKey);
    setName(providerKey === 'gemini' ? 'Gemini 3.8 Flash' : preset.name);
    setUrl(preset.defaultUrl);
    setModel(preset.defaultModel);
    setErrorMsg(null);
  };

  const handleSelectModel = (modelId: string, suggestedName?: string) => {
    setModel(modelId);
    if (suggestedName) {
      setName(suggestedName);
    }
  };

  const currentPreset = PROVIDER_PRESETS[selectedProvider] || PROVIDER_PRESETS['custom'];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Please enter a Name.');
      return;
    }
    if (!api.trim()) {
      setErrorMsg(`Please enter your ${currentPreset.name} API key.`);
      return;
    }
    if (!model.trim()) {
      setErrorMsg('Please enter the Model ID.');
      return;
    }

    onSaveModel({
      name: name.trim(),
      apiProvider: selectedProvider,
      apiKey: api.trim(),
      baseUrl: normalizeBaseUrl(url) || currentPreset.defaultUrl,
      modelId: model.trim(),
      contextLength: 65536,
    });

    onClose();
  };

  const providerKeys: ProviderType[] = ['gemini', 'openai', 'grok', 'kimi', 'deepseek', 'custom'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85">
      <div className="w-full max-w-xl rounded-2xl glass border border-cyan-500/30 bg-[#0a0d13] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.9)] space-y-5 animate-in fade-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 neon-glow" />
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              <span>Add Model</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Provider Selection Buttons */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-white/80">
              Select AI Provider (Official Default URL Included)
            </span>
            <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
              <Check className="h-3 w-3 stroke-[3]" />
              Default URL Ready
            </span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {providerKeys.map((pKey) => {
              const preset = PROVIDER_PRESETS[pKey];
              if (!preset) return null;
              const isSelected = selectedProvider === pKey;
              return (
                <button
                  key={pKey}
                  type="button"
                  onClick={() => handleSelectPreset(pKey)}
                  className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-[0_0_12px_rgba(0,242,255,0.25)] ring-1 ring-cyan-400/50'
                      : 'bg-black/40 border-white/10 text-white/70 hover:bg-white/5 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <span className="text-xs font-bold truncate w-full">{preset.name}</span>
                  <span className="text-[9px] text-white/40 truncate w-full mt-0.5">
                    {preset.brand}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/50 text-red-300 text-xs flex items-center justify-between">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-white/40 hover:text-white ml-2">
              ✕
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Name */}
          <div>
            <label className="block text-xs font-bold text-white/90 mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={currentPreset.name}
              className="w-full rounded-xl bg-black/50 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
              required
            />
          </div>

          {/* 2. url (Default URL provided automatically) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-white/90 flex items-center gap-1.5">
                <Globe className="h-3 w-3 text-cyan-400" />
                <span>url (Default API Endpoint)</span>
              </label>
              <span className="text-[10px] text-cyan-300/80 font-mono bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                Official Default URL
              </span>
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={currentPreset.defaultUrl}
              className="w-full rounded-xl bg-black/50 border border-cyan-500/30 px-3 py-2 text-xs text-cyan-100 placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
            />
            <p className="text-[10px] text-white/40 mt-1">
              Default URL provided automatically. No configuration needed unless using a custom proxy.
            </p>
          </div>

          {/* 3. Api (API Key) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-white/90 flex items-center gap-1.5">
                <Key className="h-3 w-3 text-cyan-400" />
                <span>Api ({currentPreset.name} API Key)</span>
              </label>
              {currentPreset.docsUrl && (
                <a
                  href={currentPreset.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 underline underline-offset-2"
                >
                  <span>Get API Key</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={api}
                onChange={(e) => setApi(e.target.value)}
                placeholder={currentPreset.keyPlaceholder}
                className="w-full rounded-xl bg-black/50 border border-white/20 pl-3 pr-9 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white cursor-pointer"
              >
                {showApiKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-[10px] text-emerald-400/90 mt-1 flex items-center gap-1">
              <span>✦ Just paste your {currentPreset.name} API Key here to use immediately.</span>
            </p>
          </div>

          {/* 4. Model with Selection Button */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white/90 flex items-center gap-1.5">
                <Cpu className="h-3 w-3 text-cyan-400" />
                <span>
                  {selectedProvider === 'gemini'
                    ? 'ប៊ូតុងជ្រើសរើសម៉ូដែល Gemini (3.1 ➔ 3.8 ថ្មី)'
                    : 'Model (Model ID)'}
                </span>
              </label>
              {selectedProvider === 'gemini' && (
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                  3.1 ➔ 3.8 ថ្មី
                </span>
              )}
            </div>

            {/* Selection Button Dropdown */}
            <ModelSelectorDropdown
              provider={selectedProvider}
              selectedModel={model}
              onSelectModel={handleSelectModel}
            />

            {/* Editable Model ID input */}
            <div className="pt-0.5">
              <div className="flex items-center justify-between text-[10px] text-white/50 mb-1">
                <span>Model ID (ឬកែសម្រួលដោយផ្ទាល់ / edit directly):</span>
              </div>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={currentPreset.defaultModel}
                className="w-full rounded-xl bg-black/50 border border-white/15 px-3 py-2 text-xs text-cyan-200 placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
                required
              />
            </div>
          </div>

          {/* Button strictly labeled 'Used model' */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs py-2.5 shadow-[0_0_15px_rgba(0,242,255,0.4)] transition-all cursor-pointer active:scale-[0.99]"
            >
              <Check className="h-3.5 w-3.5 stroke-[3]" />
              <span>Used model</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
