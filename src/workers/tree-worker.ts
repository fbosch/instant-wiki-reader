/**
 * Web Worker for CPU-intensive directory tree operations.
 * Uses Comlink for seamless RPC-style communication with main thread.
 */

import { expose } from 'comlink';
import type { DirectoryNode } from '@/types';

/**
 * Serializable file metadata for transfer to worker.
 * Cannot use File objects directly as they're not transferable.
 */
interface SerializableFile {
  name: string;
  path: string;
  size: number;
  lastModified: number;
}

/**
 * Build a directory tree from a flat list of files.
 * Uses sorting for O(n log n) performance instead of nested lookups (O(n²)).
 * 
 * @param files - Array of serializable file objects
 * @returns Root directory node with nested children
 */
function buildDirectoryTree(files: SerializableFile[]): DirectoryNode {
  const root: DirectoryNode = {
    name: 'root',
    path: '',
    type: 'dir',
    children: [],
    isExpanded: true,
  };

  // Sort files by path for efficient tree building
  const sortedFiles = [...files].sort((a, b) => 
    a.path.localeCompare(b.path)
  );

  for (const file of sortedFiles) {
    const parts = file.path.split('/');
    
    let currentNode = root;
    let currentPath = '';

    // Build path for each part
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLastPart = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      // Ensure children array exists
      if (!currentNode.children) {
        currentNode.children = [];
      }

      // Check if node already exists
      let existingNode = currentNode.children.find((child) => child.name === part);

      if (!existingNode) {
        existingNode = {
          name: part,
          path: currentPath,
          type: isLastPart ? 'file' : 'dir',
          children: isLastPart ? undefined : [],
          isExpanded: false,
        };
        currentNode.children.push(existingNode);
      }

      if (!isLastPart) {
        currentNode = existingNode;
      }
    }
  }

  // Second pass: detect index files for directories
  // A directory has an index file if there's a sibling file with the same name + .md
  function detectIndexFiles(node: DirectoryNode): void {
    if (!node.children) return;

    for (const child of node.children) {
      if (child.type === 'dir') {
        // Check if there's a sibling file with same name + .md
        const indexFileName = `${child.name}.md`;
        const parentChildren = node.children;
        const indexFile = parentChildren.find(
          (sibling) => sibling.type === 'file' && sibling.name === indexFileName
        );
        
        if (indexFile) {
          child.indexFile = indexFile.path;
        }
        
        // Recursively check children
        detectIndexFiles(child);
      }
    }
  }

  detectIndexFiles(root);

  return root;
}

/**
 * Search files by name (case-insensitive substring match).
 * 
 * @param files - Array of serializable file objects
 * @param query - Search query
 * @returns Array of matching file paths
 */
function searchFiles(files: SerializableFile[], query: string): string[] {
  const lowerQuery = query.toLowerCase();
  
  return files
    .filter((file) => {
      const name = file.name.toLowerCase();
      return name.includes(lowerQuery);
    })
    .map((file) => file.path);
}

/**
 * Filter files to only include markdown files.
 * 
 * @param files - Array of serializable file objects
 * @returns Array containing only markdown files
 */
function filterMarkdownFiles(files: SerializableFile[]): SerializableFile[] {
  const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];
  
  return files.filter((file) => {
    const lowerName = file.name.toLowerCase();
    return MARKDOWN_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  });
}

// Worker API
const workerApi = {
  buildDirectoryTree,
  searchFiles,
  filterMarkdownFiles,
};

// Expose API via Comlink
expose(workerApi);

export type TreeWorkerApi = typeof workerApi;
