import { ModelInfo, ProviderConfig, ProviderType } from '../types';

export interface ProviderPreset {
  id: ProviderType;
  name: string;
  brand: string;
  badge: string;
  defaultUrl: string;
  defaultModel: string;
  keyPlaceholder: string;
  docsUrl: string;
  description: string;
  popularModels: Array<{ id: string; name: string; desc: string }>;
}

export interface GeminiModelItem {
  id: string;
  name: string;
  version: '3.1' | '3.5' | '3.6' | '3.7' | '3.8';
  desc: string;
  isNewest?: boolean;
}

export const GEMINI_ORDERED_MODELS: GeminiModelItem[] = [
  // 3.1 (Older)
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', version: '3.1', desc: 'Gemini 3.1 Fast inference & responsive multimodal' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', version: '3.1', desc: 'Gemini 3.1 Complex reasoning & logic' },
  // 3.5
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', version: '3.5', desc: 'Gemini 3.5 High speed and multimodal intelligence' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', version: '3.5', desc: 'Gemini 3.5 Ultra-low latency responsive inference' },
  // 3.6
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', version: '3.6', desc: 'Gemini 3.6 High-throughput responsive inference' },
  // 3.7
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', version: '3.7', desc: 'Gemini 3.7 Hybrid thinking & vision reasoning' },
  // 3.8 (ថ្មីបំផុត / Newest)
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', version: '3.8', desc: 'Gemini 3.8 Frontier Flash — ថ្មីបំផុត (Latest & Fastest)', isNewest: true },
  { id: 'gemini-pro-latest', name: 'Gemini Pro Latest (3.8 Reasoning)', version: '3.8', desc: 'Gemini Frontier Flagship — ថ្មីបំផុត (Latest & Deepest Reasoning)', isNewest: true },
];

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    brand: 'Google',
    badge: 'Google AI',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.8-flash',
    keyPlaceholder: 'AIzaSy... (Google AI Studio Key)',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    description: 'Official Google Gemini with multimodal capabilities and reasoning (3.1 ➔ 3.8 ថ្មី).',
    popularModels: GEMINI_ORDERED_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      desc: m.desc,
    })),
  },
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    brand: 'OpenAI',
    badge: 'OpenAI',
    defaultUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    keyPlaceholder: 'sk-proj-... or sk-... (OpenAI Key)',
    docsUrl: 'https://platform.openai.com/api-keys',
    description: 'Official OpenAI API for GPT-4o, GPT-4o-mini, o3-mini, and o1.',
    popularModels: [
      { id: 'gpt-4o', name: 'GPT-4o', desc: 'Omni flagship intelligence' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Fast, lightweight & economical' },
      { id: 'o3-mini', name: 'o3-mini', desc: 'High-speed STEM reasoning' },
      { id: 'o1', name: 'o1', desc: 'Deep mathematical & logic reasoning' },
    ],
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    brand: 'xAI',
    badge: 'xAI',
    defaultUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-1212',
    keyPlaceholder: 'xai-... (xAI Grok API Key)',
    docsUrl: 'https://console.x.ai/',
    description: 'Official xAI API for Grok-2 and Grok-2 Vision.',
    popularModels: [
      { id: 'grok-2-1212', name: 'Grok 2', desc: 'Frontier language and real-time reasoning' },
      { id: 'grok-2-vision-1212', name: 'Grok 2 Vision', desc: 'Multimodal image understanding' },
      { id: 'grok-beta', name: 'Grok Beta', desc: 'Developer preview release' },
    ],
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    brand: 'Moonshot AI',
    badge: 'Moonshot',
    defaultUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    keyPlaceholder: 'sk-... (Moonshot / Kimi Key)',
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    description: 'Official Moonshot AI API for Kimi 8K to 128K long context.',
    popularModels: [
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K', desc: 'Fast conversational model' },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K', desc: 'Medium 32k context processing' },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K', desc: '128k long document context' },
      { id: 'kimi-latest', name: 'Kimi Latest', desc: 'Latest Kimi model updates' },
    ],
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    brand: 'DeepSeek',
    badge: 'Official API',
    defaultUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-... (DeepSeek API Key)',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    description: 'Official DeepSeek API for DeepSeek-V3 and DeepSeek-R1.',
    popularModels: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3', desc: 'DeepSeek-V3 Chat & Coding' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1', desc: 'DeepSeek-R1 CoT Reasoning' },
    ],
  },
  custom: {
    id: 'custom',
    name: 'Custom API',
    brand: 'Custom / OpenRouter',
    badge: 'OpenAI-Compatible',
    defaultUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-v4-flash',
    keyPlaceholder: 'sk-... (Custom or OpenRouter Key)',
    docsUrl: 'https://openrouter.ai/keys',
    description: 'Connect any custom or OpenAI-compatible endpoint.',
    popularModels: [
      { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', desc: 'OpenRouter fast inference' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', desc: 'Open weights flagship' },
    ],
  },
};

export const INITIAL_PROVIDERS: Record<string, ProviderConfig> = {
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    badge: 'Google AI',
    description: 'Direct Google Gemini API with Gemini 2.5 Flash & Pro.',
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    enabled: true,
    isConfigured: false,
    freeTierInfo: 'Google AI Studio Free Tier available',
    defaultModel: 'gemini-2.5-flash',
    keyPlaceholder: 'AIzaSy... (Gemini API Key)',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    iconType: 'gemini',
  },
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    badge: 'OpenAI',
    description: 'Official OpenAI API for GPT-4o, GPT-4o-mini, o3-mini, and o1.',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    isConfigured: false,
    freeTierInfo: 'OpenAI billing API quota',
    defaultModel: 'gpt-4o',
    keyPlaceholder: 'sk-proj-... or sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    iconType: 'openai',
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    badge: 'xAI',
    description: 'Official xAI Grok API for Grok-2 and Grok-2 Vision.',
    apiKey: '',
    baseUrl: 'https://api.x.ai/v1',
    enabled: true,
    isConfigured: false,
    freeTierInfo: 'xAI console credits',
    defaultModel: 'grok-2-1212',
    keyPlaceholder: 'xai-...',
    docsUrl: 'https://console.x.ai/',
    iconType: 'grok',
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    badge: 'Moonshot AI',
    description: 'Official Moonshot AI API for Kimi 8k to 128k context.',
    apiKey: '',
    baseUrl: 'https://api.moonshot.cn/v1',
    enabled: true,
    isConfigured: false,
    freeTierInfo: 'Moonshot free credits on sign up',
    defaultModel: 'moonshot-v1-8k',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    iconType: 'kimi',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    badge: 'Official API',
    description: 'Official DeepSeek API for DeepSeek-V3 and DeepSeek-R1.',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    enabled: true,
    isConfigured: false,
    freeTierInfo: 'DeepSeek official API token credits',
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    iconType: 'deepseek',
  },
  custom: {
    id: 'custom',
    name: 'Custom API',
    badge: 'OpenAI-Compatible',
    description: 'Connect any OpenAI-compatible API (Ollama, vLLM, DeepSeek, OpenRouter, or custom gateway).',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    customModel: '',
    enabled: true,
    isConfigured: false,
    freeTierInfo: 'Custom or OpenRouter API quota',
    defaultModel: '',
    keyPlaceholder: 'sk-... (API Key)',
    docsUrl: '',
    iconType: 'server',
  },
};

// Populated dynamically when user inputs API key & selects model
export const INITIAL_MODELS: ModelInfo[] = [];

export const SYSTEM_PRESETS: Record<string, { name: string; prompt: string; description: string }> = {
  'agent-pro': {
    name: 'Agent Pro Default',
    description: 'Adaptive, intelligent, structured problem solver with code and step breakdown.',
    prompt: `You are Agent Pro, a powerful, versatile, and precise AI assistant.
You provide clear, accurate, and deeply helpful answers.
When presenting code, use proper markdown syntax and formatting.
If asked to analyze or reason, break down your methodology methodically.`,
  },
  coder: {
    name: 'Code Architect Pro',
    description: 'Senior Software Engineer specializing in modern TypeScript, Python, and system design.',
    prompt: `You are an elite Senior Staff Software Engineer and Architect.
Provide production-ready, clean, well-typed code. Avoid unnecessary filler or preamble.
Identify edge cases, security considerations, and performance optimizations.`,
  },
  thinker: {
    name: 'Deep Reasoner / Researcher',
    description: 'Thorough scientific researcher and analytical thinker with explicit breakdown.',
    prompt: `You are a rigorous analytical thinker and scientific researcher.
Break down complex queries into fundamental first principles.
Examine multiple hypotheses, present counter-arguments, and substantiate claims clearly.`,
  },
  concise: {
    name: 'Concise & Direct',
    description: 'Ultra-fast, high-density answers with zero conversational fluff.',
    prompt: `You are a concise AI assistant. Answer directly and factually.
Do not include conversational greetings or closing remarks.
Focus purely on actionable, high-signal information.`,
  },
};
