/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import {
  AppSettings,
  AttachedFile,
  ChatMessage,
  Conversation,
  ModelInfo,
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
import { sendChatMessage, sendChatMessageStream } from './services/apiClient';
import { normalizeBaseUrl } from './utils/url';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { ModelsView } from './components/ModelsView';
import { SettingsView } from './components/SettingsView';
import { TasksView } from './components/TasksView';
import { HistoryDrawer } from './components/HistoryDrawer';
import { SaveModelModal } from './components/SaveModelModal';
import { ModelSelectionModal } from './components/ModelSelectionModal';

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

    const isGemini = activeModel.provider === 'gemini';
    const useInstantMode = isGemini || !settings.parameters.stream;

    const assistantMsgId = 'msg-asst-' + (Date.now() + 1);
    const initialAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      reasoning: '',
      timestamp: Date.now() + 1,
      modelUsed: activeModel.name,
      providerUsed: activeModel.provider,
      status: useInstantMode ? 'sending' : 'streaming',
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

      if (useInstantMode) {
        // Instant Mode: Complete direct generation without progressive streaming delay
        const response = await sendChatMessage({
          provider: activeModel.provider,
          modelId: activeModel.id,
          providerModelId: activeModel.providerModelId,
          messages: chatHistory,
          parameters: settings.parameters,
          images,
          providerConfig: activeProviderConfig,
        });

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
                      content: response.content,
                      reasoning: response.reasoning,
                      status: 'complete',
                      modelUsed: response.modelUsed || activeModel.name,
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
      } else {
        // Progressive streaming for other providers when stream is enabled
        let streamContent = '';
        let streamReasoning = '';
        let lastChunkModel = '';
        let streamRaf = 0;
        let lastStreamFlush = 0;

        // Apply the accumulated stream buffer to state. Token chunks from the
        // SSE reader are coalesced into at most ONE update per animation frame —
        // updating state (and re-parsing markdown, re-scrolling, persisting)
        // for every single token is what made the UI jank and jump on mobile.
        //
        // ADAPTIVE THROTTLE: short replies still update every frame (~60fps) so
        // typing feels instant, but once a reply grows past STREAM_THROTTLE_AFTER
        // chars we cap updates to ~STREAM_MIN_INTERVAL_MS. Re-rendering the whole
        // growing markdown of a long reply on EVERY frame is what made long
        // answers stutter and made the viewport fight the relayout while
        // scrolling — it is purely client-side render cost, not the API/worker.
        const STREAM_MIN_INTERVAL_MS = 40; // ≈25fps cap for long replies
        const STREAM_THROTTLE_AFTER = 4000; // chars before the cap kicks in

        const commitStreamedContent = () => {
          lastStreamFlush = performance.now();
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

        // Coalesce token chunks into a single frame update; for long replies,
        // defer to the next frame until the min interval has elapsed so we never
        // re-render a 20k-char markdown blob more than ~25 times per second.
        const scheduleStreamFlush = () => {
          const elapsed = performance.now() - lastStreamFlush;
          const isLongReply = streamContent.length > STREAM_THROTTLE_AFTER;
          if (!isLongReply || elapsed >= STREAM_MIN_INTERVAL_MS) {
            streamRaf = 0;
            commitStreamedContent();
          } else {
            streamRaf = window.requestAnimationFrame(scheduleStreamFlush);
          }
        };

        const response = await sendChatMessageStream(
          {
            provider: activeModel.provider,
            modelId: activeModel.id,
            providerModelId: activeModel.providerModelId,
            messages: chatHistory,
            parameters: settings.parameters,
            images,
            providerConfig: activeProviderConfig,
          },
          (chunk) => {
            if (chunk.content) streamContent += chunk.content;
            if (chunk.reasoning) streamReasoning += chunk.reasoning;
            if (chunk.model) lastChunkModel = chunk.model;

            if (!streamRaf) {
              streamRaf = window.requestAnimationFrame(scheduleStreamFlush);
            }
          }
        );

        // The final "complete" update below carries the full buffer, so any
        // still-scheduled frame flush is redundant — cancel it.
        if (streamRaf) {
          window.cancelAnimationFrame(streamRaf);
          streamRaf = 0;
        }

        // Mark completed
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
                      content: streamContent || response.content,
                      reasoning: streamReasoning || response.reasoning,
                      status: 'complete',
                      modelUsed: response.modelUsed || activeModel.name,
                      providerUsed: response.providerUsed || activeModel.provider,
                    };
                  }
                  return m;
                }),
              };
            }
            return c;
          })
        );
      }
    } catch (err: any) {
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
