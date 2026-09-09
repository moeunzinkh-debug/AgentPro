import React, { useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  Key,
  Plus,
  Server,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { ModelInfo, ProviderConfig, ProviderType } from '../types';
import { normalizeBaseUrl } from '../utils/url';

interface ModelSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  providers: Record<string, ProviderConfig>;
  onUpdateProviderKey: (provider: ProviderType, apiKey: string, baseUrl?: string) => void;
  onSelectAndActivateModel: (model: ModelInfo, apiKey?: string, baseUrl?: string) => void;
  savedModels: ModelInfo[];
  activeModelId: string;
  onDeleteModel?: (modelId: string) => void;
  onClearAllModels: () => void;
  initialProvider?: ProviderType;
}

export const ModelSelectionModal: React.FC<ModelSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelectAndActivateModel,
  savedModels,
  activeModelId,
  onDeleteModel,
}) => {
  const [tab, setTab] = useState<'add_api' | 'custom_api'>('add_api');

  // Add API Form
  const [name, setName] = useState('');
  const [api, setApi] = useState('');
  const [model, setModel] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Custom API Form
  const [customName, setCustomName] = useState('');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [customApi, setCustomApi] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [showCustomApiKey, setShowCustomApiKey] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFillExample = () => {
    setName('DeepSeek');
    setApi('sk-xt-ab6e247ffe1cfc84b4016753e696c68e96810003ff2949b6');
    setModel('deepseek/deepseek-v4-flash');
    setErrorMsg(null);
  };

  const handleSubmitAddApi = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Please enter a Name.');
      return;
    }
    if (!api.trim()) {
      setErrorMsg('Please enter the Api key.');
      return;
    }
    if (!model.trim()) {
      setErrorMsg('Please enter the Model ID.');
      return;
    }

    const newId = `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newModel: ModelInfo = {
      id: newId,
      name: name.trim(),
      provider: 'custom',
      description: `Configured Model: ${model.trim()}`,
      contextLength: 65536,
      isFree: false,
      category: 'general',
      providerModelId: model.trim(),
      tags: ['API', 'Active'],
      isUserSaved: true,
      customApiKey: api.trim(),
    };

    onSelectAndActivateModel(newModel, api.trim());
    onClose();
  };

  const handleSubmitCustomApi = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) {
      setErrorMsg('Please enter a Name.');
      return;
    }
    if (!customEndpoint.trim()) {
      setErrorMsg('Please enter the Custom API Endpoint (Base URL).');
      return;
    }
    if (!customModel.trim()) {
      setErrorMsg('Please enter the Model ID.');
      return;
    }

    const newId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newModel: ModelInfo = {
      id: newId,
      name: customName.trim(),
      provider: 'custom',
      description: `Custom Endpoint: ${customEndpoint.trim()}`,
      contextLength: 65536,
      isFree: false,
      category: 'general',
      providerModelId: customModel.trim(),
      tags: ['Custom Endpoint', 'Active'],
      isUserSaved: true,
      customApiKey: customApi.trim() || undefined,
      customBaseUrl: normalizeBaseUrl(customEndpoint),
    };

    onSelectAndActivateModel(newModel, customApi.trim() || undefined, customEndpoint.trim());
    onClose();
  };

  const maskKey = (key?: string) => {
    if (!key) return 'No Key';
    if (key.length <= 12) return '••••••••';
    return `${key.slice(0, 6)}••••••${key.slice(-4)}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85">
      <div className="w-full max-w-lg rounded-2xl glass border border-cyan-500/30 bg-[#0a0d13] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.9)] space-y-5 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 neon-glow" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Model Selection
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab switcher: Add API vs Custom API */}
        <div className="flex items-center p-1 rounded-xl bg-white/5 border border-white/10">
          <button
            type="button"
            onClick={() => {
              setTab('add_api');
              setErrorMsg(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              tab === 'add_api'
                ? 'bg-cyan-500 text-black shadow-[0_0_12px_rgba(0,242,255,0.4)]'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add API</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('custom_api');
              setErrorMsg(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              tab === 'custom_api'
                ? 'bg-cyan-500 text-black shadow-[0_0_12px_rgba(0,242,255,0.4)]'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Server className="h-3.5 w-3.5" />
            <span>Custom API</span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/50 text-red-300 text-xs">
            {errorMsg}
          </div>
        )}

        {/* Form: Add API */}
        {tab === 'add_api' && (
          <form onSubmit={handleSubmitAddApi} className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">
                Enter Name, Api key, and Model ID.
              </span>
              <button
                type="button"
                onClick={handleFillExample}
                className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 cursor-pointer"
              >
                Example (DeepSeek)
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-white/80 mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="DeepSeek"
                className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-white/80 mb-1">
                Api
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={api}
                  onChange={(e) => setApi(e.target.value)}
                  placeholder="sk-xt-ab6e247ffe1cfc84b4016753e696c68e96810003ff2949b6"
                  className="w-full rounded-xl bg-black/40 border border-white/15 pl-3 pr-9 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
                  required
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
            </div>

            <div>
              <label className="block text-xs font-bold text-white/80 mb-1">
                Model
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="deepseek/deepseek-v4-flash"
                className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
                required
              />
            </div>

            {/* Button strictly labeled 'Used model' */}
            <div className="pt-2">
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs py-2.5 shadow-[0_0_15px_rgba(0,242,255,0.4)] transition-all cursor-pointer"
              >
                <Check className="h-3.5 w-3.5 stroke-[3]" />
                <span>Used model</span>
              </button>
            </div>
          </form>
        )}

        {/* Form: Custom API */}
        {tab === 'custom_api' && (
          <form onSubmit={handleSubmitCustomApi} className="space-y-4">
            <p className="text-xs text-white/50">
              Enter Custom Endpoint URL, Api key, and Model ID.
            </p>

            <div>
              <label className="block text-xs font-bold text-white/80 mb-1">
                Name
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Custom DeepSeek / Local Server"
                className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-white/80 mb-1">
                Endpoint (Base URL)
              </label>
              <input
                type="url"
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
                placeholder="https://api.deepseek.com/v1 or http://localhost:11434/v1"
                className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-white/80 mb-1">
                Api (Optional for local)
              </label>
              <div className="relative">
                <input
                  type={showCustomApiKey ? 'text' : 'password'}
                  value={customApi}
                  onChange={(e) => setCustomApi(e.target.value)}
                  placeholder="sk-... or Bearer token"
                  className="w-full rounded-xl bg-black/40 border border-white/15 pl-3 pr-9 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowCustomApiKey(!showCustomApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white cursor-pointer"
                >
                  {showCustomApiKey ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-white/80 mb-1">
                Model
              </label>
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="deepseek/deepseek-v4-flash or llama3:latest"
                className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
                required
              />
            </div>

            {/* Button strictly labeled 'Used model' */}
            <div className="pt-2">
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs py-2.5 shadow-[0_0_15px_rgba(0,242,255,0.4)] transition-all cursor-pointer"
              >
                <Check className="h-3.5 w-3.5 stroke-[3]" />
                <span>Used model</span>
              </button>
            </div>
          </form>
        )}

        {/* Existing Configured Models List */}
        {savedModels.length > 0 && (
          <div className="pt-3 border-t border-white/10 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/60">
              Your Configured Models ({savedModels.length})
            </h3>
            <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
              {savedModels.map((m) => {
                const isActive = m.id === activeModelId;
                return (
                  <div
                    key={m.id}
                    className={`flex items-center justify-between p-2.5 rounded-xl border text-xs ${
                      isActive
                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                        : 'bg-white/5 border-white/10 text-white/80 hover:border-white/20'
                    }`}
                  >
                    <div className="truncate pr-2">
                      <div className="font-bold text-white truncate">{m.name}</div>
                      <div className="text-[10px] text-white/40 font-mono truncate">
                        {m.providerModelId} • {maskKey(m.customApiKey)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isActive ? (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectAndActivateModel(m, m.customApiKey, m.customBaseUrl);
                            onClose();
                          }}
                          className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-bold text-[11px] border border-cyan-500/40 cursor-pointer"
                        >
                          Used model
                        </button>
                      ) : (
                        <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">
                          Active
                        </span>
                      )}

                      {onDeleteModel && (
                        <button
                          type="button"
                          onClick={() => onDeleteModel(m.id)}
                          className="p-1 text-white/40 hover:text-red-400 cursor-pointer"
                          title="Delete model"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
