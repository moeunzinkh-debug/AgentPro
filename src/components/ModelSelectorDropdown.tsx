import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Check,
  Sparkles,
  Flame,
  Search,
  Cpu,
} from 'lucide-react';
import { GEMINI_ORDERED_MODELS, GeminiModelItem, PROVIDER_PRESETS } from '../data/defaultCatalog';
import { ProviderType } from '../types';

interface ModelSelectorDropdownProps {
  provider: ProviderType;
  selectedModel: string;
  onSelectModel: (modelId: string, suggestedName?: string) => void;
}

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({
  provider,
  selectedModel,
  onSelectModel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [geminiVersionFilter, setGeminiVersionFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const isGemini = provider === 'gemini';
  const currentPreset = PROVIDER_PRESETS[provider];

  // If Gemini, use the strict ordered list (3.1, 3.5, 3.6, 3.7, 3.8 ថ្មី)
  const geminiModels: GeminiModelItem[] = GEMINI_ORDERED_MODELS;

  // Filtered Gemini models
  const filteredGeminiModels = geminiModels.filter((m) => {
    if (geminiVersionFilter !== 'all' && m.version !== geminiVersionFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.desc.toLowerCase().includes(q) ||
        m.version.includes(q)
      );
    }
    return true;
  });

  // Current model label for button display
  const getSelectedModelLabel = () => {
    if (isGemini) {
      const match = geminiModels.find((m) => m.id === selectedModel);
      if (match) {
        return {
          title: match.name,
          badge: match.isNewest ? '3.8 ថ្មី' : match.version,
          isNew: !!match.isNewest,
        };
      }
    } else if (currentPreset) {
      const match = currentPreset.popularModels?.find((m) => m.id === selectedModel);
      if (match) {
        return {
          title: match.name,
          badge: currentPreset.name,
          isNew: false,
        };
      }
    }
    return {
      title: selectedModel || 'ជ្រើសរើសម៉ូដែល (Select Model)',
      badge: provider,
      isNew: false,
    };
  };

  const currentLabel = getSelectedModelLabel();

  return (
    <div className="relative w-full" ref={dropdownRef}>
      {/* SELECTION BUTTON (ប៊ូតុងជ្រើសរើសម៉ូដែល) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
          isOpen
            ? 'bg-cyan-500/15 border-cyan-400 shadow-[0_0_20px_rgba(0,242,255,0.25)] ring-1 ring-cyan-400'
            : 'bg-black/60 border-white/15 hover:border-cyan-400/60 hover:bg-white/[0.04]'
        }`}
      >
        <div className="flex items-center gap-2.5 truncate">
          <div
            className={`p-1.5 rounded-lg flex items-center justify-center shrink-0 ${
              isGemini
                ? 'bg-gradient-to-br from-cyan-400/30 to-blue-500/30 border border-cyan-400/40 text-cyan-300'
                : 'bg-white/10 text-white'
            }`}
          >
            {currentLabel.isNew ? (
              <Flame className="h-4 w-4 text-amber-400 animate-pulse" />
            ) : (
              <Cpu className="h-4 w-4 text-cyan-400" />
            )}
          </div>

          <div className="text-left truncate">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white tracking-wide truncate">
                {currentLabel.title}
              </span>
              {currentLabel.isNew && (
                <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.2 rounded border border-amber-500/40 flex items-center gap-1">
                  <Flame className="h-2.5 w-2.5 fill-amber-300" />
                  ថ្មី
                </span>
              )}
            </div>
            <div className="text-[10px] text-white/50 font-mono truncate">
              {isGemini ? (
                <span>ម៉ូដែល Gemini (3.1 ➔ 3.8 ថ្មី) • {selectedModel}</span>
              ) : (
                <span>ID: {selectedModel}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="hidden sm:inline-block text-[11px] text-cyan-400/90 font-medium px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
            {isGemini ? 'ជ្រើសរើសម៉ូដែល' : 'Select'}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-white/60 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-cyan-400' : ''
            }`}
          />
        </div>
      </button>

      {/* DROPDOWN MENU / SELECTION PANEL */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-full rounded-2xl glass border border-cyan-500/40 bg-[#090c12]/98 backdrop-blur-2xl p-3 shadow-[0_15px_40px_rgba(0,0,0,0.9)] z-50 animate-in fade-in zoom-in-95 duration-150 space-y-3 max-h-[26rem] flex flex-col">
          {/* Dropdown Header */}
          <div className="flex items-center justify-between pb-2 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              <span className="text-xs font-bold text-white">
                {isGemini
                  ? 'បញ្ជីម៉ូដែល Gemini (ពីចាស់ 3.1 ទៅថ្មីបំផុត 3.8)'
                  : `ម៉ូដែល ${currentPreset?.name || provider}`}
              </span>
            </div>
            <span className="text-[10px] text-white/40 font-mono">
              {isGemini ? `${geminiModels.length} ម៉ូដែល` : 'Official models'}
            </span>
          </div>

          {/* Gemini Version Filter Buttons (3.1, 3.5, 3.6, 3.7, 3.8 ថ្មី) */}
          {isGemini && (
            <div className="space-y-1.5 shrink-0">
              <div className="flex items-center justify-between text-[10px] text-white/60 font-medium">
                <span>តម្រងតាមជំនាន់ (Filter version):</span>
                <span className="text-cyan-400 font-mono">3.1 ➔ 3.8 ថ្មី</span>
              </div>
              <div className="grid grid-cols-6 gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
                <button
                  type="button"
                  onClick={() => setGeminiVersionFilter('all')}
                  className={`text-[10px] font-bold py-1 rounded-lg transition-all cursor-pointer ${
                    geminiVersionFilter === 'all'
                      ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/50'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  ទាំងអស់
                </button>
                {(['3.1', '3.5', '3.6', '3.7', '3.8'] as const).map((ver) => {
                  const isSelected = geminiVersionFilter === ver;
                  const isNew = ver === '3.8';
                  return (
                    <button
                      key={ver}
                      type="button"
                      onClick={() => setGeminiVersionFilter(ver)}
                      className={`text-[10px] font-bold py-1 rounded-lg transition-all flex items-center justify-center gap-0.5 cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-500 text-black shadow-[0_0_10px_rgba(0,242,255,0.4)]'
                          : isNew
                          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25'
                          : 'text-white/70 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <span>{ver}</span>
                      {isNew && <Flame className="h-2.5 w-2.5 fill-current" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search box if list is long */}
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isGemini ? 'ស្វែងរក 3.1, 3.5, 3.6, 3.7, 3.8...' : 'Search model...'}
              className="w-full rounded-xl bg-black/40 border border-white/10 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none font-mono"
            />
          </div>

          {/* Model list ordered from older (3.1) to newest (3.8 ថ្មី) */}
          <div className="overflow-y-auto custom-scrollbar space-y-1.5 pr-1 flex-1">
            {isGemini ? (
              filteredGeminiModels.length === 0 ? (
                <div className="p-4 text-center text-xs text-white/40">
                  រកមិនឃើញម៉ូដែលដែលត្រូវនឹងពាក្យស្វែងរក
                </div>
              ) : (
                filteredGeminiModels.map((m) => {
                  const isSelected = selectedModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onSelectModel(m.id, m.name);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_12px_rgba(0,242,255,0.2)]'
                          : m.isNewest
                          ? 'bg-amber-950/20 border-amber-500/30 hover:bg-amber-900/30 hover:border-amber-400'
                          : 'bg-black/30 border-white/5 hover:bg-white/5 hover:border-white/20'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.2 rounded border font-bold ${
                              m.isNewest
                                ? 'bg-amber-500/25 border-amber-500/50 text-amber-300'
                                : 'bg-white/10 border-white/15 text-white/70'
                            }`}
                          >
                            v{m.version}
                          </span>
                          <span className="text-xs font-bold text-white">{m.name}</span>
                          {m.isNewest && (
                            <span className="text-[9px] font-bold text-amber-400 bg-amber-500/20 px-1.5 py-0.2 rounded-full border border-amber-500/40 flex items-center gap-0.5">
                              <Flame className="h-2.5 w-2.5 fill-amber-400" />
                              <span>ថ្មីបំផុត (Latest)</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-white/50 font-mono">
                          ID: <span className="text-cyan-300/90">{m.id}</span>
                        </div>
                        <div className="text-[10px] text-white/40">{m.desc}</div>
                      </div>

                      <div className="shrink-0 ml-3">
                        {isSelected ? (
                          <div className="p-1 rounded-full bg-cyan-400 text-black">
                            <Check className="h-3.5 w-3.5 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="text-[10px] text-white/40 group-hover:text-cyan-400 font-mono">
                            ជ្រើស
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )
            ) : (
              // Other providers list
              currentPreset?.popularModels &&
              currentPreset.popularModels.map((pm) => {
                const isSelected = selectedModel === pm.id;
                return (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => {
                      onSelectModel(pm.id, pm.name);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-[0_0_12px_rgba(0,242,255,0.2)]'
                        : 'bg-black/30 border-white/5 hover:bg-white/5 hover:border-white/20'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-white">{pm.name}</div>
                      <div className="text-[10px] text-cyan-300 font-mono">{pm.id}</div>
                      <div className="text-[10px] text-white/40">{pm.desc}</div>
                    </div>
                    {isSelected && (
                      <div className="p-1 rounded-full bg-cyan-400 text-black">
                        <Check className="h-3.5 w-3.5 stroke-[3]" />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
