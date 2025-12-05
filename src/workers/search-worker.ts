/**
 * Web Worker for filename and metadata search.
 * Uses Comlink for seamless RPC-style communication with main thread.
 * Uses Fuse.js for fuzzy filename/heading search (non-blocking).
 * 
 * Note: Full-text content search is handled by content-search-worker.ts
 */

import { expose } from 'comlink';
import Fuse from 'fuse.js';
import type { IFuseOptions } from 'fuse.js';

/**
 * Simple file metadata for search indexing
 */
interface FileMetadata {
  path: string;
  name: string;
}

/**
 * Search result from Fuse.js
 */
interface SearchResult {
  path: string;
  name: string;
  score: number;
}

// Store Fuse instance globally in worker
let fuseInstance: Fuse<FileMetadata> | null = null;

/**
 * Build search index from file metadata.
 * Fuse.js handles all the search logic - no custom extraction needed!
 * 
 * @param files - Array of file metadata (path + name)
 */
function buildIndex(files: FileMetadata[]): void {
  const fuseOptions: IFuseOptions<FileMetadata> = {
    keys: ['name', 'path'],      // Search in filename and path
    threshold: 0.3,              // 0 = exact match, 1 = match anything (0.3 is good balance)
    distance: 100,               // How far to search for pattern
    minMatchCharLength: 2,       // Minimum 2 characters to match
    includeScore: true,          // Include match score
    includeMatches: false,       // Don't need match positions for simple filename search
    ignoreLocation: true,        // Search anywhere in text
    findAllMatches: false,       // Stop at first good match (faster)
  };

  fuseInstance = new Fuse(files, fuseOptions);
  console.log(`[SearchWorker] Index built with ${files.length} files`);
}

/**
 * Search through indexed files using Fuse.js.
 * 
 * @param query - Search query
 * @returns Array of matching files with scores
 */
function search(query: string): SearchResult[] {
  if (!query.trim() || !fuseInstance) {
    return [];
  }

  // Let Fuse.js do all the work!
  const results = fuseInstance.search(query);
  
  // Transform to simpler format
  return results.map((result) => ({
    path: result.item.path,
    name: result.item.name,
    // Invert score: Fuse.js uses 0 = best, 1 = worst
    // We return 0-10 where 10 = best match
    score: result.score !== undefined ? (1 - result.score) * 10 : 0,
  }));
}

// Worker API
const workerApi = {
  buildIndex,
  search,
};

// Expose API via Comlink
expose(workerApi);

export type SearchWorkerApi = typeof workerApi;
