'use client';

import { useCallback } from 'react';
import { parseAsString, useQueryStates } from 'nuqs';

/**
 * Helper function to decode URL-encoded file paths
 */
function decodeFilePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

/**
 * Custom parsers for nuqs
 */
const fileParser = parseAsString.withDefault('');
const highlightParser = parseAsString.withDefault('');

/**
 * Custom hook for managing application state in URL.
 * Uses nuqs for all query parameters including file path and highlight text.
 * 
 * Note: Expanded directories are NOT stored in URL - they persist in sessionStorage
 * via Valtio. Only the file path and highlight text are in the URL.
 */
export function useUrlState() {
  // Use nuqs for query parameters (file and highlight)
  const [state, setState] = useQueryStates(
    {
      file: fileParser,
      highlight: highlightParser,
    },
    {
      history: 'replace',
      scroll: false,
    }
  );

  const updateUrl = useCallback(async (updates: { 
    file?: string | null; 
    textFragment?: string | null;
  }) => {
    console.log('[useUrlState] updateUrl called with:', updates);
    
    const newState: { file?: string | null; highlight?: string | null } = {};
    
    if (updates.file !== undefined) {
      newState.file = updates.file || null;
    }
    
    if (updates.textFragment !== undefined) {
      newState.highlight = updates.textFragment || null;
    }
    
    console.log('[useUrlState] Setting state:', newState);
    await setState(newState);
  }, [setState]);

  const getFileFromUrl = useCallback(() => {
    const rawFile = state.file;
    if (!rawFile) return null;
    return decodeFilePath(rawFile);
  }, [state.file]);

  const getHighlightFromUrl = useCallback(() => {
    const highlight = state.highlight;
    if (!highlight) return null;
    console.log('[useUrlState] getHighlightFromUrl returning:', highlight);
    return highlight;
  }, [state.highlight]);

  return {
    updateUrl,
    getFileFromUrl,
    getHighlightFromUrl,
  };
}
