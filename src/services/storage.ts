import { AppSettings, Conversation, ModelInfo, ProviderConfig, ProviderType } from '../types';
import { INITIAL_MODELS, INITIAL_PROVIDERS } from '../data/defaultCatalog';

const STORAGE_KEYS = {
  CONVERSATIONS: 'agentpro_conversations_v1',
  CURRENT_CONV_ID: 'agentpro_current_conv_id_v1',
  PROVIDERS: 'agentpro_providers_v1',
  MODELS: 'agentpro_models_v1',
  SETTINGS: 'agentpro_settings_v1',
  ACTIVE_MODEL: 'agentpro_active_model_v1',
  SAVED_MODEL_IDS: 'agentpro_saved_model_ids_v1',
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'immersive',
  parameters: {
    temperature: 0.7,
    topP: 0.95,
    maxTokens: 4096,
    presencePenalty: 0,
    frequencyPenalty: 0,
    systemPrompt: `You are Agent Pro, a powerful, versatile, and precise AI assistant.
You provide clear, structured, and accurate responses.
When presenting code, use clean markdown blocks with language tags.
If asked to analyze complex issues, provide methodical step-by-step reasoning.`,
    systemPreset: 'agent-pro',
    stream: true,
    enableReasoning: true,
  },
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

export function loadProviders(): Record<string, ProviderConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROVIDERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...INITIAL_PROVIDERS, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load providers:', e);
  }
  return INITIAL_PROVIDERS;
}

export function saveProviders(providers: Record<string, ProviderConfig>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(providers));
  } catch (e) {
    console.error('Failed to save providers:', e);
  }
}

const RESET_FLAG_KEY = 'agentpro_cleared_all_models_v6';

export function loadSavedModelIds(): string[] {
  try {
    if (!localStorage.getItem(RESET_FLAG_KEY)) {
      localStorage.removeItem(STORAGE_KEYS.SAVED_MODEL_IDS);
      return [];
    }
    const raw = localStorage.getItem(STORAGE_KEYS.SAVED_MODEL_IDS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveSavedModelIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SAVED_MODEL_IDS, JSON.stringify(ids));
  } catch {}
}

export function clearAllSavedModels(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.MODELS);
    localStorage.removeItem(STORAGE_KEYS.SAVED_MODEL_IDS);
    localStorage.setItem(STORAGE_KEYS.ACTIVE_MODEL, '');
  } catch {}
}

export function loadModels(): ModelInfo[] {
  try {
    // Reset any legacy pre-populated models on first load of this update
    if (!localStorage.getItem(RESET_FLAG_KEY)) {
      localStorage.removeItem(STORAGE_KEYS.MODELS);
      localStorage.removeItem(STORAGE_KEYS.SAVED_MODEL_IDS);
      localStorage.setItem(STORAGE_KEYS.ACTIVE_MODEL, '');
      localStorage.setItem(RESET_FLAG_KEY, 'true');
      return [];
    }

    const raw = localStorage.getItem(STORAGE_KEYS.MODELS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Return only user saved/fetched models
        return parsed.filter((m: ModelInfo) => m.isUserSaved);
      }
    }
  } catch (e) {
    console.warn('Failed to load models:', e);
  }
  return [];
}

export function saveModels(models: ModelInfo[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MODELS, JSON.stringify(models));
  } catch (e) {
    console.error('Failed to save models:', e);
  }
}

export function loadActiveModelId(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_MODEL);
    if (raw) return raw;

    const savedIds = loadSavedModelIds();
    if (savedIds.length > 0) {
      return savedIds[0];
    }
  } catch {}
  return '';
}

export function saveActiveModelId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_MODEL, id);
  } catch {}
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load conversations:', e);
  }
  
  // Default fresh conversation
  const initialConv: Conversation = {
    id: 'conv-' + Date.now(),
    title: 'New Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    selectedModelId: '',
  };
  return [initialConv];
}

export function saveConversations(convs: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(convs));
  } catch (e) {
    console.error('Failed to save conversations:', e);
  }
}

export function loadCurrentConvId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_CONV_ID);
  } catch {}
  return null;
}

export function saveCurrentConvId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CURRENT_CONV_ID, id);
  } catch {}
}
