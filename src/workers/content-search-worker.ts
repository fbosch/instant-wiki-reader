/**
 * Content Search Worker
 * 
 * Uses MiniSearch for full-text search through markdown file contents.
 * Accesses IndexedDB directly to avoid blocking the main thread.
 * Exposed via Comlink for easy async API.
 */

import MiniSearch from 'minisearch';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { expose } from 'comlink';

const FILE_CONTENTS_DB_NAME = 'wiki-file-contents';
const FILE_CONTENTS_DB_VERSION = 1;

/**
 * IndexedDB schema for file contents
 */
interface FileContentsDB extends DBSchema {
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
 * Search result with context
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
        upgrade(db) {
          if (!db.objectStoreNames.contains('contents')) {
            db.createObjectStore('contents', { keyPath: 'path' });
          }
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
}

// Expose worker API via Comlink
const worker = new ContentSearchWorker();
expose(worker);
