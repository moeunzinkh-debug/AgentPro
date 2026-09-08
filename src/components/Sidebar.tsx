import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  ListTodo,
  MessageSquare,
  Settings,
  Sparkles,
} from 'lucide-react';
import { NavTab } from '../types';

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  modelsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  modelsCount,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: any;
    badge?: string;
  }> = [
    {
      id: 'chat',
      label: 'Chat',
      icon: MessageSquare,
    },
    {
      id: 'tasks',
      label: 'Tasks',
      icon: ListTodo,
    },
    {
      id: 'models',
      label: 'Models',
      icon: Layers,
      badge: modelsCount > 0 ? `${modelsCount}` : undefined,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
    },
  ];

  return (
    <aside
      className={`border-r border-white/10 flex flex-col glass select-none z-30 transition-all duration-200 relative shrink-0 ${
        collapsed ? 'w-12' : 'w-36'
      }`}
    >
      {/* Brand Header with Cyan Neon Dot */}
      <div
        className={`border-b border-white/10 flex items-center justify-between ${
          collapsed ? 'py-2.5 px-2 justify-center' : 'py-2.5 px-2.5'
        }`}
      >
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          className="flex items-center gap-1.5 cursor-pointer group text-left border-none bg-transparent p-0"
          title="Agent Pro"
        >
          <div className="w-2 h-2 rounded-full bg-cyan-400 neon-glow shrink-0 group-hover:scale-125 transition-transform" />
          {!collapsed && (
            <span className="text-xs font-bold tracking-tight text-white flex items-center gap-1">
              <span>AGENT</span>
              <span className="text-cyan-400">PRO</span>
            </span>
          )}
        </button>

        {/* Collapse / Expand toggle */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={`text-white/40 hover:text-white p-0.5 rounded hover:bg-white/5 transition-colors cursor-pointer ${
            collapsed ? 'hidden' : 'flex'
          }`}
          title="Collapse sidebar"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-1.5 space-y-1 overflow-y-auto custom-scrollbar">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center rounded-lg text-xs font-medium transition-all relative group cursor-pointer ${
                collapsed
                  ? 'justify-center p-2'
                  : 'gap-2 px-2 py-1.5'
              } ${
                isActive
                  ? 'bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 shadow-[0_0_10px_rgba(0,242,255,0.15)] font-semibold'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
              title={item.label}
            >
              <Icon
                className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                  isActive ? 'text-cyan-400 neon-text' : 'text-white/60 group-hover:text-white'
                }`}
              />

              {!collapsed && (
                <div className="flex-1 text-left truncate flex items-center justify-between">
                  <span className="truncate text-[11px]">{item.label}</span>
                  {item.badge && (
                    <span className="text-[9px] px-1 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                      {item.badge}
                    </span>
                  )}
                </div>
              )}

              {/* Collapsed active indicator dot */}
              {collapsed && isActive && (
                <span className="absolute right-1 top-1 w-1.5 h-1.5 rounded-full bg-cyan-400 neon-glow" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Footer / Expand Button */}
      <div className="p-1.5 border-t border-white/10 mt-auto bg-black/20">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="w-full flex items-center justify-center p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            title="Expand sidebar"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div
            onClick={() => setActiveTab('settings')}
            className="flex items-center justify-between px-2 py-1 rounded text-[10px] text-white/40 hover:text-white hover:bg-white/5 cursor-pointer transition-colors"
            title="Open Settings"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 neon-glow" />
              <span className="font-mono text-cyan-400">v2.6</span>
            </div>
            <span className="text-white/30 font-mono text-[9px]">Ready</span>
          </div>
        )}
      </div>
    </aside>
  );
};
