import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ModelInfo, ProviderType } from '../types';
import { normalizeBaseUrl } from '../utils/url.ts';

/**
 * One streamed frame forwarded to the client.
 *
 * `status` carries a short, human-readable note about what the server had to do
 * (retry a rejected generation config, fall back because the upstream ignored
 * `stream: true`, …). The UI shows it as a hint instead of leaving the user
 * staring at a spinner with no explanation.
 */
export interface StreamChunkPayload {
  content?: string;
  reasoning?: string;
  model?: string;
  status?: string;
}

/**
 * Thrown when the streaming transport itself cannot be used (the upstream
 * refused the request outright). The client answers it with exactly ONE
 * non-streaming fallback generation — and only then, so a genuine model error
 * is never paid for twice.
 */
export class ChatStreamUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatStreamUnsupportedError';
  }
}

/**
 * Thrown when the upstream answered 200 but did not honour `stream: true`
 * (a plain JSON body instead of SSE). The answer is still delivered — as one
 * block plus a status note — so the bubble never hangs on "generating…".
 */
export class UpstreamStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamStreamError';
  }
}

/** True when Gemini rejected the *generation config* (not the model/key). */
function isGeminiParamRejection(err: any): boolean {
  const msg = err?.message || String(err || '');
  return (
    msg.includes('thinkingConfig') ||
    msg.includes('thinkingLevel') ||
    msg.includes('thinkingBudget') ||
    msg.includes('includeThoughts') ||
    msg.includes('Unknown name') ||
    msg.includes('Cannot find field') ||
    msg.includes('invalid argument') ||
    msg.includes('INVALID_ARGUMENT') ||
    err?.status === 400 ||
    msg.includes('(400)')
  );
}

/**
 * ROOT CAUSE of the "instant mode waits, then dumps the whole answer" bug.
 *
 * The Gemini branch used to hard-code `thinkingConfig: { thinkingLevel: LOW }`
 * for every model. No Gemini 2.x model accepts `thinkingLevel` (it is a 3.x
 * field), so the very first request was rejected with a 400 — a full wasted
 * round trip — and the retry dropped the thinking config entirely, which means
 * "dynamic thinking": the model spent seconds emitting *thought-only* chunks
 * (`part.thought === true`, `chunk.text === undefined`). Those chunks were
 * discarded, so the UI showed nothing while the model was thinking and then
 * painted the answer as soon as the visible text finally arrived — looking
 * exactly like "it generated everything first and only then displayed it".
 *
 * The ladder below sends the RIGHT thinking config for the model on the FIRST
 * attempt:
 *   • Instant Mode  → thinking disabled (budget 0 / level minimal), so the first
 *                     visible token arrives after a single round trip;
 *   • thinking on   → `includeThoughts: true`, so the thoughts themselves stream
 *                     back as `reasoning` and the user watches progress.
 * If a config is still rejected we retry the SAME model with the next, less
 * specific config (never cascade straight to a worse fallback model).
 */
function buildGeminiConfigLadder(
  modelName: string,
  opts: { instantMode: boolean; temperature: number; maxOutputTokens: number; topP: number; sysPrompt: string }
): Array<{ label: string; config: Record<string, any> }> {
  const m = modelName.toLowerCase();
  const base = {
    systemInstruction: opts.sysPrompt,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    topP: opts.topP,
  };

  // Gemini 3.x: `thinkingLevel` is the only accepted thinking knob.
  if (/(^|[^0-9.])3(\.|$|-)/.test(m) || m.includes('gemini-3')) {
    const minimal = (ThinkingLevel as any)?.MINIMAL ?? 'minimal';
    return opts.instantMode
      ? [
          { label: 'thinkingLevel minimal', config: { ...base, thinkingConfig: { thinkingLevel: minimal } } },
          { label: 'thinkingBudget 0', config: { ...base, thinkingConfig: { thinkingBudget: 0 } } },
          { label: 'no thinkingConfig', config: { ...base } },
        ]
      : [
          {
            label: 'thinkingLevel low + thoughts',
            config: { ...base, thinkingConfig: { thinkingLevel: (ThinkingLevel as any)?.LOW ?? 'low', includeThoughts: true } },
          },
          { label: 'thinkingBudget -1 + thoughts', config: { ...base, thinkingConfig: { thinkingBudget: -1, includeThoughts: true } } },
          { label: 'no thinkingConfig', config: { ...base } },
        ];
  }

  // Gemini 2.5: `thinkingBudget` (pro refuses 0 — its minimum is 128).
  if (m.includes('2.5')) {
    const isPro = m.includes('pro');
    return opts.instantMode
      ? [
          { label: 'thinkingBudget 0', config: { ...base, thinkingConfig: { thinkingBudget: isPro ? 128 : 0 } } },
          { label: 'no thinkingConfig', config: { ...base } },
        ]
      : [
          { label: 'thinkingBudget -1 + thoughts', config: { ...base, thinkingConfig: { thinkingBudget: -1, includeThoughts: true } } },
          { label: 'no thinkingConfig', config: { ...base } },
        ];
  }

  // Gemini 2.0 / 1.5: no `thinkingLevel`, and 1.5 only accepts a budget.
  const budgetOnly = m.includes('1.5');
  if (opts.instantMode) {
    return budgetOnly
      ? [
          { label: 'thinkingBudget 0', config: { ...base, thinkingConfig: { thinkingBudget: 0 } } },
          { label: 'no thinkingConfig', config: { ...base } },
        ]
      : [{ label: 'no thinkingConfig', config: { ...base } }];
  }
  return budgetOnly
    ? [
        { label: 'thinkingBudget -1 + thoughts', config: { ...base, thinkingConfig: { thinkingBudget: -1, includeThoughts: true } } },
        { label: 'no thinkingConfig', config: { ...base } },
      ]
    : [{ label: 'no thinkingConfig', config: { ...base } }];
}

/**
 * Split one streamed Gemini response into visible text and thoughts.
 *
 * `chunk.text` concatenates every part and is `undefined` for thought-only
 * chunks — relying on it is what made the whole thinking phase invisible.
 */
function splitGeminiChunk(chunk: any): { content: string; reasoning: string } {
  let content = '';
  let reasoning = '';
  for (const candidate of chunk?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      const text = part?.text;
      if (!text) continue;
      if (part?.thought) reasoning += text;
      else content += text;
    }
  }
  return { content, reasoning };
}

export function parseApiErrorMessage(err: any): string {
  if (!err) return 'Unknown error occurred';
  let raw = typeof err === 'string' ? err : err.message || String(err);

  // If error has nested JSON string, recursively unpack
  for (let i = 0; i < 4; i++) {
    try {
      const braceIdx = raw.indexOf('{');
      if (braceIdx !== -1) {
        const candidate = raw.slice(braceIdx);
        const parsed = JSON.parse(candidate);
        if (parsed.error?.message) {
          raw = parsed.error.message;
        } else if (parsed.message) {
          raw = parsed.message;
        } else if (parsed.error && typeof parsed.error === 'string') {
          raw = parsed.error;
        }
      }
    } catch {}
  }

  // Check specific error patterns
  if (raw.includes('experiencing high demand') || raw.includes('503') || raw.includes('UNAVAILABLE')) {
    return 'This model is currently experiencing high demand (503). Spikes in demand are temporary. Please try again in a few moments, or select another Gemini version.';
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429') || raw.includes('quota')) {
    return 'Quota or rate limit exceeded (429). Please wait a moment or check your API key quota.';
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('API key not valid') || raw.includes('401') || raw.includes('Unauthorized')) {
    return 'API key is invalid, unauthorized, or expired. Please verify your API key in the Models configuration.';
  }
  if (raw.includes('not found') || raw.includes('404')) {
    return 'The requested model was not found or is unsupported on this endpoint.';
  }

  return raw.replace(/^[a-zA-Z0-9_]+Error:\s*/, '').trim();
}

export function resolveGeminiModel(modelName?: string): string {
  if (!modelName) return 'gemini-2.5-flash';
  const clean = modelName.replace(/^models\//, '').trim().toLowerCase();

  const aliasMap: Record<string, string> = {
    'gemini-3.1-flash': 'gemini-2.5-flash',
    'gemini-3.1-flash-lite': 'gemini-2.0-flash-lite',
    'gemini-3.1-pro': 'gemini-2.5-pro',
    'gemini-3.1-pro-preview': 'gemini-2.5-pro',
    'gemini-3.5-flash': 'gemini-2.5-flash',
    'gemini-3.5-flash-lite': 'gemini-2.0-flash-lite',
    'gemini-3.5-pro': 'gemini-2.5-pro',
    'gemini-3.6-flash': 'gemini-2.5-flash',
    'gemini-3.6-pro': 'gemini-2.5-pro',
    'gemini-3.7-flash': 'gemini-2.5-flash',
    'gemini-3.7-pro': 'gemini-2.5-pro',
    'gemini-3.8-flash': 'gemini-2.5-flash',
    'gemini-3.8-pro': 'gemini-2.5-pro',
    'gemini-pro-latest': 'gemini-2.5-pro',
    'gemini-flash-latest': 'gemini-2.5-flash',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.0-flash': 'gemini-2.0-flash',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
    'gemini-1.5-flash': 'gemini-1.5-flash',
    'gemini-1.5-pro': 'gemini-1.5-pro',
  };

  return aliasMap[clean] || clean;
}

export function getGeminiCandidateModels(requestedModel: string): string[] {
  const resolved = resolveGeminiModel(requestedModel);
  const candidates = [
    resolved,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-2.5-pro',
    'gemini-1.5-pro',
  ];

  return Array.from(new Set(candidates));
}

export interface ChatRequestBody {
  provider: ProviderType;
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  apiKey?: string;
  baseUrl?: string;
  /**
   * Instant Mode: answer directly with the thinking phase disabled so the first
   * visible token arrives after ONE round trip. The reply is still streamed
   * progressively from start to finish — Instant Mode never means "generate
   * everything first, then display".
   */
  instantMode?: boolean;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    systemPrompt?: string;
  };
  images?: string[]; // base64 or data URLs
}

export async function handleChatRequest(body: ChatRequestBody): Promise<{
  content: string;
  reasoning?: string;
  model: string;
  provider: ProviderType;
  tokensUsed?: number;
}> {
  const { provider, model, messages, apiKey, baseUrl: rawBaseUrl, parameters, images } = body;
  // Repair common base URL typos (e.g. "ttps://..." -> "https://...") before any fetch.
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const sysPrompt = parameters?.systemPrompt || 'You are Agent Pro, an advanced and helpful AI assistant.';

  // 1. Google Gemini
  if (provider === 'gemini') {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        'Gemini API key is required. Please add your key in Models -> Configure API, or set GEMINI_API_KEY in environment.'
      );
    }

    const ai = new GoogleGenAI({ apiKey: key });

    // Format contents for Google GenAI
    const contents: any[] = [];

    // Add user/assistant turns
    for (const msg of messages) {
      const textVal = msg.content || (images && images.length > 0 ? 'Analyze the attached file/image.' : ' ');
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: textVal }],
      });
    }

    // If there's an image in the latest request, attach it
    if (images && images.length > 0 && contents.length > 0) {
      const lastUserIdx = contents.length - 1;
      for (const img of images) {
        const base64Data = img.replace(/^data:image\/\w+;base64,/, '');
        const mimeMatch = img.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        contents[lastUserIdx].parts.push({
          inlineData: {
            mimeType,
            data: base64Data,
          },
        });
      }
    }

    const candidateModels = getGeminiCandidateModels(model || 'gemini-2.5-flash');
    let lastError: any = null;

    for (let i = 0; i < candidateModels.length; i++) {
      const activeModel = candidateModels[i];
      try {
        let response;
        try {
          response = await ai.models.generateContent({
            model: activeModel,
            contents: contents.length > 0 ? contents : 'Hello',
            config: {
              systemInstruction: sysPrompt,
              temperature: parameters?.temperature ?? 0.7,
              maxOutputTokens: parameters?.maxTokens ?? 4096,
              topP: parameters?.topP ?? 0.95,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        } catch (innerErr: any) {
          const innerMsg = innerErr?.message || String(innerErr);
          if (
            innerMsg.includes('invalid argument') ||
            innerMsg.includes('INVALID_ARGUMENT') ||
            innerErr?.status === 400 ||
            innerMsg.includes('thinkingConfig')
          ) {
            // Fallback immediately to standard config without thinkingConfig
            response = await ai.models.generateContent({
              model: activeModel,
              contents: contents.length > 0 ? contents : 'Hello',
              config: {
                systemInstruction: sysPrompt,
                temperature: parameters?.temperature ?? 0.7,
                maxOutputTokens: parameters?.maxTokens ?? 4096,
                topP: parameters?.topP ?? 0.95,
              },
            });
          } else {
            throw innerErr;
          }
        }

        return {
          content: response.text || '(No text returned)',
          model: activeModel,
          provider: 'gemini',
        };
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const isTemporary =
          errMsg.includes('503') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('high demand') ||
          errMsg.includes('404') ||
          errMsg.includes('not found') ||
          errMsg.includes('invalid argument') ||
          errMsg.includes('INVALID_ARGUMENT') ||
          errMsg.includes('400');

        if (isTemporary && i < candidateModels.length - 1) {
          console.warn(`Gemini model ${activeModel} unavailable or rejected (${errMsg.slice(0, 50)}), trying fallback ${candidateModels[i + 1]}...`);
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }

        throw new Error(parseApiErrorMessage(err));
      }
    }

    throw new Error(parseApiErrorMessage(lastError));
  }

  // 2. OpenRouter
  if (provider === 'openrouter') {
    const key = apiKey || process.env.OPENROUTER_API_KEY;
    const isFreeModel = model.endsWith(':free');

    if (!key && !isFreeModel) {
      throw new Error(
        'OpenRouter API key is required for non-free models. Please add your key in Models -> Configure API or switch to a :free model.'
      );
    }

    const formattedMessages = [
      { role: 'system', content: sysPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key || 'sk-or-v1-free-anonymous'}`,
        'HTTP-Referer': 'https://agentpro.aistudio.build',
        'X-Title': 'Agent Pro',
      },
      body: JSON.stringify({
        model: model || 'deepseek/deepseek-r1:free',
        messages: formattedMessages,
        temperature: parameters?.temperature ?? 0.7,
        max_tokens: parameters?.maxTokens ?? 4096,
        top_p: parameters?.topP ?? 0.95,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedErr = errText;
      try {
        const json = JSON.parse(errText);
        parsedErr = json.error?.message || json.message || errText;
      } catch {}
      throw new Error(`OpenRouter Error (${response.status}): ${parsedErr}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content || '';
    const reasoning = choice?.message?.reasoning || choice?.message?.thought;

    return {
      content: text,
      reasoning: reasoning || undefined,
      model: data.model || model,
      provider: 'openrouter',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  // 3. NVIDIA NIM
  if (provider === 'nvidia') {
    const key = apiKey || process.env.NVIDIA_API_KEY;
    if (!key) {
      throw new Error('NVIDIA NIM API key is required. Get 1,000 free inference credits at build.nvidia.com');
    }

    const formattedMessages = [
      { role: 'system', content: sysPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || 'meta/llama-3.3-70b-instruct',
        messages: formattedMessages,
        temperature: parameters?.temperature ?? 0.7,
        max_tokens: parameters?.maxTokens ?? 4096,
        top_p: parameters?.topP ?? 0.95,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA NIM Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || '',
      reasoning: choice?.message?.reasoning,
      model: data.model || model,
      provider: 'nvidia',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  // 4. Hugging Face
  if (provider === 'huggingface') {
    const key = apiKey || process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
    const targetModel = model || 'meta-llama/Llama-3.2-3B-Instruct';

    const formattedMessages = [
      { role: 'system', content: sysPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }

    const response = await fetch('https://router.huggingface.co/hf-inference/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        temperature: parameters?.temperature ?? 0.7,
        max_tokens: parameters?.maxTokens ?? 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Hugging Face Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || '',
      model: targetModel,
      provider: 'huggingface',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  // 5. xKiro (Kimi AI / Moonshot)
  if (provider === 'xkiro') {
    const key = apiKey || process.env.XKIRO_API_KEY || process.env.MOONSHOT_API_KEY;
    const endpoint = baseUrl || 'https://api.moonshot.cn/v1';

    if (!key) {
      throw new Error(
        'xKiro (Moonshot / Kimi) API key is required. Please go to "Save Model" (Name, Api, Model), enter your API key (sk-...), and click Save to use it.'
      );
    }

    const formattedMessages = [
      { role: 'system', content: sysPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const response = await fetch(`${endpoint.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || 'kimi-2.6',
        messages: formattedMessages,
        temperature: parameters?.temperature ?? 0.7,
        max_tokens: parameters?.maxTokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`xKiro Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || '',
      reasoning: choice?.message?.reasoning,
      model: data.model || model,
      provider: 'xkiro',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  // 6. OpenAI (ChatGPT)
  if (provider === 'openai') {
    const key = apiKey || process.env.OPENAI_API_KEY;
    const endpoint = baseUrl || 'https://api.openai.com/v1';
    if (!key) {
      throw new Error('OpenAI API key is required. Please provide your API key (sk-...) to use ChatGPT.');
    }
    const targetModel = model || 'gpt-4o';
    const formattedMessages: any[] = [{ role: 'system', content: sysPrompt }];
    messages.forEach((m, idx) => {
      if (idx === messages.length - 1 && m.role === 'user' && images && images.length > 0) {
        formattedMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: m.content || ' ' },
            ...images.map((img) => ({ type: 'image_url', image_url: { url: img } })),
          ],
        });
      } else {
        formattedMessages.push({ role: m.role, content: m.content });
      }
    });

    const cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
    const fullUrl = cleanEndpoint.endsWith('/chat/completions') ? cleanEndpoint : `${cleanEndpoint}/chat/completions`;

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key.trim()}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        temperature: parameters?.temperature ?? 0.7,
        max_tokens: parameters?.maxTokens ?? 4096,
        top_p: parameters?.topP ?? 0.95,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedMsg = errText;
      try {
        const j = JSON.parse(errText);
        parsedMsg = j.error?.message || j.message || errText;
      } catch {}
      throw new Error(`OpenAI Error (${response.status}): ${parsedMsg}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      reasoning: choice?.message?.reasoning || choice?.message?.thought,
      model: data.model || targetModel,
      provider: 'openai',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  // 7. Grok (xAI)
  if (provider === 'grok') {
    const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;
    const endpoint = baseUrl || 'https://api.x.ai/v1';
    if (!key) {
      throw new Error('Grok (xAI) API key is required. Please provide your xAI API key (xai-...).');
    }
    const targetModel = model || 'grok-2-1212';
    const formattedMessages: any[] = [{ role: 'system', content: sysPrompt }];
    messages.forEach((m, idx) => {
      if (idx === messages.length - 1 && m.role === 'user' && images && images.length > 0) {
        formattedMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: m.content || ' ' },
            ...images.map((img) => ({ type: 'image_url', image_url: { url: img } })),
          ],
        });
      } else {
        formattedMessages.push({ role: m.role, content: m.content });
      }
    });

    const cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
    const fullUrl = cleanEndpoint.endsWith('/chat/completions') ? cleanEndpoint : `${cleanEndpoint}/chat/completions`;

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key.trim()}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        temperature: parameters?.temperature ?? 0.7,
        max_tokens: parameters?.maxTokens ?? 4096,
        top_p: parameters?.topP ?? 0.95,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedMsg = errText;
      try {
        const j = JSON.parse(errText);
        parsedMsg = j.error?.message || j.message || errText;
      } catch {}
      throw new Error(`Grok Error (${response.status}): ${parsedMsg}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      reasoning: choice?.message?.reasoning || choice?.message?.thought,
      model: data.model || targetModel,
      provider: 'grok',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  // 8. Kimi (Moonshot AI)
  if (provider === 'kimi') {
    const key = apiKey || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || process.env.XKIRO_API_KEY;
    const endpoint = baseUrl || 'https://api.moonshot.cn/v1';
    if (!key) {
      throw new Error('Kimi (Moonshot) API key is required. Please enter your Moonshot API key (sk-...).');
    }
    const targetModel = model || 'moonshot-v1-8k';
    const formattedMessages = [
      { role: 'system', content: sysPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
    const fullUrl = cleanEndpoint.endsWith('/chat/completions') ? cleanEndpoint : `${cleanEndpoint}/chat/completions`;

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key.trim()}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        temperature: parameters?.temperature ?? 0.7,
        max_tokens: parameters?.maxTokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedMsg = errText;
      try {
        const j = JSON.parse(errText);
        parsedMsg = j.error?.message || j.message || errText;
      } catch {}
      throw new Error(`Kimi Error (${response.status}): ${parsedMsg}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      reasoning: choice?.message?.reasoning || choice?.message?.thought,
      model: data.model || targetModel,
      provider: 'kimi',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  // 9. DeepSeek (Official API)
  if (provider === 'deepseek') {
    const key = apiKey || process.env.DEEPSEEK_API_KEY;
    const endpoint = baseUrl || 'https://api.deepseek.com/v1';
    if (!key) {
      throw new Error('DeepSeek API key is required. Please enter your DeepSeek API key (sk-...).');
    }
    const targetModel = model || 'deepseek-chat';
    const formattedMessages = [
      { role: 'system', content: sysPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
    const fullUrl = cleanEndpoint.endsWith('/chat/completions') ? cleanEndpoint : `${cleanEndpoint}/chat/completions`;

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key.trim()}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        temperature: parameters?.temperature ?? 0.7,
        max_tokens: parameters?.maxTokens ?? 4096,
        top_p: parameters?.topP ?? 0.95,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedMsg = errText;
      try {
        const j = JSON.parse(errText);
        parsedMsg = j.error?.message || j.message || errText;
      } catch {}
      throw new Error(`DeepSeek Error (${response.status}): ${parsedMsg}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || choice?.text || '',
      reasoning: choice?.message?.reasoning_content || choice?.message?.reasoning || choice?.message?.thought,
      model: data.model || targetModel,
      provider: 'deepseek',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  // 10. Custom or Added API (OpenAI-compatible, OpenRouter, DeepSeek, Ollama, etc.)
  if (provider === 'custom') {
    let endpoint = baseUrl?.trim();
    if (!endpoint) {
      if (model.includes('/')) {
        endpoint = 'https://openrouter.ai/api/v1';
      } else if (model.toLowerCase().startsWith('deepseek')) {
        endpoint = 'https://api.deepseek.com/v1';
      } else {
        endpoint = 'https://openrouter.ai/api/v1';
      }
    }
    const targetModel = model || 'deepseek/deepseek-v4-flash';

    const formattedMessages = [
      { role: 'system', content: sysPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://agentpro.aistudio.build',
      'X-Title': 'Agent Pro',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    let cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
    if (cleanEndpoint === 'https://openrouter.ai') cleanEndpoint = 'https://openrouter.ai/api/v1';
    if (cleanEndpoint === 'https://api.deepseek.com') cleanEndpoint = 'https://api.deepseek.com/v1';
    const fullUrl = cleanEndpoint.endsWith('/chat/completions')
      ? cleanEndpoint
      : `${cleanEndpoint}/chat/completions`;

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: targetModel,
        messages: formattedMessages,
        temperature: parameters?.temperature ?? 0.7,
        max_tokens: parameters?.maxTokens ?? 4096,
        top_p: parameters?.topP ?? 0.95,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsedMsg = errText;
      try {
        const j = JSON.parse(errText);
        parsedMsg = j.error?.message || j.message || errText;
      } catch {}
      throw new Error(`API Error (${response.status}): ${parsedMsg}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content || choice?.text || '';
    const reasoning = choice?.message?.reasoning || choice?.message?.thought;

    return {
      content: text,
      reasoning: reasoning || undefined,
      model: data.model || targetModel,
      provider: 'custom',
      tokensUsed: data.usage?.total_tokens,
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export async function handleChatStreamRequest(
  body: ChatRequestBody,
  onChunk: (chunk: StreamChunkPayload) => void,
  signal?: AbortSignal
): Promise<void> {
  const { provider, model, messages, apiKey, baseUrl: rawBaseUrl, parameters, images } = body;
  // Repair common base URL typos (e.g. "ttps://..." -> "https://...") before any fetch.
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const sysPrompt = parameters?.systemPrompt || 'You are Agent Pro, an advanced and helpful AI assistant.';

  // 1. Google Gemini streaming
  if (provider === 'gemini') {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        'Gemini API key is required. Please add your key in Models -> Configure API, or set GEMINI_API_KEY in environment.'
      );
    }
    const ai = new GoogleGenAI({ apiKey: key });

    const contents: any[] = [];
    for (const msg of messages) {
      const textVal = msg.content || (images && images.length > 0 ? 'Analyze the attached file/image.' : ' ');
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: textVal }],
      });
    }

    if (images && images.length > 0 && contents.length > 0) {
      const lastUserIdx = contents.length - 1;
      for (const img of images) {
        const base64Data = img.replace(/^data:image\/\w+;base64,/, '');
        const mimeMatch = img.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        contents[lastUserIdx].parts.push({
          inlineData: {
            mimeType,
            data: base64Data,
          },
        });
      }
    }

    const candidateModels = getGeminiCandidateModels(model || 'gemini-2.5-flash');
    const instantMode = body.instantMode !== false; // Gemini defaults to Instant Mode
    let lastError: any = null;
    let streamStarted = false;

    for (let i = 0; i < candidateModels.length; i++) {
      const activeModel = candidateModels[i];
      // The RIGHT thinking config for THIS model, tried in order. A rejected
      // config retries the SAME model — it must never cascade to a worse one.
      const ladder = buildGeminiConfigLadder(activeModel, {
        instantMode,
        temperature: parameters?.temperature ?? 0.7,
        maxOutputTokens: parameters?.maxTokens ?? 4096,
        topP: parameters?.topP ?? 0.95,
        sysPrompt,
      });

      try {
        let responseStream: any = null;
        let usedLabel = '';
        let ladderError: any = null;

        for (let c = 0; c < ladder.length; c++) {
          const rung = ladder[c];
          try {
            responseStream = await ai.models.generateContentStream({
              model: activeModel,
              contents: contents.length > 0 ? contents : 'Hello',
              config: rung.config as any,
            });
            usedLabel = rung.label;
            ladderError = null;
            break;
          } catch (cfgErr: any) {
            ladderError = cfgErr;
            if (signal?.aborted) throw cfgErr;
            // Only a *config* rejection walks the ladder; anything else
            // (auth, quota, 404…) is handled by the outer model loop.
            if (!isGeminiParamRejection(cfgErr) || c === ladder.length - 1) {
              throw cfgErr;
            }
            console.warn(
              `Gemini ${activeModel} rejected "${rung.label}" (${String(cfgErr?.message || cfgErr).slice(0, 60)}), retrying same model with "${ladder[c + 1].label}"…`
            );
            // Tell the user why there was a brief pause instead of leaving them
            // staring at a spinner with no explanation.
            onChunk({
              status: `កំពុងព្យាយាមម្ដងទៀតជាមួយ ${activeModel} (retrying with adjusted parameters)…`,
              model: activeModel,
            });
          }
        }

        if (!responseStream) throw ladderError || new Error('No stream returned');

        for await (const chunk of responseStream) {
          if (signal?.aborted) break;
          // `chunk.text` is undefined for thought-only chunks — splitting the
          // parts is what lets the thinking phase stream as visible progress.
          const { content, reasoning } = splitGeminiChunk(chunk);
          if (content || reasoning) {
            streamStarted = true;
            onChunk({ content, reasoning, model: activeModel });
          }
        }
        return;
      } catch (err: any) {
        if (signal?.aborted) throw err;
        lastError = err;
        const errMsg = err?.message || String(err);
        const isTemporary =
          errMsg.includes('503') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('high demand') ||
          errMsg.includes('404') ||
          errMsg.includes('not found') ||
          errMsg.includes('invalid argument') ||
          errMsg.includes('INVALID_ARGUMENT') ||
          errMsg.includes('400');

        // If we already started streaming bytes to the client, we cannot silently switch model mid-stream
        if (streamStarted) {
          throw new Error(parseApiErrorMessage(err));
        }

        // If temporary or parameter error, retry with next candidate model
        if (isTemporary && i < candidateModels.length - 1) {
          console.warn(`Gemini model ${activeModel} unavailable or rejected (${errMsg.slice(0, 50)}), switching to fallback ${candidateModels[i + 1]}...`);
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }

        throw new Error(parseApiErrorMessage(err));
      }
    }

    throw new Error(parseApiErrorMessage(lastError));
  }

  // 2. OpenAI-compatible endpoints: custom, openrouter, xkiro, nvidia, huggingface, openai, grok, kimi, deepseek
  let endpoint = baseUrl?.trim();
  let defaultModel = model;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://agentpro.aistudio.build',
    'X-Title': 'Agent Pro',
  };

  if (provider === 'custom') {
    if (!endpoint) {
      if (model.includes('/')) {
        endpoint = 'https://openrouter.ai/api/v1';
      } else if (model.toLowerCase().startsWith('deepseek')) {
        endpoint = 'https://api.deepseek.com/v1';
      } else {
        endpoint = 'https://openrouter.ai/api/v1';
      }
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    defaultModel = model || 'deepseek/deepseek-v4-flash';
  } else if (provider === 'openai') {
    endpoint = baseUrl || 'https://api.openai.com/v1';
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (key) headers.Authorization = `Bearer ${key.trim()}`;
    defaultModel = model || 'gpt-4o';
  } else if (provider === 'grok') {
    endpoint = baseUrl || 'https://api.x.ai/v1';
    const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;
    if (key) headers.Authorization = `Bearer ${key.trim()}`;
    defaultModel = model || 'grok-2-1212';
  } else if (provider === 'kimi') {
    endpoint = baseUrl || 'https://api.moonshot.cn/v1';
    const key = apiKey || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || process.env.XKIRO_API_KEY;
    if (key) headers.Authorization = `Bearer ${key.trim()}`;
    defaultModel = model || 'moonshot-v1-8k';
  } else if (provider === 'deepseek') {
    endpoint = baseUrl || 'https://api.deepseek.com/v1';
    const key = apiKey || process.env.DEEPSEEK_API_KEY;
    if (key) headers.Authorization = `Bearer ${key.trim()}`;
    defaultModel = model || 'deepseek-chat';
  } else if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1';
    const key = apiKey || process.env.OPENROUTER_API_KEY;
    if (key) headers.Authorization = `Bearer ${key.trim()}`;
    defaultModel = model || 'deepseek/deepseek-r1:free';
  } else if (provider === 'xkiro') {
    endpoint = baseUrl || 'https://api.moonshot.cn/v1';
    const key = apiKey || process.env.XKIRO_API_KEY || process.env.MOONSHOT_API_KEY;
    if (key) headers.Authorization = `Bearer ${key.trim()}`;
    defaultModel = model || 'kimi-2.6';
  } else if (provider === 'nvidia') {
    endpoint = 'https://integrate.api.nvidia.com/v1';
    const key = apiKey || process.env.NVIDIA_API_KEY;
    if (key) headers.Authorization = `Bearer ${key.trim()}`;
    defaultModel = model || 'meta/llama-3.3-70b-instruct';
  } else if (provider === 'huggingface') {
    endpoint = 'https://router.huggingface.co/hf-inference/v1';
    const key = apiKey || process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
    if (key) headers.Authorization = `Bearer ${key.trim()}`;
    defaultModel = model || 'meta-llama/Llama-3.2-3B-Instruct';
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const formattedMessages: any[] = [{ role: 'system', content: sysPrompt }];
  messages.forEach((m, idx) => {
    if (idx === messages.length - 1 && m.role === 'user' && images && images.length > 0) {
      formattedMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content || ' ' },
          ...images.map((img) => ({
            type: 'image_url',
            image_url: { url: img },
          })),
        ],
      });
    } else {
      formattedMessages.push({ role: m.role, content: m.content });
    }
  });

  let cleanEndpoint = (endpoint || '').trim().replace(/\/+$/, '');
  if (cleanEndpoint === 'https://openrouter.ai') cleanEndpoint = 'https://openrouter.ai/api/v1';
  if (cleanEndpoint === 'https://api.deepseek.com') cleanEndpoint = 'https://api.deepseek.com/v1';
  const fullUrl = cleanEndpoint.endsWith('/chat/completions')
    ? cleanEndpoint
    : `${cleanEndpoint}/chat/completions`;

  const upstreamResponse = await fetch(fullUrl, {
    method: 'POST',
    headers,
    // Forwarding the abort signal is what makes "Stop response" (បញ្ឈប់ការឆ្លើយតប)
    // cancel the upstream generation immediately instead of letting it run to
    // completion in the background.
    signal,
    body: JSON.stringify({
      model: defaultModel,
      messages: formattedMessages,
      temperature: parameters?.temperature ?? 0.7,
      max_tokens: parameters?.maxTokens ?? 4096,
      top_p: parameters?.topP ?? 0.95,
      stream: true,
    }),
  });

  if (!upstreamResponse.ok) {
    const errText = await upstreamResponse.text();
    let parsedMsg = errText;
    try {
      const j = JSON.parse(errText);
      parsedMsg = j.error?.message || j.message || errText;
    } catch {}
    throw new ChatStreamUnsupportedError(`API Error (${upstreamResponse.status}): ${parsedMsg}`);
  }

  if (!upstreamResponse.body) {
    throw new ChatStreamUnsupportedError('No response stream received from upstream API.');
  }

  // Some OpenAI-compatible endpoints silently ignore `stream: true` and reply
  // with one JSON object. Detect that from the first bytes so the answer is
  // still delivered (with a status note) instead of an empty bubble stuck on
  // "is generating response…".
  const contentType = (upstreamResponse.headers.get('content-type') || '').toLowerCase();
  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder('utf-8');

  const first = await reader.read();
  if (first.done) {
    onChunk({
      status: 'ម៉ូដែលបានបិទការឆ្លើយតបដោយគ្មានអត្ថបទ (the upstream closed the stream without sending any text).',
      model: defaultModel,
    });
    return;
  }
  let buffer = decoder.decode(first.value, { stream: true });
  const looksLikeSse =
    contentType.includes('text/event-stream') ||
    contentType.includes('stream') ||
    /^\s*(:|data:|event:)/.test(buffer);

  if (!looksLikeSse) {
    // Non-streaming JSON answer: read it fully, then deliver it as one block.
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    buffer += decoder.decode();

    let text = '';
    let reasoning = '';
    let usedModel = defaultModel;
    try {
      const parsed = JSON.parse(buffer);
      const choice = parsed.choices?.[0];
      text = choice?.message?.content || choice?.text || parsed.content || '';
      reasoning =
        choice?.message?.reasoning_content ||
        choice?.message?.reasoning ||
        choice?.message?.thought ||
        '';
      usedModel = parsed.model || defaultModel;
    } catch {
      text = buffer;
    }

    if (text || reasoning) onChunk({ content: text, reasoning, model: usedModel });
    onChunk({
      status:
        'ចំណាំ៖ ម៉ូដែលនេះមិនបានបើកការ streaming ទេ ដូច្នេះចម្លើយត្រូវបានបង្ហាញជាប្លុកតែមួយ (this endpoint did not honour streaming, so the answer arrived as a single block).',
      model: usedModel,
    });
    return;
  }

  /** Parse one SSE `data:` line and forward any delta to the client. */
  const feedLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    if (!trimmed.startsWith('data:')) return;
    const dataStr = trimmed.replace(/^data:\s*/, '');
    if (dataStr === '[DONE]') return;
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.error) {
        throw new UpstreamStreamError(
          typeof parsed.error === 'string' ? parsed.error : parsed.error?.message || 'Upstream stream error'
        );
      }
      const choice = parsed.choices?.[0];
      const delta = choice?.delta;
      const content = delta?.content || '';
      const reasoning = delta?.reasoning_content || delta?.reasoning || delta?.thought || '';
      if (content || reasoning) {
        onChunk({ content, reasoning, model: parsed.model || defaultModel });
      }
    } catch (e: any) {
      // Ignore partial JSON, but never swallow a real upstream error.
      if (e instanceof UpstreamStreamError) throw e;
    }
  };

  // Cancelling the reader is what actually stops the upstream read the moment
  // the user presses Stop — `signal.aborted` alone would only notice on the
  // next chunk, which can be seconds away on a slow model.
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) feedLine(line);
    }

    // Flush a final frame that arrived without a trailing newline.
    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) feedLine(line);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function handleFetchModels(
  provider: ProviderType,
  apiKey?: string,
  baseUrl?: string
): Promise<ModelInfo[]> {
  // Repair common base URL typos (e.g. "ttps://..." -> "https://...") before any fetch.
  const safeBaseUrl = normalizeBaseUrl(baseUrl);

  // 1. xKiro (Moonshot / Kimi AI) live models
  if (provider === 'xkiro' || provider === 'kimi') {
    const key = apiKey || process.env.XKIRO_API_KEY || process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY;
    const endpoint = safeBaseUrl || 'https://api.moonshot.cn/v1';

    if (!key || !key.trim()) {
      return [];
    }

    try {
      const modelsUrl = `${endpoint.replace(/\/+$/, '')}/models`;
      const res = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key.trim()}`,
          'Content-Type': 'application/json',
        },
      });

      if (res.ok) {
        const json = await res.json();
        const dataList = json.data || json.models || (Array.isArray(json) ? json : []);

        return dataList.map((m: any) => {
          const rawId: string = m.id || m.name || 'kimi-latest';
          let contextLength = 128000;
          if (rawId.includes('8k')) contextLength = 8192;
          else if (rawId.includes('32k')) contextLength = 32768;
          else if (rawId.includes('128k')) contextLength = 131072;
          else if (rawId.includes('256k') || rawId.includes('2.6')) contextLength = 262144;

          const isReasoning =
            rawId.includes('k1.5') ||
            rawId.includes('r1') ||
            rawId.includes('reason') ||
            rawId.includes('thinking');

          let displayName = rawId;
          if (rawId.startsWith('moonshot-')) {
            displayName = `Moonshot ${rawId.replace('moonshot-', '').toUpperCase()}`;
          } else if (rawId.startsWith('kimi-')) {
            displayName = `Kimi ${rawId.replace('kimi-', '').toUpperCase()}`;
          }

          return {
            id: `${provider}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            name: displayName,
            provider,
            description: `Official ${provider} model: ${rawId}. Free tier access with ${Math.round(
              contextLength / 1024
            )}k context window.`,
            contextLength,
            isFree: true,
            category: (isReasoning ? 'reasoning' : 'general') as any,
            providerModelId: rawId,
            pricingDescription: `${provider} Access`,
            tags: [provider, isReasoning ? 'Reasoning' : 'Chat'],
            isUserSaved: true,
          };
        });
      }
    } catch {}
    return [];
  }

  // 2. OpenRouter live models (free models only)
  if (provider === 'openrouter') {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      if (res.ok) {
        const json = await res.json();
        const list: ModelInfo[] = [];

        for (const item of json.data || []) {
          const isFree =
            item.id.endsWith(':free') ||
            (item.pricing?.prompt === '0' && item.pricing?.completion === '0');

          if (!isFree) continue;

          list.push({
            id: `openrouter-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            name: item.name || item.id,
            provider: 'openrouter',
            description: item.description || `Context: ${item.context_length || 'unknown'} tokens`,
            contextLength: item.context_length || 32768,
            isFree: true,
            category: item.id.includes('vision')
              ? 'vision'
              : item.id.includes('code')
              ? 'code'
              : item.id.includes('r1') || item.id.includes('reason')
              ? 'reasoning'
              : 'general',
            providerModelId: item.id,
            pricingDescription: '100% Free (:free tier)',
            tags: [
              'Free',
              item.id.split('/')[0],
              `${Math.round((item.context_length || 32000) / 1024)}k Context`,
            ],
            isUserSaved: true,
          });
        }

        return list;
      }
    } catch {}
    return [];
  }

  // 3. Gemini live models
  if (provider === 'gemini') {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      return [];
    }
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key.trim()}`
      );
      if (res.ok) {
        const json = await res.json();
        return (json.models || [])
          .filter(
            (m: any) =>
              m.name.includes('gemini') &&
              m.supportedGenerationMethods?.includes('generateContent') &&
              !m.name.includes('vision')
          )
          .map((m: any) => {
            const cleanId = m.name.replace('models/', '');
            return {
              id: `gemini-${cleanId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
              name: m.displayName || cleanId,
              provider: 'gemini' as ProviderType,
              description: m.description || 'Google DeepMind multimodal reasoning model',
              contextLength: m.inputTokenLimit || 1048576,
              isFree: true,
              category: 'general' as const,
              providerModelId: cleanId,
              pricingDescription: 'Google AI Studio Tier',
              tags: ['Gemini', 'Google AI'],
              isUserSaved: true,
            };
          });
      }
    } catch {}
    return [];
  }

  // 4. OpenAI live models
  if (provider === 'openai') {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (key) {
      try {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key.trim()}` },
        });
        if (res.ok) {
          const json = await res.json();
          const chatModels = (json.data || []).filter((m: any) =>
            m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('chatgpt-')
          );
          return chatModels.map((m: any) => ({
            id: `openai-${m.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            name: m.id.toUpperCase(),
            provider: 'openai' as ProviderType,
            description: `Official OpenAI model: ${m.id}`,
            contextLength: 128000,
            isFree: false,
            category: (m.id.startsWith('o1') || m.id.startsWith('o3') ? 'reasoning' : 'general') as any,
            providerModelId: m.id,
            pricingDescription: 'OpenAI API Token Billing',
            tags: ['OpenAI', m.id],
            isUserSaved: true,
          }));
        }
      } catch {}
    }
  }

  // 5. DeepSeek live models
  if (provider === 'deepseek') {
    const key = apiKey || process.env.DEEPSEEK_API_KEY;
    if (key) {
      try {
        const res = await fetch('https://api.deepseek.com/v1/models', {
          headers: { Authorization: `Bearer ${key.trim()}` },
        });
        if (res.ok) {
          const json = await res.json();
          return (json.data || []).map((m: any) => ({
            id: `deepseek-${m.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            name: m.id.toUpperCase(),
            provider: 'deepseek' as ProviderType,
            description: `DeepSeek official model: ${m.id}`,
            contextLength: 65536,
            isFree: false,
            category: (m.id.includes('reason') || m.id.includes('r1') ? 'reasoning' : 'general') as any,
            providerModelId: m.id,
            pricingDescription: 'DeepSeek Official API',
            tags: ['DeepSeek', 'Official'],
            isUserSaved: true,
          }));
        }
      } catch {}
    }
  }

  // 6. Grok (xAI) live models
  if (provider === 'grok') {
    const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;
    if (key) {
      try {
        const res = await fetch('https://api.x.ai/v1/models', {
          headers: { Authorization: `Bearer ${key.trim()}` },
        });
        if (res.ok) {
          const json = await res.json();
          return (json.data || []).map((m: any) => ({
            id: `grok-${m.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            name: m.id.toUpperCase(),
            provider: 'grok' as ProviderType,
            description: `xAI Grok model: ${m.id}`,
            contextLength: 131072,
            isFree: false,
            category: (m.id.includes('vision') ? 'vision' : 'general') as any,
            providerModelId: m.id,
            pricingDescription: 'xAI Console API',
            tags: ['xAI', 'Grok'],
            isUserSaved: true,
          }));
        }
      } catch {}
    }
  }

  // 7. NVIDIA NIM live models
  if (provider === 'nvidia' && apiKey) {
    try {
      const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (res.ok) {
        const json = await res.json();
        return (json.data || []).map((m: any) => ({
          id: `nvidia-${m.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
          name: m.id.split('/').pop()?.toUpperCase() || m.id,
          provider: 'nvidia' as ProviderType,
          description: `NVIDIA NIM accelerated model: ${m.id}`,
          contextLength: 131072,
          isFree: true,
          category: (m.id.includes('r1') || m.id.includes('nemotron') ? 'reasoning' : 'general') as any,
          providerModelId: m.id,
          pricingDescription: 'NVIDIA Free Developer Credits',
          tags: ['NVIDIA NIM', 'GPU Speed', 'Free Credits'],
        }));
      }
    } catch {}
  }

  // 8. Hugging Face live models
  if (provider === 'huggingface') {
    try {
      const res = await fetch(
        'https://huggingface.co/api/models?pipeline_tag=text-generation&sort=trending&direction=-1&limit=25'
      );
      if (res.ok) {
        const json = await res.json();
        return json.map((m: any) => ({
          id: `hf-${m.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
          name: m.id.split('/').pop() || m.id,
          provider: 'huggingface' as ProviderType,
          description: `Hugging Face model: ${m.id}. Downloads: ${m.downloads?.toLocaleString() || 0}`,
          contextLength: 32768,
          isFree: true,
          category: (m.id.includes('R1') || m.id.includes('Reason') ? 'reasoning' : 'general') as any,
          providerModelId: m.id,
          pricingDescription: 'Serverless Inference Free Rate Limits',
          tags: ['Hugging Face', 'Trending', 'Free Inference'],
        }));
      }
    } catch {}
  }

  // 9. Custom endpoint live models
  if (provider === 'custom' && safeBaseUrl) {
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey.trim()}`;
      const res = await fetch(`${safeBaseUrl.replace(/\/+$/, '')}/models`, { headers });
      if (res.ok) {
        const json = await res.json();
        return (json.data || []).map((m: any) => ({
          id: `custom-${m.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
          name: m.id,
          provider: 'custom' as ProviderType,
          description: `Custom model from ${safeBaseUrl}`,
          contextLength: 32768,
          isFree: true,
          category: 'general' as const,
          providerModelId: m.id,
          pricingDescription: 'Local / Custom Endpoint',
          tags: ['Custom', 'Self-Hosted'],
        }));
      }
    } catch {}
  }

  return [];
}
