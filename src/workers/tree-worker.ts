/**
 * Web Worker for CPU-intensive directory tree operations.
 * Uses Comlink for seamless RPC-style communication with main thread.
 * Accesses IndexedDB directly to avoid serialization overhead.
 */

import { expose } from 'comlink';
import { get } from 'idb-keyval';
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
 * Cached file structure from IndexedDB
 */
interface CachedFile {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  content: ArrayBuffer;
}

const CACHED_FILES_KEY = 'wiki-cached-files';

/**
 * Build a directory tree from cached files in IndexedDB.
 * This method loads from IndexedDB directly, avoiding serialization.
 * 
 * @returns Root directory node with nested children
 */
async function buildDirectoryTreeFromCache(): Promise<DirectoryNode> {
  const cachedFiles = await get<CachedFile[]>(CACHED_FILES_KEY);
  
  if (!cachedFiles || cachedFiles.length === 0) {
    return {
      name: 'root',
      path: '',
      type: 'dir',
      children: [],
      isExpanded: true,
    };
  }
  
  // Convert to SerializableFile format
  const files: SerializableFile[] = cachedFiles.map((cached) => ({
    name: cached.name,
    path: cached.path,
    size: cached.size,
    lastModified: cached.lastModified,
  }));
  
  return buildDirectoryTreeFromFiles(files);
}

/**
 * Build a directory tree from a flat list of files.
 * Uses sorting for O(n log n) performance instead of nested lookups (O(n²)).
 * 
 * @param files - Array of serializable file objects
 * @returns Root directory node with nested children
 */
function buildDirectoryTreeFromFiles(files: SerializableFile[]): DirectoryNode {
  const root: DirectoryNode = {
    name: 'root',
    path: '',
    type: 'dir',
    children: [],
    isExpanded: true,
  };

  if (files.length === 0) {
    return root;
  }

  // Sort files by path for efficient tree building
  const sortedFiles = [...files].sort((a, b) => 
    a.path.localeCompare(b.path)
  );

  // Detect if all paths share a common root directory (from browser-fs-access)
  // If they do, we'll skip it to avoid showing the selected directory itself
  let commonRootToSkip: string | null = null;
  const firstPath = sortedFiles[0].path;
  const firstParts = firstPath.split('/');
  
  if (firstParts.length > 1) {
    // Check if all files share the same first path segment
    const potentialRoot = firstParts[0];
    const allShareRoot = sortedFiles.every((file) => {
      return file.path.startsWith(potentialRoot + '/') || file.path === potentialRoot;
    });
    
    if (allShareRoot) {
      commonRootToSkip = potentialRoot;
    }
  }

  for (const file of sortedFiles) {
    let relativePath = file.path;
    
    // Strip common root if detected
    if (commonRootToSkip && relativePath.startsWith(commonRootToSkip + '/')) {
      relativePath = relativePath.slice(commonRootToSkip.length + 1);
    } else if (commonRootToSkip && relativePath === commonRootToSkip) {
      // Skip the root directory itself if it appears as a file
      continue;
    }

    const parts = relativePath.split('/');
    
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

  // Second pass: detect index files and clean up tree
  // 1. Merge files with same-name directories (e.g., Arkitektur.md + Arkitektur/)
  // 2. Hide .attachments directories from view
  function processTree(node: DirectoryNode): void {
    if (!node.children) return;

    const filesToRemove = new Set<DirectoryNode>();

    // Find files that should be merged with directories
    for (const child of node.children) {
      if (child.type === 'file' && child.name.endsWith('.md')) {
        // Get the name without .md extension
        const baseNameWithoutExt = child.name.slice(0, -3);
        
        // Check if there's a directory with the same base name
        const matchingDir = node.children.find(
          (sibling) => sibling.type === 'dir' && sibling.name === baseNameWithoutExt
        );
        
        if (matchingDir) {
          // Merge: make this file the index of the directory
          matchingDir.indexFile = child.path;
          // Mark file for removal from tree (it shouldn't show separately)
          filesToRemove.add(child);
        }
      }
    }

    // Remove merged files and .attachments directories from tree
    node.children = node.children.filter(
      (child) => !filesToRemove.has(child) && child.name !== '.attachments'
    );

    // Recursively process children
    for (const child of node.children) {
      if (child.type === 'dir') {
        processTree(child);
      }
    }
  }

  processTree(root);

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
  buildDirectoryTree: buildDirectoryTreeFromFiles,
  buildDirectoryTreeFromCache,
  searchFiles,
  filterMarkdownFiles,
};

// Expose API via Comlink
expose(workerApi);

export type TreeWorkerApi = typeof workerApi;
