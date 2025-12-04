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
 * Formats a file name for display by removing extension and formatting dashes.
 * Paths are already decoded by getFilePath, so no need to decode again.
 * 
 * Dash formatting rules:
 * - Three dashes (---) → space-dash-space ( - )
 * - Single dashes → spaces
 * 
 * @param fileName - File name (e.g., "Documentation.md", "File---Name-Example.md")
 * @param removeExtension - Whether to remove the file extension (default: false)
 * @returns Formatted file name (e.g., "Documentation", "File - Name Example")
 */
export function formatFileName(fileName: string, removeExtension = false): string {
  let formatted = fileName;
  
  if (removeExtension && formatted.endsWith('.md')) {
    formatted = formatted.slice(0, -3);
  }
  
  // Replace three dashes with space-dash-space
  formatted = formatted.replace(/---/g, ' - ');
  
  // Replace single dashes with spaces
  formatted = formatted.replace(/-/g, ' ');
  
  return formatted;
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

