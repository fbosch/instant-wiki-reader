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
