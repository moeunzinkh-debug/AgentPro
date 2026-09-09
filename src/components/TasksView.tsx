import React, { useState } from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Code2,
  FileSearch,
  ListTodo,
  Play,
  RotateCw,
  Sparkles,
  Zap,
} from 'lucide-react';
import { ModelInfo, ProviderConfig } from '../types';
import { sendChatMessage } from '../services/apiClient';
import { DEFAULT_SETTINGS } from '../services/storage';
import { MarkdownView } from './MarkdownView';

interface TasksViewProps {
  activeModel: ModelInfo;
  activeProviderConfig: ProviderConfig;
  onJumpToChatWithPrompt: (prompt: string) => void;
}

interface AgentTask {
  id: string;
  title: string;
  category: 'code' | 'research' | 'architecture' | 'benchmark';
  icon: any;
  description: string;
  defaultPrompt: string;
}

const PRESET_TASKS: AgentTask[] = [
  {
    id: 'task-code-audit',
    title: 'Autonomous Code Review & Refactor',
    category: 'code',
    icon: Code2,
    description: 'Analyze code for security leaks, edge cases, type errors, and performance improvements.',
    defaultPrompt: 'Conduct a thorough architectural and security audit of this TypeScript function:\n```typescript\nasync function handleTransaction(req: any) {\n  const user = await db.find(req.userId);\n  user.balance -= req.amount;\n  await db.save(user);\n  return { success: true };\n}\n```',
  },
  {
    id: 'task-research',
    title: 'Multi-Perspective Deep Research',
    category: 'research',
    icon: FileSearch,
    description: 'Deconstruct complex topics into first principles with citations, pros/cons, and future outlook.',
    defaultPrompt: 'Deconstruct the technical differences between MoE (Mixture of Experts) architectures like DeepSeek V3 and Dense models like Llama 3.3. Analyze memory bandwidth constraints, KV cache compression, and token throughput.',
  },
  {
    id: 'task-architecture',
    title: 'Production System Architecture Design',
    category: 'architecture',
    icon: Zap,
    description: 'Design a resilient, fault-tolerant microservice architecture with diagram breakdowns.',
    defaultPrompt: 'Design a low-latency real-time collaboration canvas system supporting 10,000 concurrent websocket connections. Detail database selection, conflict resolution (CRDTs), and edge caching.',
  },
  {
    id: 'task-model-benchmark',
    title: 'Cross-Model Reasoning Challenge',
    category: 'benchmark',
    icon: Sparkles,
    description: 'Execute a rigorous mathematical and algorithmic logic puzzle to test the active model.',
    defaultPrompt: 'Solve this riddle step by step with formal logic:\nA farmer has 17 sheep. All but 9 run away. How many sheep are left alive? Next, prove whether the sum of any two odd integers is always even using algebraic notation.',
  },
];

export const TasksView: React.FC<TasksViewProps> = ({
  activeModel,
  activeProviderConfig,
  onJumpToChatWithPrompt,
}) => {
  const [selectedTask, setSelectedTask] = useState<AgentTask>(PRESET_TASKS[0]);
  const [taskPrompt, setTaskPrompt] = useState<string>(PRESET_TASKS[0].defaultPrompt);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<string | null>(null);
  const [executionReasoning, setExecutionReasoning] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<number>(0);

  const handleSelectTask = (task: AgentTask) => {
    setSelectedTask(task);
    setTaskPrompt(task.defaultPrompt);
    setExecutionResult(null);
    setExecutionReasoning(null);
    setCurrentStep(0);
  };

  const handleRunTask = async () => {
    if (!taskPrompt.trim() || isExecuting) return;

    setIsExecuting(true);
    setExecutionResult(null);
    setExecutionReasoning(null);
    setCurrentStep(1);

    try {
      const stepTimer1 = setTimeout(() => setCurrentStep(2), 600);
      const stepTimer2 = setTimeout(() => setCurrentStep(3), 1200);

      const res = await sendChatMessage({
        provider: activeModel.provider,
        modelId: activeModel.id,
        providerModelId: activeModel.providerModelId,
        messages: [{ role: 'user', content: taskPrompt }],
        parameters: {
          ...DEFAULT_SETTINGS.parameters,
          systemPrompt: `You are Agent Pro operating in Autonomous Task Execution Mode (${selectedTask.title}). Provide a structured, in-depth, production-grade output.`,
        },
        providerConfig: activeProviderConfig,
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setCurrentStep(4);
      setExecutionResult(res.content);
      if (res.reasoning) {
        setExecutionReasoning(res.reasoning);
      }
    } catch (err: any) {
      setExecutionResult(`Task execution error: ${err?.message || 'Failed'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="view-surface flex-1 flex flex-col min-w-0 min-h-0 text-[#e2e2e7] overflow-hidden">
      {/* Aurora gradient background */}
      <div className="aurora-bg z-0" />
      <div className="aurora-orb aurora-orb-fuchsia w-72 h-72 -top-16 left-1/3 z-0" />
      <div className="aurora-orb aurora-orb-cyan w-72 h-72 bottom-0 -right-20 z-0" />

      {/* Header matching Immersive UI */}
      <div className="shrink-0 px-4 md:px-6 py-4 md:py-5 glass gradient-header z-10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-avatar-agent">
            <ListTodo className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight uppercase tracking-wide">
              <span className="gradient-text">Agent Workflows</span>
            </h1>
            <p className="text-xs text-white/40 mt-0.5">
              Execute structured autonomous workflows using {activeModel.name} ({activeModel.provider}).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-white/40">Target Model:</span>
          <span className="rounded-lg gradient-pill-active px-2.5 py-1 text-xs font-mono font-semibold text-violet-100">
            {activeModel.name}
          </span>
        </div>
      </div>

      {/* Main split view */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden z-10">
        {/* Left column: Task Selection */}
        <div className="w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-white/10 p-4 space-y-2 lg:overflow-y-auto glass custom-scrollbar">
          <div className="text-[11px] uppercase tracking-wider text-white/40 font-bold px-2 mb-2">
            Workflows Catalog
          </div>

          {PRESET_TASKS.map((task) => {
            const isSelected = selectedTask.id === task.id;
            const Icon = task.icon;

            return (
              <button
                key={task.id}
                onClick={() => handleSelectTask(task)}
                className={`w-full text-left p-3.5 rounded-xl transition-all cursor-pointer ${
                  isSelected
                    ? 'gradient-card-soft accent-border text-violet-100 shadow-[0_0_14px_rgba(139,92,246,0.3)]'
                    : 'glass border border-white/10 text-white/70 hover:border-violet-400/40 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5 mb-1.5">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                      isSelected
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-white/5 text-white/60 border border-white/10'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-bold text-white truncate">{task.title}</span>
                </div>
                <p className="text-[11px] text-white/40 line-clamp-2 leading-relaxed">
                  {task.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Right column: Execution Workspace */}
        <div className="min-w-0 shrink-0 lg:flex-1 flex flex-col lg:overflow-y-auto p-4 md:p-6 space-y-5 custom-scrollbar">
          {/* Prompt Editor */}
          <div className="shrink-0 rounded-xl gradient-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider font-bold text-white/80 flex items-center gap-2">
                <Bot className="h-4 w-4 text-cyan-400" />
                Task Configuration
              </span>
              <button
                onClick={() => onJumpToChatWithPrompt(taskPrompt)}
                className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                Open in Interactive Chat <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <textarea
              rows={4}
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-xs font-mono text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none leading-relaxed"
              placeholder="Task instructions..."
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-white/40">
                Executes via <strong className="text-cyan-400 font-mono">{activeModel.name}</strong>
              </span>
              <button
                onClick={handleRunTask}
                disabled={isExecuting || !taskPrompt.trim()}
                className="flex items-center gap-2 rounded-lg gradient-btn px-5 py-2 text-xs font-bold cursor-pointer"
              >
                {isExecuting ? (
                  <>
                    <RotateCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Executing Plan...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Run Workflow</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Execution Progress & Result */}
          {isExecuting && (
            <div className="shrink-0 rounded-xl gradient-card-soft p-4 space-y-3 shadow-[0_0_16px_rgba(139,92,246,0.3)]">
              <div className="text-xs font-bold text-cyan-300 flex items-center gap-2 uppercase tracking-wide">
                <RotateCw className="h-4 w-4 animate-spin text-cyan-400" />
                Autonomous Plan Execution
              </div>
              <div className="space-y-2 text-xs">
                <div
                  className={`flex items-center gap-2 ${
                    currentStep >= 1 ? 'text-cyan-300' : 'text-white/30'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Step 1: Deconstructing task objectives & constraints...</span>
                </div>
                <div
                  className={`flex items-center gap-2 ${
                    currentStep >= 2 ? 'text-cyan-300' : 'text-white/30'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Step 2: Synthesizing architecture and edge cases...</span>
                </div>
                <div
                  className={`flex items-center gap-2 ${
                    currentStep >= 3 ? 'text-cyan-300' : 'text-white/30'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Step 3: Compiling structured output and verification...</span>
                </div>
              </div>
            </div>
          )}

          {/* Reasoning trace if present */}
          {executionReasoning && (
            <div className="shrink-0 rounded-xl glass border border-cyan-500/30 p-4 text-xs font-mono text-cyan-400/90 space-y-1">
              <div className="font-bold text-cyan-300 text-[11px] uppercase tracking-wider mb-1">
                Internal Reasoning Trace:
              </div>
              <p className="whitespace-pre-wrap">{executionReasoning}</p>
            </div>
          )}

          {/* Output Card */}
          {executionResult && (
            <div className="shrink-0 rounded-xl gradient-card p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                <div className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wide">
                  <CheckCircle2 className="h-4 w-4 text-cyan-400" />
                  Task Execution Output
                </div>
                <span className="text-[11px] font-mono text-cyan-400">
                  Model: {activeModel.name}
                </span>
              </div>
              <div className="pt-2">
                <MarkdownView content={executionResult} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
