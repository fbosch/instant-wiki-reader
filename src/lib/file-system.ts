import { directoryOpen } from 'browser-fs-access';
import { createStore, get, set, del } from 'idb-keyval';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { DirectoryNode, FileMeta } from '@/types';
import { getFilePath } from '@/lib/path-manager';

/**
 * Safely access properties on file-like objects.
 * In Firefox, browser-fs-access may return objects where properties are getters that can throw.
 * 
 * @param obj - Object to access property from
 * @param prop - Property name
 * @param defaultValue - Default value if property is inaccessible
 * @returns Property value or default
 */
function safePropertyAccess<T>(obj: unknown, prop: string, defaultValue: T): T {
  try {
    if (obj && typeof obj === 'object' && prop in obj) {
      const value = (obj as Record<string, unknown>)[prop];
      if (value !== null && value !== undefined) {
        return value as T;
      }
    }
  } catch (e) {
    // Property access threw an error (browser quirk)
    console.warn(`[safePropertyAccess] Error accessing ${prop}:`, e);
  }
  return defaultValue;
}

const DIRECTORY_HANDLE_KEY = 'wiki-directory-handle';
const CACHED_WIKI_NAME_KEY = 'wiki-cached-name';
const FILE_CONTENTS_DB_NAME = 'wiki-file-contents';
const FILE_CONTENTS_DB_VERSION = 4; // Incremented for new 'files' store

// Create a custom store for idb-keyval to avoid conflicts
const customStore = createStore('wiki-keyval-store', 'keyval');

/**
 * File metadata for tree rendering (lightweight)
 */
export interface FileMetadata {
  path: string;
  name: string;
  size: number;
  lastModified: number;
  type: string;
}

/**
 * IndexedDB schema with separate stores for metadata, contents, and File objects
 */
interface FileContentsDB extends DBSchema {
  'metadata': {
    key: string; // file path
    value: FileMetadata;
  };
  'contents': {
    key: string; // file path
    value: {
      path: string;
      content: string | ArrayBuffer; // string (new) or ArrayBuffer (legacy)
      lastModified: number;
    };
  };
  'files': {
    key: string; // file path
    value: {
      path: string;
      file: File; // Actual File object stored as Blob
    };
  };
}

/**
 * Get or create the file contents database with separate metadata, contents, and files stores
 */
export async function getFileContentsDB(): Promise<IDBPDatabase<FileContentsDB>> {
  return openDB<FileContentsDB>(FILE_CONTENTS_DB_NAME, FILE_CONTENTS_DB_VERSION, {
    upgrade(db, oldVersion) {
      // Create metadata store for lightweight file info (tree rendering)
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'path' });
      }
      
      // Create/update contents store for file text content (on-demand loading)
      if (!db.objectStoreNames.contains('contents')) {
        db.createObjectStore('contents', { keyPath: 'path' });
      }
      
      // Create files store for actual File objects
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'path' });
      }
    },
  });
}

/**
 * Check if File System Access API is supported.
 * 
 * @returns true if supported in current environment
 */
export function isFileSystemAccessSupported(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  
  return 'showDirectoryPicker' in window;
}

/**
 * Open a directory picker and get all files recursively using browser-fs-access fallback.
 * This is used when the native File System Access API is not available.
 * 
 * @returns Object containing files array and optional directory handle
 */
export async function openDirectory(): Promise<{
  files: File[];
  directoryHandle?: FileSystemDirectoryHandle;
}> {
  try {
    const files = await directoryOpen({
      recursive: true,
      skipDirectory: (entry) => {
        // Skip hidden directories except .attachments, and skip common ignore patterns
        const { name } = entry;
        const isHidden = name.startsWith('.');
        const isAllowedHidden = name === '.attachments';
        
        return (
          (isHidden && !isAllowedHidden) ||
          name === 'node_modules' ||
          name === '.git' ||
          name === '.obsidian'
        );
      },
    });

    // Note: browser-fs-access doesn't expose handles directly in current API
    // We use native showDirectoryPicker separately for handle persistence
    return { files };
  } catch (error) {
    console.error('[openDirectory] Error:', error);
    if ((error as Error).name === 'AbortError') {
      throw new Error('Directory selection was cancelled');
    }
    throw error;
  }
}

/**
 * Save directory handle to IndexedDB for future access.
 * 
 * @param handle - Directory handle to persist
 */
export async function saveDirectoryHandle(
  handle: FileSystemDirectoryHandle
): Promise<void> {
  try {
    await set(DIRECTORY_HANDLE_KEY, handle, customStore);
  } catch (error) {
    console.error('Failed to save directory handle:', error);
    throw new Error('Failed to persist directory handle');
  }
}

// Store file path metadata map OUTSIDE to avoid issues with File object property access
// Maps File objects to their original paths (needed for Firefox where webkitRelativePath restoration fails)
const fileToPathMap = new WeakMap<File, string>();

export function setFilePathMapping(file: File, path: string): void {
  fileToPathMap.set(file, path);
}

export function getFilePathMapping(file: File): string | undefined {
  return fileToPathMap.get(file);
}

// Extended interface for directory handles with permission methods
interface FileSystemHandleWithPermissions extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

/**
 * Get saved directory handle from IndexedDB and verify permissions.
 * 
 * @returns Directory handle if available and permission granted, null otherwise
 */
export async function getSavedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await get<FileSystemDirectoryHandle>(DIRECTORY_HANDLE_KEY, customStore);
    if (!handle) {
      return null;
    }

    const handleWithPermissions = handle as FileSystemHandleWithPermissions;

    // Verify permission
    const permission = await handleWithPermissions.queryPermission?.({ mode: 'read' });
    if (permission === 'granted') {
      return handle;
    }

    // Request permission if not granted
    const requestedPermission = await handleWithPermissions.requestPermission?.({ mode: 'read' });
    if (requestedPermission === 'granted') {
      return handle;
    }

    return null;
  } catch (error) {
    console.error('Failed to get saved directory handle:', error);
    return null;
  }
}

/**
 * Clear saved directory handle from IndexedDB.
 */
export async function clearDirectoryHandle(): Promise<void> {
  try {
    await del(DIRECTORY_HANDLE_KEY, customStore);
  } catch (error) {
    console.error('Failed to clear directory handle:', error);
    throw new Error('Failed to clear directory handle');
  }
}

/**
 * Save files to IndexedDB cache (for all browsers - enables webworker access without blocking main thread).
 * Stores:
 * - metadata: lightweight file info for tree building
 * - contents: text content of markdown files
 * - files: actual File objects (as Blobs) for reconstruction
 * 
 * @param files - Array of files to cache
 * @param wikiName - Name of the wiki for display
 */
export async function cacheFiles(files: File[], wikiName: string): Promise<void> {
  try {
    await set(CACHED_WIKI_NAME_KEY, wikiName, customStore);
    
    const db = await getFileContentsDB();
    
    // Write metadata first (lightweight)
    const metadataTx = db.transaction('metadata', 'readwrite');
    for (const file of files) {
      const path = getFilePath(file);
      const metadata: FileMetadata = {
        path,
        name: safePropertyAccess(file, 'name', 'unknown'),
        size: safePropertyAccess(file, 'size', 0),
        lastModified: safePropertyAccess(file, 'lastModified', Date.now()),
        type: safePropertyAccess(file, 'type', ''),
      };
      metadataTx.store.put(metadata);
    }
    await metadataTx.done;
    
    // Write File objects (for reconstruction)
    const BATCH_SIZE = 50;
    
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, Math.min(i + BATCH_SIZE, files.length));
      const filesTx = db.transaction('files', 'readwrite');
      
      for (const file of batch) {
        const path = getFilePath(file);
        filesTx.store.put({
          path,
          file, // Store the actual File object (IndexedDB supports Blob/File)
        });
      }
      
      await filesTx.done;
    }
    
    // Write contents for markdown files (pre-read for search)
    let mdFilesCount = 0;
    
    const mdFiles = files.filter(f => {
      const name = safePropertyAccess(f, 'name', '');
      return name.endsWith('.md') || name.endsWith('.markdown');
    });
    
    for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
      const batch = mdFiles.slice(i, Math.min(i + BATCH_SIZE, mdFiles.length));
      
      // Read all file contents as text FIRST (outside transaction to avoid timeout)
      const contentsToWrite: Array<{
        path: string;
        content: string;
        lastModified: number;
      }> = [];
      
      for (const file of batch) {
        try {
          const path = getFilePath(file);
          const content = await file.text(); // Read as text for search indexing
          contentsToWrite.push({
            path,
            content,
            lastModified: safePropertyAccess(file, 'lastModified', Date.now()),
          });
        } catch (error) {
          console.error('[cacheFiles] Error reading file:', getFilePath(file), error);
        }
      }
      
      // Now write all contents in a fresh transaction (fast, no timeout)
      if (contentsToWrite.length > 0) {
        const contentsTx = db.transaction('contents', 'readwrite');
        for (const item of contentsToWrite) {
          contentsTx.store.put(item);
          mdFilesCount++;
        }
        await contentsTx.done;
      }
    }
  } catch (error) {
    console.error('[cacheFiles] Failed to cache files:', error);
    // Don't throw - caching is optional
  }
}

/**
 * Load cached file metadata from IndexedDB.
 * Returns lightweight metadata suitable for building directory tree.
 * 
 * @returns Object with file metadata array and wiki name, or null if no cache exists
 */
export async function loadCachedFileMetadata(): Promise<{ 
  files: FileMetadata[]; 
  wikiName: string;
} | null> {
  try {
    const wikiName = await get<string>(CACHED_WIKI_NAME_KEY, customStore);
    
    if (!wikiName) {
      return null;
    }
    
    const db = await getFileContentsDB();
    const allMetadata = await db.getAll('metadata');
    
    if (!allMetadata || allMetadata.length === 0) {
      return null;
    }
    
    return { files: allMetadata, wikiName };
  } catch (error) {
    console.error('Failed to load cached file metadata:', error);
    return null;
  }
}

/**
 * Load cached File objects from IndexedDB.
 * Returns actual File objects for use in the application.
 * Restores webkitRelativePath property which may be lost during IndexedDB storage.
 * 
 * @returns Array of File objects, or null if no cache exists
 */
export async function loadCachedFiles(): Promise<File[] | null> {
  try {
    const db = await getFileContentsDB();
    const allFileRecords = await db.getAll('files');
    
    if (!allFileRecords || allFileRecords.length === 0) {
      return null;
    }
    
    // Restore webkitRelativePath on File objects (it may be lost in IndexedDB round-trip)
    const files = allFileRecords.map((record) => {
      const file = record.file;
      
      // Store the path in WeakMap for reliable retrieval (Firefox-safe)
      setFilePathMapping(file, record.path);
      
      // Check if webkitRelativePath is missing or empty
      const currentPath = safePropertyAccess(file, 'webkitRelativePath', '');
      
      // Always restore from stored path if they differ
      if (currentPath !== record.path) {
        // Restore it from the stored path
        try {
          Object.defineProperty(file, 'webkitRelativePath', {
            value: record.path,
            writable: false,
            enumerable: true,
            configurable: true,
          });
        } catch (e) {
          console.warn(`[loadCachedFiles] Failed to restore webkitRelativePath for ${record.path}:`, e);
        }
      }
      
      return file;
    });
    
    return files;
  } catch (error) {
    console.error('[loadCachedFiles] Failed to load cached files:', error);
    return null;
  }
}

/**
 * Clear cached files from IndexedDB.
 */
export async function clearCachedFiles(): Promise<void> {
  try {
    await del(CACHED_WIKI_NAME_KEY, customStore);
    
    // Clear both stores in the file contents DB
    const db = await getFileContentsDB();
    await db.clear('metadata');
    await db.clear('contents');
  } catch (error) {
    console.error('Failed to clear cached files:', error);
  }
}

/**
 * Build a directory tree from file metadata (lightweight, memory-efficient).
 * Uses sorting for O(n log n) performance instead of nested lookups (O(n²)).
 * Stores FULL paths in nodes - prefix is only stripped for display.
 * 
 * @param metadata - Array of file metadata objects with path property
 * @returns Root directory node with nested children
 */
export function buildDirectoryTreeFromMetadata(
  metadata: Array<{ path: string; name: string }>
): DirectoryNode {
  const root: DirectoryNode = {
    name: 'root',
    path: '',
    type: 'dir',
    children: [],
    isExpanded: true,
  };

  if (metadata.length === 0) {
    return root;
  }

  // Decode all paths to handle legacy cached data with URL-encoded paths
  // This ensures consistency regardless of when the data was cached
  const decodedMetadata = metadata.map(item => {
    let decodedPath = item.path;
    try {
      decodedPath = decodeURIComponent(item.path);
    } catch (e) {
      // If decoding fails, keep the original path
      console.warn('[buildDirectoryTreeFromMetadata] Failed to decode path:', item.path);
    }
    return {
      path: decodedPath,
      name: item.name,
    };
  });
  
  // Sort files by path for efficient tree building
  const sortedFiles = [...decodedMetadata].sort((a, b) => a.path.localeCompare(b.path));

  // Detect if all paths share a common root directory (from browser-fs-access)
  // We'll store this but NOT strip it from paths - only use for display
  let commonRootPrefix: string | null = null;
  const firstPath = sortedFiles[0].path;
  const firstParts = firstPath.split('/');
  
  if (firstParts.length > 1) {
    // Check if all files share the same first path segment
    const potentialRoot = firstParts[0];
    const allShareRoot = sortedFiles.every((file) => {
      return file.path.startsWith(potentialRoot + '/') || file.path === potentialRoot;
    });
    
    if (allShareRoot) {
      commonRootPrefix = potentialRoot;
    }
  }

  for (const file of sortedFiles) {
    const fullPath = file.path; // Keep full path unchanged
    
    // For tree building, we need to work without the common prefix
    // to avoid duplicating the root directory in the tree structure
    let pathForTreeBuilding = fullPath;
    if (commonRootPrefix && fullPath.startsWith(commonRootPrefix + '/')) {
      pathForTreeBuilding = fullPath.slice(commonRootPrefix.length + 1);
    } else if (commonRootPrefix && fullPath === commonRootPrefix) {
      // Skip the root directory itself if it appears as a file
      continue;
    }
    
    const parts = pathForTreeBuilding.split('/');
    
    let currentNode = root;

    // Build tree hierarchy
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLastPart = i === parts.length - 1;
      
      // Ensure children array exists
      if (!currentNode.children) {
        currentNode.children = [];
      }

      // Check if node already exists
      let existingNode = currentNode.children.find((child) => child.name === part);

      if (!existingNode) {
        // Calculate the full path for this node by taking a slice from the original fullPath
        // For file "Wiki.wiki/dir/subdir/file.md" with parts ["dir", "subdir", "file.md"]
        // At i=0 (dir): path should be "Wiki.wiki/dir"
        // At i=1 (subdir): path should be "Wiki.wiki/dir/subdir"
        // At i=2 (file.md): path should be "Wiki.wiki/dir/subdir/file.md"
        const pathSegmentsFromRoot = parts.slice(0, i + 1);
        const nodePath = commonRootPrefix 
          ? `${commonRootPrefix}/${pathSegmentsFromRoot.join('/')}`
          : pathSegmentsFromRoot.join('/');
        
        existingNode = {
          name: part,
          path: nodePath, // Store FULL path including common root
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
  function processTree(node: DirectoryNode) {
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
          matchingDir.indexFile = child.path; // Use FULL path
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
 * Extract file metadata from a File object.
 * 
 * @param file - File object to extract metadata from
 * @returns FileMeta object with path, name, size, lastModified, and extension
 */
export function extractFileMeta(file: File): FileMeta {
  const name = safePropertyAccess(file, 'name', 'unknown');
  const size = safePropertyAccess(file, 'size', 0);
  const lastModified = safePropertyAccess(file, 'lastModified', Date.now());
  const path = getFilePath(file);
  const extension = name.includes('.') ? name.substring(name.lastIndexOf('.')) : '';

  return {
    path,
    name,
    size,
    lastModified,
    extension,
  };
}

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/**
 * Filter files to only include markdown files.
 * 
 * @param files - Array of files to filter
 * @returns Array containing only markdown files
 */
export function filterMarkdownFiles(files: File[]): File[] {
  return files.filter((file) => {
    const name = safePropertyAccess(file, 'name', '');
    const lowerName = name.toLowerCase();
    return MARKDOWN_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  });
}

/**
 * Get file by path from a list of files.
 * Handles both URL-encoded and decoded path formats.
 * 
 * @param files - Array of files to search
 * @param path - Path to match (can be URL-encoded or decoded)
 * @returns File if found, undefined otherwise
 */
export function getFileByPath(files: File[], path: string): File | undefined {
  // Try to decode the path in case it's URL-encoded
  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch (e) {
    // If decoding fails, use original path
    decodedPath = path;
  }
  
  const found = files.find((file) => {
    const filePath = getFilePath(file);
    
    // Try exact match first
    if (filePath === path) return true;
    
    // Try with decoded path
    if (filePath === decodedPath) return true;
    
    // Try decoding the file path as well (in case it's URL-encoded)
    try {
      const decodedFilePath = decodeURIComponent(filePath);
      if (decodedFilePath === path || decodedFilePath === decodedPath) return true;
    } catch (e) {
      // Ignore decoding errors
    }
    
    return false;
  });

  if (!found) {
    console.error(`[getFileByPath] File not found: "${path}"`);
    console.error(`[getFileByPath] Decoded path: "${decodedPath}"`);
    console.error(`[getFileByPath] Available files (first 10):`, files.slice(0, 10).map(f => getFilePath(f)));
  }

  return found;
}

/**
 * Clean up wiki name for display.
 * Removes .wiki suffix and other common artifacts.
 * 
 * @param name - Raw wiki name
 * @returns Cleaned wiki name
 */
export function cleanWikiName(name: string): string {
  let cleaned = name;
  
  // Remove .wiki suffix (common in Azure DevOps)
  if (cleaned.endsWith('.wiki')) {
    cleaned = cleaned.slice(0, -5);
  }
  
  // Replace hyphens and underscores with spaces for readability
  // But keep the original if it's a single word
  if (cleaned.includes('-') || cleaned.includes('_')) {
    const spaced = cleaned.replace(/[-_]/g, ' ');
    // Capitalize first letter of each word
    cleaned = spaced.replace(/\b\w/g, (char) => char.toUpperCase());
  }
  
  return cleaned;
}

/**
 * Azure DevOps context information extracted from git config
 */
export interface AzureDevOpsContext {
  organization: string;
  project: string;
  wikiName: string;
  baseUrl: string;
}

/**
 * Reads the .git/config file to extract Azure DevOps context.
 * 
 * @param rootHandle - Directory handle for the wiki root
 * @returns Azure DevOps context or null if not found
 */
export async function getAzureDevOpsContext(
  rootHandle: FileSystemDirectoryHandle
): Promise<AzureDevOpsContext | null> {
  try {
    // Try to get .git directory
    const gitHandle = await rootHandle.getDirectoryHandle('.git');
    
    // Try to get config file
    const configHandle = await gitHandle.getFileHandle('config');
    const configFile = await configHandle.getFile();
    const configText = await configFile.text();
    
    // Parse git config to find remote URL
    // Look for patterns like:
    // [remote "origin"]
    //   url = https://kommunekredit.visualstudio.com/KK%20Laaneportal/_git/KK-Laaneportal.wiki
    const urlMatch = configText.match(/url\s*=\s*(.+)/);
    if (!urlMatch) {
      return null;
    }
    
    const remoteUrl = urlMatch[1].trim();
    
    // Parse Azure DevOps URL
    // Format: https://{org}.visualstudio.com/{project}/_git/{wiki-name}
    // or: https://dev.azure.com/{org}/{project}/_git/{wiki-name}
    const visualStudioMatch = remoteUrl.match(/https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/?]+)/);
    const devAzureMatch = remoteUrl.match(/https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?]+)/);
    
    const match = visualStudioMatch || devAzureMatch;
    if (match) {
      const organization = match[1];
      const project = decodeURIComponent(match[2]);
      let wikiName = decodeURIComponent(match[3]);
      
      // Clean up the wiki name for display
      wikiName = cleanWikiName(wikiName);
      
      const baseUrl = visualStudioMatch 
        ? `https://${organization}.visualstudio.com`
        : `https://dev.azure.com/${organization}`;
      
      return {
        organization,
        project,
        wikiName,
        baseUrl,
      };
    }
    
    return null;
  } catch (error) {
    // Could not read .git/config - not an error, just means no Azure DevOps context
    return null;
  }
}

/**
 * Reads the .git/config file to extract the wiki name from the remote URL.
 * 
 * @param rootHandle - Directory handle for the wiki root
 * @returns Wiki name (e.g., "KK-Laaneportal.wiki") or null if not found
 */
export async function getWikiNameFromGit(
  rootHandle: FileSystemDirectoryHandle
): Promise<string | null> {
  const context = await getAzureDevOpsContext(rootHandle);
  return context?.wikiName || null;
}

/**
 * Get a File object from IndexedDB by path.
 * Used for loading binary files (like images) in cached mode.
 * 
 * @param path - File path (webkitRelativePath)
 * @returns File object, or null if not found
 */
export async function getFileFromCache(path: string): Promise<File | null> {
  try {
    const db = await getFileContentsDB();
    
    // Try direct lookup first
    let cached = await db.get('files', path);
    
    if (cached && cached.file) {
      return cached.file;
    }
    
    // Try with URL decoding
    try {
      const decodedPath = decodeURIComponent(path);
      if (decodedPath !== path) {
        cached = await db.get('files', decodedPath);
        if (cached && cached.file) {
          return cached.file;
        }
      }
    } catch (e) {
      // Ignore decoding errors
    }
    
    return null;
  } catch (error) {
    console.error('[getFileFromCache] Error:', error);
    return null;
  }
}

/**
 * Get file content directly from IndexedDB by path.
 * Used for cached files in Firefox/Safari.
 * 
 * @param path - File path (webkitRelativePath)
 * @returns File content as string, or null if not found
 */
export async function getFileContentFromCache(path: string): Promise<string | null> {
  try {
    const db = await getFileContentsDB();
    
    // Helper to handle both string and ArrayBuffer (for backwards compatibility)
    const getContentAsString = (content: string | ArrayBuffer): string => {
      if (typeof content === 'string') {
        return content;
      }
      // Legacy ArrayBuffer format - decode it
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(content);
    };
    
    // Try direct lookup first
    let cached = await db.get('contents', path);
    
    if (cached && cached.content) {
      return getContentAsString(cached.content);
    }
    
    // Try with URL decoding
    try {
      const decodedPath = decodeURIComponent(path);
      if (decodedPath !== path) {
        cached = await db.get('contents', decodedPath);
        if (cached && cached.content) {
          return getContentAsString(cached.content);
        }
      }
    } catch (e) {
      // Ignore decoding errors
    }
    
    // Try with Unicode normalization (for special characters like æ, ø, å)
    try {
      const normalizedPath = path.normalize('NFC');
      if (normalizedPath !== path) {
        cached = await db.get('contents', normalizedPath);
        if (cached && cached.content) {
          return getContentAsString(cached.content);
        }
      }
      
      // Try both normalization and decoding
      const normalizedDecodedPath = decodeURIComponent(normalizedPath);
      if (normalizedDecodedPath !== normalizedPath) {
        cached = await db.get('contents', normalizedDecodedPath);
        if (cached && cached.content) {
          return getContentAsString(cached.content);
        }
      }
    } catch (e) {
      // Ignore normalization errors
    }
    
    // Last resort: search all entries for a matching filename
    const allEntries = await db.getAll('contents');
    const fileName = path.split('/').pop();
    if (fileName) {
      const match = allEntries.find(entry => {
        const entryFileName = entry.path.split('/').pop();
        if (!entryFileName) return false;
        return entryFileName === fileName || 
               entryFileName === decodeURIComponent(fileName) ||
               decodeURIComponent(entryFileName) === fileName;
      });
      
      if (match && match.content) {
        console.warn('[getFileContentFromCache] Path mismatch - requested:', path, 'found:', match.path);
        return getContentAsString(match.content);
      }
    }
    
    return null;
  } catch (error) {
    console.error('[getFileContentFromCache] Error:', error);
    return null;
  }
}

/**
 * Read file contents as text.
 * First tries to get from IndexedDB cache (for Firefox/Safari cached files),
 * then falls back to native file.text() or FileReader for live files.
 * 
 * @param file - File to read (File or Blob)
 * @param path - Optional path to use for IndexedDB lookup
 * @returns Promise resolving to file content as string
 */
export async function readFileAsText(file: File | Blob, path?: string): Promise<string> {
  // For native File objects, try to get path and check cache
  if (file instanceof File) {
    const filePath = path || getFilePath(file);
    
    const cachedContent = await getFileContentFromCache(filePath);
    if (cachedContent !== null) {
      return cachedContent;
    }
    
    // Use native file.text() method - works in all modern browsers
    return file.text();
  }
  
  // For Blob objects, use FileReader
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
