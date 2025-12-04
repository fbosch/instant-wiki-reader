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
function safePropertyAccess<T>(obj: unknown, propName: string, defaultValue: T): T {
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
 * Returns decoded paths to ensure consistency across the application
 * 
 * @param fileOrMeta - File object or metadata object with path property
 * @returns Path string (decoded)
 */
export function getFilePath(fileOrMeta: File | { path: string; name?: string }): string {
  // If it's a metadata object with path property
  if ('path' in fileOrMeta && typeof fileOrMeta.path === 'string') {
    return fileOrMeta.path;
  }
  
  // If it's a File object
  const file = fileOrMeta as File;
  
  // Try the decoded path WeakMap first (from file-system-store)
  // This is the primary source of truth for file paths
  try {
    const { getDecodedPathForFile } = require('@/store/file-system-store');
    const decodedPath = getDecodedPathForFile(file);
    if (typeof decodedPath === 'string' && decodedPath.length > 0) {
      return decodedPath;
    }
  } catch (e) {
    // Store module not loaded yet, continue to fallback
  }
  
  // Fallback to webkitRelativePath with decoding
  const webkitPath = safePropertyAccess(file, 'webkitRelativePath', '');
  if (typeof webkitPath === 'string' && webkitPath.length > 0) {
    try {
      return decodeURIComponent(webkitPath);
    } catch (e) {
      return webkitPath;
    }
  }
  
  // Final fallback to name with decoding
  const name = safePropertyAccess(file, 'name', '');
  if (typeof name === 'string' && name.length > 0) {
    try {
      return decodeURIComponent(name);
    } catch (e) {
      return name;
    }
  }
  
  // If all else fails
  console.error('[getFilePath] Could not get path from file:', file);
  return 'unknown-file';
}

type FileWithPath = { path: string; name: string } | File;

/**
 * Detects the common root directory prefix from file paths
 * Returns null if no common prefix exists
 */
function detectCommonPrefix(files: readonly FileWithPath[]): string | null {
  if (files.length === 0) return null;
  
  // Get first path segment from all files
  const firstSegments = files.map(f => {
    const path = getFilePath(f as File);
    return path.split('/')[0];
  });
  
  // Check if all files share the same first segment
  const firstSegment = firstSegments[0];
  const allSame = firstSegments.every(s => s === firstSegment);
  
  // Only return as common prefix if all files share it AND there are nested paths
  const hasNestedPaths = files.some(f => getFilePath(f as File).includes('/'));
  
  return allSame && hasNestedPaths ? firstSegment : null;
}

/**
 * Finds a file by path with encoding/normalization fallbacks
 * Handles URL encoding/decoding and Unicode normalization
 * Automatically prepends common root prefix if search path is missing it
 * 
 * @param files - Array of files
 * @param searchPath - Path to search for
 * @returns File object or undefined if not found
 */
export function getFileByDisplayPath<T extends FileWithPath>(files: readonly T[], searchPath: string): T | undefined {
  // Detect common prefix and normalize search path if needed
  const commonPrefix = detectCommonPrefix(files);
  const pathsToTry: string[] = [searchPath];
  
  // If there's a common prefix and search path doesn't include it, add it as a variant
  if (commonPrefix && !searchPath.startsWith(commonPrefix + '/') && !searchPath.startsWith(commonPrefix)) {
    pathsToTry.push(`${commonPrefix}/${searchPath}`);
  }
  
  // Helper to try matching with encoding variations
  const tryMatch = (file: T, path: string): boolean => {
    const filePath = getFilePath(file as File);
    
    // Direct match
    if (filePath === path) return true;
    
    // Try URL encoding/decoding variations
    try {
      const decodedFilePath = decodeURIComponent(filePath);
      const decodedPath = decodeURIComponent(path);
      
      if (decodedFilePath === path) return true;
      if (filePath === decodedPath) return true;
      if (decodedFilePath === decodedPath) return true;
    } catch (e) {
      // Ignore encoding errors
    }
    
    // Try Unicode normalization (for characters like æ, ø, å)
    try {
      const normalizedFilePath = filePath.normalize('NFC');
      const normalizedSearchPath = path.normalize('NFC');
      
      if (normalizedFilePath === normalizedSearchPath) return true;
      
      const decodedNormalizedFile = decodeURIComponent(normalizedFilePath);
      const decodedNormalizedSearch = decodeURIComponent(normalizedSearchPath);
      
      if (decodedNormalizedFile === normalizedSearchPath) return true;
      if (normalizedFilePath === decodedNormalizedSearch) return true;
    } catch (e) {
      // Ignore normalization errors
    }
    
    return false;
  };
  
  // Try all path variations
  for (const pathToTry of pathsToTry) {
    const found = files.find(f => tryMatch(f, pathToTry));
    if (found) return found;
  }
  
  // Not found - log for debugging
  if (process.env.NODE_ENV === 'development') {
    console.error('[PathManager] File not found:', searchPath);
    if (commonPrefix) {
      console.error('[PathManager] Also tried with prefix:', `${commonPrefix}/${searchPath}`);
    }
  }
  
  return undefined;
}
