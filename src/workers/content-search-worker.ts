/**
 * Content Search Worker
 * 
 * Provides two search methods:
 * 1. Full-text search using MiniSearch (fuzzy, ranked)
 * 2. Regex search using netgrep WASM + JS context extraction
 * 
 * Accesses IndexedDB directly to avoid blocking the main thread.
 * Exposed via Comlink for easy async API.
 */

import MiniSearch from 'minisearch';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { expose } from 'comlink';

const FILE_CONTENTS_DB_NAME = 'wiki-file-contents';
const FILE_CONTENTS_DB_VERSION = 3;

// Dynamic WASM module import
let searchBytesModule: ((chunk: Uint8Array, pattern: string) => boolean) | null = null;

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
      content: string;
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
 * Match context for a single line
 */
export interface MatchContext {
  lineNumber: number;
  line: string;
  matchStart: number;
  matchEnd: number;
}

/**
 * Regex search result with line context
 */
export interface RegexSearchResult {
  path: string;
  title: string;
  matches: MatchContext[];
  matchCount: number;
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

class ContentSearchWorker {
  private searchEngine: MiniSearch<SearchDocument> | null = null;
  private db: IDBPDatabase<FileContentsDB> | null = null;
  private isIndexing = false;
  private indexedFileCount = 0;

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
   */
  async buildIndex(): Promise<{ success: boolean; fileCount: number }> {
    if (this.isIndexing) {
      return { success: false, fileCount: 0 };
    }

    try {
      this.isIndexing = true;
      console.log('[ContentSearchWorker] Building search index...');

      // Initialize MiniSearch
      this.searchEngine = new MiniSearch<SearchDocument>({
        fields: ['title', 'content', 'headings'], // Fields to index
        storeFields: ['path', 'title'], // Fields to return in results
        searchOptions: {
          boost: { title: 3, headings: 2, content: 1 },
          fuzzy: 0.2,
          prefix: true,
        },
      });

      // Load all files from IndexedDB
      const db = await this.getDB();
      const allFiles = await db.getAll('contents');

      console.log(`[ContentSearchWorker] Found ${allFiles.length} files in cache`);

      // Index each file
      const documents: SearchDocument[] = allFiles.map((file) => ({
        id: file.path,
        path: file.path,
        title: this.extractTitle(file.path, file.content),
        content: file.content,
        headings: this.extractHeadings(file.content),
      }));

      this.searchEngine.addAll(documents);
      this.indexedFileCount = documents.length;

      console.log(`[ContentSearchWorker] Indexed ${this.indexedFileCount} files`);
      
      return { success: true, fileCount: this.indexedFileCount };
    } catch (error) {
      console.error('[ContentSearchWorker] Error building index:', error);
      return { success: false, fileCount: 0 };
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Search through indexed content
   */
  async search(query: string): Promise<SearchResult[]> {
    if (!this.searchEngine) {
      console.warn('[ContentSearchWorker] Search engine not initialized');
      return [];
    }

    if (!query || query.trim().length === 0) {
      return [];
    }

    try {
      console.log(`[ContentSearchWorker] Searching for: "${query}"`);
      
      const results = this.searchEngine.search(query, {
        fuzzy: 0.2,
        prefix: true,
      });

      console.log(`[ContentSearchWorker] Found ${results.length} results`);

      return results.map((result) => ({
        path: result.path,
        title: result.title,
        score: result.score,
        match: result.match,
        terms: result.terms,
      }));
    } catch (error) {
      console.error('[ContentSearchWorker] Search error:', error);
      return [];
    }
  }

  /**
   * Get index status
   */
  async getStatus(): Promise<{ isIndexed: boolean; fileCount: number; isIndexing: boolean }> {
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

  /**
   * Search file contents using WASM-powered regex matching
   * Uses netgrep's ripgrep WASM for fast pattern detection,
   * then extracts context using JavaScript for detailed results
   */
  async regexSearch(pattern: string, options?: { 
    maxResults?: number;
    contextLines?: number;
  }): Promise<RegexSearchResult[]> {
    if (!pattern || pattern.trim().length === 0) {
      return [];
    }

    const maxResults = options?.maxResults || 100;
    const results: RegexSearchResult[] = [];

    try {
      console.log(`[ContentSearchWorker] Regex searching for: "${pattern}"`);

      // Load all files from IndexedDB
      const db = await this.getDB();
      const allFiles = await db.getAll('contents');

      console.log(`[ContentSearchWorker] Searching ${allFiles.length} files`);

      // Convert pattern to regex for context extraction
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'gi');
      } catch (e) {
        console.error('[ContentSearchWorker] Invalid regex pattern:', e);
        return [];
      }

      // Search each file
      for (const file of allFiles) {
        if (results.length >= maxResults) {
          break;
        }

        // First, use WASM for fast detection if available
        let hasMatch = false;
        
        if (!searchBytesModule) {
          try {
            // @ts-ignore - Dynamic WASM import
            const module = await import('@netgrep/search');
            searchBytesModule = module.search_bytes;
          } catch (e) {
            console.warn('[ContentSearchWorker] WASM module not available, falling back to regex-only search');
            // Fallback: use regex directly
            regex.lastIndex = 0;
            hasMatch = regex.test(file.content);
          }
        }
        
        if (searchBytesModule) {
          const textEncoder = new TextEncoder();
          const bytes = textEncoder.encode(file.content);
          hasMatch = searchBytesModule(bytes, pattern);
        }

        if (!hasMatch) {
          continue;
        }

        // If WASM detected a match, extract context with JS
        const matches: MatchContext[] = [];
        const lines = file.content.split('\n');

        lines.forEach((line, index) => {
          // Reset regex lastIndex for global regex
          regex.lastIndex = 0;
          const match = regex.exec(line);

          if (match) {
            matches.push({
              lineNumber: index + 1,
              line: line,
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            });
          }
        });

        if (matches.length > 0) {
          results.push({
            path: file.path,
            title: this.extractTitle(file.path, file.content),
            matches: matches,
            matchCount: matches.length,
          });
        }
      }

      console.log(`[ContentSearchWorker] Found ${results.length} files with matches`);
      return results;
    } catch (error) {
      console.error('[ContentSearchWorker] Regex search error:', error);
      return [];
    }
  }
}

// Expose worker API via Comlink
const worker = new ContentSearchWorker();
expose(worker);
