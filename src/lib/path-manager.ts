/**
 * PathManager - Browser-agnostic path handling utilities
 * 
 * Handles the differences between:
 * - Chrome/Edge (File System Access API): Variable path structure
 * - Firefox/Safari (browser-fs-access): Includes root directory in paths
 * 
 * Pure functional helpers - no state, no classes.
 */

/**
 * Safely extract a property from a file-like object
 * Handles Firefox quirks where getters may throw errors
 */
function safeGetProperty<T>(obj: unknown, propName: string, defaultValue: T): T {
  try {
    if (obj && typeof obj === 'object' && propName in obj) {
      const value = (obj as Record<string, unknown>)[propName];
      if (value !== null && value !== undefined) {
        return value as T;
      }
    }
  } catch (e) {
    // Property access threw an error (Firefox quirk)
  }
  return defaultValue;
}

/**
 * Gets the path from a File object or metadata object
 * Works cross-browser without relying on webkit-specific APIs directly
 * 
 * @param fileOrMeta - File object or metadata object with path property
 * @returns Path string
 */
export function getFilePath(fileOrMeta: File | { path: string; name?: string }): string {
  // If it's a metadata object with path property
  if ('path' in fileOrMeta && typeof fileOrMeta.path === 'string') {
    return fileOrMeta.path;
  }
  
  // If it's a File object, try webkitRelativePath (cross-browser support)
  const file = fileOrMeta as File;
  
  // Try webkitRelativePath first
  const webkitPath = safeGetProperty(file, 'webkitRelativePath', '');
  if (typeof webkitPath === 'string' && webkitPath.length > 0) {
    return webkitPath;
  }
  
  // Fallback to name
  const name = safeGetProperty(file, 'name', '');
  if (typeof name === 'string' && name.length > 0) {
    return name;
  }
  
  // Last resort - try direct property access (for when safeGetProperty fails)
  try {
    if ('webkitRelativePath' in file && file.webkitRelativePath) {
      return file.webkitRelativePath;
    }
    if ('name' in file && file.name) {
      return file.name;
    }
  } catch (e) {
    // Ignore
  }
  
  // Absolute last resort
  console.error('[getFilePath] Could not get path from file:', file);
  return 'unknown-file';
}

/**
 * Detects the common root prefix in a set of file paths.
 * This is needed because browser-fs-access includes the root directory name
 * in webkitRelativePath, while native File System Access API may not.
 * 
 * @param files - Array of files to analyze
 * @returns Common root prefix or null if none detected
 */
export function detectCommonRootPrefix(files: readonly ({ path: string; name: string } | File)[]): string | null {
  if (files.length === 0) return null;
  
  const paths = files.map(f => getFilePath(f as any));
  
  // Get the first path segment from each path
  const firstSegments = paths.map(p => p.split('/')[0]);
  
  // If all files share the same first segment and have multiple segments,
  // that's our common root prefix
  const firstSegment = firstSegments[0];
  const allSamePrefix = firstSegments.every(s => s === firstSegment);
  const hasMultipleSegments = paths.some(p => p.includes('/'));
  
  if (allSamePrefix && hasMultipleSegments) {
    return firstSegment;
  }
  
  return null;
}

/**
 * Gets the storage path from a file object
 * (webkitRelativePath or name)
 */
function getStoragePath(file: { path?: string; name: string } | File): string {
  return getFilePath(file as any);
}

type FileWithPath = { path: string; name: string } | File;

/**
 * Converts a display path (without prefix) to a storage path (with prefix if needed)
 * 
 * @param files - Array of files
 * @param displayPath - Path as shown in UI (e.g., "Leasingportal/file.md")
 * @returns Storage path for file lookup (e.g., "KK-Laaneportal.wiki/Leasingportal/file.md")
 */
export function toStoragePath<T extends FileWithPath>(files: readonly T[], displayPath: string): string {
  const prefix = detectCommonRootPrefix(files);
  
  // If there's no common root prefix, display path === storage path
  if (!prefix) {
    return displayPath;
  }
  
  // If path already starts with prefix, return as-is
  if (displayPath.startsWith(prefix + '/')) {
    return displayPath;
  }
  
  // Add prefix
  return `${prefix}/${displayPath}`;
}

/**
 * Converts a storage path (with prefix) to a display path (without prefix)
 * 
 * @param files - Array of files
 * @param storagePath - Path as stored in files (e.g., "KK-Laaneportal.wiki/Leasingportal/file.md")
 * @returns Display path for UI (e.g., "Leasingportal/file.md")
 */
export function toDisplayPath<T extends FileWithPath>(files: readonly T[], storagePath: string): string {
  const prefix = detectCommonRootPrefix(files);
  
  // If there's no common root prefix, display path === storage path
  if (!prefix) {
    return storagePath;
  }
  
  // If path starts with prefix, strip it
  const prefixWithSlash = prefix + '/';
  if (storagePath.startsWith(prefixWithSlash)) {
    return storagePath.slice(prefixWithSlash.length);
  }
  
  // Otherwise return as-is
  return storagePath;
}

/**
 * Finds a file by display path
 * Handles URL encoding/decoding and prefix normalization
 * 
 * @param files - Array of files
 * @param displayPath - Path as shown in UI
 * @returns File object or undefined if not found
 */
export function getFileByDisplayPath<T extends FileWithPath>(files: readonly T[], displayPath: string): T | undefined {
  const prefix = detectCommonRootPrefix(files);
  const storagePath = toStoragePath(files, displayPath);
  
  // Helper to try matching with various encoding variations and normalizations
  const tryMatch = (file: T, searchPath: string): boolean => {
    const filePath = getFilePath(file as any);
    
    // Direct match
    if (filePath === searchPath) return true;
    
    // Try URL encoding/decoding variations
    try {
      if (decodeURIComponent(filePath) === searchPath) return true;
      if (filePath === decodeURIComponent(searchPath)) return true;
      if (decodeURIComponent(filePath) === decodeURIComponent(searchPath)) return true;
    } catch (e) {
      // Ignore encoding errors
    }
    
    // Try Unicode normalization (for characters like æ, ø, å)
    try {
      const normalizedFilePath = filePath.normalize('NFC');
      const normalizedSearchPath = searchPath.normalize('NFC');
      if (normalizedFilePath === normalizedSearchPath) return true;
      if (decodeURIComponent(normalizedFilePath) === normalizedSearchPath) return true;
      if (normalizedFilePath === decodeURIComponent(normalizedSearchPath)) return true;
    } catch (e) {
      // Ignore normalization errors
    }
    
    return false;
  };
  
  // Try finding by storage path
  let found = files.find(f => tryMatch(f, storagePath));
  if (found) return found;
  
  // Try finding by display path directly
  found = files.find(f => tryMatch(f, displayPath));
  if (found) return found;
  
  // Try with decoded display path
  try {
    const decodedDisplay = decodeURIComponent(displayPath);
    found = files.find(f => tryMatch(f, decodedDisplay));
    if (found) return found;
  } catch (e) {
    // Ignore
  }
  
  // Not found - log for debugging
  console.error('[PathManager] File not found for display path:', displayPath);
  console.error('[PathManager] Tried storage path:', storagePath);
  console.error('[PathManager] Common root prefix:', prefix);
  console.error('[PathManager] Total files available:', files.length);
  console.error('[PathManager] First 10 file paths:', 
    files.slice(0, 10).map(f => {
      const path = getFilePath(f as any);
      return `"${path}" (name: "${f.name}")`;
    }));
  console.error('[PathManager] Looking for files with similar names:',
    files.filter(f => f.name.includes(displayPath.split('/').pop() || '')).slice(0, 5).map(f => getFilePath(f as any)));
  
  return undefined;
}

/**
 * Normalizes a file path from a File object to display path
 * 
 * @param files - Array of files (needed to detect prefix)
 * @param file - File object
 * @returns Display path (without prefix)
 */
export function normalizeFilePath<T extends FileWithPath>(files: readonly T[], file: T): string {
  const storagePath = getFilePath(file as any);
  return toDisplayPath(files, storagePath);
}
