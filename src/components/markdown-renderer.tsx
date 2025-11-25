'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content with proper styling.
 * Uses react-markdown for parsing and rendering.
 * 
 * @param content - Markdown content to render
 * @param className - Optional additional CSS classes
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({ 
  content, 
  className 
}: MarkdownRendererProps) {
  return (
    <div className={cn('prose prose-slate dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        components={{
          // Custom heading rendering with anchor links
          h1: ({ children, ...props }) => (
            <h1 className="text-4xl font-bold mt-8 mb-4" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="text-3xl font-semibold mt-6 mb-3" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-2xl font-semibold mt-4 mb-2" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="text-xl font-semibold mt-3 mb-2" {...props}>
              {children}
            </h4>
          ),
          // Code blocks with syntax highlighting placeholder
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match;
            
            if (isInline) {
              return (
                <code
                  className="bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 text-sm font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={cn(
                  'block bg-gray-100 dark:bg-gray-800 rounded p-4 overflow-x-auto text-sm font-mono',
                  className
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
          // Links with proper styling
          a: ({ children, href, ...props }) => (
            <a
              href={href}
              className="text-blue-600 dark:text-blue-400 hover:underline"
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
              {...props}
            >
              {children}
            </a>
          ),
          // Blockquotes
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic my-4"
              {...props}
            >
              {children}
            </blockquote>
          ),
          // Lists
          ul: ({ children, ...props }) => (
            <ul className="list-disc list-inside my-4 space-y-2" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="list-decimal list-inside my-4 space-y-2" {...props}>
              {children}
            </ol>
          ),
          // Tables
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border border-gray-300 dark:border-gray-600" {...props}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              className="border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-left font-semibold"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-gray-300 dark:border-gray-600 px-4 py-2" {...props}>
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
