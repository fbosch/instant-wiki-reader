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

console.log('[ContentSearchWorker] Module loading...');

import MiniSearch from 'minisearch';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { expose } from 'comlink';

console.log('[ContentSearchWorker] Imports loaded');

const FILE_CONTENTS_DB_NAME = 'wiki-file-contents';
const FILE_CONTENTS_DB_VERSION = 4; // Must match main thread version!

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
   * Only indexes metadata and text snippets, not full content
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
        storeFields: ['path', 'title'], // Only store path and title, not full content
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
      
      if (allFiles.length === 0) {
        console.warn('[ContentSearchWorker] No files found in IndexedDB contents store!');
        return { success: false, fileCount: 0 };
      }

      // Helper to decode content (supports both string and ArrayBuffer)
      const getContentAsString = (content: string | ArrayBuffer): string => {
        if (typeof content === 'string') {
          return content;
        }
        // Legacy ArrayBuffer format
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(content);
      };
      
      console.log('[ContentSearchWorker] Sample file paths:', allFiles.slice(0, 3).map(f => f.path));
      console.log('[ContentSearchWorker] Sample content types:', allFiles.slice(0, 3).map(f => typeof f.content));

      // Index each file (MiniSearch will tokenize and index, but we don't keep full content in memory)
      const documents: SearchDocument[] = allFiles.map((file) => {
        const contentStr = getContentAsString(file.content);
        return {
          id: file.path,
          path: file.path,
          title: this.extractTitle(file.path, contentStr),
          content: contentStr, // MiniSearch indexes this but doesn't store in results
          headings: this.extractHeadings(contentStr),
        };
      });

      this.searchEngine.addAll(documents);
      this.indexedFileCount = documents.length;

      console.log(`[ContentSearchWorker] Indexed ${this.indexedFileCount} files`);
      
      // Log sample document to verify indexing
      if (documents.length > 0) {
        const sample = documents[0];
        console.log('[ContentSearchWorker] Sample indexed document:', {
          id: sample.id,
          path: sample.path,
          title: sample.title,
          contentLength: sample.content.length,
          contentPreview: sample.content.substring(0, 100),
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
   */
  private async extractSnippets(
    path: string,
    terms: string[],
    maxSnippets: number = 2
  ): Promise<{ [field: string]: string[] }> {
    try {
      const db = await this.getDB();
      const cached = await db.get('contents', path);
      
      if (!cached || !cached.content) {
        return {};
      }

      // Helper to decode content
      const getContentAsString = (content: string | ArrayBuffer): string => {
        if (typeof content === 'string') return content;
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(content);
      };

      const content = getContentAsString(cached.content);
      const snippets: string[] = [];

      // Create regex from search terms
      const termsRegex = new RegExp(
        terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
        'gi'
      );

      // Split into lines and find matches
      const lines = content.split('\n');
      const matchedLines: Array<{ index: number; line: string }> = [];

      lines.forEach((line, index) => {
        if (termsRegex.test(line) && matchedLines.length < maxSnippets * 2) {
          matchedLines.push({ index, line });
        }
      });

      // Extract snippets with context
      for (const match of matchedLines.slice(0, maxSnippets)) {
        const contextStart = Math.max(0, match.index - 1);
        const contextEnd = Math.min(lines.length, match.index + 2);
        const contextLines = lines.slice(contextStart, contextEnd);
        
        // Highlight matches in the snippet
        const snippet = contextLines
          .map(line => {
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
   * Search through indexed content
   * Loads file content on-demand from IndexedDB to extract snippets
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
      
      const results = this.searchEngine.search(query, {
        fuzzy: 0.2,
        prefix: true,
      });

      console.log(`[ContentSearchWorker] MiniSearch returned ${results.length} results`);
      console.log('[ContentSearchWorker] Raw results:', results.slice(0, 3));
      
      if (results.length === 0) {
        console.warn('[ContentSearchWorker] No results found for query:', query);
        console.log('[ContentSearchWorker] Search engine has', this.indexedFileCount, 'documents indexed');
        return [];
      }

      // Extract snippets for each result (on-demand from IndexedDB)
      const resultsWithSnippets = await Promise.all(
        results.slice(0, 50).map(async (result) => {
          const snippets = await this.extractSnippets(result.path, result.terms);
          return {
            path: result.path,
            title: result.title,
            score: result.score,
            match: snippets,
            terms: result.terms,
          };
        })
      );

      console.log(`[ContentSearchWorker] Returning ${resultsWithSnippets.length} results with snippets`);

      return resultsWithSnippets;
    } catch (error) {
      console.error('[ContentSearchWorker] Search error:', error);
      return [];
    }
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

      // Helper to decode content (supports both string and ArrayBuffer)
      const getContentAsString = (content: string | ArrayBuffer): string => {
        if (typeof content === 'string') {
          return content;
        }
        // Legacy ArrayBuffer format
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(content);
      };

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

        const contentStr = getContentAsString(file.content);

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
            hasMatch = regex.test(contentStr);
          }
        }
        
        if (searchBytesModule) {
          const textEncoder = new TextEncoder();
          const bytes = textEncoder.encode(contentStr);
          hasMatch = searchBytesModule(bytes, pattern);
        }

        if (!hasMatch) {
          continue;
        }

        // If WASM detected a match, extract context with JS
        const matches: MatchContext[] = [];
        const lines = contentStr.split('\n');

        lines.forEach((line: string, index: number) => {
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
            title: this.extractTitle(file.path, contentStr),
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
console.log('[ContentSearchWorker] Creating worker instance...');
const worker = new ContentSearchWorker();
console.log('[ContentSearchWorker] Worker instance created, exposing via Comlink...');
expose(worker);
console.log('[ContentSearchWorker] Worker exposed and ready');
