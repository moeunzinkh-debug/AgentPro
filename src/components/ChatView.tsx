import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Eye,
  File,
  FileCode,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Square,
  X,
  Zap,
} from 'lucide-react';
import {
  AttachedFile,
  ChatMessage,
  Conversation,
  ModelInfo,
  ProviderConfig,
  ProviderType,
} from '../types';
import { MarkdownView } from './MarkdownView';

interface ChatViewProps {
  conversation: Conversation;
  activeModel: ModelInfo;
  activeProviderConfig: ProviderConfig;
  allModels: ModelInfo[];
  savedModelIds: string[];
  onSelectModel: (modelId: string) => void;
  onSendMessage: (
    content: string,
    images?: string[],
    attachments?: AttachedFile[]
  ) => Promise<void>;
  onNewChat: () => void;
  onOpenHistory: () => void;
  onOpenSaveModelModal: (prefill?: {
    name?: string;
    apiProvider?: ProviderType;
    modelId?: string;
  }) => void;
  onOpenModelSelectionModal: () => void;
  isGenerating: boolean;
  /** True when the active model answers in Instant Mode (all models or Gemini). */
  instantMode: boolean;
  /** Stop the in-flight response (បញ្ឈប់ការឆ្លើយតប). */
  onStopResponse: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  conversation,
  activeModel,
  activeProviderConfig,
  allModels,
  savedModelIds,
  onSelectModel,
  onSendMessage,
  onNewChat,
  onOpenHistory,
  onOpenSaveModelModal,
  onOpenModelSelectionModal,
  isGenerating,
  instantMode,
  onStopResponse,
}) => {
  const [inputVal, setInputVal] = useState('');
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [viewingFile, setViewingFile] = useState<AttachedFile | null>(null);
  const [copiedFileContent, setCopiedFileContent] = useState(false);

  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});
  const chatViewportRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  // --- Stick-to-bottom streaming scroll ---
  // While the user stays at the bottom we "stick" the viewport to the newest
  // content. The flag lives in a ref (not state) so token-by-token updates
  // never re-trigger scroll effects in a loop.
  const stickToBottomRef = useRef(true);
  // Until this timestamp, scroll events are considered self-inflicted by our
  // own programmatic pin and must not change stick state.
  const programmaticScrollUntilRef = useRef(0);
  const pinFrameRef = useRef(0);
  // True while a wheel/touch scroll gesture is in progress: pins are paused.
  const userInteractingRef = useRef(false);
  const interactEndTimerRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // Close attach options menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    if (showAttachMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAttachMenu]);

  const NEAR_BOTTOM_PX = 120;

  const isNearBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;

  const syncBottomUi = () => {
    const el = chatViewportRef.current;
    if (!el) return;
    const overflows = el.scrollHeight - el.clientHeight > 24;
    setShowScrollBottom(overflows && !isNearBottom(el));
  };

  // Pin the viewport to the bottom. This is the heart of the fix: we used to
  // call scrollIntoView({ behavior: 'smooth' }) on *every* streamed token,
  // which restarted the smooth animation constantly and made the view jump
  // around on mobile. Worse, the mid-animation positions were misread as
  // "user scrolled up", permanently disabling auto-follow so replies ended up
  // cut off below the visible area.
  const pinToBottom = (behavior: ScrollBehavior = 'auto') => {
    const el = chatViewportRef.current;
    if (!el) return;
    programmaticScrollUntilRef.current =
      Date.now() + (behavior === 'smooth' ? 750 : 150);
    if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      // Re-sync the floating button once the animation settles.
      window.setTimeout(syncBottomUi, 820);
    } else {
      el.scrollTop = el.scrollHeight;
      syncBottomUi();
    }
  };

  // Coalesce every pin request into a single write per animation frame.
  const schedulePinToBottom = () => {
    // While the user is mid gesture (wheel/touch drag), never yank the
    // viewport — their scroll delta would be erased by the pin before the
    // scroll event can even be measured.
    if (userInteractingRef.current) return;
    if (pinFrameRef.current) return;
    pinFrameRef.current = window.requestAnimationFrame(() => {
      pinFrameRef.current = 0;
      if (stickToBottomRef.current && !userInteractingRef.current) pinToBottom('auto');
    });
  };

  // A wheel event has no reliable "end" signal, so treat the gesture as over
  // after a short idle; touch has touchend. When the gesture ends we decide
  // from the settled position whether auto-follow resumes (stick) or stays
  // paused for reading.
  const endUserInteracting = () => {
    window.clearTimeout(interactEndTimerRef.current);
    userInteractingRef.current = false;
    const el = chatViewportRef.current;
    if (!el) return;
    stickToBottomRef.current = isNearBottom(el);
    syncBottomUi();
  };

  const markUserInteracting = (isWheel: boolean) => {
    userInteractingRef.current = true;
    // Stop treating pending programmatic movement as an intent guard.
    programmaticScrollUntilRef.current = 0;
    window.clearTimeout(interactEndTimerRef.current);
    if (isWheel) {
      interactEndTimerRef.current = window.setTimeout(endUserInteracting, 200);
    }
  };

  const handleScroll = () => {
    // Ignore scroll events caused by our own pinning — they are not user
    // intent and must not toggle the stick-to-bottom state.
    if (Date.now() < programmaticScrollUntilRef.current) return;
    if (userInteractingRef.current) return;
    const el = chatViewportRef.current;
    if (!el) return;
    stickToBottomRef.current = isNearBottom(el);
    syncBottomUi();
  };

  const handleScrollToBottomClick = () => {
    stickToBottomRef.current = true;
    setShowScrollBottom(false);
    // While tokens are still arriving, pin instantly: a smooth animation
    // would fight the per-frame auto-pins and could settle a few pixels off.
    pinToBottom(isGenerating ? 'auto' : 'smooth');
  };

  // Follow streamed content frame-by-frame while the user is at the bottom.
  useLayoutEffect(() => {
    if (stickToBottomRef.current) {
      schedulePinToBottom();
    }
  }, [conversation.messages, isGenerating]);

  const hasMessages = conversation.messages.length > 0;

  // Re-pin whenever an async reflow lands (markdown/code block relayout,
  // images finishing loading, reasoning block appearing, keyboard show/hide).
  // Without this the tail of the reply ends up hidden behind the input bar.
  useEffect(() => {
    const viewport = chatViewportRef.current;
    const content = messagesContentRef.current;
    if (!viewport || !content) return;
    const observer = new ResizeObserver(() => {
      // Don't fight a running smooth scroll animation.
      if (Date.now() < programmaticScrollUntilRef.current) return;
      if (stickToBottomRef.current) {
        schedulePinToBottom();
      } else {
        syncBottomUi();
      }
    });
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [conversation.id, hasMessages]);

  // When switching conversation, jump straight to the bottom.
  useEffect(() => {
    stickToBottomRef.current = true;
    setShowScrollBottom(false);
    // One frame later so the new conversation's content is measurable.
    const raf = window.requestAnimationFrame(() => pinToBottom('auto'));
    return () => window.cancelAnimationFrame(raf);
  }, [conversation.id]);

  // Adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputVal]);

  const detectFileType = (fileName: string, mime: string): AttachedFile['type'] => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const codeExts = [
      'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs',
      'php', 'rb', 'swift', 'kt', 'sql', 'html', 'css', 'scss', 'less', 'json', 'yaml',
      'yml', 'xml', 'sh', 'bash', 'zsh', 'env', 'dockerfile', 'toml', 'lua', 'r', 'dart'
    ];
    if (codeExts.includes(ext)) return 'code';
    if (['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'rtf'].includes(ext)) return 'text';
    if (ext === 'pdf' || mime.includes('pdf')) return 'pdf';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'].includes(ext) || mime.startsWith('image/')) return 'image';
    return 'document';
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (
      (!inputVal.trim() && attachedImages.length === 0 && attachedFiles.length === 0) ||
      isGenerating
    )
      return;

    const text = inputVal;
    const imgs = [...attachedImages];
    const files = [...attachedFiles];
    setInputVal('');
    setAttachedImages([]);
    setAttachedFiles([]);
    setShowAttachMenu(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Sending a new message re-sticks the view to the bottom.
    stickToBottomRef.current = true;
    setShowScrollBottom(false);
    schedulePinToBottom();

    await onSendMessage(
      text,
      imgs.length > 0 ? imgs : undefined,
      files.length > 0 ? files : undefined
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Cmd+Enter submits message
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file: File) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        if (loadEvt.target?.result) {
          setAttachedImages((prev) => [...prev, loadEvt.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
    setShowAttachMenu(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const type = detectFileType(file.name, file.type);

      // If user uploaded image file in document picker
      if (type === 'image') {
        const reader = new FileReader();
        reader.onload = (loadEvt) => {
          if (loadEvt.target?.result) {
            setAttachedImages((prev) => [...prev, loadEvt.target!.result as string]);
          }
        };
        reader.readAsDataURL(file);
        return;
      }

      // Read code, text, markdown, json, pdf, etc. as text
      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        const content = (loadEvt.target?.result as string) || '';
        const newFile: AttachedFile = {
          id: 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          name: file.name,
          size: file.size,
          type,
          extension: ext,
          content,
        };
        setAttachedFiles((prev) => [...prev, newFile]);
      };
      reader.readAsText(file);
    });

    if (docInputRef.current) docInputRef.current.value = '';
    setShowAttachMenu(false);
  };

  const removeAttachedImage = (idx: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeAttachedFile = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const toggleReasoning = (msgId: string) => {
    setExpandedReasoning((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  const quickPrompts = [
    'Write a production-ready TypeScript worker with rate limiting and exponential backoff.',
    'Solve complex mathematical and logical reasoning challenges step by step.',
    'Compare DeepSeek R1, Llama 3.3 70B, and Gemini 2.5 Flash for enterprise coding.',
  ];

  // Partition models for Switch Active Model dropdown
  const savedModelsList = allModels.filter(
    (m) => m.isUserSaved || savedModelIds.includes(m.id)
  );
  const otherModelsList = allModels.filter(
    (m) => !m.isUserSaved && !savedModelIds.includes(m.id)
  );

  return (
    <div className="view-surface flex-1 flex flex-col min-w-0 min-h-0 text-[#e2e2e7] overflow-hidden">
      {/* Aurora gradient background — chat viewer canvas */}
      <div className="aurora-bg aurora-bg-strong z-0" />
      <div className="aurora-orb aurora-orb-violet w-72 h-72 -top-20 -left-16 z-0" />
      <div className="aurora-orb aurora-orb-cyan w-80 h-80 top-1/3 -right-24 z-0" />
      <div className="aurora-orb aurora-orb-fuchsia w-96 h-96 -bottom-32 left-1/4 z-0" />

      {/* Top Header matching Immersive UI */}
      <header className="shrink-0 min-h-16 px-3 md:px-6 xl:px-8 py-3 flex items-center justify-between gap-2 glass gradient-header z-20">
        <div className="flex flex-col sm:flex-row sm:items-center min-w-0 flex-1 gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <span className="hidden xl:inline text-xs uppercase tracking-widest text-white/40">Current Session:</span>
            <span className="text-sm font-medium text-white max-w-[160px] lg:max-w-[220px] truncate">
              {conversation.title || 'New Chat'}
            </span>
          </div>

          {/* Active Model Pill */}
          <div className="relative min-w-0">
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              aria-label="Select active model"
              aria-expanded={showModelDropdown}
              className={`max-w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-all cursor-pointer ${
                activeModel.id === 'unselected' || !activeModel.providerModelId
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_15px_rgba(0,242,255,0.25)]'
                  : 'bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  activeModel.id === 'unselected' || !activeModel.providerModelId
                    ? 'bg-amber-400 animate-ping'
                    : 'bg-cyan-400 neon-glow'
                }`}
              />
              <span className="font-semibold text-white truncate max-w-[140px] min-w-0">
                {activeModel.id === 'unselected' || !activeModel.providerModelId
                  ? 'Select Model'
                  : activeModel.name}
              </span>
              {activeModel.id !== 'unselected' && activeModel.providerModelId && (
                <span className="hidden xl:inline text-[11px] text-cyan-400 uppercase font-mono">
                  • {activeModel.provider}
                </span>
              )}
              {instantMode && (
                <span className="text-[10px] text-amber-300 font-bold bg-amber-500/20 border border-amber-500/40 rounded px-1.5 py-0.5 hidden lg:flex shrink-0 items-center gap-1 shadow-[0_0_8px_rgba(245,158,11,0.2)]">
                  <Zap className="h-2.5 w-2.5 fill-amber-300" />
                  Instant Mode
                </span>
              )}
              <ChevronDown className="h-3 w-3 text-white/40 ml-0.5" />
            </button>

            {/* Quick Model Dropdown - Shows Saved Models and lets user switch immediately */}
            {showModelDropdown && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowModelDropdown(false)}
                />
                <div className="absolute left-0 top-full mt-2 w-[min(21rem,calc(100vw-2rem))] rounded-2xl glass gradient-panel-modal border border-violet-400/40 p-3 shadow-[0_10px_35px_rgba(0,0,0,0.8)] z-40 max-h-[min(30rem,50dvh)] overflow-y-auto custom-scrollbar">
                  {/* Dropdown Header */}
                  <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10 mb-2.5">
                    <div className="text-[10px] uppercase tracking-widest text-white/60 font-bold">
                      Switch Active Model
                    </div>
                    <button
                      onClick={() => {
                        setShowModelDropdown(false);
                        onOpenSaveModelModal();
                      }}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Add API</span>
                    </button>
                  </div>

                  {/* Primary Action Button: Add API (Name, Api, Model) */}
                  <button
                    onClick={() => {
                      setShowModelDropdown(false);
                      onOpenSaveModelModal();
                    }}
                    className="w-full mb-3 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black text-xs font-bold hover:from-cyan-400 hover:to-blue-500 transition-all shadow-[0_0_15px_rgba(0,242,255,0.3)] cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5 stroke-[3]" />
                    <span>Add API (Name, Api, Model)</span>
                  </button>

                  {/* Configured Models List */}
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-cyan-400 font-bold flex items-center justify-between">
                    <span>Configured Models</span>
                    <span className="text-white/40 font-mono text-[9px]">
                      {savedModelsList.length}
                    </span>
                  </div>

                  {savedModelsList.length === 0 ? (
                    <div className="p-3 mb-2 rounded-xl bg-white/[0.02] border border-dashed border-white/10 text-center">
                      <p className="text-[11px] text-white/40">
                        No models configured yet.
                      </p>
                      <button
                        onClick={() => {
                          setShowModelDropdown(false);
                          onOpenSaveModelModal();
                        }}
                        className="mt-1 text-[11px] text-cyan-400 hover:underline font-bold cursor-pointer"
                      >
                        Click here to Add API & Use Model
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1 mb-2">
                      {savedModelsList.map((m) => {
                        const isSelected = m.id === activeModel.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => {
                              onSelectModel(m.id);
                              setShowModelDropdown(false);
                            }}
                            className={`w-full flex items-center justify-between p-2 rounded-xl text-xs transition-all text-left cursor-pointer ${
                              isSelected
                                ? 'bg-cyan-500/20 text-cyan-200 font-semibold border border-cyan-500/50 shadow-[0_0_12px_rgba(0,242,255,0.18)]'
                                : 'text-slate-300 hover:bg-white/5 hover:text-white border border-transparent'
                            }`}
                          >
                            <div className="truncate pr-2">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                    isSelected ? 'bg-cyan-400 neon-glow-sm' : 'bg-white/40'
                                  }`}
                                />
                                <span className="font-bold text-white truncate">{m.name}</span>
                              </div>
                              <div className="text-[10px] text-white/40 font-mono pl-3 truncate mt-0.5">
                                {m.providerModelId}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isSelected ? (
                                <Check className="h-3 w-3 text-cyan-400 stroke-[3]" />
                              ) : (
                                <span className="text-[10px] text-cyan-400 font-mono">
                                  Use
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right header icons: History Clock & New Chat Plus */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenHistory}
            className="p-2 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            title="Chat History"
          >
            <Clock className="h-4 w-4" />
          </button>
          <button
            onClick={onNewChat}
            className="p-2 rounded-lg border border-white/10 text-white/60 hover:text-cyan-400 hover:bg-white/5 transition-colors"
            title="Start New Chat"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Chat messages viewport */}
      <div className="flex-1 relative min-h-0 flex flex-col">
        <div
          ref={chatViewportRef}
          onScroll={handleScroll}
          onWheel={() => markUserInteracting(true)}
          onTouchStart={() => markUserInteracting(false)}
          onTouchEnd={endUserInteracting}
          onTouchCancel={endUserInteracting}
          className="chat-viewport flex-1 min-h-0 min-w-0 overflow-y-auto px-3 md:px-8 py-6 space-y-6 relative z-10 custom-scrollbar"
        >
        {conversation.messages.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center min-h-full text-center px-1 sm:px-4 py-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl gradient-avatar-agent mb-4 animate-glow-pulse">
              <MessageSquare className="h-8 w-8 text-white" />
            </div>

            <h2 className="text-2xl font-bold tracking-tight flex flex-wrap justify-center items-center gap-2">
              <span className="gradient-text">AI Chat</span>
              <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 font-mono">
                {activeModel.id === 'unselected' ? 'No Model Selected' : activeModel.name}
              </span>
            </h2>

            {activeModel.id === 'unselected' || !activeModel.providerModelId ? (
              <div className="mt-4 p-5 max-w-md mx-auto rounded-2xl border border-cyan-500/40 bg-cyan-950/20 shadow-[0_0_30px_rgba(0,242,255,0.15)] text-center space-y-3">
                <div className="flex items-center justify-center gap-2 text-cyan-300 font-bold text-sm">
                  <Plus className="h-4 w-4 text-cyan-400" />
                  <span>No Model Configured</span>
                </div>
                <p className="text-xs text-white/70 leading-relaxed">
                  Add your model with Name, url, Api, and Model ID, then click &quot;Used model&quot; to start chatting.
                </p>
                <button
                  onClick={onOpenSaveModelModal}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-bold text-xs hover:from-cyan-400 hover:to-blue-500 transition-all shadow-[0_0_15px_rgba(0,242,255,0.3)] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5 stroke-[3]" />
                  <span>Add Model (Name, url, Api, Model)</span>
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-white/40 mt-1 mb-6">
                  Start an interactive session or select a starter prompt below.
                </p>

                <div className="flex flex-wrap justify-center items-center gap-3">
                  <button
                    onClick={onNewChat}
                    className="flex items-center gap-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 px-6 py-2.5 text-sm font-bold text-black transition-all shadow-[0_0_16px_rgba(0,242,255,0.4)] hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <Plus className="h-4 w-4 stroke-[3]" />
                    <span>New Conversation</span>
                  </button>

                  <button
                    onClick={onOpenModelSelectionModal}
                    className="flex items-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 px-4 py-2.5 text-xs font-bold text-white/80 transition-all cursor-pointer"
                  >
                    <Zap className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Change Model</span>
                  </button>
                </div>

                <div className="w-full max-w-xl mt-10 grid grid-cols-1 gap-2.5">
                  {quickPrompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        stickToBottomRef.current = true;
                        setShowScrollBottom(false);
                        schedulePinToBottom();
                        onSendMessage(prompt);
                      }}
                      className="text-left p-3.5 rounded-xl gradient-card-soft hover:border-violet-400/60 text-xs text-white/80 hover:text-white transition-all group flex items-center justify-between"
                    >
                      <span className="truncate pr-2">{prompt}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-white/30 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div ref={messagesContentRef} className="max-w-3xl mx-auto space-y-6">
            {conversation.messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              const isReasoningExpanded = expandedReasoning[msg.id] ?? false;

              return (
                <div
                  key={msg.id}
                  className={`message-row flex gap-3.5 animate-message-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {/* Avatar matching Immersive UI: A for Agent, U for User */}
                  {!isUser ? (
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center text-cyan-400 text-xs font-bold shrink-0 shadow-[0_0_10px_rgba(0,242,255,0.2)]">
                      A
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-lg gradient-avatar-user flex items-center justify-center text-xs font-bold shrink-0">
                      U
                    </div>
                  )}

                  <div className={`max-w-[82%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
                    {/* Timestamp & metadata */}
                    <div className="flex items-center gap-2 text-[10px] text-white/30 mb-1 px-1">
                      {!isUser && (
                        <span className="text-cyan-400 font-mono">
                          {msg.modelUsed || activeModel.name} •
                        </span>
                      )}
                      <span>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Reasoning block if available */}
                    {!isUser && msg.reasoning && (
                      <div className="w-full mb-3 rounded-xl chat-reasoning-gradient p-3 text-xs">
                        <button
                          onClick={() => toggleReasoning(msg.id)}
                          className="flex items-center justify-between w-full text-white/60 hover:text-white transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <BrainCircuit className="h-3.5 w-3.5 text-cyan-400" />
                            <span className="font-mono text-cyan-300 text-[11px]">
                              Internal Reasoning Trace
                            </span>
                          </div>
                          {isReasoningExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                        {isReasoningExpanded && (
                          <div className="mt-2.5 pt-2 border-t border-white/10 text-white/60 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto custom-scrollbar">
                            {msg.reasoning}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Message Bubble */}
                    <div
                      className={`p-4 rounded-2xl text-sm leading-relaxed ${
                        isUser
                          ? 'chat-bubble-user rounded-tr-none'
                          : 'chat-bubble-assistant rounded-tl-none'
                      }`}
                    >
                      {/* Attached images */}
                      {msg.imageUrls && msg.imageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {msg.imageUrls.map((img, imgIdx) => (
                            <img
                              key={imgIdx}
                              src={img}
                              alt="Attachment"
                              className="max-h-48 max-w-xs rounded-lg object-cover border border-white/10"
                            />
                          ))}
                        </div>
                      )}

                      {/* Attached files */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {msg.attachments.map((file) => (
                            <div
                              key={file.id}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 border border-cyan-500/30 text-xs text-white max-w-xs shadow-sm hover:border-cyan-500/60 transition-colors"
                            >
                              <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 shrink-0">
                                {file.type === 'code' ? (
                                  <FileCode className="h-4 w-4" />
                                ) : file.type === 'pdf' ? (
                                  <FileText className="h-4 w-4 text-orange-400" />
                                ) : (
                                  <FileText className="h-4 w-4" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-xs truncate text-white/90">
                                  {file.name}
                                </p>
                                <p className="text-[10px] text-white/40 uppercase font-mono">
                                  {file.extension ? `.${file.extension}` : file.type} •{' '}
                                  {formatFileSize(file.size)}
                                </p>
                              </div>
                              {file.content && (
                                <button
                                  type="button"
                                  onClick={() => setViewingFile(file)}
                                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-cyan-400 transition-colors cursor-pointer"
                                  title="View file content"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Content */}
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : !msg.content && !msg.errorMsg && !msg.stopped ? (
                        <div className="flex items-center gap-2.5 py-1 text-cyan-300 text-xs font-mono">
                          <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                          </span>
                          <span>
                            {instantMode
                              ? '⚡ Instant Mode — កំពុងបង្កើតចម្លើយពេញលេញ (Generating complete response)...'
                              : `${activeModel.name || 'Model'} កំពុងបង្កើតចម្លើយ... (is generating response...)`}
                          </span>
                        </div>
                      ) : msg.content || msg.errorMsg ? (
                        <MarkdownView
                          content={msg.content}
                          isStreaming={isGenerating && idx === conversation.messages.length - 1}
                        />
                      ) : null}

                      {/* Stopped-by-user banner (បញ្ឈប់ការឆ្លើយតប) */}
                      {!isUser && msg.stopped && (
                        <div className="mt-2.5 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300/90 text-[11px] font-medium">
                          <Square className="h-3 w-3 fill-current shrink-0" />
                          <span>ការឆ្លើយតបត្រូវបានបញ្ឈប់ដោយអ្នក (Response stopped by user)</span>
                        </div>
                      )}

                      {/* Error banner & Recovery Actions */}
                      {msg.errorMsg && (
                        <div className="mt-3 p-3.5 rounded-xl chat-error-gradient text-xs">
                          <div className="flex items-start gap-2.5 text-rose-300">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-rose-200">
                                {msg.errorMsg.includes('503') || msg.errorMsg.includes('high demand')
                                  ? 'Model Experiencing High Demand (503)'
                                  : 'Service Error'}
                              </p>
                              <p className="text-rose-300/90 mt-1 leading-relaxed">{msg.errorMsg}</p>
                            </div>
                          </div>

                          {/* Quick Recovery Actions */}
                          <div className="mt-3 pt-2.5 border-t border-rose-500/20 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={isGenerating}
                              onClick={() => {
                                const lastUserMsg = conversation.messages
                                  .slice(0, idx)
                                  .reverse()
                                  .find((m) => m.role === 'user');
                                if (lastUserMsg) {
                                  stickToBottomRef.current = true;

                                  schedulePinToBottom();
                                  onSendMessage(
                                    lastUserMsg.content,
                                    lastUserMsg.imageUrls,
                                    lastUserMsg.attachments
                                  );
                                }
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <RefreshCw className="h-3 w-3" />
                              <span>Retry</span>
                            </button>

                            {(msg.errorMsg.includes('503') ||
                              msg.errorMsg.includes('high demand') ||
                              activeModel.provider === 'gemini') && (
                              <button
                                type="button"
                                disabled={isGenerating}
                                onClick={() => {
                                  onSelectModel('gemini-3.5-flash');
                                  const lastUserMsg = conversation.messages
                                    .slice(0, idx)
                                    .reverse()
                                    .find((m) => m.role === 'user');
                                  if (lastUserMsg) {
                                    setTimeout(() => {
                                      stickToBottomRef.current = true;

                                      schedulePinToBottom();
                                      onSendMessage(
                                        lastUserMsg.content,
                                        lastUserMsg.imageUrls,
                                        lastUserMsg.attachments
                                      );
                                    }, 150);
                                  }
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                              >
                                <Zap className="h-3 w-3" />
                                <span>Switch to Gemini 3.5 Flash & Retry</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Copy action */}
                    {!isUser && msg.content && !isGenerating && (
                      <div className="flex items-center gap-2 mt-1 px-1">
                        <button
                          onClick={() => navigator.clipboard.writeText(msg.content)}
                          className="flex items-center gap-1 text-[10px] text-white/40 hover:text-cyan-400 transition-colors"
                          title="Copy reply"
                        >
                          <Copy className="h-3 w-3" />
                          <span>Copy</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Fallback generating indicator if no assistant message is present */}
            {isGenerating &&
              (conversation.messages.length === 0 ||
                conversation.messages[conversation.messages.length - 1].role === 'user') && (
                <div className="flex items-center gap-3 text-white/60 text-xs py-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center text-cyan-400">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-cyan-400">{activeModel.name}</span>
                    <span>is connecting...</span>
                  </div>
                </div>
              )}

            <div aria-hidden="true" />
          </div>
        )}
        </div>

        {/* Floating Scroll to Bottom Button (ប៊ូតុងសញ្ញាព្រួញចុះក្រោម) */}
        {showScrollBottom && conversation.messages.length > 0 && (
          <div className="absolute bottom-4 right-6 md:right-8 z-30 pointer-events-auto">
            <button
              onClick={handleScrollToBottomClick}
              className="flex items-center gap-2 px-3.5 py-2 rounded-full gradient-btn font-bold text-xs hover:scale-105 active:scale-95 cursor-pointer group"
              title="Scroll to bottom (ចុះទៅក្រោម)"
            >
              <span className="text-[11px] font-semibold hidden sm:inline">Scroll to bottom</span>
              <ArrowDown className="h-4 w-4 stroke-[2.5] group-hover:translate-y-0.5 transition-transform" />
            </button>
          </div>
        )}
      </div>

      {/* Input Bar matching Immersive UI glass footer */}
      <div className="shrink-0 p-3 md:p-6 gradient-footer z-10">
        <div className="max-w-3xl mx-auto space-y-2.5">
          {/* Unconfigured Provider Banner */}
          {!activeProviderConfig.isConfigured && activeModel.provider !== 'gemini' && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/40 text-xs text-cyan-200 shadow-[0_0_15px_rgba(0,242,255,0.1)]">
              <div className="flex items-center gap-2 truncate pr-2">
                <AlertCircle className="h-4 w-4 text-cyan-400 shrink-0" />
                <span className="truncate">
                  <strong className="text-white">{activeModel.name}</strong> ({activeModel.provider.toUpperCase()}) requires API credentials.
                </span>
              </div>
              <button
                onClick={() =>
                  onOpenSaveModelModal({
                    name: activeModel.name,
                    apiProvider: activeModel.provider,
                    modelId: activeModel.providerModelId,
                  })
                }
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-[11px] transition-all shrink-0 cursor-pointer shadow-[0_0_10px_rgba(0,242,255,0.3)]"
              >
                <Save className="h-3 w-3" />
                <span>Configure & Save</span>
              </button>
            </div>
          )}

          {/* Attached items preview chips (Images & Files) */}
          {(attachedImages.length > 0 || attachedFiles.length > 0) && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1.5 custom-scrollbar">
              {attachedImages.map((img, idx) => (
                <div key={'img-' + idx} className="relative group shrink-0">
                  <img
                    src={img}
                    alt="Upload thumbnail"
                    className="h-14 w-14 rounded-lg object-cover border border-cyan-500/40 shadow-[0_0_8px_rgba(0,242,255,0.2)]"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachedImage(idx)}
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[10px] hover:bg-rose-400 cursor-pointer shadow-md"
                    title="Remove image"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}

              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 border border-cyan-500/40 text-xs text-white shrink-0 max-w-[240px] shadow-[0_0_10px_rgba(0,242,255,0.1)] relative group"
                >
                  <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 shrink-0">
                    {file.type === 'code' ? (
                      <FileCode className="h-4 w-4" />
                    ) : file.type === 'pdf' ? (
                      <FileText className="h-4 w-4 text-orange-400" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-xs text-white/90">{file.name}</p>
                    <p className="text-[10px] text-white/40 uppercase font-mono">
                      {file.extension ? `.${file.extension}` : file.type} •{' '}
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(file.id)}
                    className="h-5 w-5 rounded-full bg-white/10 hover:bg-rose-500 text-white/70 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    title="Remove file"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input container — gradient frame */}
          <div className="gradient-input-frame">
          <div className="relative flex items-center gradient-input-inner">
            {/* Attachment Button (+) and Options Menu */}
            <div className="absolute left-3 z-20 flex items-center" ref={attachMenuRef}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />
              <input
                ref={docInputRef}
                type="file"
                accept=".txt,.md,.pdf,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.scss,.csv,.java,.c,.cpp,.h,.go,.rs,.php,.rb,.sql,.sh,.yaml,.yml,.xml,.env,.log,.rtf,.doc,.docx"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  showAttachMenu
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-[0_0_12px_rgba(0,242,255,0.3)]'
                    : 'text-white/50 hover:text-cyan-400 hover:bg-white/10'
                }`}
                title="Add files or images (+)"
              >
                <Plus
                  className={`h-4 w-4 transition-transform duration-200 stroke-[2.5] ${
                    showAttachMenu ? 'rotate-45 text-cyan-400' : ''
                  }`}
                />
              </button>

              {/* Attach Dropdown Menu */}
              {showAttachMenu && (
                <div className="absolute bottom-11 left-0 w-64 rounded-xl border border-cyan-500/30 bg-gradient-to-b from-[#11161f] to-[#0a0d12] shadow-[0_0_25px_rgba(0,242,255,0.2)] p-1.5 space-y-1 z-30">
                  <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-cyan-400/70 border-b border-white/5">
                    Upload Options (ជម្រើសផ្ទុកឡើង)
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 text-left transition-colors group cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                      <ImageIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors">
                        Upload Images (រូបភាព)
                      </div>
                      <div className="text-[10px] text-white/40 truncate font-mono">
                        PNG, JPG, WEBP, GIF
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      docInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 text-left transition-colors group cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:scale-105 transition-transform">
                      <FileCode className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white group-hover:text-blue-300 transition-colors">
                        Upload Files & Code (ហ្វាល/កូដ)
                      </div>
                      <div className="text-[10px] text-white/40 truncate font-mono">
                        Code, Text (.txt, .md), PDF
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Textarea input */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything or discuss attached files..."
              className="w-full bg-transparent border-0 rounded-xl py-3 pl-12 pr-12 text-base sm:text-sm text-white placeholder-white/40 focus:outline-none transition-colors resize-none leading-relaxed max-h-44"
            />

            {/* Send button — morphs into a Stop button (បញ្ឈប់) while the
                response is working, so the user can cancel it at any time. */}
            <button
              type="button"
              onClick={() => (isGenerating ? onStopResponse() : handleSubmit())}
              disabled={
                !isGenerating &&
                (!inputVal.trim() && attachedImages.length === 0 && attachedFiles.length === 0)
              }
              className={`absolute right-2.5 p-2 rounded-lg transition-all ${
                isGenerating
                  ? 'bg-rose-500/20 border border-rose-400/60 text-rose-300 hover:bg-rose-500/35 hover:text-rose-200 shadow-[0_0_14px_rgba(244,63,94,0.4)] cursor-pointer'
                  : inputVal.trim() || attachedImages.length > 0 || attachedFiles.length > 0
                  ? 'gradient-btn cursor-pointer'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}
              title={
                isGenerating
                  ? 'បញ្ឈប់ការឆ្លើយតប (Stop response)'
                  : 'Send message (⬆️)'
              }
            >
              {isGenerating ? (
                <Square className="h-3.5 w-3.5 fill-current stroke-[2.5] animate-pulse" />
              ) : (
                <ArrowUp className="h-4 w-4 stroke-[2.5]" />
              )}
            </button>
          </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1 px-1 text-[10px] text-white/30">
            <div className="flex items-center gap-2">
              <span>
                Active: <strong className="text-cyan-400 font-mono">{activeModel.name}</strong> (
                {activeModel.isFree ? 'Free Tier' : 'API Key'})
              </span>
              {instantMode && (
                <span className="text-[10px] text-amber-300 font-bold bg-amber-500/20 border border-amber-500/40 rounded px-1.5 py-0.5 flex items-center gap-1 shadow-[0_0_6px_rgba(245,158,11,0.25)]">
                  <Zap className="h-2.5 w-2.5 fill-amber-300" />
                  Instant Mode
                </span>
              )}
            </div>
            <span className="hidden sm:inline">Shift + Enter for newline</span>
          </div>
        </div>
      </div>

      {/* Attached File Content Viewer Modal */}
      {viewingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 animate-in fade-in duration-200">
          <div className="gradient-panel-modal border border-violet-400/40 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-[0_0_40px_rgba(139,92,246,0.35)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400 shrink-0">
                  {viewingFile.type === 'code' ? (
                    <FileCode className="h-5 w-5" />
                  ) : viewingFile.type === 'pdf' ? (
                    <FileText className="h-5 w-5 text-orange-400" />
                  ) : (
                    <FileText className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm text-white truncate">{viewingFile.name}</h3>
                  <p className="text-[11px] text-white/40 uppercase font-mono">
                    {viewingFile.extension ? `.${viewingFile.extension}` : viewingFile.type} •{' '}
                    {formatFileSize(viewingFile.size)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {viewingFile.content && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(viewingFile.content || '');
                      setCopiedFileContent(true);
                      setTimeout(() => setCopiedFileContent(false), 2000);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/80 hover:text-white transition-colors cursor-pointer"
                  >
                    {copiedFileContent ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => setViewingFile(null)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-5 flex-1 overflow-y-auto custom-scrollbar font-mono text-xs leading-relaxed text-cyan-100/90 bg-black/40 whitespace-pre-wrap selection:bg-cyan-500/30">
              {viewingFile.content || '(File content is binary or cannot be displayed as plain text)'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
