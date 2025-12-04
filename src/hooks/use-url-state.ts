'use client';

import { parseAsString, parseAsArrayOf, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useState } from 'react';

/**
 * Helper function to decode URL-encoded file paths
 */
function decodeFilePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    // If decoding fails, return the original value
    return value;
  }
}

/**
 * Custom parser for file parameter with double-decode support
 */
const fileParser = parseAsString.withDefault('');

/**
 * Custom parser for expanded directories (comma-separated array)
 */
const expandedParser = parseAsArrayOf(parseAsString, ',').withDefault([]);

/**
 * Custom hook for managing application state in URL parameters using nuqs.
 * Provides functions to update file path, expanded directories, and text fragments in the URL.
 */
export function useUrlState() {
  const [state, setState] = useQueryStates(
    {
      file: fileParser,
      expanded: expandedParser,
    },
    {
      history: 'replace',
      scroll: false,
    }
  );

  // Track text fragment separately (hash is not managed by nuqs)
  const [textFragment, setTextFragment] = useState<string | null>(null);

  // Listen for hash changes to extract text fragments
  useEffect(() => {
    const updateTextFragment = () => {
      const hash = window.location.hash;
      // Extract text fragment: #:~:text=something
      const match = hash.match(/#:~:text=(.+)/);
      if (match && match[1]) {
        try {
          setTextFragment(decodeURIComponent(match[1]));
        } catch {
          setTextFragment(match[1]);
        }
      } else {
        setTextFragment(null);
      }
    };

    // Initial check
    updateTextFragment();

    // Listen for hash changes
    window.addEventListener('hashchange', updateTextFragment);
    return () => window.removeEventListener('hashchange', updateTextFragment);
  }, []);

  const updateUrl = useCallback((updates: { 
    file?: string | null; 
    expanded?: Set<string> | null;
    textFragment?: string | null;
  }) => {
    const newState: { file?: string | null; expanded?: string[] | null } = {};

    // Update file parameter
    if (updates.file !== undefined) {
      newState.file = updates.file || null;
    }

    // Update expanded directories parameter
    if (updates.expanded !== undefined) {
      newState.expanded = updates.expanded && updates.expanded.size > 0
        ? Array.from(updates.expanded)
        : null;
    }

    setState(newState);

    // Handle text fragment separately (it's a hash, not a query param)
    if (updates.textFragment !== undefined) {
      if (updates.textFragment) {
        // Add text fragment to URL
        window.location.hash = `#:~:text=${encodeURIComponent(updates.textFragment)}`;
      } else {
        // Clear text fragment
        window.location.hash = '';
      }
    }
  }, [setState]);

  const getFileFromUrl = useCallback(() => {
    const rawFile = state.file;
    if (!rawFile) return null;
    
    // Apply double-decode logic
    return decodeFilePath(rawFile);
  }, [state.file]);

  const getExpandedFromUrl = useCallback(() => {
    return new Set(state.expanded);
  }, [state.expanded]);

  const getTextFragmentFromUrl = useCallback(() => {
    return textFragment;
  }, [textFragment]);

  return {
    updateUrl,
    getFileFromUrl,
    getExpandedFromUrl,
    getTextFragmentFromUrl,
  };
}
