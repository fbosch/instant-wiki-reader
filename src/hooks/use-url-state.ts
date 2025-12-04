'use client';

import { parseAsString, parseAsArrayOf, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

/**
 * Helper function to decode file paths that may be double-encoded
 */
function decodeFilePath(value: string): string {
  // Handle double (or more) URL encoding by decoding until we get a stable result
  let decoded = value;
  let prevDecoded = '';
  let attempts = 0;
  
  // Keep decoding until the string doesn't change anymore (max 3 iterations)
  while (decoded !== prevDecoded && attempts < 3) {
    prevDecoded = decoded;
    try {
      decoded = decodeURIComponent(decoded);
    } catch (e) {
      // If decoding fails, stop and return what we have
      break;
    }
    attempts++;
  }
  
  return decoded;
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
 * Provides functions to update file path and expanded directories in the URL.
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

  const updateUrl = useCallback((updates: { file?: string | null; expanded?: Set<string> | null }) => {
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

  return {
    updateUrl,
    getFileFromUrl,
    getExpandedFromUrl,
  };
}
