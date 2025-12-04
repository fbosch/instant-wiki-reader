/**
 * Direct File System Access API utilities
 * These functions use the native API directly for features not covered by browser-fs-access
 */

// Type definitions for File System Access API
interface FileSystemDirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface WindowWithFSA extends Window {
  showDirectoryPicker?: (options?: FileSystemDirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}

/**
 * Open directory using native showDirectoryPicker.
 * Returns the directory handle for persistence.
 * 
 * @returns Directory handle or null if cancelled/unsupported
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const windowWithFSA = window as WindowWithFSA;
  
  if (!windowWithFSA.showDirectoryPicker) {
    return null;
  }

  try {
    const handle = await windowWithFSA.showDirectoryPicker({
      mode: 'read',
      startIn: 'documents',
    });
    return handle;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      // User cancelled
      return null;
    }
    throw error;
  }
}

// Extended interface for directory handles with permission methods
interface FileSystemHandleWithPermissions extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

/**
 * Check and request permission for a directory handle.
 * 
 * @param handle - Directory handle to verify permissions for
 * @param mode - Permission mode ('read' or 'readwrite')
 * @returns true if permission granted, false otherwise
 */
export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'read'
): Promise<boolean> {
  const handleWithPermissions = handle as FileSystemHandleWithPermissions;
  const opts = { mode };

  // Check if we already have permission
  const currentPermission = await handleWithPermissions.queryPermission?.(opts);
  if (currentPermission === 'granted') {
    return true;
  }

  // Request permission
  const requestedPermission = await handleWithPermissions.requestPermission?.(opts);
  if (requestedPermission === 'granted') {
    return true;
  }

  return false;
}

// Extended interface for async iteration on directory handles
interface FileSystemDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

/**
 * Read all files from a directory handle recursively.
 * Skips hidden files and common ignore patterns.
 * 
 * @param handle - Directory handle to read from
 * @param path - Current path (used internally for recursion)
 * @returns Array of files with webkitRelativePath polyfilled
 */
export async function readDirectory(
  handle: FileSystemDirectoryHandle,
  path: string = ''
): Promise<File[]> {
  const files: File[] = [];
  const ignoredNames = new Set(['node_modules', '.git', '.obsidian']);
  const allowedHiddenDirs = new Set(['.attachments']); // Allow .attachments for images
  
  // Get the root directory name to prepend to all paths
  // This ensures paths include the wiki name (e.g., "KK-Laaneportal.wiki/...")
  const rootDirName = handle.name;

  async function traverse(
    dirHandle: FileSystemDirectoryHandle,
    currentPath: string
  ): Promise<void> {
    const handleWithIteration = dirHandle as FileSystemDirectoryHandleWithIteration;
    const entries = handleWithIteration.values();
    
    for await (const entry of entries) {
      const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

      // Skip hidden files/dirs except allowed ones, and skip common ignore patterns
      const isHidden = entry.name.startsWith('.');
      const isAllowed = allowedHiddenDirs.has(entry.name);
      
      if ((isHidden && !isAllowed) || ignoredNames.has(entry.name)) {
        continue;
      }

      if (entry.kind === 'file') {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        
        // Polyfill webkitRelativePath with FULL path including root directory name
        // This makes it consistent with browser-fs-access behavior
        const fullPath = `${rootDirName}/${entryPath}`;
        Object.defineProperty(file, 'webkitRelativePath', {
          value: fullPath,
          writable: false,
          enumerable: true,
          configurable: true,
        });
        
        files.push(file);
      } else if (entry.kind === 'directory') {
        await traverse(entry as FileSystemDirectoryHandle, entryPath);
      }
    }
  }

  await traverse(handle, path);
  console.log(`[readDirectory] Read ${files.length} files from root: ${rootDirName}`);
  if (files.length > 0) {
    console.log(`[readDirectory] First 3 paths:`, files.slice(0, 3).map(f => f.webkitRelativePath || f.name));
  }
  return files;
}
