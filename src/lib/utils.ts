import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with proper conflict resolution.
 * Combines clsx for conditional classes and tailwind-merge for deduplication.
 * 
 * @param inputs - Class values to merge
 * @returns Merged class string
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extracts all parent directory paths from a file path.
 * Used to auto-expand the tree when navigating to a nested file.
 * 
 * @param filePath - Full path to the file (e.g., "docs/api/overview.md")
 * @returns Array of parent directory paths (e.g., ["docs", "docs/api"])
 */
export function getParentDirs(filePath: string): string[] {
  const parts = filePath.split('/');
  const parents: string[] = [];
  
  // Build up parent paths
  for (let i = 0; i < parts.length - 1; i++) {
    const path = parts.slice(0, i + 1).join('/');
    if (path) {
      parents.push(path);
    }
  }
  
  return parents;
}

/**
 * Formats a file name for display by decoding URL encoding and removing extension.
 * 
 * @param fileName - Raw file name (e.g., "Projekt%20Dokumentation.md")
 * @param removeExtension - Whether to remove the file extension (default: false)
 * @returns Formatted file name (e.g., "Projekt Dokumentation")
 */
export function formatFileName(fileName: string, removeExtension = false): string {
  // Decode URL encoding (handles %20, %2D, etc.)
  let decoded = decodeURIComponent(fileName);
  
  // Remove .md extension if requested
  if (removeExtension && decoded.endsWith('.md')) {
    decoded = decoded.slice(0, -3);
  }
  
  return decoded;
}

/**
 * Formats a file path for display by decoding URL encoding.
 * 
 * @param path - Raw file path
 * @returns Formatted file path with decoded components
 */
export function formatFilePath(path: string): string {
  return path.split('/').map(part => decodeURIComponent(part)).join('/');
}

/**
 * Table of contents entry
 */
export interface TocEntry {
  id: string;
  text: string;
  level: number;
  children: TocEntry[];
}

/**
 * Generates an ID from heading text for anchor linking.
 * Converts to lowercase, replaces special chars and spaces with hyphens.
 * 
 * @param text - Heading text
 * @returns URL-safe ID
 */
export function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extracts headings from markdown content to build a table of contents.
 * Handles malformed headers (without space after #) by preprocessing.
 * 
 * @param content - Markdown content
 * @returns Hierarchical table of contents entries
 */
export function extractTableOfContents(content: string): TocEntry[] {
  // Preprocess to fix headers without spaces (e.g., ##Header -> ## Header)
  const fixedContent = content.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
  
  // Extract all headers with regex
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  const entries: TocEntry[] = [];
  const stack: TocEntry[] = [];
  
  let match;
  while ((match = headerRegex.exec(fixedContent)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = generateHeadingId(text);
    
    const entry: TocEntry = {
      id,
      text,
      level,
      children: [],
    };
    
    // Build hierarchy
    // Pop stack until we find a parent with lower level
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    
    if (stack.length === 0) {
      // Top-level entry
      entries.push(entry);
    } else {
      // Add as child of the last item in stack
      stack[stack.length - 1].children.push(entry);
    }
    
    stack.push(entry);
  }
  
  return entries;
}


/**
 * Extracts file path and wiki name from Azure DevOps wiki URL.
 * 
 * Azure DevOps wiki URLs have formats like:
 * - https://{org}.visualstudio.com/{project}/_wiki/wikis/{wiki-name}/{page-id}/{page-path}
 * - https://dev.azure.com/{org}/{project}/_wiki/wikis/{wiki-name}?pagePath=%2FPath%2FTo%2FFile
 * 
 * @param url - Azure DevOps wiki URL
 * @returns Object with wikiName and filePath, or null if not a valid Azure DevOps wiki link
 */
export function extractAzureDevOpsPath(url: string): { wikiName: string; filePath: string } | null {
  try {
    const urlObj = new URL(url);
    
    console.log('[extractAzureDevOpsPath] Parsing URL:', url);
    console.log('[extractAzureDevOpsPath] Hostname:', urlObj.hostname);
    console.log('[extractAzureDevOpsPath] Pathname:', urlObj.pathname);
    
    // Check if it's an Azure DevOps URL
    if (!urlObj.hostname.includes('dev.azure.com') && !urlObj.hostname.includes('visualstudio.com')) {
      console.log('[extractAzureDevOpsPath] Not an Azure DevOps URL');
      return null;
    }
    
    // Check if it's a wiki URL
    if (!urlObj.pathname.includes('/_wiki/')) {
      console.log('[extractAzureDevOpsPath] Not a wiki URL');
      return null;
    }
    
    // Extract wiki name and path from URL
    // Pattern: /_wiki/wikis/{wiki-name}/{page-id}/{page-path...}
    // or: /_wiki/wikis/{wiki-name}?pagePath=...
    const wikiMatch = urlObj.pathname.match(/\/_wiki\/wikis\/([^/?]+)/);
    console.log('[extractAzureDevOpsPath] Wiki match:', wikiMatch);
    
    if (!wikiMatch) {
      console.log('[extractAzureDevOpsPath] Could not extract wiki name');
      return null;
    }
    
    const wikiName = decodeURIComponent(wikiMatch[1]);
    console.log('[extractAzureDevOpsPath] Wiki name:', wikiName);
    
    // Try to get path from URL path segments (newer format)
    const pathAfterWikiName = urlObj.pathname.split(`/wikis/${wikiMatch[1]}/`)[1];
    console.log('[extractAzureDevOpsPath] Path after wiki name:', pathAfterWikiName);
    
    if (pathAfterWikiName) {
      // Remove page ID (first segment, typically a number)
      const segments = pathAfterWikiName.split('/');
      console.log('[extractAzureDevOpsPath] Path segments:', segments);
      
      // Skip first segment if it's a number (page ID)
      const pathSegments = /^\d+$/.test(segments[0]) ? segments.slice(1) : segments;
      console.log('[extractAzureDevOpsPath] Path segments after removing ID:', pathSegments);
      
      let filePath = pathSegments.map(s => decodeURIComponent(s)).join('/');
      if (!filePath.endsWith('.md')) {
        filePath = `${filePath}.md`;
      }
      
      console.log('[extractAzureDevOpsPath] Final file path:', filePath);
      return { wikiName, filePath };
    }
    
    // Try to get path from pagePath query parameter (older format)
    const pagePath = urlObj.searchParams.get('pagePath');
    console.log('[extractAzureDevOpsPath] Page path parameter:', pagePath);
    
    if (pagePath) {
      const decoded = decodeURIComponent(pagePath);
      const withoutLeadingSlash = decoded.startsWith('/') ? decoded.slice(1) : decoded;
      
      let filePath = withoutLeadingSlash;
      if (!filePath.endsWith('.md')) {
        filePath = `${filePath}.md`;
      }
      
      console.log('[extractAzureDevOpsPath] Final file path from query:', filePath);
      return { wikiName, filePath };
    }
    
    console.log('[extractAzureDevOpsPath] No path found');
    return null;
  } catch (error) {
    // Invalid URL
    console.error('[extractAzureDevOpsPath] Error parsing URL:', error);
    return null;
  }
}

/**
 * Checks if a URL is an Azure DevOps wiki link matching the current wiki.
 * 
 * @param url - URL to check
 * @param currentWikiName - Name of the currently selected wiki (e.g., "KK-Laaneportal.wiki")
 * @returns true if this is an Azure DevOps link to the same wiki
 */
export function isMatchingWikiLink(url: string, currentWikiName: string | null): boolean {
  if (!currentWikiName) return false;
  
  const extracted = extractAzureDevOpsPath(url);
  if (!extracted) return false;
  
  return extracted.wikiName === currentWikiName;
}

/**
 * Find a file in the file list using multiple matching strategies.
 * Handles Azure DevOps wiki naming variations (hyphens vs spaces, case sensitivity, etc.)
 * Also handles URL-encoded vs decoded paths.
 * 
 * @param files - Array of files to search
 * @param targetPath - Target file path to find
 * @returns Matching file if found, undefined otherwise
 */
export function findFileFlexible(files: readonly File[], targetPath: string): File | undefined {
  console.log('[findFileFlexible] Searching for:', targetPath);
  console.log('[findFileFlexible] Total files to search:', files.length);
  
  // Helper to get decoded file path
  const getDecodedPath = (filePath: string): string => {
    try {
      return decodeURIComponent(filePath);
    } catch (e) {
      return filePath;
    }
  };
  
  // Helper to compare paths (handles URL encoding)
  const pathsMatch = (filePath: string, searchPath: string): boolean => {
    if (filePath === searchPath) return true;
    
    const decodedFile = getDecodedPath(filePath);
    const decodedSearch = getDecodedPath(searchPath);
    
    return decodedFile === decodedSearch || decodedFile === searchPath || filePath === decodedSearch;
  };
  
  // Strategy 1: Exact match (with URL encoding handling)
  let file = files.find((f) => {
    const filePath = f.webkitRelativePath || f.name;
    return pathsMatch(filePath, targetPath);
  });
  
  if (file) {
    console.log('[findFileFlexible] ✓ Found with strategy 1 (exact):', file.webkitRelativePath || file.name);
    return file;
  }

  // Strategy 2: Try with hyphens converted to spaces
  // Azure DevOps sometimes uses hyphens in URLs but spaces in file names
  const pathWithSpaces = targetPath.replace(/-/g, ' ');
  console.log('[findFileFlexible] Strategy 2: Trying with spaces:', pathWithSpaces);
  file = files.find((f) => {
    const filePath = f.webkitRelativePath || f.name;
    return filePath === pathWithSpaces;
  });
  
  if (file) {
    console.log('[findFileFlexible] ✓ Found with strategy 2 (spaces):', file.webkitRelativePath || file.name);
    return file;
  }

  // Strategy 3: Case-insensitive match
  console.log('[findFileFlexible] Strategy 3: Trying case-insensitive');
  file = files.find((f) => {
    const filePath = f.webkitRelativePath || f.name;
    return filePath.toLowerCase() === targetPath.toLowerCase();
  });
  
  if (file) {
    console.log('[findFileFlexible] ✓ Found with strategy 3 (case-insensitive):', file.webkitRelativePath || file.name);
    return file;
  }

  // Strategy 4: Fuzzy match - find files that match the base name (without path/extension)
  const baseName = targetPath.split('/').pop()?.replace('.md', '');
  if (baseName) {
    console.log('[findFileFlexible] Strategy 4: Trying fuzzy match for base name:', baseName);
    file = files.find((f) => {
      const filePath = f.webkitRelativePath || f.name;
      const fileBaseName = filePath.split('/').pop()?.replace('.md', '');
      
      // Try exact base name match
      if (fileBaseName === baseName) return true;
      
      // Try with hyphens/spaces normalized
      const normalizedFile = fileBaseName?.toLowerCase().replace(/[-\s]/g, '');
      const normalizedSearch = baseName.toLowerCase().replace(/[-\s]/g, '');
      return normalizedFile === normalizedSearch;
    });
    
    if (file) {
      console.log('[findFileFlexible] ✓ Found with strategy 4 (fuzzy):', file.webkitRelativePath || file.name);
      return file;
    }
  }
  
  // Strategy 5: Partial match - Azure DevOps URLs might use shortened page names
  // Search for files where the base name STARTS with the search term
  if (baseName && baseName.length >= 5) { // Only try partial match for reasonably long names
    console.log('[findFileFlexible] Strategy 5: Trying partial match (file starts with search term)');
    const normalizedSearch = baseName.toLowerCase().replace(/[-\s]/g, '');
    
    // Find all files that start with the search term
    const candidates = files.filter((f) => {
      const filePath = f.webkitRelativePath || f.name;
      const fileBaseName = filePath.split('/').pop()?.replace('.md', '') || '';
      const normalizedFile = fileBaseName.toLowerCase().replace(/[-\s]/g, '');
      
      // Check if file name starts with search term (and is reasonably close in length)
      const startsWithSearch = normalizedFile.startsWith(normalizedSearch);
      const lengthDiff = Math.abs(normalizedFile.length - normalizedSearch.length);
      // Allow up to 15 extra characters or 50% length difference, whichever is larger
      // This handles cases where URLs show abbreviated page names
      const maxDiff = Math.max(15, normalizedSearch.length * 0.5);
      
      return startsWithSearch && lengthDiff <= maxDiff;
    });
    
    if (candidates.length === 1) {
      // If we found exactly one candidate, use it (unambiguous match)
      file = candidates[0];
      console.log('[findFileFlexible] ✓ Found with strategy 5 (partial, unambiguous):', file.webkitRelativePath || file.name);
      return file;
    } else if (candidates.length > 1) {
      // Multiple matches - pick the shortest one (most likely to be the right match)
      console.log('[findFileFlexible] Found multiple partial matches:', candidates.length);
      file = candidates.reduce((shortest, current) => {
        const shortestPath = shortest.webkitRelativePath || shortest.name;
        const currentPath = current.webkitRelativePath || current.name;
        const shortestName = shortestPath.split('/').pop()?.replace('.md', '') || '';
        const currentName = currentPath.split('/').pop()?.replace('.md', '') || '';
        return currentName.length < shortestName.length ? current : shortest;
      });
      console.log('[findFileFlexible] ✓ Found with strategy 5 (partial, shortest):', file.webkitRelativePath || file.name);
      return file;
    }
  }
  
  // Log similar files to help debugging
  console.log('[findFileFlexible] ✗ Not found. Showing files with similar names:');
  const searchTerm = baseName?.toLowerCase().replace(/[-\s]/g, '') || '';
  const similarFiles = files
    .filter((f) => {
      const filePath = f.webkitRelativePath || f.name;
      const fileBaseName = filePath.split('/').pop()?.replace('.md', '').toLowerCase().replace(/[-\s]/g, '') || '';
      return fileBaseName.includes(searchTerm.substring(0, 8)) || searchTerm.includes(fileBaseName.substring(0, 8));
    })
    .slice(0, 5);
  
  similarFiles.forEach((f) => {
    console.log('[findFileFlexible]   Similar:', f.webkitRelativePath || f.name);
  });
  
  return file;
}

