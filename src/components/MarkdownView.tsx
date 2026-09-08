import React, { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';

interface MarkdownViewProps {
  content: string;
  isStreaming?: boolean;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, isStreaming }) => {
  // Simple, robust parser for code blocks, bold, headers, lists, quotes, inline code
  const blocks = React.useMemo(() => {
    const parts: Array<{ type: 'code' | 'text'; content: string; language?: string }> = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: content.substring(lastIndex, match.index),
        });
      }
      parts.push({
        type: 'code',
        language: match[1] || 'text',
        content: match[2],
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      const remaining = content.substring(lastIndex);
      const unclosedCodeMatch = remaining.match(/^```([a-zA-Z0-9_-]*)\n([\s\S]*)$/);
      if (unclosedCodeMatch) {
        parts.push({
          type: 'code',
          language: unclosedCodeMatch[1] || 'text',
          content: unclosedCodeMatch[2],
        });
      } else {
        parts.push({
          type: 'text',
          content: remaining,
        });
      }
    }

    return parts;
  }, [content]);

  return (
    <div className="space-y-3 leading-relaxed text-[15px]">
      {blocks.map((block, idx) => {
        const isLastBlock = idx === blocks.length - 1;
        if (block.type === 'code') {
          return (
            <div key={idx} className="relative">
              <CodeBlock
                code={block.content}
                language={block.language || 'text'}
              />
              {isStreaming && isLastBlock && (
                <span className="inline-block w-2 h-4 bg-cyan-400 ml-1 translate-y-0.5 animate-pulse rounded-sm" />
              )}
            </div>
          );
        }
        return (
          <div key={idx} className="inline">
            <TextBlock text={block.content} />
            {isStreaming && isLastBlock && (
              <span className="inline-block w-2 h-4 bg-cyan-400 ml-1 translate-y-0.5 animate-pulse rounded-sm" />
            )}
          </div>
        );
      })}
    </div>
  );
};

const CodeBlock: React.FC<{ code: string; language: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-[#070b0e] text-slate-200 shadow-xl">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-400 font-mono">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-emerald-400" />
          <span className="font-semibold text-slate-300 uppercase tracking-wider">{language}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13.5px] font-mono leading-normal text-emerald-100/90">
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
};

const TextBlock: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');

  return (
    <div className="space-y-2">
      {lines.map((line, lIdx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={lIdx} className="h-2" />;
        }

        // Headers
        if (line.startsWith('### ')) {
          return (
            <h4 key={lIdx} className="text-base font-bold text-white mt-3 mb-1">
              {renderInline(line.replace('### ', ''))}
            </h4>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <h3 key={lIdx} className="text-lg font-bold text-white mt-4 mb-2 border-b border-white/10 pb-1">
              {renderInline(line.replace('## ', ''))}
            </h3>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <h2 key={lIdx} className="text-xl font-bold text-white mt-4 mb-2">
              {renderInline(line.replace('# ', ''))}
            </h2>
          );
        }

        // Bullet lists
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={lIdx} className="flex items-start gap-2 ml-2">
              <span className="text-emerald-400 mt-1 font-bold">•</span>
              <div className="flex-1">{renderInline(line.replace(/^[-*]\s+/, ''))}</div>
            </div>
          );
        }

        // Numbered list
        const numMatch = line.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          return (
            <div key={lIdx} className="flex items-start gap-2 ml-2">
              <span className="text-emerald-400 font-semibold text-xs mt-1 w-4 text-right">
                {numMatch[1]}.
              </span>
              <div className="flex-1">{renderInline(numMatch[2])}</div>
            </div>
          );
        }

        // Blockquotes
        if (line.startsWith('> ')) {
          return (
            <blockquote
              key={lIdx}
              className="border-l-2 border-emerald-500/60 pl-3 py-1 text-slate-300 italic bg-emerald-950/20 rounded-r my-1"
            >
              {renderInline(line.replace('> ', ''))}
            </blockquote>
          );
        }

        return <p key={lIdx}>{renderInline(line)}</p>;
      })}
    </div>
  );
};

function renderInline(text: string): React.ReactNode {
  // Inline code `code`
  const codeRegex = /`([^`]+)`/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderBoldItalic(text.substring(lastIndex, match.index)));
    }
    parts.push(
      <code
        key={match.index}
        className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-emerald-300 border border-white/5"
      >
        {match[1]}
      </code>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(renderBoldItalic(text.substring(lastIndex)));
  }

  return parts;
}

function renderBoldItalic(text: string): React.ReactNode {
  // Bold **text**
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  return boldParts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
