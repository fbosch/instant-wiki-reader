import { useSearchParams, useRouter } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Custom hook for managing application state in URL parameters.
 * Provides functions to update file path and expanded directories in the URL.
 */
export function useUrlState() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateUrl = useCallback((updates: { file?: string | null; expanded?: Set<string> | null }) => {
    const params = new URLSearchParams(searchParams.toString());

    // Update file parameter
    if (updates.file !== undefined) {
      if (updates.file) {
        params.set('file', updates.file);
      } else {
        params.delete('file');
      }
    }

    // Update expanded directories parameter
    if (updates.expanded !== undefined) {
      if (updates.expanded && updates.expanded.size > 0) {
        params.set('expanded', Array.from(updates.expanded).join(','));
      } else {
        params.delete('expanded');
      }
    }

    const newUrl = params.toString();
    // Preserve the hash if present
    const hash = window.location.hash;
    const finalUrl = newUrl ? `?${newUrl}${hash}` : `/${hash}`;
    router.replace(finalUrl, { scroll: false });
  }, [router, searchParams]);

  const getFileFromUrl = useCallback(() => {
    const rawFile = searchParams.get('file');
    if (!rawFile) return null;
    
    // Handle double (or more) URL encoding by decoding until we get a stable result
    let decoded = rawFile;
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
  }, [searchParams]);

  const getExpandedFromUrl = useCallback(() => {
    const expandedParam = searchParams.get('expanded');
    return expandedParam ? new Set(expandedParam.split(',').filter(Boolean)) : new Set<string>();
  }, [searchParams]);

  return {
    updateUrl,
    getFileFromUrl,
    getExpandedFromUrl,
  };
}
