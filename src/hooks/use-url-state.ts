'use client';

import { parseAsString, parseAsArrayOf, useQueryStates } from 'nuqs';
import { useCallback, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

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
 * Extract text fragment from current URL hash
 * Only logs on actual text fragments to reduce console noise
 */
function getTextFragmentFromHash(): string | null {
  const hash = window.location.hash;
  // Extract text fragment: #:~:text=something
  const match = hash.match(/#:~:text=(.+)/);
  if (match && match[1]) {
    try {
      const decoded = decodeURIComponent(match[1]);
      console.log('[useUrlState] Extracted text fragment:', decoded);
      return decoded;
    } catch {
      console.log('[useUrlState] Failed to decode, using raw:', match[1]);
      return match[1];
    }
  }
  return null;
}

/**
 * Subscribe to hash changes
 */
function subscribeToHash(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

/**
 * Server snapshot for SSR (no hash on server)
 */
function getServerSnapshot(): null {
  return null;
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
  const router = useRouter();
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

  // Track text fragment using useSyncExternalStore (hash is not managed by nuqs)
  const textFragment = useSyncExternalStore(
    subscribeToHash,
    getTextFragmentFromHash,
    getServerSnapshot
  );

  const updateUrl = useCallback(async (updates: { 
    file?: string | null; 
    expanded?: Set<string> | null;
    textFragment?: string | null;
  }) => {
    // Handle text fragments with client-side navigation
    if (updates.textFragment !== undefined && updates.textFragment) {
      console.log('[useUrlState] Text fragment update:', updates.textFragment);
      
      // First update query params via nuqs (client-side)
      const newState: { file?: string | null; expanded?: string[] | null } = {};
      
      if (updates.file !== undefined) {
        newState.file = updates.file || null;
      }
      
      if (updates.expanded !== undefined) {
        newState.expanded = updates.expanded && updates.expanded.size > 0
          ? Array.from(updates.expanded)
          : null;
      }
      
      // Update state if needed
      if (Object.keys(newState).length > 0) {
        await setState(newState);
      }
      
      // Text fragment syntax: #:~:text=textStart
      // Percent-encode the text, including dashes as %2D per spec
      const encodedText = encodeURIComponent(updates.textFragment).replace(/-/g, '%2D');
      const fragment = `:~:text=${encodedText}`;
      
      console.log('[useUrlState] Setting text fragment:', fragment);
      
      // Set hash after state update
      // Note: Browser's native text fragment highlighting only works on full navigation
      // So we'll need to handle highlighting manually in the app
      window.location.hash = fragment;
    } else {
      // No text fragment - update query params normally
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

      await setState(newState);
      
      // Clear hash if explicitly set to null or when changing files without text fragment
      if (updates.textFragment === null || (updates.file !== undefined && updates.textFragment === undefined)) {
        console.log('[useUrlState] Clearing hash');
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
