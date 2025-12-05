/**
 * Content Search Worker
 * 
 * Provides full-text search using Fuse.js (fuzzy, ranked, field-boosted).
 * Accesses IndexedDB directly to avoid blocking the main thread.
 * Exposed via Comlink for easy async API.
 */

console.log('[ContentSearchWorker] Module loading...');

import Fuse from 'fuse.js';
import type { IFuseOptions } from 'fuse.js';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { expose } from 'comlink';
import { FILE_CONTENTS_DB_NAME, FILE_CONTENTS_DB_VERSION } from '@/lib/db-constants';

console.log('[ContentSearchWorker] Imports loaded');

/**
 * IndexedDB schema for file contents (must match main thread schema)
 */
interface FileContentsDB extends DBSchema {
  'metadata': {
    key: string;
    value: {
      path: string;
      name: string;
      size: number;
      lastModified: number;
      type: string;
    };
  };
  'contents': {
    key: string;
    value: {
      path: string;
      content: string | ArrayBuffer; // Support both new (string) and legacy (ArrayBuffer)
      lastModified: number;
    };
  };
}

/**
 * Search result with context (for full-text search)
 */
export interface SearchResult {
  path: string;
  title: string;
  score: number;
  match: {
    [field: string]: string[];
  };
  terms: string[];
}

/**
 * Document for indexing
 */
interface SearchDocument {
  id: string;
  path: string;
  title: string;
  content: string;
  headings: string;
}

/**
 * Helper to decode content (supports both string and legacy ArrayBuffer format)
 */
function getContentAsString(content: string | ArrayBuffer): string {
  if (typeof content === 'string') {
    return content;
  }
  // Legacy ArrayBuffer format
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(content);
}

class ContentSearchWorker {
  private searchEngine: Fuse<SearchDocument> | null = null;
  private db: IDBPDatabase<FileContentsDB> | null = null;
  private isIndexing = false;
  private indexedFileCount = 0;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Auto-initialize when worker is created
    console.log('[ContentSearchWorker] Worker created, starting auto-initialization...');
    this.initPromise = this.autoInit();
  }

  /**
   * Auto-initialize: build index from IndexedDB when worker starts
   */
  private async autoInit(): Promise<void> {
    try {
      console.log('[ContentSearchWorker] Auto-init starting...');
      console.log('[ContentSearchWorker] Opening IndexedDB connection...');
      const db = await this.getDB();
      console.log('[ContentSearchWorker] IndexedDB opened, counting contents...');
      const fileCount = await db.count('contents');
      
      console.log(`[ContentSearchWorker] Found ${fileCount} files in IndexedDB 'contents' store`);
      
      if (fileCount > 0) {
        console.log('[ContentSearchWorker] Files found! Building initial index...');
        const result = await this.buildIndex();
        console.log('[ContentSearchWorker] Initial index built:', result);
      } else {
        console.warn('[ContentSearchWorker] No files to index yet (IndexedDB "contents" store is empty)');
        console.log('[ContentSearchWorker] The main thread needs to cache files first');
      }
      
      console.log('[ContentSearchWorker] Auto-init completed');
    } catch (error) {
      console.error('[ContentSearchWorker] Auto-init failed with error:', error);
      console.error('[ContentSearchWorker] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    }
  }

  /**
   * Get or create the file contents database
   */
  private async getDB(): Promise<IDBPDatabase<FileContentsDB>> {
    if (!this.db) {
      this.db = await openDB<FileContentsDB>(FILE_CONTENTS_DB_NAME, FILE_CONTENTS_DB_VERSION, {
        upgrade(db, oldVersion) {
          // Create metadata store for lightweight file info (tree rendering)
          if (!db.objectStoreNames.contains('metadata')) {
            db.createObjectStore('metadata', { keyPath: 'path' });
          }
          
          // Create/update contents store for file text content (on-demand loading)
          if (!db.objectStoreNames.contains('contents')) {
            db.createObjectStore('contents', { keyPath: 'path' });
          }
          
          console.log(`[ContentSearchWorker] Upgraded DB from version ${oldVersion} to ${FILE_CONTENTS_DB_VERSION}`);
        },
      });
    }
    return this.db;
  }

  /**
   * Extract title from markdown content (first h1 or filename)
   */
  private extractTitle(path: string, content: string): string {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      return h1Match[1].trim();
    }
    
    // Fallback to filename
    const filename = path.split('/').pop() || path;
    return filename.replace(/\.md$/, '').replace(/-/g, ' ');
  }

  /**
   * Extract all headings from markdown content
   */
  private extractHeadings(content: string): string {
    const headings: string[] = [];
    const headingRegex = /^#{1,6}\s+(.+)$/gm;
    let match;
    
    while ((match = headingRegex.exec(content)) !== null) {
      headings.push(match[1].trim());
    }
    
    return headings.join(' ');
  }

  /**
   * Build search index from files in IndexedDB
   * Only indexes title and headings (not full content) for speed
   */
  async buildIndex(): Promise<{ success: boolean; fileCount: number }> {
    if (this.isIndexing) {
      return { success: false, fileCount: 0 };
    }

    try {
      this.isIndexing = true;
      console.log('[ContentSearchWorker] Building search index...');

      // Load all files from IndexedDB
      const db = await this.getDB();
      const allFiles = await db.getAll('contents');

      console.log(`[ContentSearchWorker] Found ${allFiles.length} files in cache`);
      
      if (allFiles.length === 0) {
        console.warn('[ContentSearchWorker] No files found in IndexedDB contents store!');
        return { success: false, fileCount: 0 };
      }
      
      console.log('[ContentSearchWorker] Sample file paths:', allFiles.slice(0, 3).map(f => f.path));
      console.log('[ContentSearchWorker] Sample content types:', allFiles.slice(0, 3).map(f => typeof f.content));

      // Prepare documents for Fuse.js - DON'T index full content (too slow)
      const documents: SearchDocument[] = allFiles.map((file) => {
        const contentStr = getContentAsString(file.content);
        return {
          id: file.path,
          path: file.path,
          title: this.extractTitle(file.path, contentStr),
          content: '', // Don't index content - we'll search it separately
          headings: this.extractHeadings(contentStr),
        };
      });

      // Initialize Fuse.js with documents - optimized for speed
      const fuseOptions: IFuseOptions<SearchDocument> = {
        keys: [
          { name: 'title', weight: 0.7 },     // Title gets highest weight
          { name: 'headings', weight: 0.3 },  // Headings get lower weight
          // content is NOT searched with Fuse (too slow) - we use regex instead
        ],
        threshold: 0.4,              // 0 = exact, 1 = match anything (0.4 balanced for fuzzy)
        distance: 100,               // Reduced from 200 for speed
        minMatchCharLength: 2,       // Minimum 2 chars to match
        includeScore: true,          // Include relevance scores
        includeMatches: false,       // Don't need match positions (faster)
        ignoreLocation: true,        // Search anywhere in text
        findAllMatches: false,       // Stop at first good match (faster)
        shouldSort: true,            // Sort by score
        useExtendedSearch: false,    // No special operators (faster)
      };

      this.searchEngine = new Fuse(documents, fuseOptions);
      this.indexedFileCount = documents.length;

      console.log(`[ContentSearchWorker] Indexed ${this.indexedFileCount} files with Fuse.js (title + headings only)`);
      
      // Log sample document to verify indexing
      if (documents.length > 0) {
        const sample = documents[0];
        console.log('[ContentSearchWorker] Sample indexed document:', {
          id: sample.id,
          path: sample.path,
          title: sample.title,
          headingsLength: sample.headings.length,
        });
      }
      
      return { success: true, fileCount: this.indexedFileCount };
    } catch (error) {
      console.error('[ContentSearchWorker] Error building index:', error);
      return { success: false, fileCount: 0 };
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Extract snippet context around search terms
   * Finds ALL matches and highlights them
   */
  private async extractSnippets(
    path: string,
    terms: string[],
    maxSnippets: number = 5
  ): Promise<{ [field: string]: string[] }> {
    try {
      const db = await this.getDB();
      const cached = await db.get('contents', path);
      
      if (!cached || !cached.content) {
        return {};
      }

      const content = getContentAsString(cached.content);
      const snippets: string[] = [];

      // Create regex from search terms to find ALL matches
      const termsRegex = new RegExp(
        terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
        'gi'
      );

      // Split into lines and find ALL matched lines
      const lines = content.split('\n');
      const matchedLines: Array<{ index: number; line: string }> = [];

      lines.forEach((line, index) => {
        // Reset regex for each line to find all matches
        termsRegex.lastIndex = 0;
        if (termsRegex.test(line)) {
          matchedLines.push({ index, line });
        }
      });

      // Extract snippets with context (limit to maxSnippets for display)
      for (const match of matchedLines.slice(0, maxSnippets)) {
        const contextStart = Math.max(0, match.index - 1);
        const contextEnd = Math.min(lines.length, match.index + 2);
        const contextLines = lines.slice(contextStart, contextEnd);
        
        // Highlight ALL matches in the snippet
        const snippet = contextLines
          .map(line => {
            // Reset regex for each line
            termsRegex.lastIndex = 0;
            return line.replace(termsRegex, '<mark>$&</mark>');
          })
          .join(' ');

        snippets.push(snippet.substring(0, 200)); // Limit snippet length
      }

      return { content: snippets };
    } catch (error) {
      console.error('[ContentSearchWorker] Error extracting snippets:', error);
      return {};
    }
  }

  /**
   * Search through indexed content using hybrid approach:
   * 1. Fuse.js for fuzzy title/heading search (fast)
   * 2. Regex for full-text content search (accurate)
   * Extracts snippets on-demand from IndexedDB with match positions
   */
  async search(query: string): Promise<SearchResult[]> {
    // Wait for auto-init to complete
    if (this.initPromise) {
      console.log('[ContentSearchWorker] Waiting for auto-init to complete...');
      await this.initPromise;
    }
    
    console.log(`[ContentSearchWorker] search() called with query: "${query}"`);
    console.log(`[ContentSearchWorker] searchEngine initialized: ${!!this.searchEngine}`);
    console.log(`[ContentSearchWorker] indexedFileCount: ${this.indexedFileCount}`);
    
    if (!this.searchEngine) {
      console.warn('[ContentSearchWorker] Search engine not initialized - call buildIndex() first');
      return [];
    }

    if (!query || query.trim().length === 0) {
      console.log('[ContentSearchWorker] Empty query, returning no results');
      return [];
    }

    try {
      console.log(`[ContentSearchWorker] Searching for: "${query}"`);
      const startTime = performance.now();
      
      // Step 1: Fuzzy search on title/headings with Fuse.js (fast)
      const fuseResults = this.searchEngine.search(query);
      console.log(`[ContentSearchWorker] Fuse.js found ${fuseResults.length} title/heading matches in ${(performance.now() - startTime).toFixed(2)}ms`);

      // Step 2: Also search content with regex (accurate + fast for exact matches)
      const contentMatches = await this.searchContentByRegex(query);
      console.log(`[ContentSearchWorker] Regex found ${contentMatches.size} content matches in ${(performance.now() - startTime).toFixed(2)}ms total`);

      // Combine results: Fuse results + content matches
      const combinedPaths = new Set([
        ...fuseResults.map(r => r.item.path),
        ...contentMatches.keys()
      ]);

      console.log(`[ContentSearchWorker] Combined: ${combinedPaths.size} unique documents`);
      
      if (combinedPaths.size === 0) {
        console.warn('[ContentSearchWorker] No results found for query:', query);
        return [];
      }

      // Extract search terms from query for snippet highlighting
      const searchTerms = query.trim().toLowerCase().split(/\s+/);

      // Build results with scores and snippets
      const results: SearchResult[] = [];
      
      for (const path of Array.from(combinedPaths).slice(0, 50)) {
        const fuseResult = fuseResults.find(r => r.item.path === path);
        const hasContentMatch = contentMatches.has(path);
        
        // Calculate combined score
        // Content matches get HIGHEST score (10-8), title/heading matches get lower score (0-6)
        let score = 0;
        if (hasContentMatch && fuseResult) {
          score = 10; // Perfect - matches both title/heading AND content
        } else if (hasContentMatch) {
          score = 9; // Excellent - matches content only (boosted from 8)
        } else if (fuseResult) {
          // Good - matches title/heading only (use Fuse score)
          score = fuseResult.score !== undefined ? (1 - fuseResult.score) * 6 : 5;
        }

        // Only extract snippets for files with content matches
        // Title/heading-only matches don't need snippets
        const snippets = hasContentMatch 
          ? await this.extractSnippets(path, searchTerms)
          : {};
        
        results.push({
          path,
          title: fuseResult?.item.title || path.split('/').pop() || path,
          score,
          match: snippets,
          terms: searchTerms,
        });
      }

      // Sort by score descending (content matches will be at top: 10, 9, then title/heading: 0-6)
      results.sort((a, b) => b.score - a.score);

      console.log(`[ContentSearchWorker] Returning ${results.length} results in ${(performance.now() - startTime).toFixed(2)}ms`);
      
      // Log score distribution for debugging
      if (results.length > 0) {
        const scoreBreakdown = {
          contentAndTitle: results.filter(r => r.score === 10).length,
          contentOnly: results.filter(r => r.score === 9).length,
          titleOnly: results.filter(r => r.score < 9).length,
        };
        console.log('[ContentSearchWorker] Score distribution:', scoreBreakdown);
        console.log('[ContentSearchWorker] Top 3 results:', results.slice(0, 3).map(r => ({
          path: r.path,
          score: r.score,
          hasSnippets: Object.keys(r.match).length > 0,
        })));
      }

      return results;
    } catch (error) {
      console.error('[ContentSearchWorker] Search error:', error);
      return [];
    }
  }

  /**
   * Search content using fast regex matching
   * Returns Set of paths that match
   */
  private async searchContentByRegex(query: string): Promise<Set<string>> {
    const matches = new Set<string>();
    
    try {
      const db = await this.getDB();
      const allFiles = await db.getAll('contents');
      
      // Create regex from query (case-insensitive)
      const searchTerms = query.trim().toLowerCase().split(/\s+/);
      const regex = new RegExp(
        searchTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
        'gi'
      );
      
      // Search each file's content
      for (const file of allFiles) {
        const content = getContentAsString(file.content);
        regex.lastIndex = 0; // Reset regex
        
        if (regex.test(content)) {
          matches.add(file.path);
        }
      }
    } catch (error) {
      console.error('[ContentSearchWorker] Regex search error:', error);
    }
    
    return matches;
  }

  /**
   * Get index status
   */
  async getStatus(): Promise<{ isIndexed: boolean; fileCount: number; isIndexing: boolean }> {
    // Wait for auto-init to complete
    if (this.initPromise) {
      await this.initPromise;
    }
    
    return {
      isIndexed: this.searchEngine !== null,
      fileCount: this.indexedFileCount,
      isIndexing: this.isIndexing,
    };
  }

  /**
   * Clear the search index
   */
  async clearIndex(): Promise<void> {
    this.searchEngine = null;
    this.indexedFileCount = 0;
    console.log('[ContentSearchWorker] Index cleared');
  }
}

// Expose worker API via Comlink
console.log('[ContentSearchWorker] Creating worker instance...');
const worker = new ContentSearchWorker();
console.log('[ContentSearchWorker] Worker instance created, exposing via Comlink...');
expose(worker);
console.log('[ContentSearchWorker] Worker exposed and ready');
