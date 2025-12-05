'use client';

import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { useSnapshot } from 'valtio';
import { useUrlState } from '@/hooks/use-url-state';
import type {
  FileSystemActions,
  DirectoryNode,
  FileContent,
  SearchIndexEntry,
  SearchMode,
} from '@/types';
import {
  openDirectory,
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
  getFileByPath,
} from '@/lib/file-system';
import { pickDirectory, verifyPermission, readDirectory } from '@/lib/fs-access';
import { getFileByDisplayPath } from '@/lib/path-manager';
import { getFilePath } from '@/lib/path-manager';
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
  setIsCaching,
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
  // Initialize workers
  const { contentSearchWorker, searchWorker } = useWorkers();
  
  // Get URL state management
  const { updateUrl } = useUrlState();

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
            
            // Try to load cached File objects (for reading files)
            // If this fails, we'll fall back to IndexedDB cache
            const { loadCachedFiles } = await import('@/lib/file-system');
            const cachedFiles = await loadCachedFiles();
            if (cachedFiles && cachedFiles.length > 0) {
              console.log('[FileSystemContext] Loaded', cachedFiles.length, 'File objects from cache');
              setAllFiles(cachedFiles);
            } else {
              console.log('[FileSystemContext] No cached File objects - will use IndexedDB only');
            }
            
            // Worker will auto-build index from IndexedDB
          } else {
            console.log('[FileSystemContext] No cached metadata found, showing welcome screen');
          }
          
          setIsInitializing(false);
          return;
        }

        // Chrome/Edge: try to restore directory handle
        console.log('[FileSystemContext] Checking for saved directory handle');
        const startTime = performance.now();
        const savedHandle = await getSavedDirectoryHandle();
        
        if (!savedHandle) {
          console.log('[FileSystemContext] No saved handle found, showing welcome screen');
          setIsInitializing(false);
          return;
        }

        setRootHandle(savedHandle);
        setPermissionState('granted');
        
        // Get wiki name from cache metadata (fast) instead of reading from .git
        const cached = await loadCachedFileMetadata();
        
        if (cached) {
          console.log('[FileSystemContext] ✓ Loaded metadata from IndexedDB cache (took', (performance.now() - startTime).toFixed(2), 'ms)');
          console.log('[FileSystemContext] Cached metadata count:', cached.files.length);
          
          // Build tree from metadata (fast - no File System Access needed)
          const tree = buildDirectoryTreeFromMetadata(cached.files);
          setDirectoryTree(tree);
          setWikiName(cached.wikiName);
          setLastRefresh(Date.now());
          
          // Also try to get Azure DevOps context from .git/config
          // This is needed for work item link conversion
          // Wrapped in try-catch to prevent blocking initialization if it fails
          try {
            console.log('[FileSystemContext] Attempting to load Azure DevOps context from .git/config');
            const azureContext = await getAzureDevOpsContext(savedHandle);
            if (azureContext) {
              console.log('[FileSystemContext] ✓ Loaded Azure DevOps context:', azureContext);
              setAzureDevOpsContext(azureContext);
            } else {
              console.log('[FileSystemContext] No Azure DevOps context found');
            }
          } catch (error) {
            console.warn('[FileSystemContext] Failed to load Azure DevOps context:', error);
            // Non-critical - continue with initialization
          }
          
          // Build file path metadata map from cached metadata (lightweight)
          console.log('[FileSystemContext] Building file path metadata map...');
          const { setFilePathMetadataFromCache } = await import('@/store/file-system-store');
          setFilePathMetadataFromCache(cached.files);
          console.log('[FileSystemContext] ✓ File path metadata map ready');
          
          // Try to load cached File objects (for reading files)  
          // If this fails, we'll fall back to IndexedDB cache or File System Access
          const { loadCachedFiles } = await import('@/lib/file-system');
          const cachedFiles = await loadCachedFiles();
          if (cachedFiles && cachedFiles.length > 0) {
            console.log('[FileSystemContext] Loaded', cachedFiles.length, 'File objects from cache');
            setAllFiles(cachedFiles);
          } else {
            console.log('[FileSystemContext] No cached File objects - will use IndexedDB or File System Access');
          }
          
          console.log('[FileSystemContext] ✓ Initialization complete (total:', (performance.now() - startTime).toFixed(2), 'ms)');
          setIsInitializing(false);
          return;
        }
        
        // No cache - need to scan directory (first time or cache cleared)
        console.log('[FileSystemContext] No cache found, scanning directory...');
        const wikiNameValue = await getWikiName(savedHandle);
        setWikiName(wikiNameValue);
        
        try {
          setIsScanning(true);
          const files = await readDirectory(savedHandle);
          setAllFiles(files);
          
          // Build tree on main thread
          const metadata = files.map(file => ({
            path: getFilePath(file),
            name: file.name,
          }));
          const tree = buildDirectoryTreeFromMetadata(metadata);
          setDirectoryTree(tree);
          setLastRefresh(Date.now());
          
          // Cache for next time (background)
          if (wikiNameValue) {
            setIsCaching(true);
            cacheFiles(files, wikiNameValue).then(() => {
              console.log('[FileSystemContext] Background caching complete');
              setIsCaching(false);
            }).catch((error) => {
              console.error('[FileSystemContext] Background caching failed:', error);
              setIsCaching(false);
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
        
        // Cache files for web worker access (async, non-blocking)
        if (wikiNameValue) {
          setIsCaching(true);
          cacheFiles(files, wikiNameValue).then(() => {
            console.log('[FileSystemContext] Background caching complete');
            setIsCaching(false);
          }).catch((error) => {
            console.error('[FileSystemContext] Background caching failed:', error);
            setIsCaching(false);
          });
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
        
        // Cache files for next page load (async, non-blocking)
        if (wikiNameValue) {
          setIsCaching(true);
          cacheFiles(files, wikiNameValue).then(() => {
            console.log('[FileSystemContext] Background caching complete');
            setIsCaching(false);
            // Tell worker to rebuild index now that files are cached
            if (contentSearchWorker) {
              contentSearchWorker.buildIndex().then((result) => {
                console.log('[FileSystemContext] Index rebuilt after caching:', result);
              });
            }
          }).catch((error) => {
            console.error('[FileSystemContext] Background caching failed:', error);
            setIsCaching(false);
          });
        }
      }

      setAllFiles(files);
      
      // Build directory tree on main thread
      const metadata = files.map(file => ({
        path: getFilePath(file),
        name: file.name,
      }));
      const tree = buildDirectoryTreeFromMetadata(metadata);
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
    (path: string) => {
      console.log('[openFile] Updating URL to file:', path);
      // Just update the URL - page.tsx will observe and load the file
      // Clear any text fragment highlight when navigating to a new file
      updateUrl({ file: path, textFragment: null });
    },
    [updateUrl]
  );

  // Load file content (called by page.tsx when URL changes)
  const loadFile = useCallback(async (path: string) => {
    try {
      const startTime = performance.now();
      console.log('[loadFile] ========== START ==========');
      console.log('[loadFile] Loading file:', path);
      
      // Check in-memory cache first (fastest)
      const cached = fileSystemStore.fileCache.get(path);
      if (cached) {
        console.log('[loadFile] ✓ Found in memory cache (took', (performance.now() - startTime).toFixed(2), 'ms)');
        setCurrentFile(cached);
        return;
      }

      console.log('[loadFile] Not in cache, loading...');
      
      let content: string | null = null;
      
      // Try IndexedDB cache first
      console.log('[loadFile] Trying IndexedDB cache...');
      const { getFileContentFromCache } = await import('@/lib/file-system');
      content = await getFileContentFromCache(path);
      
      // Fallback to File objects if cache missed
      if (content === null) {
        const allFiles = fileSystemStore.allFiles;
        console.log('[loadFile] Cache miss, trying allFiles... (length:', allFiles.length, ')');
        
        if (allFiles.length > 0) {
          const file = getFileByPath(allFiles, path);
          
          if (file) {
            console.log('[loadFile] ✓ Found file in allFiles, reading...');
            content = await readFileAsText(file);
          } else {
            console.log('[loadFile] File not found in allFiles');
          }
        }
      }
      
      // Final fallback: Try to read from File System Access API directly
      if (content === null && fileSystemStore.rootHandle) {
        console.log('[loadFile] Trying File System Access API directly...');
        try {
          const parts = path.split('/');
          let currentHandle: FileSystemDirectoryHandle = fileSystemStore.rootHandle;
          
          for (let i = 0; i < parts.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
          }
          
          const fileName = parts[parts.length - 1];
          const fileHandle = await currentHandle.getFileHandle(fileName);
          const file = await fileHandle.getFile();
          content = await readFileAsText(file);
          console.log('[loadFile] ✓ Read from File System Access API');
        } catch (error) {
          console.log('[loadFile] File System Access API failed:', error);
        }
      }
      
      if (content === null) {
        console.error('[loadFile] ❌ File not found in any source');
        throw new Error(ERROR_MESSAGES.FILE_NOT_FOUND(path));
      }
      
      console.log('[loadFile] ✓ Loaded successfully (took', (performance.now() - startTime).toFixed(2), 'ms)');
      
      const fileContent: FileContent = { path, content };
      updateFileCache(path, fileContent);
      setCurrentFile(fileContent);
      
      console.log('[loadFile] ========== TOTAL:', (performance.now() - startTime).toFixed(2), 'ms ==========');
    } catch (error) {
      console.error(ERROR_MESSAGES.OPEN_FAILED, error);
      throw error;
    }
  }, []);

  // Filename/metadata search using worker (non-blocking)
  const search = useCallback(
    async (query: string, _mode: SearchMode = 'filename'): Promise<SearchIndexEntry[]> => {
      if (!query.trim()) return [];
      
      if (!searchWorker) {
        console.warn('[FileSystemContext] Search worker not available, using fallback');
        // Fallback to simple sync search
        const lowerQuery = query.toLowerCase();
        const mdFiles = filterMarkdownFiles(fileSystemStore.allFiles);
        return mdFiles
          .filter((file) => file.name.toLowerCase().includes(lowerQuery))
          .map((file) => ({
            path: getFilePath(file),
            title: file.name,
            headings: [],
            keywords: [],
          }));
      }

      try {
        const results = await searchWorker.search(query.trim());
        // Convert search results to SearchIndexEntry format
        return results.map(result => ({
          path: result.path,
          title: result.name,
          headings: [],
          keywords: [],
        }));
      } catch (error) {
        console.error('[FileSystemContext] Search error:', error);
        return [];
      }
    },
    [searchWorker]
  );

  // Full-text content search using worker
  const searchContent = useCallback(
    async (query: string): Promise<import('@/types').ContentSearchResult[]> => {
      console.log(`[FileSystemContext] searchContent called with query: "${query}"`);
      console.log(`[FileSystemContext] contentSearchWorker available: ${!!contentSearchWorker}`);
      
      if (!contentSearchWorker) {
        console.warn('[FileSystemContext] Content search worker not available');
        return [];
      }

      if (!query || query.trim().length === 0) {
        console.log('[FileSystemContext] Empty query');
        return [];
      }

      try {
        console.log(`[FileSystemContext] Calling worker.search("${query.trim()}")`);
        const results = await contentSearchWorker.search(query.trim());
        console.log(`[FileSystemContext] Worker returned ${results.length} results`);
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

      const metadata = files.map(file => ({
        path: getFilePath(file),
        name: file.name,
      }));
      const tree = buildDirectoryTreeFromMetadata(metadata);
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

  const value = {
    selectDirectory,
    loadNodeChildren,
    openFile,
    loadFile,
    search,
    searchContent,
    refresh,
    clearDirectory,
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
