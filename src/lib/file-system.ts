import { directoryOpen } from 'browser-fs-access';
import { get, set, del } from 'idb-keyval';
import type { DirectoryNode, FileMeta } from '@/types';

const DIRECTORY_HANDLE_KEY = 'wiki-directory-handle';

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
        // Skip hidden directories and common ignore patterns
        const { name } = entry;
        return (
          name.startsWith('.') ||
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
 * Build a directory tree from a flat list of files.
 * Uses sorting for O(n log n) performance instead of nested lookups (O(n²)).
 * 
 * @param files - Array of File objects with webkitRelativePath property
 * @returns Root directory node with nested children
 */
export function buildDirectoryTree(files: File[]): DirectoryNode {
  const root: DirectoryNode = {
    name: 'root',
    path: '',
    type: 'dir',
    children: [],
    isExpanded: true,
  };

  // Sort files by path for efficient tree building
  const sortedFiles = [...files].sort((a, b) => {
    const pathA = a.webkitRelativePath || a.name;
    const pathB = b.webkitRelativePath || b.name;
    return pathA.localeCompare(pathB);
  });

  for (const file of sortedFiles) {
    const relativePath = file.webkitRelativePath || file.name;
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

  // Second pass: detect index files for directories
  // A directory has an index file if there's a sibling file with the same name + .md
  function detectIndexFiles(node: DirectoryNode) {
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
 * 
 * @param files - Array of files to search
 * @param path - Path to match against webkitRelativePath or name
 * @returns File if found, undefined otherwise
 */
export function getFileByPath(files: File[], path: string): File | undefined {
  return files.find((file) => {
    const filePath = file.webkitRelativePath || file.name;
    return filePath === path;
  });
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
