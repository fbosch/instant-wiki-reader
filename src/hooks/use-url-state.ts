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
    const finalUrl = newUrl ? `?${newUrl}` : '/';
    router.replace(finalUrl, { scroll: false });
  }, [router, searchParams]);

  const getFileFromUrl = useCallback(() => {
    return searchParams.get('file');
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
