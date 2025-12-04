import { directoryOpen } from 'browser-fs-access';
import { get, set, del } from 'idb-keyval';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { DirectoryNode, FileMeta } from '@/types';

const DIRECTORY_HANDLE_KEY = 'wiki-directory-handle';
const CACHED_FILES_KEY = 'wiki-cached-files';
const CACHED_WIKI_NAME_KEY = 'wiki-cached-name';
const FILE_CONTENTS_DB_NAME = 'wiki-file-contents';
const FILE_CONTENTS_DB_VERSION = 1;

/**
 * Serializable file data for caching
 */
interface CachedFile {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  content: ArrayBuffer;
}

/**
 * IndexedDB schema for file contents (accessible from workers)
 */
interface FileContentsDB extends DBSchema {
  'contents': {
    key: string; // file path
    value: {
      path: string;
      content: string;
      lastModified: number;
    };
  };
}

/**
 * Get or create the file contents database (accessible from workers)
 */
export async function getFileContentsDB(): Promise<IDBPDatabase<FileContentsDB>> {
  return openDB<FileContentsDB>(FILE_CONTENTS_DB_NAME, FILE_CONTENTS_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('contents')) {
        db.createObjectStore('contents', { keyPath: 'path' });
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
    await set(DIRECTORY_HANDLE_KEY, handle);
  } catch (error) {
    console.error('Failed to save directory handle:', error);
    throw new Error('Failed to persist directory handle');
  }
}

// Extended interface for handles with permission methods
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
    const handle = await get<FileSystemDirectoryHandle>(DIRECTORY_HANDLE_KEY);
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
    await del(DIRECTORY_HANDLE_KEY);
  } catch (error) {
    console.error('Failed to clear directory handle:', error);
    throw new Error('Failed to clear directory handle');
  }
}

/**
 * Save files to IndexedDB cache (for Firefox/browsers without File System Access API).
 * Stores file metadata and content for offline access.
 * 
 * @param files - Array of files to cache
 * @param wikiName - Name of the wiki for display
 */
export async function cacheFiles(files: File[], wikiName: string): Promise<void> {
  try {
    // Cache file metadata using idb-keyval
    const cachedFiles: CachedFile[] = await Promise.all(
      files.map(async (file) => {
        const content = await file.arrayBuffer();
        return {
          name: file.name,
          path: file.webkitRelativePath || file.name,
          size: file.size,
          lastModified: file.lastModified,
          content,
        };
      })
    );
    
    await set(CACHED_FILES_KEY, cachedFiles);
    await set(CACHED_WIKI_NAME_KEY, wikiName);
    
    // Also cache text content in separate DB for search worker access
    const db = await getFileContentsDB();
    const tx = db.transaction('contents', 'readwrite');
    
    await Promise.all(
      files.map(async (file) => {
        // Only cache text files (markdown)
        if (!file.name.endsWith('.md') && !file.name.endsWith('.markdown')) {
          return;
        }
        
        const content = await file.text();
        await tx.store.put({
          path: file.webkitRelativePath || file.name,
          content,
          lastModified: file.lastModified,
        });
      })
    );
    
    await tx.done;
    
    console.log(`[cacheFiles] Cached ${cachedFiles.length} files`);
  } catch (error) {
    console.error('Failed to cache files:', error);
    // Don't throw - caching is optional
  }
}

/**
 * Load cached files from IndexedDB (for Firefox/browsers without File System Access API).
 * 
 * @returns Object with files array and wiki name, or null if no cache exists
 */
export async function loadCachedFiles(): Promise<{ files: File[]; wikiName: string } | null> {
  try {
    const cachedFiles = await get<CachedFile[]>(CACHED_FILES_KEY);
    const wikiName = await get<string>(CACHED_WIKI_NAME_KEY);
    
    if (!cachedFiles || !wikiName) {
      return null;
    }
    
    const files = cachedFiles.map((cached: CachedFile) => {
      const file = new File([cached.content], cached.name, {
        lastModified: cached.lastModified,
      });
      
      // Add webkitRelativePath property
      Object.defineProperty(file, 'webkitRelativePath', {
        value: cached.path,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      
      return file;
    });
    
    console.log(`[loadCachedFiles] Loaded ${files.length} cached files`);
    return { files, wikiName };
  } catch (error) {
    console.error('Failed to load cached files:', error);
    return null;
  }
}

/**
 * Clear cached files from IndexedDB.
 */
export async function clearCachedFiles(): Promise<void> {
  try {
    await del(CACHED_FILES_KEY);
    await del(CACHED_WIKI_NAME_KEY);
    
    // Also clear the file contents DB
    const db = await getFileContentsDB();
    await db.clear('contents');
  } catch (error) {
    console.error('Failed to clear cached files:', error);
  }
}

/**
 * Build a directory tree from a flat list of files.
 * Uses sorting for O(n log n) performance instead of nested lookups (O(n²)).
 * 
 * @param files - Array of File objects with webkitRelativePath property
 * @returns Root directory node with nested children and common root prefix info
 */
export function buildDirectoryTree(files: File[]): DirectoryNode & { _commonRootPrefix?: string } {
  const root: DirectoryNode & { _commonRootPrefix?: string } = {
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
  const sortedFiles = [...files].sort((a, b) => {
    const pathA = a.webkitRelativePath || a.name;
    const pathB = b.webkitRelativePath || b.name;
    return pathA.localeCompare(pathB);
  });

  // Detect if all paths share a common root directory (from browser-fs-access)
  // If they do, we'll skip it to avoid showing the selected directory itself
  let commonRootToSkip: string | null = null;
  const firstPath = sortedFiles[0].webkitRelativePath || sortedFiles[0].name;
  const firstParts = firstPath.split('/');
  
  if (firstParts.length > 1) {
    // Check if all files share the same first path segment
    const potentialRoot = firstParts[0];
    const allShareRoot = sortedFiles.every((file) => {
      const path = file.webkitRelativePath || file.name;
      return path.startsWith(potentialRoot + '/') || path === potentialRoot;
    });
    
    if (allShareRoot) {
      commonRootToSkip = potentialRoot;
      // Store the common root prefix in the tree for later use
      root._commonRootPrefix = potentialRoot;
    }
  }

  for (const file of sortedFiles) {
    let relativePath = file.webkitRelativePath || file.name;
    
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
 * Extract file metadata from a File object.
 * 
 * @param file - File object to extract metadata from
 * @returns FileMeta object with path, name, size, lastModified, and extension
 */
export function extractFileMeta(file: File): FileMeta {
  const { name, size, lastModified } = file;
  const path = file.webkitRelativePath || name;
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
    const lowerName = file.name.toLowerCase();
    return MARKDOWN_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  });
}

/**
 * Get file by path from a list of files.
 * Handles both URL-encoded and decoded path formats.
 * 
 * @param files - Array of files to search
 * @param path - Path to match against webkitRelativePath or name (can be URL-encoded or decoded)
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
    const filePath = file.webkitRelativePath || file.name;
    
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
    console.error(`[getFileByPath] Available files (first 10):`, files.slice(0, 10).map(f => f.webkitRelativePath || f.name));
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
    console.log('[getAzureDevOpsContext] Remote URL:', remoteUrl);
    
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
      
      console.log('[getAzureDevOpsContext] Extracted context:', { organization, project, wikiName, baseUrl });
      
      return {
        organization,
        project,
        wikiName,
        baseUrl,
      };
    }
    
    return null;
  } catch (error) {
    console.log('[getAzureDevOpsContext] Could not read .git/config:', error);
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
 * Read file contents as text.
 * 
 * @param file - File to read
 * @returns Promise resolving to file content as string
 */
export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
