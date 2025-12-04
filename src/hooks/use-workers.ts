import { useEffect, useRef } from 'react';
import { wrap, type Remote } from 'comlink';
import type { TreeWorkerApi } from '@/workers/tree-worker';
import type { SearchWorkerApi } from '@/workers/search-worker';

// Import worker type - actual type will be imported from worker file
type ContentSearchWorkerType = {
  buildIndex(): Promise<{ success: boolean; fileCount: number }>;
  search(query: string): Promise<Array<{
    path: string;
    title: string;
    score: number;
    match: { [field: string]: string[] };
    terms: string[];
  }>>;
  getStatus(): Promise<{ isIndexed: boolean; fileCount: number; isIndexing: boolean }>;
  clearIndex(): Promise<void>;
};

/**
 * Hook to manage Web Workers with Comlink.
 * Creates workers on mount and terminates them on unmount.
 * 
 * @returns Worker API proxies
 */
export function useWorkers() {
  const treeWorkerRef = useRef<{ worker: Worker; api: Remote<TreeWorkerApi> } | null>(null);
  const searchWorkerRef = useRef<{ worker: Worker; api: Remote<SearchWorkerApi> } | null>(null);
  const contentSearchWorkerRef = useRef<{ worker: Worker; api: Remote<ContentSearchWorkerType> } | null>(null);

  useEffect(() => {
    // Initialize tree worker
    const treeWorker = new Worker(
      new URL('../workers/tree-worker.ts', import.meta.url),
      { type: 'module' }
    );
    const treeApi = wrap<TreeWorkerApi>(treeWorker);
    treeWorkerRef.current = { worker: treeWorker, api: treeApi };

    // Initialize search worker
    const searchWorker = new Worker(
      new URL('../workers/search-worker.ts', import.meta.url),
      { type: 'module' }
    );
    const searchApi = wrap<SearchWorkerApi>(searchWorker);
    searchWorkerRef.current = { worker: searchWorker, api: searchApi };

    // Initialize content search worker
    const contentSearchWorker = new Worker(
      new URL('../workers/content-search-worker.ts', import.meta.url),
      { type: 'module' }
    );
    const contentSearchApi = wrap<ContentSearchWorkerType>(contentSearchWorker);
    contentSearchWorkerRef.current = { worker: contentSearchWorker, api: contentSearchApi };

    // Cleanup on unmount
    return () => {
      treeWorkerRef.current?.worker.terminate();
      searchWorkerRef.current?.worker.terminate();
      contentSearchWorkerRef.current?.worker.terminate();
      treeWorkerRef.current = null;
      searchWorkerRef.current = null;
      contentSearchWorkerRef.current = null;
    };
  }, []);

  return {
    treeWorker: treeWorkerRef.current?.api,
    searchWorker: searchWorkerRef.current?.api,
    contentSearchWorker: contentSearchWorkerRef.current?.api,
  };
}
