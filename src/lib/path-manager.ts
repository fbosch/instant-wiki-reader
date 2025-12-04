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
 * Detects the common root prefix in a set of file paths.
 * This is needed because browser-fs-access includes the root directory name
 * in webkitRelativePath, while native File System Access API may not.
 * 
 * @param files - Array of files to analyze
 * @returns Common root prefix or null if none detected
 */
export function detectCommonRootPrefix(files: File[]): string | null {
  if (files.length === 0) return null;
  
  const paths = files.map(f => f.webkitRelativePath || f.name);
  
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
 * Gets the storage path from a File object
 * (webkitRelativePath or name)
 */
function getStoragePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

/**
 * Converts a display path (without prefix) to a storage path (with prefix if needed)
 * 
 * @param files - Array of files
 * @param displayPath - Path as shown in UI (e.g., "Leasingportal/file.md")
 * @returns Storage path for file lookup (e.g., "KK-Laaneportal.wiki/Leasingportal/file.md")
 */
export function toStoragePath(files: File[], displayPath: string): string {
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
export function toDisplayPath(files: File[], storagePath: string): string {
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
export function getFileByDisplayPath(files: File[], displayPath: string): File | undefined {
  const prefix = detectCommonRootPrefix(files);
  const storagePath = toStoragePath(files, displayPath);
  
  // Helper to try matching with various encoding variations
  const tryMatch = (file: File, searchPath: string): boolean => {
    const filePath = getStoragePath(file);
    
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
  console.error('[PathManager] Available files (first 10):', 
    files.slice(0, 10).map(f => getStoragePath(f)));
  
  return undefined;
}

/**
 * Normalizes a file path from a File object to display path
 * 
 * @param files - Array of files (needed to detect prefix)
 * @param file - File object
 * @returns Display path (without prefix)
 */
export function normalizeFilePath(files: File[], file: File): string {
  const storagePath = getStoragePath(file);
  return toDisplayPath(files, storagePath);
}
