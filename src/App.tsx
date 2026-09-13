/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import {
  AppSettings,
  AttachedFile,
  ChatMessage,
  Conversation,
  ModelInfo,
  ModelParameters,
  NavTab,
  ProviderConfig,
  ProviderType,
} from './types';
import {
  DEFAULT_SETTINGS,
  clearAllSavedModels,
  loadActiveModelId,
  loadConversations,
  loadCurrentConvId,
  loadModels,
  loadProviders,
  loadSavedModelIds,
  loadSettings,
  saveActiveModelId,
  saveConversations,
  saveCurrentConvId,
  saveModels,
  saveProviders,
  saveSavedModelIds,
  saveSettings,
} from './services/storage';
import {
  ChatStreamFailedError,
  sendChatMessage,
  sendChatMessageStream,
  type ChatApiResponse,
  type StreamChunk,
} from './services/apiClient';
import { createStreamPainter, type StreamPainter } from './services/streamPainter';
import { normalizeBaseUrl } from './utils/url';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { ModelsView } from './components/ModelsView';
import { SettingsView } from './components/SettingsView';
import { TasksView } from './components/TasksView';
import { HistoryDrawer } from './components/HistoryDrawer';
import { SaveModelModal } from './components/SaveModelModal';
import { ModelSelectionModal } from './components/ModelSelectionModal';

/**
 * គ្រប់ចម្លើយត្រូវតែជាភាសាខ្មែរ — every AI reply must ALWAYS be in Khmer,
 * appended to the system prompt on every request regardless of preset.
 */
const KHMER_LANGUAGE_RULE =
  'IMPORTANT LANGUAGE RULE: You must ALWAYS respond in Khmer (ភាសាខ្មែរ) in every single reply, even if the user writes in English or another language.';

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<NavTab>('chat');

  // App State
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>(() =>
    loadProviders()
  );
  const [models, setModels] = useState<ModelInfo[]>(() => loadModels());
  const [savedModelIds, setSavedModelIds] = useState<string[]>(() => loadSavedModelIds());
  const [activeModelId, setActiveModelId] = useState<string>(() => loadActiveModelId());
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadConversations()
  );
  const [currentConvId, setCurrentConvId] = useState<string>(() => {
    const saved = loadCurrentConvId();
    const convs = loadConversations();
    if (saved && convs.some((c) => c.id === saved)) return saved;
    return convs[0]?.id || 'conv-default';
  });

  // UI state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Abort controller for the in-flight chat request so the user can press
  // "Stop response" (បញ្ឈប់ការឆ្លើយតប) while the model is working.
  const abortControllerRef = useRef<AbortController | null>(null);

  // Save Model Modal State
  const [isSaveModelModalOpen, setIsSaveModelModalOpen] = useState(false);
  const [saveModelPrefill, setSaveModelPrefill] = useState<{
    name?: string;
    apiProvider?: ProviderType;
    modelId?: string;
  }>({});

  // Model Selection Modal State (Live API Discovery Workflow)
  const [isModelSelectionModalOpen, setIsModelSelectionModalOpen] = useState(false);
  const [modelSelectionInitialProvider, setModelSelectionInitialProvider] = useState<ProviderType>('xkiro');
  const [savedToastMsg, setSavedToastMsg] = useState<string | null>(null);

  // Sync to localStorage
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveProviders(providers);
  }, [providers]);

  useEffect(() => {
    saveModels(models);
  }, [models]);

  useEffect(() => {
    saveActiveModelId(activeModelId);
  }, [activeModelId]);

  useEffect(() => {
    saveSavedModelIds(savedModelIds);
  }, [savedModelIds]);

  // Persist conversations with a short debounce: while streaming, the
  // conversations array changes every frame, and JSON.stringify-ing the
  // entire history to localStorage on each change stalls the mobile UI.
  // pagehide forces a final flush so nothing is lost if the tab closes early.
  useEffect(() => {
    const t = window.setTimeout(() => saveConversations(conversations), 500);
    const flush = () => saveConversations(conversations);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pagehide', flush);
    };
  }, [conversations]);

  useEffect(() => {
    saveCurrentConvId(currentConvId);
  }, [currentConvId]);

  // Current active model and provider - never hardcode Kimi or Gemini as unselected default
  const activeModel: ModelInfo = useMemo(() => {
    const found = models.find((m) => m.id === activeModelId);
    if (found) return found;
    if (models.length > 0) return models[0];
    return {
      id: 'unselected',
      name: 'No Model Added',
      provider: 'custom',
      description: 'Add your model (Name, url, Api, Model) and click "Used model" to chat.',
      contextLength: 0,
      isFree: true,
      category: 'general',
      providerModelId: '',
      tags: ['No Model'],
    };
  }, [models, activeModelId]);

  const activeProviderConfig = useMemo(() => {
    const baseConfig =
      providers[activeModel.provider] ||
      providers.custom ||
      Object.values(providers)[0];

    return {
      ...baseConfig,
      apiKey: activeModel.customApiKey || baseConfig?.apiKey || '',
      baseUrl: activeModel.customBaseUrl || baseConfig?.baseUrl || '',
    };
  }, [providers, activeModel]);

  // Instant Mode: Gemini is always instant; the Settings → Model Parameters
  // "All Models (Instant Mode)" switch (or the legacy `stream: false` flag)
  // extends Instant Mode to every other model.
  //
  // Instant Mode STILL STREAMS: the reply is generated directly (zero thinking
  // lag) but it is displayed progressively from the first token to the last —
  // never buffered until the whole generation finishes, which wasted a lot of
  // waiting time on long documents / long texts.
  const isInstantMode = useMemo(
    () =>
      activeModel.provider === 'gemini' ||
      settings.parameters.instantMode ||
      !settings.parameters.stream,
    [
      activeModel.provider,
      settings.parameters.instantMode,
      settings.parameters.stream,
    ]
  );

  // Stop the in-flight response (បញ្ឈប់ការឆ្លើយតប)
  const handleStopResponse = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Open Model Selection Modal (Dynamic Discovery)
  const handleOpenModelSelectionModal = (provider: ProviderType = 'custom') => {
    setModelSelectionInitialProvider(provider);
    setIsModelSelectionModalOpen(true);
  };

  // Handle Live Model Selection & Activation
  const handleSelectAndActivateModel = (
    model: ModelInfo,
    apiKey?: string,
    baseUrl?: string
  ) => {
    // 1. Add / update models list
    setModels((prev) => {
      const filtered = prev.filter((m) => m.id !== model.id);
      return [{ ...model, isUserSaved: true }, ...filtered];
    });

    // 2. Track in saved model IDs
    setSavedModelIds((prev) => {
      const next = Array.from(new Set([model.id, ...prev]));
      saveSavedModelIds(next);
      return next;
    });

    // 3. Update provider if API key or base URL was provided
    if (apiKey || baseUrl) {
      setProviders((prev) => {
        const curr = prev[model.provider];
        if (!curr) return prev;
        return {
          ...prev,
          [model.provider]: {
            ...curr,
            apiKey: apiKey ? apiKey.trim() : curr.apiKey,
            baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : curr.baseUrl,
            isConfigured: Boolean(apiKey?.trim() || curr.apiKey?.trim()),
          },
        };
      });
    }

    // 4. Immediately switch active model to selected model!
    setActiveModelId(model.id);

    // 5. Toast
    setSavedToastMsg(`Model "${model.name}" is now Active!`);
    setTimeout(() => setSavedToastMsg(null), 3500);
  };

  // Handle Clear All Models (Fresh Workflow)
  const handleClearAllModels = () => {
    clearAllSavedModels();
    setModels([]);
    setSavedModelIds([]);
    setActiveModelId('');
    setSavedToastMsg('All models cleared. Ready for new workflow.');
    setTimeout(() => setSavedToastMsg(null), 3500);
  };

  // Handle Delete Single Model
  const handleDeleteModel = (modelId: string) => {
    setModels((prev) => prev.filter((m) => m.id !== modelId));
    setSavedModelIds((prev) => prev.filter((id) => id !== modelId));
    if (activeModelId === modelId) {
      setActiveModelId('');
    }
  };

  // Update Provider Key directly
  const handleUpdateProviderKey = (
    provider: ProviderType,
    apiKey: string,
    baseUrl?: string
  ) => {
    setProviders((prev) => {
      const curr = prev[provider];
      if (!curr) return prev;
      return {
        ...prev,
        [provider]: {
          ...curr,
          apiKey: apiKey.trim(),
          baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : curr.baseUrl,
          isConfigured: apiKey.trim().length > 0,
        },
      };
    });
  };

  // Open Save Model Modal
  const handleOpenSaveModelModal = (prefill?: {
    name?: string;
    apiProvider?: ProviderType;
    modelId?: string;
  }) => {
    setSaveModelPrefill(prefill || {});
    setIsSaveModelModalOpen(true);
  };

  // Handle Model Save (Name, Api, Model)
  const handleSaveModel = (data: {
    name: string;
    apiProvider: ProviderType;
    apiKey: string;
    baseUrl?: string;
    modelId: string;
    contextLength?: number;
  }) => {
    const newModelId = `${data.apiProvider}-${data.modelId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const savedModel: ModelInfo = {
      id: newModelId,
      name: data.name,
      provider: data.apiProvider,
      description: `User-saved model on ${data.apiProvider.toUpperCase()} (${data.modelId})`,
      contextLength: data.contextLength || 128000,
      isFree: data.apiProvider === 'xkiro' || data.modelId.includes('free'),
      category: 'general',
      providerModelId: data.modelId,
      tags: ['Custom', data.apiProvider.toUpperCase(), 'Saved'],
      isUserSaved: true,
      customApiKey: data.apiKey,
      customBaseUrl: data.baseUrl ? normalizeBaseUrl(data.baseUrl) : undefined,
    };

    // 1. Update models state (insert at top or update if existing)
    setModels((prev) => {
      const exists = prev.some((m) => m.id === savedModel.id);
      if (exists) {
        return prev.map((m) => (m.id === savedModel.id ? savedModel : m));
      }
      return [savedModel, ...prev];
    });

    // 2. Track in saved model IDs
    setSavedModelIds((prev) => {
      const next = Array.from(new Set([savedModel.id, ...prev]));
      saveSavedModelIds(next);
      return next;
    });

    // 3. If an API key was provided for this provider, update provider configuration
    if (data.apiKey) {
      setProviders((prev) => {
        const current = prev[data.apiProvider];
        if (!current) return prev;
        return {
          ...prev,
          [data.apiProvider]: {
            ...current,
            apiKey: data.apiKey || current.apiKey,
            baseUrl: data.baseUrl ? normalizeBaseUrl(data.baseUrl) : current.baseUrl,
            isConfigured: true,
          },
        };
      });
    }

    // 4. Immediately switch active model to the newly saved model!
    setActiveModelId(savedModel.id);

    // 5. Display success confirmation toast
    setSavedToastMsg(`Model "${savedModel.name}" saved and set as Active Model!`);
    setTimeout(() => {
      setSavedToastMsg(null);
    }, 4500);
  };

  // Current conversation
  const currentConversation = useMemo(() => {
    const found = conversations.find((c) => c.id === currentConvId);
    if (found) return found;
    return (
      conversations[0] || {
        id: 'conv-' + Date.now(),
        title: 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        selectedModelId: activeModelId,
      }
    );
  }, [conversations, currentConvId, activeModelId]);

  // Handler: Create new chat
  const handleNewChat = () => {
    const newConv: Conversation = {
      id: 'conv-' + Date.now(),
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      selectedModelId: activeModelId,
    };
    setConversations((prev) => [newConv, ...prev]);
    setCurrentConvId(newConv.id);
    setActiveTab('chat');
  };

  // Handler: Delete conversation
  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const fresh: Conversation = {
          id: 'conv-' + Date.now(),
          title: 'New Chat',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          selectedModelId: activeModelId,
        };
        setCurrentConvId(fresh.id);
        return [fresh];
      }
      if (currentConvId === id) {
        setCurrentConvId(next[0].id);
      }
      return next;
    });
  };

  // Handler: Send chat message
  const handleSendMessage = async (
    text: string,
    images?: string[],
    attachments?: AttachedFile[]
  ) => {
    if (
      !text.trim() &&
      (!images || images.length === 0) &&
      (!attachments || attachments.length === 0)
    )
      return;

    // Check if a model is selected
    if (activeModel.id === 'unselected' || !activeModel.providerModelId) {
      handleOpenModelSelectionModal('xkiro');
      setSavedToastMsg('Please enter your API key and select an active model first.');
      setTimeout(() => setSavedToastMsg(null), 3500);
      return;
    }

    const userMsgId = 'msg-' + Date.now();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: text,
      imageUrls: images,
      attachments: attachments,
      timestamp: Date.now(),
    };

    // Auto update conversation title on first message
    const isFirst = currentConversation.messages.length === 0;
    const titleBase =
      text.trim() || (attachments && attachments[0] ? attachments[0].name : 'Chat with files');
    const newTitle = isFirst
      ? titleBase.slice(0, 32) + (titleBase.length > 32 ? '...' : '')
      : currentConversation.title;

    const useInstantMode = isInstantMode;

    // Allow the user to stop this response while it is working.
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // ត្រឹមត្រូវឆ្លើយតបជាភាសាខ្មែរជានិច្ច — the Khmer language rule is
    // always appended to the system prompt for every request.
    const requestParams: ModelParameters = {
      ...settings.parameters,
      systemPrompt:
        (settings.parameters.systemPrompt.trim()
          ? settings.parameters.systemPrompt.trimEnd() + '\n\n'
          : '') + KHMER_LANGUAGE_RULE,
    };

    const assistantMsgId = 'msg-asst-' + (Date.now() + 1);
    const initialAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      reasoning: '',
      timestamp: Date.now() + 1,
      modelUsed: activeModel.name,
      providerUsed: activeModel.provider,
      // Instant Mode streams too — the reply shows up progressively from the
      // first token (កុំរង់ចាំបង្កើតរួចរាល់ទាំងអស់ទើបបង្ហាញ)។
      status: 'streaming',
    };

    // Append user message AND initial assistant message placeholder immediately
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === currentConvId) {
          return {
            ...c,
            title: newTitle,
            updatedAt: Date.now(),
            messages: [...c.messages, userMsg, initialAssistantMsg],
          };
        }
        return c;
      })
    );

    setIsGenerating(true);

    // Hoisted so the abort handler can keep whatever partial content was
    // already received when the user stops a progressive stream.
    let streamContent = '';
    let streamReasoning = '';
    let streamStatusNote = '';
    let lastChunkModel = '';

    // --- Progressive streaming plumbing (shared by Instant Mode and normal mode) ---
    // Token chunks are committed through the stream painter: the FIRST token
    // paints immediately and every later commit is scheduled with rAF *and* a
    // setTimeout watchdog, so a hidden tab / dimmed phone / off-screen preview
    // iframe (where rAF never fires) can no longer buffer the whole reply and
    // dump it in one jump. Commits are coalesced and throttled as the reply
    // grows, because each one re-parses the whole markdown.
    const commitStreamedContent = () => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === currentConvId) {
            return {
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map((m) => {
                if (m.id === assistantMsgId) {
                  return {
                    ...m,
                    content: streamContent,
                    reasoning: streamReasoning || undefined,
                    statusNote: streamStatusNote || undefined,
                    modelUsed: lastChunkModel || activeModel.name,
                    status: 'streaming',
                  };
                }
                return m;
              }),
            };
          }
          return c;
        })
      );
    };

    const painter: StreamPainter = createStreamPainter({
      onCommit: commitStreamedContent,
      getBufferLength: () => streamContent.length + streamReasoning.length,
    });

    const handleStreamChunk = (chunk: StreamChunk) => {
      if (chunk.content) streamContent += chunk.content;
      if (chunk.reasoning) streamReasoning += chunk.reasoning;
      if (chunk.status) streamStatusNote = chunk.status;
      if (chunk.model) lastChunkModel = chunk.model;
      painter.push();
    };

    // Mark the assistant message complete with the final streamed (or, for the
    // non-stream fallback, direct) content of `response`.
    const finalizeAssistantMessage = (response: ChatApiResponse) => {
      painter.cancel();
      const finalContent = streamContent || response.content || '';
      const finalReasoning = streamReasoning || response.reasoning || '';
      const finalNote = streamStatusNote || response.statusNote || '';

      // An empty generation must never leave the bubble stuck on the spinner:
      // report it as an error so the Retry path is available.
      if (!finalContent.trim() && !finalReasoning.trim()) {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id === currentConvId) {
              return {
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: '',
                        reasoning: undefined,
                        status: 'error',
                        statusNote: finalNote || undefined,
                        errorMsg:
                          'ម៉ូដែលបានវិលត្រឡប់មកវិញដោយគ្មានអត្ថបទទេ (the model returned no text). សូមចុច Retry ឬជ្រើសរើសម៉ូដែលផ្សេង។',
                        modelUsed: response.modelUsed || lastChunkModel || activeModel.name,
                        providerUsed: response.providerUsed || activeModel.provider,
                      }
                    : m
                ),
              };
            }
            return c;
          })
        );
        return;
      }

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === currentConvId) {
            return {
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map((m) => {
                if (m.id === assistantMsgId) {
                  return {
                    ...m,
                    content: finalContent,
                    reasoning: finalReasoning || undefined,
                    statusNote: finalNote || undefined,
                    status: 'complete',
                    modelUsed: response.modelUsed || lastChunkModel || activeModel.name,
                    providerUsed: response.providerUsed || activeModel.provider,
                    tokensUsed: response.tokensUsed,
                  };
                }
                return m;
              }),
            };
          }
          return c;
        })
      );
    };

    try {
      // If code/text/pdf files are attached, include their content in prompt for the model
      let promptText = text;
      if (attachments && attachments.length > 0) {
        const fileSections = attachments
          .filter((f) => f.content && f.type !== 'image')
          .map(
            (f) =>
              `[Attached File: ${f.name} (${f.type}${f.extension ? ` .${f.extension}` : ''}, ${Math.round(f.size / 1024)} KB)]\n\`\`\`${f.extension || ''}\n${f.content}\n\`\`\``
          );
        if (fileSections.length > 0) {
          promptText = `${fileSections.join('\n\n')}\n\n${text || 'Please review, analyze, or explain the attached file(s).'}`;
        }
      }

      // Build conversation context
      const chatHistory = [
        ...currentConversation.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'user' as const, content: promptText },
      ];

      const chatRequest = {
        provider: activeModel.provider,
        modelId: activeModel.id,
        providerModelId: activeModel.providerModelId,
        messages: chatHistory,
        parameters: requestParams,
        images,
        providerConfig: activeProviderConfig,
        // Instant Mode is forwarded to the SERVER so it disables the thinking
        // phase (first token after one round trip) — but the reply still
        // streams progressively from the first token to the last.
        instantMode: useInstantMode,
      };

      // BOTH modes stream progressively from the first token to the last.
      // Instant Mode only differs in that the server answers directly (zero
      // thinking lag); it never waits for the full generation before painting.
      try {
        const response = await sendChatMessageStream(
          chatRequest,
          handleStreamChunk,
          abortController.signal
        );
        finalizeAssistantMessage(response);
      } catch (streamErr: any) {
        const streamAborted =
          abortController.signal.aborted || streamErr?.name === 'AbortError';
        // User stopped, or content already streamed: keep the partial reply and
        // let the outer handler finish — there is nothing to fall back to.
        if (streamAborted || streamContent) {
          throw streamErr;
        }
        // ONLY a transport-level failure (the endpoint could not stream at all)
        // earns a single non-streaming fallback. A genuine model error inside
        // the stream is rethrown so it is reported at once instead of being
        // silently regenerated (the hidden second attempt that doubled latency).
        if (streamErr instanceof ChatStreamFailedError) {
          const response = await sendChatMessage(chatRequest, abortController.signal);
          finalizeAssistantMessage(response);
        } else {
          throw streamErr;
        }
      }
    } catch (err: any) {
      // បញ្ឈប់ការឆ្លើយតប — user pressed Stop while the model was working.
      // Keep any partial content already received and mark the message as
      // stopped instead of showing an error banner.
      const wasAborted =
        abortController.signal.aborted || err?.name === 'AbortError';

      // A still-scheduled painter commit must not overwrite the stopped state.
      painter.cancel();

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === currentConvId) {
            return {
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map((m) => {
                if (m.id === assistantMsgId) {
                  if (wasAborted) {
                    return {
                      ...m,
                      content: streamContent || m.content || '',
                      reasoning: streamReasoning || m.reasoning || undefined,
                      stopped: true,
                      errorMsg: undefined,
                      status: 'complete',
                    };
                  }
                  return {
                    ...m,
                    content: m.content || `Error: Unable to complete request with ${activeModel.name}.`,
                    errorMsg: err?.message || 'Check your provider configuration in the Models tab.',
                    status: 'error',
                  };
                }
                return m;
              }),
            };
          }
          return c;
        })
      );
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleSelectAndChat = (modelId: string) => {
    setActiveModelId(modelId);
    setActiveTab('chat');
  };

  const handleJumpToChatWithPrompt = (prompt: string) => {
    setActiveTab('chat');
    handleSendMessage(prompt);
  };

  // Determine theme styling wrapper
  const themeClass = useMemo(() => {
    switch (settings.theme) {
      case 'dark-slate':
        return 'theme-dark-slate bg-[#0b0f17] text-slate-100';
      case 'midnight-blue':
        return 'theme-midnight bg-[#030712] text-slate-100';
      case 'light':
        return 'theme-light bg-[#f8fafc] text-slate-900';
      case 'dark-emerald':
        return 'theme-dark-emerald bg-[#080c0f] text-slate-100';
      case 'immersive':
      default:
        return 'theme-immersive bg-[#05060f] text-slate-100';
    }
  }, [settings.theme]);

  return (
    <div className={`app-shell flex flex-col md:flex-row w-full overflow-hidden ${themeClass}`}>
      {/* Left Navigation Sidebar matching screenshot */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        modelsCount={models.length}
      />

      {/* Main View Area */}
      <main key={activeTab} className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative isolate">
        {/* Toast confirmation notification */}
        {savedToastMsg && (
          <div className="absolute top-4 left-4 sm:left-auto right-4 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl gradient-card border-violet-400/60 text-violet-100 text-xs font-semibold shadow-[0_0_25px_rgba(139,92,246,0.5)] animate-fade-in">
            <CheckCircle className="h-4 w-4 text-cyan-400 shrink-0" />
            <span>{savedToastMsg}</span>
          </div>
        )}

        {activeTab === 'chat' && (
          <ChatView
            conversation={currentConversation}
            activeModel={activeModel}
            activeProviderConfig={activeProviderConfig}
            allModels={models}
            savedModelIds={savedModelIds}
            onSelectModel={setActiveModelId}
            onSendMessage={handleSendMessage}
            onNewChat={handleNewChat}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onOpenSaveModelModal={handleOpenSaveModelModal}
            onOpenModelSelectionModal={handleOpenModelSelectionModal}
            isGenerating={isGenerating}
            instantMode={isInstantMode}
            onStopResponse={handleStopResponse}
          />
        )}

        {activeTab === 'tasks' && (
          <TasksView
            activeModel={activeModel}
            activeProviderConfig={activeProviderConfig}
            onJumpToChatWithPrompt={handleJumpToChatWithPrompt}
          />
        )}

        {activeTab === 'models' && (
          <ModelsView
            models={models}
            setModels={setModels}
            providers={providers}
            setProviders={setProviders}
            activeModelId={activeModelId}
            setActiveModelId={setActiveModelId}
            onSelectAndChat={handleSelectAndChat}
            savedModelIds={savedModelIds}
            onOpenSaveModelModal={handleOpenSaveModelModal}
            onOpenModelSelectionModal={handleOpenModelSelectionModal}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView settings={settings} setSettings={setSettings} />
        )}
      </main>

      {/* Model Selection Modal (Dynamic Discovery & Free Models) */}
      <ModelSelectionModal
        isOpen={isModelSelectionModalOpen}
        onClose={() => setIsModelSelectionModalOpen(false)}
        providers={providers}
        onUpdateProviderKey={handleUpdateProviderKey}
        onSelectAndActivateModel={handleSelectAndActivateModel}
        savedModels={models.filter((m) => m.isUserSaved || savedModelIds.includes(m.id))}
        activeModelId={activeModelId}
        onDeleteModel={handleDeleteModel}
        onClearAllModels={handleClearAllModels}
        initialProvider={modelSelectionInitialProvider}
      />

      {/* Save Model Modal (Name, Api, Model) */}
      <SaveModelModal
        isOpen={isSaveModelModalOpen}
        onClose={() => setIsSaveModelModalOpen(false)}
        onSaveModel={handleSaveModel}
        providers={providers}
        prefill={saveModelPrefill}
      />

      {/* History Slide-over Drawer */}
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        conversations={conversations}
        currentConvId={currentConvId}
        onSelectConversation={setCurrentConvId}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
      />
    </div>
  );
}
