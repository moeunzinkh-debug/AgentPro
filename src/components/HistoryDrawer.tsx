import React, { useState } from 'react';
import { Clock, MessageSquare, Plus, Search, Trash2, X } from 'lucide-react';
import { Conversation } from '../types';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  currentConvId: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  conversations,
  currentConvId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
}) => {
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/80">
      <div className="w-full max-w-sm h-full glass-panel gradient-panel-modal border-l border-violet-400/30 text-[#e2e2e7] flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-violet-400/25 flex items-center justify-between gradient-header">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-400" />
            <h2 className="text-xs uppercase font-bold tracking-wider text-white">Chat History</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* New chat button & search */}
        <div className="p-3 border-b border-white/10 space-y-2 bg-black/40">
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 rounded-xl gradient-btn py-2.5 text-xs font-bold cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span>New Chat</span>
          </button>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-white/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-white/40">
              No conversations found.
            </div>
          ) : (
            filtered.map((conv) => {
              const isSelected = conv.id === currentConvId;
              const dateStr = new Date(conv.updatedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              });

              return (
                <div
                  key={conv.id}
                  onClick={() => {
                    onSelectConversation(conv.id);
                    onClose();
                  }}
                  className={`group flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-all ${
                    isSelected
                      ? 'gradient-pill-active text-violet-100 accent-border'
                      : 'hover:bg-white/5 text-white/70 border border-transparent hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate pr-2">
                    <MessageSquare
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isSelected ? 'text-cyan-400' : 'text-white/40 group-hover:text-white/70'
                      }`}
                    />
                    <span className="truncate">{conv.title}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-white/30">{dateStr}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteConversation(conv.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-rose-400 text-white/30 transition-opacity"
                      title="Delete chat"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
