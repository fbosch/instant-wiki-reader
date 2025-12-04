'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFileSystem } from '@/contexts/FileSystemContext';
import { Search, FileText, Loader2, X } from 'lucide-react';
import { formatFileName } from '@/lib/utils';
import type { ContentSearchResult } from '@/types';

/**
 * Parse HTML snippet with <mark> tags and render as React components
 */
function HighlightedSnippet({ html }: { html: string }) {
  // Parse the HTML string to extract text and mark positions
  const segments: Array<{ text: string; isHighlight: boolean }> = [];
  
  // Simple parser for <mark>text</mark> patterns
  const markRegex = /<mark>(.*?)<\/mark>/g;
  let lastIndex = 0;
  let match;
  
  while ((match = markRegex.exec(html)) !== null) {
    // Add text before the mark
    if (match.index > lastIndex) {
      const beforeText = html.substring(lastIndex, match.index);
      // Decode HTML entities
      const decoded = beforeText
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
      segments.push({ text: decoded, isHighlight: false });
    }
    
    // Add the highlighted text
    const highlightText = match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');
    segments.push({ text: highlightText, isHighlight: true });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < html.length) {
    const remainingText = html.substring(lastIndex)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');
    segments.push({ text: remainingText, isHighlight: false });
  }
  
  return (
    <>
      {segments.map((segment, index) =>
        segment.isHighlight ? (
          <mark
            key={index}
            className="bg-blue-200 dark:bg-blue-600/40 text-slate-900 dark:text-slate-50 px-0.5 rounded font-medium"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Command palette for fuzzy full-text content search
 * Triggered by Cmd+K / Ctrl+K
 */
export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const { searchContent, openFile } = useFileSystem();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContentSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Handle search with debouncing
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const searchResults = await searchContent(searchQuery);
      setResults(searchResults);
      setSelectedIndex(0);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchContent]);

  // Debounced search
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (query.trim()) {
      setIsSearching(true);
      debounceTimerRef.current = setTimeout(() => {
        performSearch(query);
      }, 300);
    } else {
      setResults([]);
      setIsSearching(false);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, performSearch]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelectResult(results[selectedIndex]);
        }
        break;
    }
  }, [results, selectedIndex, onClose]);

  const handleSelectResult = useCallback(async (result: ContentSearchResult) => {
    try {
      await openFile(result.path);
      onClose();
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }, [openFile, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl bg-white dark:bg-slate-800 rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <Search className="w-5 h-5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search file contents... (Cmd+Shift+F)"
            className="flex-1 bg-transparent text-slate-900 dark:text-slate-50 placeholder-slate-400 outline-none text-base"
          />
          {isSearching && (
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {query.trim() && !isSearching && results.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
              No results found for "{query}"
            </div>
          )}

          {results.length > 0 && (
            <div className="py-2">
              {results.map((result, index) => (
                <button
                  key={result.path}
                  onClick={() => handleSelectResult(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full px-4 py-3 text-left transition-colors ${
                    index === selectedIndex
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <FileText className="w-4 h-4 text-slate-400 mt-1 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      {/* File name */}
                      <div className="font-medium text-slate-900 dark:text-slate-50 truncate">
                        {formatFileName(result.title, true)}
                      </div>
                      
                      {/* File path */}
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {result.path}
                      </div>

                      {/* Matched snippets */}
                      {result.match && Object.keys(result.match).length > 0 && (
                        <div className="mt-2 space-y-1">
                          {Object.entries(result.match).slice(0, 2).map(([, matches], i) => (
                            <div key={i} className="text-sm text-slate-600 dark:text-slate-300">
                              {matches.slice(0, 1).map((match, j) => (
                                <div key={j} className="truncate">
                                  <HighlightedSnippet html={match} />
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Score indicator */}
                      <div className="text-xs text-slate-400 mt-1">
                        Relevance: {Math.round(result.score * 100) / 100}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!query.trim() && (
            <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Type to search file contents</p>
              <p className="text-xs mt-1">Use ↑↓ to navigate, Enter to open</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
