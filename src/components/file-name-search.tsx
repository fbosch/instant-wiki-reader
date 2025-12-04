'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { useSnapshot } from 'valtio';
import { themeStore, colorThemes } from '@/store/theme-store';
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
  const { colorTheme } = useSnapshot(themeStore);
  const theme = colorThemes[colorTheme];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    
    // Calculate filtered tree and notify parent
    const trimmedQuery = newQuery.trim();
    if (!tree || !trimmedQuery) {
      onFilter(null, trimmedQuery);
    } else {
      // Filter the root node's children
      if (!tree.children) {
        onFilter(tree, trimmedQuery);
      } else {
        const filteredChildren = tree.children
          .map(child => filterTree(child, trimmedQuery))
          .filter((child): child is DirectoryNode => child !== null);
        
        onFilter({
          ...tree,
          children: filteredChildren,
        }, trimmedQuery);
      }
    }
  };

  const handleClear = () => {
    setQuery('');
    onFilter(null, '');
  };

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-4 h-4 pointer-events-none" style={{ color: theme.secondary }} />
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Filter files..."
          className="w-full pl-9 pr-9 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
          style={{
            backgroundColor: theme.code,
            borderColor: theme.border,
            color: theme.text,
            border: `1px solid ${theme.border}`,
          }}
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-2 p-1 rounded transition-colors hover:opacity-70"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" style={{ color: theme.secondary }} />
          </button>
        )}
      </div>
    </div>
  );
}
