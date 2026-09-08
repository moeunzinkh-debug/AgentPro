import React, { useState } from 'react';
import {
  ExternalLink,
  Info,
  Palette,
  RotateCcw,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react';
import { AppSettings, SystemPresetType, ThemeType } from '../types';
import { DEFAULT_SETTINGS } from '../services/storage';
import { SYSTEM_PRESETS } from '../data/defaultCatalog';

interface SettingsViewProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, setSettings }) => {
  const [activeTab, setActiveTab] = useState<'theme' | 'parameters' | 'about'>('theme');

  const handleThemeChange = (theme: ThemeType) => {
    setSettings((prev) => ({
      ...prev,
      theme,
    }));
  };

  const handleParamChange = <K extends keyof AppSettings['parameters']>(
    key: K,
    val: AppSettings['parameters'][K]
  ) => {
    setSettings((prev) => ({
      ...prev,
      parameters: {
        ...prev.parameters,
        [key]: val,
      },
    }));
  };

  const handleApplyPreset = (presetKey: SystemPresetType) => {
    const preset = SYSTEM_PRESETS[presetKey];
    if (preset) {
      setSettings((prev) => ({
        ...prev,
        parameters: {
          ...prev.parameters,
          systemPreset: presetKey,
          systemPrompt: preset.prompt,
        },
      }));
    }
  };

  const handleResetDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#050507] text-[#e2e2e7] overflow-hidden relative">
      {/* Ambient radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,242,255,0.05)_0%,transparent_50%)] pointer-events-none z-0" />

      {/* Settings Header matching Immersive UI */}
      <div className="px-6 py-5 border-b border-white/10 glass z-10">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-400 shadow-[0_0_10px_rgba(0,242,255,0.2)]">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white uppercase tracking-wide">
              Configuration & Settings
            </h1>
            <p className="text-xs text-white/40 mt-0.5">
              Customize appearance, model generation parameters, and API provider integration.
            </p>
          </div>
        </div>

        {/* Tab Navigation: Theme, Model Parameters, About */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setActiveTab('theme')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'theme'
                ? 'border border-cyan-500/50 bg-cyan-500/10 text-cyan-400 shadow-[0_0_10px_rgba(0,242,255,0.15)]'
                : 'text-white/50 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            <span>Theme</span>
          </button>

          <button
            onClick={() => setActiveTab('parameters')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'parameters'
                ? 'border border-cyan-500/50 bg-cyan-500/10 text-cyan-400 shadow-[0_0_10px_rgba(0,242,255,0.15)]'
                : 'text-white/50 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Model Parameters</span>
          </button>

          <button
            onClick={() => setActiveTab('about')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'about'
                ? 'border border-cyan-500/50 bg-cyan-500/10 text-cyan-400 shadow-[0_0_10px_rgba(0,242,255,0.15)]'
                : 'text-white/50 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <Info className="h-3.5 w-3.5" />
            <span>About</span>
          </button>
        </div>
      </div>

      {/* Main Settings Content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl z-10 custom-scrollbar">
        {/* 1. THEME SECTION */}
        {activeTab === 'theme' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xs uppercase tracking-wider text-white/40 block mb-1">
                Visual Aesthetic
              </h2>
              <p className="text-xs text-white/60">
                Select your preferred theme system. The &quot;Immersive UI&quot; theme features cybernetic neon cyan glows on an obsidian glass canvas.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Immersive UI (Default) */}
              <div
                onClick={() => handleThemeChange('immersive')}
                className={`cursor-pointer rounded-xl p-4 transition-all ${
                  settings.theme === 'immersive'
                    ? 'glass border border-cyan-500/60 accent-border shadow-[0_0_16px_rgba(0,242,255,0.18)]'
                    : 'glass border border-white/10 hover:border-cyan-500/30'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Immersive UI (Default)
                  </span>
                  {settings.theme === 'immersive' && (
                    <span className="rounded bg-cyan-500/20 text-cyan-300 text-[9px] font-bold px-2 py-0.5 border border-cyan-500/40">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-6 w-8 rounded bg-[#050507] border border-white/10" />
                  <div className="h-6 w-8 rounded bg-white/5 border border-white/10" />
                  <div className="h-6 w-8 rounded bg-[#00f2ff] shadow-[0_0_8px_rgba(0,242,255,0.6)]" />
                  <div className="h-6 w-8 rounded bg-[#00a8b3]" />
                </div>
                <p className="text-[11px] text-white/40 leading-relaxed">
                  Cyber `#050507` background with translucent glass panels and electric `#00f2ff` cyan neon glow.
                </p>
              </div>

              {/* Dark Emerald */}
              <div
                onClick={() => handleThemeChange('dark-emerald')}
                className={`cursor-pointer rounded-xl p-4 transition-all ${
                  settings.theme === 'dark-emerald'
                    ? 'glass border border-cyan-500/60 accent-border shadow-[0_0_16px_rgba(0,242,255,0.18)]'
                    : 'glass border border-white/10 hover:border-cyan-500/30'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Dark Emerald
                  </span>
                  {settings.theme === 'dark-emerald' && (
                    <span className="rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold px-2 py-0.5 border border-emerald-500/40">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-6 w-8 rounded bg-[#070b0e] border border-white/10" />
                  <div className="h-6 w-8 rounded bg-[#0d1418] border border-white/10" />
                  <div className="h-6 w-8 rounded bg-[#00d18f]" />
                  <div className="h-6 w-8 rounded bg-[#10b981]" />
                </div>
                <p className="text-[11px] text-white/40 leading-relaxed">
                  Obsidian base `#070b0e` paired with high-contrast electric emerald `#00d18f`.
                </p>
              </div>

              {/* Dark Slate */}
              <div
                onClick={() => handleThemeChange('dark-slate')}
                className={`cursor-pointer rounded-xl p-4 transition-all ${
                  settings.theme === 'dark-slate'
                    ? 'glass border border-cyan-500/60 accent-border shadow-[0_0_16px_rgba(0,242,255,0.18)]'
                    : 'glass border border-white/10 hover:border-cyan-500/30'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Dark Slate
                  </span>
                  {settings.theme === 'dark-slate' && (
                    <span className="rounded bg-cyan-500/20 text-cyan-300 text-[9px] font-bold px-2 py-0.5 border border-cyan-500/40">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-6 w-8 rounded bg-[#0f172a] border border-white/10" />
                  <div className="h-6 w-8 rounded bg-[#1e293b] border border-white/10" />
                  <div className="h-6 w-8 rounded bg-[#38bdf8]" />
                  <div className="h-6 w-8 rounded bg-[#818cf8]" />
                </div>
                <p className="text-[11px] text-white/40 leading-relaxed">
                  Cool zinc and slate tones with sky blue and indigo accents.
                </p>
              </div>

              {/* Midnight Blue */}
              <div
                onClick={() => handleThemeChange('midnight-blue')}
                className={`cursor-pointer rounded-xl p-4 transition-all ${
                  settings.theme === 'midnight-blue'
                    ? 'glass border border-cyan-500/60 accent-border shadow-[0_0_16px_rgba(0,242,255,0.18)]'
                    : 'glass border border-white/10 hover:border-cyan-500/30'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Midnight Blue
                  </span>
                  {settings.theme === 'midnight-blue' && (
                    <span className="rounded bg-cyan-500/20 text-cyan-300 text-[9px] font-bold px-2 py-0.5 border border-cyan-500/40">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-6 w-8 rounded bg-[#030712] border border-white/10" />
                  <div className="h-6 w-8 rounded bg-[#0b1329] border border-white/10" />
                  <div className="h-6 w-8 rounded bg-[#2563eb]" />
                  <div className="h-6 w-8 rounded bg-[#60a5fa]" />
                </div>
                <p className="text-[11px] text-white/40 leading-relaxed">
                  Deep space navy with high-luminosity cyber blue highlights.
                </p>
              </div>

              {/* Light Pro */}
              <div
                onClick={() => handleThemeChange('light')}
                className={`cursor-pointer rounded-xl p-4 transition-all ${
                  settings.theme === 'light'
                    ? 'glass border border-cyan-500/60 accent-border shadow-[0_0_16px_rgba(0,242,255,0.18)]'
                    : 'glass border border-white/10 hover:border-cyan-500/30'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Light Pro
                  </span>
                  {settings.theme === 'light' && (
                    <span className="rounded bg-cyan-500/20 text-cyan-300 text-[9px] font-bold px-2 py-0.5 border border-cyan-500/40">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-6 w-8 rounded bg-[#f8fafc] border border-slate-300" />
                  <div className="h-6 w-8 rounded bg-[#ffffff] border border-slate-300" />
                  <div className="h-6 w-8 rounded bg-[#059669]" />
                  <div className="h-6 w-8 rounded bg-[#0f172a]" />
                </div>
                <p className="text-[11px] text-white/40 leading-relaxed">
                  Crisp daylight editorial theme with cyan/emerald accents and high-contrast text.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 2. MODEL PARAMETERS SECTION */}
        {activeTab === 'parameters' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs uppercase tracking-wider text-white/40 mb-1">
                  Generation Hyperparameters
                </h2>
                <p className="text-xs text-white/60">
                  Configure temperature, nucleus sampling (Top-P), context limits, and persona behavior.
                </p>
              </div>
              <button
                onClick={handleResetDefaults}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset Defaults</span>
              </button>
            </div>

            {/* System Persona Presets */}
            <div className="rounded-xl glass border border-white/10 p-4 space-y-3">
              <label className="block text-[11px] uppercase tracking-wider text-white/40">
                System Persona Preset
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(
                  [
                    ['agent-pro', 'Agent Pro Default', 'Versatile, high-precision technical assistant.'],
                    ['coder', 'Code Architect Pro', 'Senior full-stack TypeScript & Python engineer.'],
                    ['thinker', 'Deep Thinker', 'Exhaustive first-principles analysis with reasoning.'],
                    ['concise', 'Concise & Direct', 'Zero boilerplate answers delivered at max density.'],
                  ] as const
                ).map(([key, name, desc]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleApplyPreset(key)}
                    className={`text-left p-3 rounded-lg border text-xs transition-all cursor-pointer ${
                      settings.parameters.systemPreset === key
                        ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200 shadow-[0_0_10px_rgba(0,242,255,0.12)]'
                        : 'border-white/5 bg-white/5 text-white/70 hover:border-white/20'
                    }`}
                  >
                    <div className="font-semibold text-white">{name}</div>
                    <div className="text-[10px] text-white/40 mt-0.5">{desc}</div>
                  </button>
                ))}
              </div>

              {/* System Prompt Custom Textarea */}
              <div className="pt-2">
                <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1.5">
                  System Instructions (Prompt)
                </label>
                <textarea
                  rows={4}
                  value={settings.parameters.systemPrompt}
                  onChange={(e) => {
                    handleParamChange('systemPrompt', e.target.value);
                    handleParamChange('systemPreset', 'custom');
                  }}
                  className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-xs font-mono text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none leading-relaxed"
                  placeholder="Enter custom instructions..."
                />
              </div>
            </div>

            {/* Sliders Grid styled with Immersive UI cyan accents */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Temperature */}
              <div className="rounded-xl glass border border-white/10 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[11px] uppercase tracking-wider text-white/60">Temperature</span>
                  <span className="font-mono text-cyan-400 font-bold">
                    {settings.parameters.temperature.toFixed(2)}
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(0,242,255,0.5)] transition-all"
                    style={{ width: `${Math.min((settings.parameters.temperature / 2) * 100, 100)}%` }}
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={settings.parameters.temperature}
                  onChange={(e) => handleParamChange('temperature', parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 h-1 bg-transparent cursor-pointer -mt-1"
                />
                <div className="flex justify-between text-[10px] text-white/30">
                  <span>Deterministic (0.0)</span>
                  <span>Balanced (0.7)</span>
                  <span>Creative (1.5+)</span>
                </div>
              </div>

              {/* Top P */}
              <div className="rounded-xl glass border border-white/10 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[11px] uppercase tracking-wider text-white/60">Top-P (Sampling)</span>
                  <span className="font-mono text-cyan-400 font-bold">
                    {settings.parameters.topP.toFixed(2)}
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(0,242,255,0.5)] transition-all"
                    style={{ width: `${settings.parameters.topP * 100}%` }}
                  />
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={settings.parameters.topP}
                  onChange={(e) => handleParamChange('topP', parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 h-1 bg-transparent cursor-pointer -mt-1"
                />
                <div className="flex justify-between text-[10px] text-white/30">
                  <span>Focused (0.2)</span>
                  <span>Standard (0.95)</span>
                  <span>Full (1.0)</span>
                </div>
              </div>

              {/* Max Output Tokens */}
              <div className="rounded-xl glass border border-white/10 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[11px] uppercase tracking-wider text-white/60">Max Tokens</span>
                  <span className="font-mono text-cyan-400 font-bold">
                    {settings.parameters.maxTokens.toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(0,242,255,0.5)] transition-all"
                    style={{
                      width: `${Math.min((settings.parameters.maxTokens / 16384) * 100, 100)}%`,
                    }}
                  />
                </div>
                <input
                  type="range"
                  min="512"
                  max="16384"
                  step="512"
                  value={settings.parameters.maxTokens}
                  onChange={(e) => handleParamChange('maxTokens', parseInt(e.target.value))}
                  className="w-full accent-cyan-400 h-1 bg-transparent cursor-pointer -mt-1"
                />
                <div className="flex justify-between text-[10px] text-white/30">
                  <span>Short (512)</span>
                  <span>Standard (4,096)</span>
                  <span>Extended (16k)</span>
                </div>
              </div>

              {/* Reasoning Trace toggle */}
              <div className="rounded-xl glass border border-white/10 p-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/80 font-bold">
                    Internal Reasoning (CoT)
                  </div>
                  <div className="text-[10px] text-white/40 mt-0.5">
                    Show reasoning trace for reasoning models (DeepSeek R1, etc.).
                  </div>
                </div>
                <div
                  onClick={() => handleParamChange('enableReasoning', !settings.parameters.enableReasoning)}
                  className="w-8 h-4 bg-cyan-500/20 rounded-full relative border border-cyan-500/40 cursor-pointer"
                >
                  <div
                    className={`absolute top-0.5 w-3 h-3 bg-cyan-400 rounded-full neon-glow transition-all duration-200 ${
                      settings.parameters.enableReasoning ? 'right-0.5' : 'left-0.5 opacity-30'
                    }`}
                  />
                </div>
              </div>

              {/* Gemini Generation Mode: Instant Mode Only */}
              <div className="rounded-xl glass border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-amber-300 font-bold flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 fill-amber-300" />
                    Gemini Generation Mode
                  </div>
                  <div className="text-[10px] text-white/50 mt-0.5">
                    Configured to <strong className="text-amber-300">Instant Mode Only</strong> (zero thinking lag, direct complete response).
                  </div>
                </div>
                <div className="px-2.5 py-1 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold uppercase tracking-wider">
                  Instant Only
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. ABOUT SECTION */}
        {activeTab === 'about' && (
          <div className="space-y-6">
            <div className="rounded-xl glass border border-cyan-500/40 p-5 shadow-[0_0_20px_rgba(0,242,255,0.1)]">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 border border-cyan-500/50 text-cyan-400 shadow-[0_0_12px_rgba(0,242,255,0.3)]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-wide">Agent Pro</h2>
                  <p className="text-xs text-cyan-400 font-mono">
                    Custom API & Model Interface
                  </p>
                </div>
              </div>
              <p className="text-xs text-white/60 leading-relaxed mt-3">
                Agent Pro connects to your API endpoints and models (DeepSeek, OpenRouter, or custom OpenAI-compatible gateways) with streaming, markdown, and code execution.
              </p>
            </div>

            {/* Provider Free Access Links */}
            <div>
              <h3 className="text-xs uppercase tracking-wider text-white/60 mb-3 flex items-center gap-2 font-bold">
                <Zap className="h-4 w-4 text-cyan-400" />
                How to Obtain API Keys
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  {
                    name: 'DeepSeek Platform',
                    badge: 'Direct API',
                    desc: 'Sign up on DeepSeek platform to get an API key for deepseek-v4-flash and deepseek-chat.',
                    url: 'https://platform.deepseek.com',
                  },
                  {
                    name: 'OpenRouter',
                    badge: 'Gateway',
                    desc: 'Generate an API key on OpenRouter to connect to models with one universal key.',
                    url: 'https://openrouter.ai/keys',
                  },
                  {
                    name: 'Google AI Studio (Gemini)',
                    badge: '15 RPM Free',
                    desc: 'Get an instant API key for Gemini 2.5 Flash and Gemini 2.0 Flash Lite.',
                    url: 'https://aistudio.google.com/app/apikey',
                  },
                  {
                    name: 'NVIDIA NIM Developer',
                    badge: '1,000 Free Credits',
                    desc: 'Create an NVIDIA Developer account to run Llama 3.3 70B & DeepSeek R1 on GPUs.',
                    url: 'https://build.nvidia.com',
                  },
                  {
                    name: 'Hugging Face Hub',
                    badge: 'Serverless Free',
                    desc: 'Create a free User Access Token to query open-source LLMs.',
                    url: 'https://huggingface.co/settings/tokens',
                  },
                  {
                    name: 'Custom / Local APIs',
                    badge: '100% Free / Self-Hosted',
                    desc: 'Point to Ollama (`http://localhost:11434/v1`) or vLLM with zero API fees.',
                    url: 'https://github.com/ollama/ollama',
                  },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl glass border border-white/10 p-3.5 flex flex-col justify-between hover:border-cyan-500/30 transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-xs font-bold text-white">{item.name}</span>
                        <span className="rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[9px] font-mono px-2 py-0.5">
                          {item.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/40 leading-relaxed">{item.desc}</p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 flex justify-end">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-[11px] font-medium text-cyan-400 hover:underline"
                      >
                        Visit Provider <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Local Security banner */}
            <div className="rounded-xl glass border border-white/10 p-4 space-y-2 text-xs text-white/40">
              <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">
                Zero-Telemetry & Local Security
              </h4>
              <p>
                Agent Pro runs client-side with an optional local proxy to eliminate browser CORS restrictions.
                All custom API keys and conversation archives are stored strictly inside your browser&apos;s
                local encrypted storage (`localStorage`). No keys or conversation transcripts are ever logged.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
