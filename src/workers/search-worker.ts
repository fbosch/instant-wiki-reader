/**
 * Web Worker for markdown parsing and search operations.
 * Uses Comlink for seamless RPC-style communication with main thread.
 * Uses Fuse.js for fuzzy search with better matching and scoring.
 */

import { expose } from 'comlink';
import Fuse from 'fuse.js';
import type { IFuseOptions } from 'fuse.js';
import type { SearchIndexEntry } from '@/types';

/**
 * Serializable file with content for processing.
 */
interface FileWithContent {
  path: string;
  name: string;
  content: string;
}

/**
 * Extract headings from markdown content.
 * 
 * @param content - Markdown content
 * @returns Array of heading texts
 */
function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      // Remove # symbols and trim
      const heading = trimmed.replace(/^#+\s*/, '').trim();
      if (heading) {
        headings.push(heading);
      }
    }
  }
  
  return headings;
}

/**
 * Extract keywords from markdown content.
 * Simple implementation that extracts unique words.
 * 
 * @param content - Markdown content
 * @returns Array of keywords
 */
function extractKeywords(content: string): string[] {
  // Remove markdown syntax
  const cleaned = content
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]+`/g, '') // Remove inline code
    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // Keep link text
    .replace(/[#*_~`]/g, '') // Remove markdown symbols
    .toLowerCase();
  
  // Extract words (alphanumeric + hyphens)
  const words = cleaned.match(/\b[\w-]+\b/g) || [];
  
  // Get unique words, filter short ones and common words
  const commonWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'with', 'this', 'that', 'from']);
  const uniqueWords = [...new Set(words)]
    .filter((word) => word.length > 2 && !commonWords.has(word))
    .slice(0, 50); // Limit to top 50
  
  return uniqueWords;
}

/**
 * Build search index from files with content.
 * 
 * @param files - Array of files with content
 * @returns Array of search index entries
 */
function buildSearchIndex(files: FileWithContent[]): SearchIndexEntry[] {
  return files.map((file) => ({
    path: file.path,
    title: file.name,
    headings: extractHeadings(file.content),
    keywords: extractKeywords(file.content),
    content: file.content, // Keep for full-text search
  }));
}

/**
 * Search through index entries using Fuse.js for fuzzy matching.
 * 
 * @param index - Search index
 * @param query - Search query
 * @param mode - Search mode ('filename' or 'fulltext')
 * @returns Array of matching entries with scores and match highlighting
 */
function searchIndex(
  index: SearchIndexEntry[],
  query: string,
  mode: 'filename' | 'fulltext' = 'filename'
): Array<{ entry: SearchIndexEntry; score: number; matches?: any }> {
  if (!query.trim()) {
    return [];
  }

  // Configure Fuse.js options based on search mode
  const fuseOptions: IFuseOptions<SearchIndexEntry> = {
    keys: mode === 'filename' 
      ? [
          { name: 'title', weight: 0.7 },       // Filename gets highest weight
          { name: 'headings', weight: 0.3 },    // Headings get lower weight
        ]
      : [
          { name: 'title', weight: 0.4 },       // Filename important but not dominant
          { name: 'headings', weight: 0.3 },    // Headings get good weight
          { name: 'content', weight: 0.3 },     // Content search in fulltext mode
        ],
    threshold: 0.4,              // 0 = perfect match, 1 = match anything
    distance: 100,               // How far to search for a pattern match
    minMatchCharLength: 2,       // Minimum match length
    includeScore: true,          // Include match score
    includeMatches: true,        // Include match positions for highlighting
    ignoreLocation: true,        // Search anywhere in text (not just beginning)
    useExtendedSearch: false,    // Don't use special operators
    findAllMatches: true,        // Find all matches, not just first
  };

  // Create Fuse instance with the index
  const fuse = new Fuse(index, fuseOptions);
  
  // Perform search
  const results = fuse.search(query);
  
  // Transform results to match our expected format
  return results.map((result) => ({
    entry: result.item,
    score: result.score !== undefined ? (1 - result.score) * 10 : 0, // Invert score (Fuse.js: lower is better)
    matches: result.matches, // Include match information for highlighting
  }));
}

// Worker API
const workerApi = {
  buildSearchIndex,
  searchIndex,
  extractHeadings,
  extractKeywords,
};

// Expose API via Comlink
expose(workerApi);

export type SearchWorkerApi = typeof workerApi;
