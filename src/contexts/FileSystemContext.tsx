'use client';

import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { useSnapshot } from 'valtio';
import type {
  FileSystemActions,
  DirectoryNode,
  FileContent,
  SearchIndexEntry,
  SearchMode,
} from '@/types';
import {
  openDirectory,
  buildDirectoryTree,
  buildDirectoryTreeFromMetadata,
  filterMarkdownFiles,
  readFileAsText,
  getSavedDirectoryHandle,
  saveDirectoryHandle,
  clearDirectoryHandle,
  isFileSystemAccessSupported,
  getWikiNameFromGit,
  getAzureDevOpsContext,
  cacheFiles,
  loadCachedFileMetadata,
  clearCachedFiles,
  cleanWikiName,
} from '@/lib/file-system';
import { pickDirectory, verifyPermission, readDirectory } from '@/lib/fs-access';
import { getFileByDisplayPath, getFilePath } from '@/lib/path-manager';
import { useWorkers } from '@/hooks/use-workers';
import {
  fileSystemStore,
  setRootHandle,
  setDirectoryTree,
  setCurrentFile,
  updateFileCache,
  setPermissionState,
  setIsScanning,
  setIsInitializing,
  setLastRefresh,
  setAllFiles,
  setWikiName,
  setAzureDevOpsContext,
  clearAllFileSystem,
} from '@/store/file-system-store';
import { getCurrentExpandedDirs } from '@/store/ui-store';

// Error messages
const ERROR_MESSAGES = {
  NO_DIRECTORY: 'No directory selected',
  FILE_NOT_FOUND: (path: string) => `File not found: ${path}`,
  LOAD_FAILED: 'Failed to load saved directory',
  SELECT_FAILED: 'Error selecting directory',
  OPEN_FAILED: 'Error opening file',
  REFRESH_FAILED: 'Error refreshing directory',
  CONTEXT_ERROR: 'useFileSystem must be used within a FileSystemProvider',
} as const;

// Context - now only provides actions, state comes from Valtio
const FileSystemContext = createContext<FileSystemActions | undefined>(undefined);

// Provider component
export function FileSystemProvider({ children }: { children: React.ReactNode }) {
  const [urlUpdateCallback, setUrlUpdateCallback] = useState<
    ((file: string | null, expanded: Set<string>) => void) | null
  >(null);
  
  // Initialize workers (only content search worker needed)
  const { contentSearchWorker } = useWorkers();

  // Helper to extract wiki name and Azure DevOps context from directory handle
  const getWikiName = useCallback(async (handle: FileSystemDirectoryHandle | null): Promise<string | null> => {
    if (!handle) return null;
    
    // First try to get Azure DevOps context from .git/config
    const azureContext = await getAzureDevOpsContext(handle);
    if (azureContext) {
      console.log('[getWikiName] Got Azure DevOps context from git:', azureContext);
      setAzureDevOpsContext(azureContext);
      return azureContext.wikiName;
    }
    
    // Fallback to old method
    const gitWikiName = await getWikiNameFromGit(handle);
    if (gitWikiName) {
      console.log('[getWikiName] Got wiki name from git:', gitWikiName);
      return gitWikiName;
    }
    
    // Fallback to directory name
    console.log('[getWikiName] Using directory handle name:', handle.name);
    return handle.name;
  }, []);

  // Check for saved directory on mount
  useEffect(() => {
    async function checkSavedDirectory() {
      try {
        if (!isFileSystemAccessSupported()) {
          // Firefox/Safari: try to load cached metadata only (fast)
          console.log('[FileSystemContext] Checking for cached metadata (fallback browser)');
          
          // Add timeout to prevent infinite loading
          const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => {
              console.warn('[FileSystemContext] Cache load timeout, showing welcome screen');
              resolve(null);
            }, 5000);
          });
          
          const cached = await Promise.race([loadCachedFileMetadata(), timeoutPromise]);
          
          if (cached) {
            console.log('[FileSystemContext] Loaded cached metadata for fallback browser');
            console.log('[FileSystemContext] Cached files count:', cached.files.length);
            
            // Build tree from metadata on main thread (fast, no File objects)
            const tree = buildDirectoryTreeFromMetadata(cached.files);
            setDirectoryTree(tree);
            setWikiName(cached.wikiName);
            setPermissionState('granted');
            setLastRefresh(Date.now());
            
            // Load cached File objects from IndexedDB
            const { loadCachedFiles } = await import('@/lib/file-system');
            const cachedFiles = await loadCachedFiles();
            if (cachedFiles) {
              console.log('[FileSystemContext] Loaded', cachedFiles.length, 'File objects from cache');
              setAllFiles(cachedFiles);
            } else {
              console.log('[FileSystemContext] No cached File objects - will load from IndexedDB on demand');
            }
            
            // Build search index in background (will load content from IndexedDB as needed)
            if (contentSearchWorker) {
              contentSearchWorker.buildIndex().then((result) => {
                console.log('[FileSystemContext] Search index built from cache:', result);
              }).catch((error) => {
                console.error('[FileSystemContext] Error building search index:', error);
              });
            }
          } else {
            console.log('[FileSystemContext] No cached metadata found, showing welcome screen');
          }
          
          setIsInitializing(false);
          return;
        }

        // Chrome/Edge: try to restore directory handle
        console.log('[FileSystemContext] Checking for saved directory handle');
        const startTime = Date.now();
        const savedHandle = await getSavedDirectoryHandle();
        
        if (!savedHandle) {
          console.log('[FileSystemContext] No saved handle found, showing welcome screen');
          // Only show welcome screen if initialization took more than 100ms
          const elapsed = Date.now() - startTime;
          if (elapsed < 100) {
            await new Promise(resolve => setTimeout(resolve, 100 - elapsed));
          }
          setIsInitializing(false);
          return;
        }

        setRootHandle(savedHandle);
        setPermissionState('granted');
        
        // Get and set wiki name
        const wikiNameValue = await getWikiName(savedHandle);
        setWikiName(wikiNameValue);
        
        // Auto-load the directory
        try {
          setIsScanning(true);
          const files = await readDirectory(savedHandle);
          setAllFiles(files);
          
          // Build tree on main thread
          const tree = buildDirectoryTree(files);
          setDirectoryTree(tree);
          setLastRefresh(Date.now());
          
          // Cache files for web worker access (even on Chrome)
          if (wikiNameValue) {
            cacheFiles(files, wikiNameValue).catch((error) => {
              console.error('[FileSystemContext] Failed to cache files:', error);
            });
          }
        } catch (error) {
          console.error(ERROR_MESSAGES.LOAD_FAILED, error);
        } finally {
          setIsScanning(false);
          setIsInitializing(false);
        }
      } catch (error) {
        console.error('[FileSystemContext] Initialization error:', error);
        setIsInitializing(false);
      }
    }

    checkSavedDirectory();
  }, [getWikiName, contentSearchWorker]);

  // Select a directory
  const selectDirectory = useCallback(async () => {
    try {
      setIsScanning(true);

      let files: File[];
      let handle: FileSystemDirectoryHandle | null = null;
      let wikiNameValue: string | null = null;

      if (isFileSystemAccessSupported()) {
        // Use native API for handle persistence
        handle = await pickDirectory();
        if (!handle) {
          setIsScanning(false);
          return;
        }

        const hasPermission = await verifyPermission(handle, 'read');
        if (!hasPermission) {
          setPermissionState('denied');
          setIsScanning(false);
          return;
        }

        setRootHandle(handle);
        setPermissionState('granted');
        
        // Get and set wiki name
        wikiNameValue = await getWikiName(handle);
        setWikiName(wikiNameValue);
        
        // Save handle for future use
        await saveDirectoryHandle(handle);

        // Read all files
        files = await readDirectory(handle);
        
        // Cache files for web worker access
        if (wikiNameValue) {
          await cacheFiles(files, wikiNameValue);
        }
      } else {
        // Fallback to browser-fs-access (Firefox, Safari, etc.)
        const result = await openDirectory();
        files = result.files;
        
        // No handle persistence in fallback mode
        setPermissionState('granted');
        
        // Extract wiki name from first file's path (directory name)
        if (files.length > 0) {
          const firstPath = getFilePath(files[0]);
          const rootDirName = firstPath.split('/')[0];
          
          // Clean up the wiki name for display
          wikiNameValue = cleanWikiName(rootDirName);
          setWikiName(wikiNameValue);
        }
        
        // Cache files for next page load
        if (wikiNameValue) {
          await cacheFiles(files, wikiNameValue);
          // Build search index in background
          if (contentSearchWorker) {
            contentSearchWorker.buildIndex().then((result) => {
              console.log('[FileSystemContext] Search index built:', result);
            }).catch((error) => {
              console.error('[FileSystemContext] Error building search index:', error);
            });
          }
        }
      }

      setAllFiles(files);
      
      // Build directory tree on main thread
      const tree = buildDirectoryTree(files);
      setDirectoryTree(tree);
      setLastRefresh(Date.now());
    } catch (error) {
      console.error(ERROR_MESSAGES.SELECT_FAILED, error);
      throw error;
    } finally {
      setIsScanning(false);
    }
  }, [getWikiName, contentSearchWorker]);

  // Load children of a directory node (for lazy loading)
  const loadNodeChildren = useCallback(async (node: DirectoryNode) => {
    // In our case, we load everything upfront, so this is a no-op
    // But we keep the function signature for future optimization
    console.log('Loading children for:', node.path);
  }, []);

  // Open a file
  const openFile = useCallback(
    async (path: string) => {
      try {
        console.log('[openFile] Opening file:', path);
        
        // Check cache first
        const cached = fileSystemStore.fileCache.get(path);
        if (cached) {
          console.log('[openFile] Found in fileCache');
          setCurrentFile(cached);
          urlUpdateCallback?.(path, getCurrentExpandedDirs());
          return;
        }

        // Try to load from IndexedDB first (for cached/Firefox mode)
        const { getFileContentFromCache } = await import('@/lib/file-system');
        let cachedContent = await getFileContentFromCache(path);
        
        // If not found and we have a directory tree, try to find the full path
        if (cachedContent === null && fileSystemStore.directoryTree) {
          const tree = fileSystemStore.directoryTree;
          const commonPrefix = tree._commonRootPrefix;
          
          // Try with common root prefix if it exists
          if (commonPrefix && !path.startsWith(commonPrefix + '/')) {
            const pathWithPrefix = `${commonPrefix}/${path}`;
            console.log('[openFile] Trying with prefix:', pathWithPrefix);
            cachedContent = await getFileContentFromCache(pathWithPrefix);
            
            if (cachedContent !== null) {
              // Update path to the one that worked
              path = pathWithPrefix;
            }
          } else if (commonPrefix && path.startsWith(commonPrefix + '/')) {
            // Try without prefix
            const pathWithoutPrefix = path.slice(commonPrefix.length + 1);
            console.log('[openFile] Trying without prefix:', pathWithoutPrefix);
            const contentWithoutPrefix = await getFileContentFromCache(pathWithoutPrefix);
            
            if (contentWithoutPrefix !== null) {
              cachedContent = contentWithoutPrefix;
              // Keep the original path (with prefix) for consistency
            }
          }
        }
        
        if (cachedContent !== null) {
          console.log('[openFile] Loaded from IndexedDB cache:', path);
          const fileContent: FileContent = {
            path,
            content: cachedContent,
          };
          
          updateFileCache(path, fileContent);
          setCurrentFile(fileContent);
          urlUpdateCallback?.(path, getCurrentExpandedDirs());
          return;
        }

        // Fallback to allFiles for File System Access API mode
        const allFiles = fileSystemStore.allFiles;
        
        console.log('[openFile] Not in IndexedDB, trying allFiles. Count:', allFiles.length);
        console.log('[openFile] Looking for path:', path);
        
        // If allFiles is empty, we're probably in cached/Firefox mode where files aren't stored
        // In this case, the file MUST be in IndexedDB, so if we got here, it's truly not found
        if (allFiles.length === 0) {
          console.error('[openFile] allFiles is empty (likely cached mode) and file not in IndexedDB');
          console.error('[openFile] This means the file was not cached properly or the path is wrong');
          console.error('[openFile] Requested path:', path);
          
          // Try to get all cached file paths to help debug
          const { getFileContentsDB } = await import('@/lib/file-system');
          const db = await getFileContentsDB();
          const allKeys = await db.getAllKeys('contents');
          console.error('[openFile] All cached file paths (first 20):', allKeys.slice(0, 20));
          
          throw new Error(`File not found in cache or allFiles: ${path}`);
        }
        
        // Debug: Log first 10 file paths to understand the structure
        console.log('[openFile] Sample file paths from allFiles:');
        allFiles.slice(0, 10).forEach((f, idx) => {
          const filePath = getFilePath(f);
          console.log(`  [${idx}] ${filePath}`);
        });
        
        // Check if the specific file we're looking for exists
        console.log('[openFile] Searching for exact match:', path);
        const exactMatch = allFiles.find(f => {
          const fp = getFilePath(f);
          console.log(`  Comparing: "${fp}" === "${path}"? ${fp === path}`);
          return fp === path;
        });
        console.log('[openFile] Exact match found:', !!exactMatch);
        
        // Use PathManager functional helper to find the file
        const file = getFileByDisplayPath(allFiles, path);
        if (!file) {
          console.error('[openFile] File not found:', path);
          console.error('[openFile] This will call getFileByDisplayPath which logs debug info');
          throw new Error(ERROR_MESSAGES.FILE_NOT_FOUND(path));
        }

        console.log('[openFile] Found file in allFiles');

        // Read file content
        const content = await readFileAsText(file);
        const fileContent: FileContent = {
          path,
          content,
        };

        updateFileCache(path, fileContent);
        setCurrentFile(fileContent);
        urlUpdateCallback?.(path, getCurrentExpandedDirs());
      } catch (error) {
        console.error(ERROR_MESSAGES.OPEN_FAILED, error);
        throw error;
      }
    },
    [urlUpdateCallback]
  );

  // Search (currently simple sync search, can be enhanced with searchWorker for full-text)
  const search = useCallback(
    (query: string, _mode: SearchMode = 'filename'): SearchIndexEntry[] => {
      if (!query.trim()) return [];

      // Simple filename search for now
      const lowerQuery = query.toLowerCase();
      const mdFiles = filterMarkdownFiles(fileSystemStore.allFiles);

      const results: SearchIndexEntry[] = mdFiles
        .filter((file) => {
          const name = file.name.toLowerCase();
          return name.includes(lowerQuery);
        })
        .map((file) => ({
          path: getFilePath(file),
          title: file.name,
          headings: [],
          keywords: [],
        }));

      return results;
    },
    []
  );

  // Full-text content search using worker
  const searchContent = useCallback(
    async (query: string): Promise<import('@/types').ContentSearchResult[]> => {
      if (!contentSearchWorker) {
        console.warn('[FileSystemContext] Content search worker not available');
        return [];
      }

      if (!query || query.trim().length === 0) {
        return [];
      }

      try {
        const results = await contentSearchWorker.search(query.trim());
        return results;
      } catch (error) {
        console.error('[FileSystemContext] Content search error:', error);
        return [];
      }
    },
    [contentSearchWorker]
  );

  // Refresh directory
  const refresh = useCallback(async () => {
    if (!fileSystemStore.rootHandle) {
      throw new Error(ERROR_MESSAGES.NO_DIRECTORY);
    }

    try {
      setIsScanning(true);

      const files = await readDirectory(fileSystemStore.rootHandle);
      setAllFiles(files);

      const tree = buildDirectoryTree(files);
      setDirectoryTree(tree);
      setLastRefresh(Date.now());
    } catch (error) {
      console.error(ERROR_MESSAGES.REFRESH_FAILED, error);
      throw error;
    } finally {
      setIsScanning(false);
    }
  }, [contentSearchWorker]);

  // Clear directory
  const clearDirectory = useCallback(async () => {
    await clearDirectoryHandle();
    await clearCachedFiles();
    clearAllFileSystem();
  }, []);

  // Set expanded directories (delegates to ui-store)
  const setExpandedDirs = useCallback((dirs: Set<string>) => {
    // This is now handled by ui-store, but we keep the interface for compatibility
    // The actual implementation is in ui-store.ts via setExpandedDirs action
    // Notify URL update callback
    urlUpdateCallback?.(fileSystemStore.currentFile?.path || null, dirs);
  }, [urlUpdateCallback]);

  // Set URL update callback
  const setUrlUpdateCallbackFn = useCallback((callback: (file: string | null, expanded: Set<string>) => void) => {
    setUrlUpdateCallback(() => callback);
  }, []);

  const value = {
    selectDirectory,
    loadNodeChildren,
    openFile,
    search,
    searchContent,
    refresh,
    clearDirectory,
    setExpandedDirs,
    setUrlUpdateCallback: setUrlUpdateCallbackFn,
  };

  return (
    <FileSystemContext.Provider value={value}>
      {children}
    </FileSystemContext.Provider>
  );
}

// Hook to use the context - returns actions AND reactive state from Valtio
export function useFileSystem() {
  const context = useContext(FileSystemContext);
  if (context === undefined) {
    throw new Error(ERROR_MESSAGES.CONTEXT_ERROR);
  }
  
  // Get reactive state from Valtio
  const state = useSnapshot(fileSystemStore);
  
  // Merge actions from context with state from Valtio
  return {
    ...state,
    ...context,
  };
}
