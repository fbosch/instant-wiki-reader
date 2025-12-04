/**
 * FileWrapper - Cross-browser File abstraction
 * 
 * Handles differences between:
 * - Chrome/Edge: Native File objects with webkitRelativePath
 * - Firefox/Safari: File-like objects from browser-fs-access
 * 
 * Provides a consistent interface for accessing file properties.
 * Uses path-manager utilities for cross-browser property access.
 */

import { getFilePath } from './path-manager';

export interface FileMetadata {
  path: string;
  name: string;
  size: number;
  lastModified: number;
  type: string;
}

/**
 * Safely extract a property from a file-like object
 * Handles Firefox/browser quirks where property access can throw errors
 */
function safeGet<T>(obj: any, prop: string, defaultValue: T): T {
  try {
    // Check if property exists without triggering getters
    const descriptor = Object.getOwnPropertyDescriptor(obj, prop);
    if (descriptor) {
      // If it has a getter, call it with proper context
      if (descriptor.get) {
        const value = descriptor.get.call(obj);
        if (value !== null && value !== undefined) {
          return value;
        }
      } else if (descriptor.value !== undefined) {
        return descriptor.value;
      }
    }
    
    // Fallback: try direct property access
    if (prop in obj) {
      const value = obj[prop];
      if (value !== null && value !== undefined) {
        return value;
      }
    }
  } catch (e) {
    // Property access threw error - this is expected in Firefox
    console.debug(`[safeGet] Error accessing ${prop}:`, e);
  }
  return defaultValue;
}

/**
 * Wrapped file with safe property access
 */
export class FileWrapper {
  private file: any;
  private _path: string;
  private _name: string;
  private _size: number;
  private _lastModified: number;
  private _type: string;

  constructor(file: any) {
    this.file = file;
    
    try {
      // Use path-manager for path extraction
      this._path = getFilePath(file);
      this._name = safeGet(file, 'name', 'unknown-file');
      this._size = safeGet(file, 'size', 0);
      this._lastModified = safeGet(file, 'lastModified', Date.now());
      this._type = safeGet(file, 'type', '');
      
      console.log('[FileWrapper] Created wrapper for:', this._name, 'path:', this._path);
    } catch (error) {
      console.error('[FileWrapper] Error creating wrapper:', error);
      // Set defaults if construction fails
      this._path = 'error-file';
      this._name = 'error-file';
      this._size = 0;
      this._lastModified = Date.now();
      this._type = '';
      throw error;
    }
  }

  // Public getters
  get path(): string {
    return this._path;
  }

  get name(): string {
    return this._name;
  }

  get size(): number {
    return this._size;
  }

  get lastModified(): number {
    return this._lastModified;
  }

  get type(): string {
    return this._type;
  }

  /**
   * Read file as text
   */
  async text(): Promise<string> {
    try {
      // Try native text() method first, binding the context to avoid "Illegal invocation"
      if (typeof this.file.text === 'function') {
        return await this.file.text.call(this.file);
      }

      // Fallback to FileReader
      if (this.file instanceof Blob || this.file instanceof File) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(this.file);
        });
      }

      throw new Error('Cannot read file: no suitable method available');
    } catch (error) {
      console.error('[FileWrapper] Error reading file:', this._path, error);
      throw error;
    }
  }

  /**
   * Get metadata object
   */
  getMetadata(): FileMetadata {
    return {
      path: this._path,
      name: this._name,
      size: this._size,
      lastModified: this._lastModified,
      type: this._type,
    };
  }

  /**
   * Get the original file object (use sparingly)
   */
  getOriginalFile(): any {
    return this.file;
  }
}

/**
 * Wrap an array of file-like objects
 */
export function wrapFiles(files: any[]): FileWrapper[] {
  console.log('[wrapFiles] Wrapping', files.length, 'files');
  const wrapped = files.map(f => new FileWrapper(f));
  
  if (wrapped.length > 0) {
    console.log('[wrapFiles] First wrapped file:', {
      path: wrapped[0].path,
      name: wrapped[0].name,
      size: wrapped[0].size,
    });
  }
  
  return wrapped;
}

/**
 * Convert wrapped files to metadata array
 */
export function toMetadataArray(files: FileWrapper[]): FileMetadata[] {
  return files.map(f => f.getMetadata());
}
