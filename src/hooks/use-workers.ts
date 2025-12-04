import { useSyncExternalStore, useCallback } from "react";
import { wrap, type Remote } from "comlink";
import type { TreeWorkerApi } from "@/workers/tree-worker";
import type { SearchWorkerApi } from "@/workers/search-worker";

// Match context for regex search results
interface MatchContext {
  lineNumber: number;
  line: string;
  matchStart: number;
  matchEnd: number;
}

// Regex search result
interface RegexSearchResult {
  path: string;
  title: string;
  matches: MatchContext[];
  matchCount: number;
}

// Content search worker API
type ContentSearchWorkerType = {
  buildIndex(): Promise<{ success: boolean; fileCount: number }>;
  search(query: string): Promise<
    Array<{
      path: string;
      title: string;
      score: number;
      match: { [field: string]: string[] };
      terms: string[];
    }>
  >;
  regexSearch(
    pattern: string,
    options?: {
      maxResults?: number;
      contextLines?: number;
    },
  ): Promise<RegexSearchResult[]>;
  getStatus(): Promise<{
    isIndexed: boolean;
    fileCount: number;
    isIndexing: boolean;
  }>;
  clearIndex(): Promise<void>;
};

// Worker store interface
interface WorkerStore {
  treeWorker: Remote<TreeWorkerApi> | null;
  searchWorker: Remote<SearchWorkerApi> | null;
  contentSearchWorker: Remote<ContentSearchWorkerType> | null;
}

// Global worker store
const workerStore: WorkerStore = {
  treeWorker: null,
  searchWorker: null,
  contentSearchWorker: null,
};

// Subscribers for store changes
const subscribers = new Set<() => void>();

// Initialize workers once
let initialized = false;

function initializeWorkers() {
  if (initialized) return;
  initialized = true;

  // Initialize tree worker
  const treeWorkerInstance = new Worker(
    new URL("../workers/tree-worker.ts", import.meta.url),
    { type: "module" },
  );
  workerStore.treeWorker = wrap<TreeWorkerApi>(treeWorkerInstance);

  // Initialize search worker
  const searchWorkerInstance = new Worker(
    new URL("../workers/search-worker.ts", import.meta.url),
    { type: "module" },
  );
  workerStore.searchWorker = wrap<SearchWorkerApi>(searchWorkerInstance);

  // Initialize content search worker
  const contentSearchWorkerInstance = new Worker(
    new URL("../workers/content-search-worker.ts", import.meta.url),
    { type: "module" },
  );
  workerStore.contentSearchWorker = wrap<ContentSearchWorkerType>(
    contentSearchWorkerInstance,
  );

  // Trigger auto-initialization in the worker
  console.log('[useWorkers] Triggering worker initialization...');
  workerStore.contentSearchWorker.getStatus().then(status => {
    console.log('[useWorkers] Worker status after init:', status);
  });

  // Notify subscribers
  subscribers.forEach((callback) => callback());
}

// Subscribe to worker store changes
function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

// Get current worker store snapshot
function getSnapshot() {
  return workerStore;
}

// Server-side snapshot (returns null workers) - cached to avoid infinite loop
const serverSnapshot: WorkerStore = {
  treeWorker: null,
  searchWorker: null,
  contentSearchWorker: null,
};

function getServerSnapshot(): WorkerStore {
  return serverSnapshot;
}

/**
 * Hook to manage Web Workers with Comlink.
 * Uses useSyncExternalStore for proper React integration.
 * Workers are initialized once globally and shared across components.
 *
 * @returns Worker API proxies
 */
export function useWorkers() {
  // Initialize workers on first call
  if (typeof window !== "undefined" && !initialized) {
    initializeWorkers();
  }

  // Subscribe to worker store
  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return store;
}
