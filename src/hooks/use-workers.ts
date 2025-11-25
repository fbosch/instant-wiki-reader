import { useEffect, useRef } from 'react';
import { wrap, type Remote } from 'comlink';
import type { TreeWorkerApi } from '@/workers/tree-worker';
import type { SearchWorkerApi } from '@/workers/search-worker';

/**
 * Hook to manage Web Workers with Comlink.
 * Creates workers on mount and terminates them on unmount.
 * 
 * @returns Worker API proxies
 */
export function useWorkers() {
  const treeWorkerRef = useRef<{ worker: Worker; api: Remote<TreeWorkerApi> } | null>(null);
  const searchWorkerRef = useRef<{ worker: Worker; api: Remote<SearchWorkerApi> } | null>(null);

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

    // Cleanup on unmount
    return () => {
      treeWorkerRef.current?.worker.terminate();
      searchWorkerRef.current?.worker.terminate();
      treeWorkerRef.current = null;
      searchWorkerRef.current = null;
    };
  }, []);

  return {
    treeWorker: treeWorkerRef.current?.api,
    searchWorker: searchWorkerRef.current?.api,
  };
}
