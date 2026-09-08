import React, { useState } from 'react';
import {
  Check,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Key,
  MessageSquare,
  Sparkles,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { ModelInfo, ProviderConfig, ProviderType } from '../types';
import { PROVIDER_PRESETS } from '../data/defaultCatalog';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';

interface ModelsViewProps {
  models: ModelInfo[];
  setModels: React.Dispatch<React.SetStateAction<ModelInfo[]>>;
  providers: Record<string, ProviderConfig>;
  setProviders: React.Dispatch<React.SetStateAction<Record<string, ProviderConfig>>>;
  activeModelId: string;
  setActiveModelId: (id: string) => void;
  onSelectAndChat: (modelId: string) => void;
  savedModelIds: string[];
  onOpenSaveModelModal: (prefill?: {
    name?: string;
    apiProvider?: ProviderType;
    modelId?: string;
  }) => void;
  onOpenModelSelectionModal: () => void;
}

export const ModelsView: React.FC<ModelsViewProps> = ({
  models,
  setModels,
  setProviders,
  activeModelId,
  setActiveModelId,
  onSelectAndChat,
}) => {
  // Provider selector state
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>('deepseek');

  // Add model form state: Name, url, Api, Model
  const [name, setName] = useState('DeepSeek');
  const [url, setUrl] = useState(PROVIDER_PRESETS['deepseek']?.defaultUrl || 'https://api.deepseek.com/v1');
  const [api, setApi] = useState('');
  const [model, setModel] = useState(PROVIDER_PRESETS['deepseek']?.defaultModel || 'deepseek-chat');
  const [showApiKey, setShowApiKey] = useState(false);

  // Feedback states
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showNotification = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => {
      setStatusMsg(null);
    }, 4500);
  };

  const handleSelectProvider = (pKey: ProviderType) => {
    const preset = PROVIDER_PRESETS[pKey];
    if (!preset) return;
    setSelectedProvider(pKey);
    setName(pKey === 'gemini' ? 'Gemini 3.8 Flash' : preset.name);
    setUrl(preset.defaultUrl);
    setModel(preset.defaultModel);
    showNotification('success', `Selected ${preset.name}! Default URL applied. Just add your API key.`);
  };

  const handleSelectModel = (modelId: string, suggestedName?: string) => {
    setModel(modelId);
    if (suggestedName) {
      setName(suggestedName);
    }
  };

  const currentPreset = PROVIDER_PRESETS[selectedProvider] || PROVIDER_PRESETS['custom'];

  // Submit Add Model Form
  const handleAddModelSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      showNotification('error', 'Please enter a Name.');
      return;
    }
    if (!api.trim()) {
      showNotification('error', `Please enter your ${currentPreset.name} API key.`);
      return;
    }
    if (!model.trim()) {
      showNotification('error', 'Please enter the Model ID.');
      return;
    }

    const newId = `${selectedProvider}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newModel: ModelInfo = {
      id: newId,
      name: name.trim(),
      provider: selectedProvider,
      description: `${currentPreset.name} (${model.trim()})`,
      contextLength: 65536,
      isFree: false,
      category: 'general',
      providerModelId: model.trim(),
      tags: [currentPreset.name, 'Active'],
      isUserSaved: true,
      customApiKey: api.trim(),
      customBaseUrl: url.trim() || currentPreset.defaultUrl,
    };

    // Update models state
    setModels((prev) => [newModel, ...prev.filter((m) => m.id !== newId)]);
    
    // Also update provider configuration
    setProviders((prev) => {
      const current = prev[selectedProvider];
      if (!current) return prev;
      return {
        ...prev,
        [selectedProvider]: {
          ...current,
          apiKey: api.trim(),
          baseUrl: url.trim() || current.baseUrl,
          isConfigured: true,
        },
      };
    });

    setActiveModelId(newId);

    showNotification(
      'success',
      `Model "${newModel.name}" added and activated as Used Model!`
    );

    // Clear key for security, keep provider ready
    setApi('');
  };

  // Delete individual model
  const handleDeleteModel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setModels((prev) => prev.filter((m) => m.id !== id));
    if (activeModelId === id) {
      setActiveModelId('');
    }
    showNotification('success', 'Model deleted.');
  };

  // Delete all models
  const handleDeleteAllModels = () => {
    if (window.confirm('Are you sure you want to delete all models?')) {
      setModels([]);
      setActiveModelId('');
      try {
        localStorage.removeItem('agentpro_saved_models_v1');
        localStorage.removeItem('agentpro_saved_model_ids');
        localStorage.removeItem('agentpro_active_model_id');
      } catch {}
      showNotification('success', 'All models deleted.');
    }
  };

  // Mask API key helper
  const maskKey = (key?: string) => {
    if (!key) return 'No Key';
    if (key.length <= 12) return '••••••••';
    return `${key.slice(0, 6)}••••••${key.slice(-4)}`;
  };

  const providerKeys: ProviderType[] = ['gemini', 'openai', 'grok', 'kimi', 'deepseek', 'custom'];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#07090d] overflow-y-auto custom-scrollbar p-5 md:p-8">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-400" />
              <span>Add Model</span>
            </h1>
            <p className="text-xs text-white/50 mt-1">
              Select Gemini, ChatGPT, Grok, Kimi, or DeepSeek — default URLs are provided automatically. Just add your API key!
            </p>
          </div>

          <div className="flex items-center gap-2">
            {models.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteAllModels}
                className="text-xs font-medium px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all cursor-pointer flex items-center gap-1.5"
                title="Delete all models"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete all</span>
              </button>
            )}
          </div>
        </div>

        {/* Notification banner */}
        {statusMsg && (
          <div
            className={`p-3 rounded-xl text-xs font-medium border flex items-center justify-between transition-all ${
              statusMsg.type === 'success'
                ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-300'
                : 'bg-red-950/40 border-red-500/50 text-red-300'
            }`}
          >
            <span>{statusMsg.text}</span>
            <button
              onClick={() => setStatusMsg(null)}
              className="text-white/40 hover:text-white ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* THE ADD MODEL FORM */}
        <div className="rounded-2xl border border-cyan-500/30 bg-[#0c1017] p-6 shadow-[0_0_30px_rgba(0,242,255,0.06)] space-y-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 neon-glow" />
              <span>Select Model Provider</span>
            </h2>
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/25 flex items-center gap-1">
              <Check className="h-3 w-3 stroke-[3]" />
              Default URLs Ready
            </span>
          </div>

          {/* Quick Provider Selection Buttons */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-white/80">
              Choose Provider:
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {providerKeys.map((pKey) => {
                const preset = PROVIDER_PRESETS[pKey];
                if (!preset) return null;
                const isSelected = selectedProvider === pKey;
                return (
                  <button
                    key={pKey}
                    type="button"
                    onClick={() => handleSelectProvider(pKey)}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-[0_0_15px_rgba(0,242,255,0.25)] ring-1 ring-cyan-400/50'
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

          <form onSubmit={handleAddModelSubmit} className="space-y-4 pt-2 border-t border-white/5">
            {/* Field 1: Name */}
            <div>
              <label className="block text-xs font-bold text-white/90 mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={currentPreset.name}
                className="w-full rounded-xl bg-black/50 border border-white/15 px-3.5 py-2.5 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono transition-colors"
                required
              />
              <p className="text-[10px] text-white/40 mt-1">
                Display name for this model (e.g., {currentPreset.name}).
              </p>
            </div>

            {/* Field 2: url */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-white/90 flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-cyan-400" />
                  <span>url (Default API Endpoint)</span>
                </label>
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                  Official Default URL
                </span>
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={currentPreset.defaultUrl}
                className="w-full rounded-xl bg-black/50 border border-cyan-500/30 px-3.5 py-2.5 text-xs text-cyan-100 placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono transition-colors"
              />
              <p className="text-[10px] text-white/40 mt-1">
                Default official URL provided automatically. No changes required.
              </p>
            </div>

            {/* Field 3: Api */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-white/90 flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5 text-cyan-400" />
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
                  className="w-full rounded-xl bg-black/50 border border-white/15 pl-3.5 pr-10 py-2.5 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-emerald-400/90 mt-1 flex items-center gap-1">
                <span>✦ Just paste your {currentPreset.name} API key to start using immediately.</span>
              </p>
            </div>

            {/* Field 4: Model with Selection Button */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-white/90 flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                  <span>
                    {selectedProvider === 'gemini'
                      ? 'ប៊ូតុងជ្រើសរើសម៉ូដែល Gemini (3.1 ➔ 3.8 ថ្មី)'
                      : 'Model (Model ID)'}
                  </span>
                </label>
                {selectedProvider === 'gemini' && (
                  <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/25">
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
              <div className="pt-1">
                <div className="flex items-center justify-between text-[10px] text-white/50 mb-1">
                  <span>Model ID (ឬកែសម្រួលដោយផ្ទាល់ / or edit directly):</span>
                </div>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={currentPreset.defaultModel}
                  className="w-full rounded-xl bg-black/50 border border-white/15 px-3.5 py-2 text-xs text-cyan-200 placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono transition-colors"
                  required
                />
              </div>
            </div>

            {/* Button strictly labeled 'Used model' */}
            <div className="pt-3">
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-sm py-3 shadow-[0_0_20px_rgba(0,242,255,0.4)] transition-all cursor-pointer active:scale-[0.99]"
              >
                <Check className="h-4 w-4 stroke-[3]" />
                <span>Used model</span>
              </button>
            </div>
          </form>
        </div>

        {/* LIST OF CONFIGURED MODELS */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
              <span>Your Configured Models</span>
              <span className="font-mono text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-white/60">
                {models.length}
              </span>
            </h3>
          </div>

          {models.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center space-y-2">
              <p className="text-xs text-white/50">
                No models added yet. Select Gemini, ChatGPT, Grok, Kimi, or DeepSeek above, paste your API key, and click &quot;Used model&quot;.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {models.map((m) => {
                const isActive = m.id === activeModelId;
                const preset = PROVIDER_PRESETS[m.provider];
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
                      isActive
                        ? 'bg-cyan-950/30 border-cyan-500/50 shadow-[0_0_20px_rgba(0,242,255,0.15)]'
                        : 'bg-white/[0.03] border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isActive ? 'bg-cyan-400 neon-glow' : 'bg-white/30'
                          }`}
                        />
                        <span className="text-sm font-bold text-white">{m.name}</span>
                        {preset && (
                          <span className="text-[10px] font-mono text-white/50 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                            {preset.badge || preset.brand}
                          </span>
                        )}
                        {isActive && (
                          <span className="text-[10px] font-bold text-cyan-300 bg-cyan-500/20 px-2 py-0.5 rounded-full border border-cyan-500/40">
                            Current Used Model
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50 font-mono pl-4">
                        <span>Model: <span className="text-white/80">{m.providerModelId}</span></span>
                        {m.customBaseUrl && (
                          <span>url: <span className="text-cyan-300/80 truncate max-w-xs">{m.customBaseUrl}</span></span>
                        )}
                        <span>Api: <span className="text-white/40">{maskKey(m.customApiKey)}</span></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 sm:self-center pl-4 sm:pl-0">
                      {!isActive ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveModelId(m.id);
                            showNotification('success', `"${m.name}" set as Used Model!`);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-bold text-xs border border-cyan-500/40 transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                          <span>Used model</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectAndChat(m.id)}
                          className="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs transition-all shadow-[0_0_12px_rgba(0,242,255,0.3)] cursor-pointer flex items-center gap-1.5"
                        >
                          <MessageSquare className="h-3.5 w-3.5 fill-black" />
                          <span>Chat now</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => handleDeleteModel(m.id, e)}
                        className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                        title="Delete model"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
