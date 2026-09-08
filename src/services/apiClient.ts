import { ModelInfo, ModelParameters, ProviderConfig, ProviderType } from '../types';
import { normalizeBaseUrl } from '../utils/url';

export function cleanErrorMessage(rawError: any): string {
  if (!rawError) return 'An unexpected error occurred.';
  let msg = typeof rawError === 'string' ? rawError : rawError.message || String(rawError);

  // Recursively extract nested JSON if present
  for (let i = 0; i < 4; i++) {
    try {
      const braceIdx = msg.indexOf('{');
      if (braceIdx !== -1) {
        const parsed = JSON.parse(msg.slice(braceIdx));
        if (parsed.error?.message) msg = parsed.error.message;
        else if (parsed.message) msg = parsed.message;
        else if (parsed.error && typeof parsed.error === 'string') msg = parsed.error;
      }
    } catch {}
  }

  if (msg.includes('experiencing high demand') || msg.includes('503') || msg.includes('UNAVAILABLE')) {
    return 'This model is currently experiencing high demand (503). Spikes in demand are temporary. Please try again in a few moments, or select another Gemini version (such as 3.7 or 3.5).';
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('quota')) {
    return 'Quota or rate limit exceeded (429). Please wait a moment or check your API key quota.';
  }
  if (msg.includes('invalid argument') || msg.includes('INVALID_ARGUMENT')) {
    return 'The requested model configuration is not accepted by this model version. The system has automatically refreshed parameter settings.';
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
    return 'Gemini API key is invalid or unauthorized. Please verify your API key in the Models tab.';
  }

  return msg.replace(/^[a-zA-Z0-9_]+Error:\s*/, '').trim();
}

export interface ChatApiRequest {
  provider: ProviderType;
  modelId: string;
  providerModelId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  parameters: ModelParameters;
  images?: string[];
  providerConfig: ProviderConfig;
}

export interface ChatApiResponse {
  content: string;
  reasoning?: string;
  modelUsed: string;
  providerUsed: ProviderType;
  tokensUsed?: number;
}

export interface StreamChunk {
  content?: string;
  reasoning?: string;
  model?: string;
}

export async function sendChatMessageStream(
  req: ChatApiRequest,
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal
): Promise<ChatApiResponse> {
  const { provider, providerModelId, messages, parameters, images, providerConfig } = req;
  const safeBaseUrl = normalizeBaseUrl(providerConfig.baseUrl);

  const res = await fetch('/api/chat?stream=true', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      provider,
      model: providerModelId,
      messages,
      apiKey: providerConfig.apiKey || undefined,
      baseUrl: safeBaseUrl || undefined,
      parameters: {
        temperature: parameters.temperature,
        maxTokens: parameters.maxTokens,
        topP: parameters.topP,
        systemPrompt: parameters.systemPrompt,
      },
      images,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(cleanErrorMessage(errText || `HTTP error ${res.status}`));
  }

  if (!res.body) {
    throw new Error('No readable stream available in response.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullContent = '';
  let fullReasoning = '';
  let modelUsed = providerModelId;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.replace(/^data:\s*/, '');
        if (dataStr === '[DONE]') {
          continue;
        }
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.error) {
            throw new Error(cleanErrorMessage(parsed.error));
          }
          if (parsed.content) {
            fullContent += parsed.content;
          }
          if (parsed.reasoning) {
            fullReasoning += parsed.reasoning;
          }
          if (parsed.model) {
            modelUsed = parsed.model;
          }
          onChunk({
            content: parsed.content || '',
            reasoning: parsed.reasoning || '',
            model: parsed.model,
          });
        } catch (e: any) {
          if (e.message && !e.message.includes('JSON')) {
            throw e;
          }
        }
      }
    }
  }

  return {
    content: fullContent,
    reasoning: fullReasoning || undefined,
    modelUsed,
    providerUsed: provider,
  };
}

export async function sendChatMessage(req: ChatApiRequest): Promise<ChatApiResponse> {
  const { provider, providerModelId, messages, parameters, images, providerConfig } = req;
  const safeBaseUrl = normalizeBaseUrl(providerConfig.baseUrl);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider,
        model: providerModelId,
        messages,
        apiKey: providerConfig.apiKey || undefined,
        baseUrl: safeBaseUrl || undefined,
        parameters: {
          temperature: parameters.temperature,
          maxTokens: parameters.maxTokens,
          topP: parameters.topP,
          systemPrompt: parameters.systemPrompt,
        },
        images,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(cleanErrorMessage(errData.error || `HTTP error ${res.status}`));
    }

    const data = await res.json();
    return {
      content: data.content,
      reasoning: data.reasoning,
      modelUsed: data.model || providerModelId,
      providerUsed: data.provider || provider,
      tokensUsed: data.tokensUsed,
    };
  } catch (err: any) {
    // Check if direct client fallback is possible for OpenRouter or HuggingFace
    if (provider === 'openrouter' && providerConfig.apiKey) {
      try {
        const directRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${providerConfig.apiKey}`,
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Agent Pro',
          },
          body: JSON.stringify({
            model: providerModelId,
            messages: [
              { role: 'system', content: parameters.systemPrompt },
              ...messages.map((m) => ({ role: m.role, content: m.content })),
            ],
            temperature: parameters.temperature,
            max_tokens: parameters.maxTokens,
          }),
        });
        if (directRes.ok) {
          const directData = await directRes.json();
          const choice = directData.choices?.[0];
          return {
            content: choice?.message?.content || '',
            reasoning: choice?.message?.reasoning,
            modelUsed: directData.model || providerModelId,
            providerUsed: 'openrouter',
            tokensUsed: directData.usage?.total_tokens,
          };
        }
      } catch {}
    }

    throw new Error(cleanErrorMessage(err?.message || 'Failed to generate response from model.'));
  }
}

export async function fetchRemoteModels(
  provider: ProviderType,
  config: ProviderConfig
): Promise<ModelInfo[]> {
  return fetchLiveProviderModels(provider, config.apiKey, config.baseUrl);
}

export async function fetchLiveProviderModels(
  provider: ProviderType,
  apiKey?: string,
  baseUrl?: string
): Promise<ModelInfo[]> {
  const res = await fetch('/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      apiKey: apiKey?.trim() || undefined,
      baseUrl: normalizeBaseUrl(baseUrl) || undefined,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || `Failed to fetch models from ${provider} (${res.status})`);
  }

  const json = await res.json();
  if (Array.isArray(json.models)) {
    return json.models;
  }
  return [];
}
