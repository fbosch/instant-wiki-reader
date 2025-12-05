'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { parseAsString, useQueryStates } from 'nuqs';
import { useRouter } from 'next/navigation';

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
 * Get text fragment from hash
 */
function getTextFragmentFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  
  const hash = window.location.hash;
  const match = hash.match(/#:~:text=(.+)/);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1].replace(/%2D/g, '-'));
    } catch {
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
 * Server snapshot
 */
function getServerSnapshot(): null {
  return null;
}

/**
 * Custom parsers for nuqs
 */
const fileParser = parseAsString.withDefault('');

/**
 * Custom hook for managing application state in URL.
 * Uses nuqs for query params, useSyncExternalStore for hash.
 * 
 * Note: Expanded directories are NOT stored in URL - they persist in sessionStorage
 * via Valtio. Only the file path is in the URL, and parent dirs are auto-expanded.
 */
export function useUrlState() {
  const router = useRouter();
  
  // Use nuqs for query parameters (only file, not expanded)
  const [state, setState] = useQueryStates(
    {
      file: fileParser,
    },
    {
      history: 'replace',
      scroll: false,
    }
  );
  
  // Use useSyncExternalStore for hash (text fragment)
  const textFragment = useSyncExternalStore(
    subscribeToHash,
    getTextFragmentFromHash,
    getServerSnapshot
  );

  const updateUrl = useCallback(async (updates: { 
    file?: string | null; 
    textFragment?: string | null;
  }) => {
    console.log('[useUrlState] updateUrl called with:', updates);
    
    // If we have a text fragment, we need to handle URL update manually
    // because nuqs doesn't support hash fragments
    if (updates.textFragment !== undefined && updates.textFragment) {
      const encodedText = encodeURIComponent(updates.textFragment).replace(/-/g, '%2D');
      const hash = `#:~:text=${encodedText}`;
      
      // Build query params manually
      const params = new URLSearchParams(window.location.search);
      
      if (updates.file !== undefined) {
        if (updates.file) params.set('file', updates.file);
        else params.delete('file');
      }
      
      const queryString = params.toString();
      const newPath = `${window.location.pathname}${queryString ? '?' + queryString : ''}${hash}`;
      
      console.log('[useUrlState] Replacing with path (with hash):', newPath);
      router.replace(newPath, { scroll: false });
      
      return;
    }
    
    // No text fragment - use nuqs normally
    const newState: { file?: string | null } = {};
    
    if (updates.file !== undefined) {
      newState.file = updates.file || null;
    }
    
    await setState(newState);
    
    // Clear hash if explicitly requested
    if (updates.textFragment === null) {
      console.log('[useUrlState] Clearing hash');
      window.location.hash = '';
    }
  }, [setState, router]);

  const getFileFromUrl = useCallback(() => {
    const rawFile = state.file;
    if (!rawFile) return null;
    return decodeFilePath(rawFile);
  }, [state.file]);

  const getHighlightFromUrl = useCallback(() => {
    return textFragment;
  }, [textFragment]);

  return {
    updateUrl,
    getFileFromUrl,
    getHighlightFromUrl,
  };
}
