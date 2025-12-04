'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useFileSystem } from '@/contexts/FileSystemContext';
import { useUrlState } from '@/hooks/use-url-state';
import { Search, FileText, Loader2 } from 'lucide-react';
import { formatFileName } from '@/lib/utils';
import type { ContentSearchResult } from '@/types';
import { 
  Combobox, 
  ComboboxInput, 
  ComboboxOptions, 
  ComboboxOption, 
  Dialog, 
  Transition 
} from '@headlessui/react';
import { useSnapshot } from 'valtio';
import { themeStore, colorThemes } from '@/store/theme-store';

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
            className="bg-amber-600 dark:bg-amber-500/40 text-white dark:text-amber-100 px-1 py-0.5 rounded font-semibold border border-amber-900/60 dark:border-amber-500/70"
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
 * Uses Headless UI for better accessibility and keyboard navigation
 */
export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const { searchContent } = useFileSystem();
  const { updateUrl } = useUrlState();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContentSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const theme = useSnapshot(themeStore);
  const colors = colorThemes[theme.colorTheme];

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

  const handleSelectResult = useCallback((result: ContentSearchResult | null) => {
    if (!result) return;
    
    // Extract first matched text from result for text fragment navigation
    let textFragment: string | null = null;
    const firstMatch = Object.values(result.match)[0]?.[0];
    console.log('[CommandPalette] First match snippet:', firstMatch);
    
    if (firstMatch) {
      // Extract text from <mark>text</mark> pattern
      const markMatch = firstMatch.match(/<mark>(.*?)<\/mark>/);
      if (markMatch && markMatch[1]) {
        // Decode HTML entities
        textFragment = markMatch[1]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#039;/g, "'")
          .replace(/&amp;/g, '&');
        
        console.log('[CommandPalette] Extracted text fragment:', textFragment);
      }
    }
    
    console.log('[CommandPalette] Updating URL:', { file: result.path, textFragment });
    
    // Update URL with file path and text fragment
    // The page's URL restoration logic will handle opening the file
    updateUrl({ 
      file: result.path,
      textFragment 
    });
    
    onClose();
  }, [updateUrl, onClose]);

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity data-[closed]:opacity-0 data-[enter]:ease-out data-[enter]:duration-200 data-[leave]:ease-in data-[leave]:duration-150" />

        {/* Dialog positioning */}
        <div className="fixed inset-0 flex items-start justify-center pt-[20vh]">
          <div 
            className="w-full max-w-2xl rounded-lg shadow-2xl overflow-hidden transition-all data-[closed]:scale-95 data-[closed]:opacity-0 data-[enter]:ease-out data-[enter]:duration-200 data-[leave]:ease-in data-[leave]:duration-150"
            style={{ backgroundColor: colors.bg }}
          >
            <Combobox value={null} onChange={handleSelectResult}>
                {/* Search Input */}
                <div 
                  className="flex items-center gap-3 px-4 py-3 border-b"
                  style={{ borderColor: colors.border }}
                >
                  <Search className="w-5 h-5 flex-shrink-0" style={{ color: colors.secondary }} />
                  <ComboboxInput
                    autoFocus
                    className="flex-1 bg-transparent outline-none text-base"
                    style={{ color: colors.text }}
                    placeholder="Search file contents... (Cmd+Shift+F)"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {isSearching && (
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                  )}
                </div>

                {/* Results */}
                <ComboboxOptions static className="max-h-[60vh] overflow-y-auto">
                  {query.trim() && !isSearching && results.length === 0 && (
                    <div className="px-4 py-8 text-center" style={{ color: colors.secondary }}>
                      No results found for "{query}"
                    </div>
                  )}

                  {!query.trim() && (
                    <div className="px-4 py-8 text-center" style={{ color: colors.secondary }}>
                      <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>Type to search file contents</p>
                      <p className="text-xs mt-1">Use ↑↓ to navigate, Enter to open</p>
                    </div>
                  )}

                  {results.map((result) => (
                    <ComboboxOption
                      key={result.path}
                      value={result}
                      className="w-full px-4 py-2 text-left cursor-pointer"
                    >
                      {({ focus }) => (
                        <div 
                          className="flex items-start gap-3 p-3 rounded-lg transition-all duration-150"
                          style={{
                            backgroundColor: focus 
                              ? (theme.colorTheme === 'dark' || theme.colorTheme === 'black' 
                                  ? 'rgba(59, 130, 246, 0.15)' 
                                  : 'rgba(59, 130, 246, 0.1)')
                              : 'transparent',
                            border: focus 
                              ? `1px solid ${theme.colorTheme === 'dark' || theme.colorTheme === 'black' 
                                  ? 'rgba(59, 130, 246, 0.3)' 
                                  : 'rgba(59, 130, 246, 0.2)'}`
                              : '1px solid transparent',
                          }}
                        >
                          <FileText className="w-4 h-4 mt-1 flex-shrink-0" style={{ color: colors.secondary }} />
                          <div className="flex-1 min-w-0">
                            {/* File name */}
                            <div className="font-medium truncate" style={{ color: colors.text }}>
                              {formatFileName(result.title, true)}
                            </div>
                            
                            {/* File path */}
                            <div className="text-xs truncate mt-0.5" style={{ color: colors.secondary }}>
                              {result.path}
                            </div>

                            {/* Matched snippets */}
                            {result.match && Object.keys(result.match).length > 0 && (
                              <div className="mt-2 space-y-1">
                                {Object.entries(result.match).slice(0, 2).map(([, matches], i) => (
                                  <div key={i} className="text-sm" style={{ color: colors.text }}>
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
                            <div className="text-xs mt-1" style={{ color: colors.secondary }}>
                              Relevance: {Math.round(result.score * 100) / 100}
                            </div>
                          </div>
                        </div>
                      )}
                    </ComboboxOption>
                  ))}
                </ComboboxOptions>
              </Combobox>
            </div>
          </div>
        </Dialog>
      </Transition>
  );
}
