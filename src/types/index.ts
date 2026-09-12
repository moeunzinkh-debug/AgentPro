export type ProviderType =
  | 'gemini'
  | 'openai'
  | 'grok'
  | 'kimi'
  | 'deepseek'
  | 'xkiro'
  | 'openrouter'
  | 'nvidia'
  | 'huggingface'
  | 'custom';

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderType;
  description: string;
  contextLength: number;
  isFree: boolean;
  category: 'general' | 'reasoning' | 'code' | 'vision' | 'fast';
  providerModelId: string;
  pricingDescription?: string;
  tags: string[];
  isUserSaved?: boolean;
  customApiKey?: string;
  customBaseUrl?: string;
}

export interface ProviderConfig {
  id: ProviderType;
  name: string;
  badge: string;
  description: string;
  apiKey: string;
  baseUrl: string;
  customModel?: string;
  enabled: boolean;
  isConfigured: boolean;
  freeTierInfo: string;
  defaultModel: string;
  keyPlaceholder: string;
  docsUrl: string;
  iconType: string;
}

export interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: 'image' | 'code' | 'text' | 'pdf' | 'document';
  extension: string;
  content?: string;
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  timestamp: number;
  modelUsed?: string;
  providerUsed?: ProviderType;
  imageUrls?: string[];
  attachments?: AttachedFile[];
  status?: 'sending' | 'streaming' | 'complete' | 'error';
  stopped?: boolean;
  errorMsg?: string;
  tokensUsed?: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  selectedModelId: string;
}

export type ThemeType = 'immersive' | 'dark-emerald' | 'dark-slate' | 'light' | 'midnight-blue';

export type SystemPresetType = 'agent-pro' | 'coder' | 'thinker' | 'concise' | 'custom';

export interface ModelParameters {
  temperature: number;
  topP: number;
  maxTokens: number;
  presencePenalty: number;
  frequencyPenalty: number;
  systemPrompt: string;
  systemPreset: SystemPresetType;
  stream: boolean;
  enableReasoning: boolean;
  /**
   * Instant Mode for ALL models (on/off).
   * When ON, every model answers directly (zero thinking lag) while the reply
   * is still displayed progressively — streamed from the first token to the
   * last, never buffered until fully generated.
   * Gemini models always use Instant Mode.
   */
  instantMode: boolean;
}

export interface AppSettings {
  theme: ThemeType;
  parameters: ModelParameters;
}

export type NavTab = 'chat' | 'tasks' | 'models' | 'settings';
