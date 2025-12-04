'use client';

import { useState, useMemo, useDeferredValue } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import type { DirectoryNode } from '@/types';

interface FileNameSearchProps {
  tree: DirectoryNode | null;
  onFilter: (filteredTree: DirectoryNode | null, searchQuery: string) => void;
}

/**
 * Check if text contains all search words (space-separated)
 */
function matchesAllWords(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  
  // All words must be present in the text
  return words.every(word => lowerText.includes(word));
}

/**
 * Filter a directory tree by file name query
 * Query can contain multiple words separated by spaces - all must match
 * Recursively filters from bottom up - directories are included if they 
 * contain matching files/subdirectories
 */
function filterTree(node: DirectoryNode, query: string): DirectoryNode | null {
  // For files, check if name matches all words
  if (node.type === 'file') {
    return matchesAllWords(node.name, query) ? node : null;
  }
  
  // For directories, recursively filter children first
  if (node.type === 'dir' && node.children) {
    const filteredChildren = node.children
      .map(child => filterTree(child, query))
      .filter((child): child is DirectoryNode => child !== null);
    
    // Include directory if:
    // 1. It has matching children (recursive matches), OR
    // 2. The directory name itself matches
    if (filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
        isExpanded: true, // Auto-expand directories with matches
      };
    }
    
    // Directory name matches but no children match
    if (matchesAllWords(node.name, query)) {
      return {
        ...node,
        children: filteredChildren, // Empty array
        isExpanded: true,
      };
    }
  }
  
  return null;
}

/**
 * Filename search bar for filtering file tree in sidebar
 * Uses useDeferredValue for non-blocking updates
 */
export function FileNameSearch({ tree, onFilter }: FileNameSearchProps) {
  const [query, setQuery] = useState('');
  
  // Defer the query value to keep input responsive
  const deferredQuery = useDeferredValue(query);

  // Filter tree based on deferred query (memoized)
  const filteredTree = useMemo(() => {
    // No query = return null (use original tree in parent)
    if (!tree || !deferredQuery.trim()) {
      return null;
    }
    
    // Filter the root node's children
    if (!tree.children) {
      return tree;
    }
    
    const filteredChildren = tree.children
      .map(child => filterTree(child, deferredQuery.trim()))
      .filter((child): child is DirectoryNode => child !== null);
    
    // Return a new root with filtered children (even if empty)
    return {
      ...tree,
      children: filteredChildren,
    };
  }, [tree, deferredQuery]);

  // Notify parent of filter changes (during render)
  // This is safe because onFilter just updates parent state
  onFilter(filteredTree, deferredQuery.trim());

  const handleClear = () => {
    setQuery('');
  };

  const isSearching = query !== deferredQuery;

  return (
    <div className="relative">
      <div className="relative flex items-center">
        {isSearching ? (
          <Loader2 className="absolute left-3 w-4 h-4 text-blue-500 animate-spin pointer-events-none" />
        ) : (
          <Search className="absolute left-3 w-4 h-4 text-slate-400 pointer-events-none" />
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter files..."
          className="w-full pl-9 pr-9 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-50 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-2 p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        )}
      </div>
    </div>
  );
}
