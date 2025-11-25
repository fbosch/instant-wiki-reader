/**
 * Web Worker for markdown parsing and search operations.
 * Uses Comlink for seamless RPC-style communication with main thread.
 */

import { expose } from 'comlink';
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
 * Search through index entries.
 * 
 * @param index - Search index
 * @param query - Search query
 * @param mode - Search mode ('filename' or 'fulltext')
 * @returns Array of matching entries with scores
 */
function searchIndex(
  index: SearchIndexEntry[],
  query: string,
  mode: 'filename' | 'fulltext' = 'filename'
): Array<{ entry: SearchIndexEntry; score: number }> {
  const lowerQuery = query.toLowerCase();
  const results: Array<{ entry: SearchIndexEntry; score: number }> = [];
  
  for (const entry of index) {
    let score = 0;
    
    // Filename match
    if (entry.title.toLowerCase().includes(lowerQuery)) {
      score += 10;
    }
    
    // Heading match
    for (const heading of entry.headings) {
      if (heading.toLowerCase().includes(lowerQuery)) {
        score += 5;
      }
    }
    
    // Full-text search
    if (mode === 'fulltext' && entry.content) {
      const matches = (entry.content.toLowerCase().match(new RegExp(lowerQuery, 'g')) || []).length;
      score += matches;
    }
    
    if (score > 0) {
      results.push({ entry, score });
    }
  }
  
  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
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
