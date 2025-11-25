'use client';

import { createContext, useContext, useReducer, useCallback, useEffect, useState } from 'react';
import type {
  FileSystemState,
  FileSystemActions,
  DirectoryNode,
  FileContent,
  SearchIndexEntry,
  SearchMode,
} from '@/types';
import {
  openDirectory,
  buildDirectoryTree,
  filterMarkdownFiles,
  getFileByPath,
  readFileAsText,
  getSavedDirectoryHandle,
  saveDirectoryHandle,
  clearDirectoryHandle,
  isFileSystemAccessSupported,
} from '@/lib/file-system';
import { pickDirectory, verifyPermission, readDirectory } from '@/lib/fs-access';

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

// Initial state
const initialState: FileSystemState = {
  rootHandle: null,
  directoryTree: null,
  selectedNode: null,
  currentFile: null,
  fileCache: new Map(),
  handleCache: new Map(),
  permissionState: 'unknown',
  isScanning: false,
  isInitializing: true,
  lastRefresh: null,
  searchIndex: [],
  expandedDirs: new Set(),
};

// Action types
type Action =
  | { type: 'SET_ROOT_HANDLE'; payload: FileSystemDirectoryHandle | null }
  | { type: 'SET_DIRECTORY_TREE'; payload: DirectoryNode | null }
  | { type: 'SET_SELECTED_NODE'; payload: DirectoryNode | null }
  | { type: 'SET_CURRENT_FILE'; payload: FileContent | null }
  | { type: 'UPDATE_FILE_CACHE'; payload: { path: string; content: FileContent } }
  | { type: 'SET_PERMISSION_STATE'; payload: FileSystemState['permissionState'] }
  | { type: 'SET_IS_SCANNING'; payload: boolean }
  | { type: 'SET_IS_INITIALIZING'; payload: boolean }
  | { type: 'SET_LAST_REFRESH'; payload: number }
  | { type: 'SET_SEARCH_INDEX'; payload: SearchIndexEntry[] }
  | { type: 'SET_EXPANDED_DIRS'; payload: Set<string> }
  | { type: 'CLEAR_ALL' };

// Reducer
function fileSystemReducer(state: FileSystemState, action: Action): FileSystemState {
  switch (action.type) {
    case 'SET_ROOT_HANDLE':
      return { ...state, rootHandle: action.payload };
    
    case 'SET_DIRECTORY_TREE':
      return { ...state, directoryTree: action.payload };
    
    case 'SET_SELECTED_NODE':
      return { ...state, selectedNode: action.payload };
    
    case 'SET_CURRENT_FILE':
      return { ...state, currentFile: action.payload };
    
    case 'UPDATE_FILE_CACHE': {
      const newCache = new Map(state.fileCache);
      newCache.set(action.payload.path, action.payload.content);
      return { ...state, fileCache: newCache };
    }
    
    case 'SET_PERMISSION_STATE':
      return { ...state, permissionState: action.payload };
    
    case 'SET_IS_SCANNING':
      return { ...state, isScanning: action.payload };
    
    case 'SET_IS_INITIALIZING':
      return { ...state, isInitializing: action.payload };
    
    case 'SET_LAST_REFRESH':
      return { ...state, lastRefresh: action.payload };
    
    case 'SET_SEARCH_INDEX':
      return { ...state, searchIndex: action.payload };
    
    case 'SET_EXPANDED_DIRS':
      return { ...state, expandedDirs: action.payload };
    
    case 'CLEAR_ALL':
      return { ...initialState };
    
    default:
      return state;
  }
}

// Context
const FileSystemContext = createContext<
  (FileSystemState & FileSystemActions) | undefined
>(undefined);

// Provider component
export function FileSystemProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(fileSystemReducer, initialState);
  const [allFiles, setAllFiles] = useState<File[]>([]);
  const [urlUpdateCallback, setUrlUpdateCallback] = useState<
    ((file: string | null, expanded: Set<string>) => void) | null
  >(null);

  // Check for saved directory on mount
  useEffect(() => {
    async function checkSavedDirectory() {
      if (!isFileSystemAccessSupported()) {
        dispatch({ type: 'SET_PERMISSION_STATE', payload: 'denied' });
        dispatch({ type: 'SET_IS_INITIALIZING', payload: false });
        return;
      }

      // Add a small delay to avoid showing welcome screen flash
      const startTime = Date.now();
      const savedHandle = await getSavedDirectoryHandle();
      
      if (!savedHandle) {
        // Only show welcome screen if initialization took more than 100ms
        const elapsed = Date.now() - startTime;
        if (elapsed < 100) {
          await new Promise(resolve => setTimeout(resolve, 100 - elapsed));
        }
        dispatch({ type: 'SET_IS_INITIALIZING', payload: false });
        return;
      }

      dispatch({ type: 'SET_ROOT_HANDLE', payload: savedHandle });
      dispatch({ type: 'SET_PERMISSION_STATE', payload: 'granted' });
      
      // Auto-load the directory
      try {
        dispatch({ type: 'SET_IS_SCANNING', payload: true });
        const files = await readDirectory(savedHandle);
        setAllFiles(files);
        
        const tree = buildDirectoryTree(files);
        dispatch({ type: 'SET_DIRECTORY_TREE', payload: tree });
        dispatch({ type: 'SET_LAST_REFRESH', payload: Date.now() });
      } catch (error) {
        console.error(ERROR_MESSAGES.LOAD_FAILED, error);
      } finally {
        dispatch({ type: 'SET_IS_SCANNING', payload: false });
        dispatch({ type: 'SET_IS_INITIALIZING', payload: false });
      }
    }

    checkSavedDirectory();
  }, []);

  // Select a directory
  const selectDirectory = useCallback(async () => {
    try {
      dispatch({ type: 'SET_IS_SCANNING', payload: true });

      let files: File[];
      let handle: FileSystemDirectoryHandle | null = null;

      if (isFileSystemAccessSupported()) {
        // Use native API for handle persistence
        handle = await pickDirectory();
        if (!handle) {
          return;
        }

        const hasPermission = await verifyPermission(handle, 'read');
        if (!hasPermission) {
          dispatch({ type: 'SET_PERMISSION_STATE', payload: 'denied' });
          return;
        }

        dispatch({ type: 'SET_ROOT_HANDLE', payload: handle });
        dispatch({ type: 'SET_PERMISSION_STATE', payload: 'granted' });
        
        // Save handle for future use
        await saveDirectoryHandle(handle);

        // Read all files
        files = await readDirectory(handle);
      } else {
        // Fallback to browser-fs-access
        const result = await openDirectory();
        files = result.files;
      }

      setAllFiles(files);
      
      // Build directory tree
      const tree = buildDirectoryTree(files);
      dispatch({ type: 'SET_DIRECTORY_TREE', payload: tree });
      dispatch({ type: 'SET_LAST_REFRESH', payload: Date.now() });
    } catch (error) {
      console.error(ERROR_MESSAGES.SELECT_FAILED, error);
      throw error;
    } finally {
      dispatch({ type: 'SET_IS_SCANNING', payload: false });
    }
  }, []);

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
        // Check cache first
        const cached = state.fileCache.get(path);
        if (cached) {
          dispatch({ type: 'SET_CURRENT_FILE', payload: cached });
          // Notify URL update callback
          urlUpdateCallback?.(path, state.expandedDirs);
          return;
        }

        // Find file in allFiles
        const file = getFileByPath(allFiles, path);
        if (!file) {
          throw new Error(ERROR_MESSAGES.FILE_NOT_FOUND(path));
        }

        // Read file content
        const content = await readFileAsText(file);
        const fileContent: FileContent = {
          path,
          content,
        };

        // Update cache and state
        dispatch({ type: 'UPDATE_FILE_CACHE', payload: { path, content: fileContent } });
        dispatch({ type: 'SET_CURRENT_FILE', payload: fileContent });
        
        // Notify URL update callback
        urlUpdateCallback?.(path, state.expandedDirs);
      } catch (error) {
        console.error(ERROR_MESSAGES.OPEN_FAILED, error);
        throw error;
      }
    },
    [allFiles, state.fileCache, state.expandedDirs, urlUpdateCallback]
  );

  // Search (placeholder for now)
  const search = useCallback(
    (query: string, _mode: SearchMode = 'filename'): SearchIndexEntry[] => {
      if (!query.trim()) return [];

      // Simple filename search for now
      const lowerQuery = query.toLowerCase();
      const mdFiles = filterMarkdownFiles(allFiles);

      const results: SearchIndexEntry[] = mdFiles
        .filter((file) => {
          const name = file.name.toLowerCase();
          return name.includes(lowerQuery);
        })
        .map((file) => ({
          path: file.webkitRelativePath || file.name,
          title: file.name,
          headings: [],
          keywords: [],
        }));

      return results;
    },
    [allFiles]
  );

  // Refresh directory
  const refresh = useCallback(async () => {
    if (!state.rootHandle) {
      throw new Error(ERROR_MESSAGES.NO_DIRECTORY);
    }

    try {
      dispatch({ type: 'SET_IS_SCANNING', payload: true });

      const files = await readDirectory(state.rootHandle);
      setAllFiles(files);

      const tree = buildDirectoryTree(files);
      dispatch({ type: 'SET_DIRECTORY_TREE', payload: tree });
      dispatch({ type: 'SET_LAST_REFRESH', payload: Date.now() });
    } catch (error) {
      console.error(ERROR_MESSAGES.REFRESH_FAILED, error);
      throw error;
    } finally {
      dispatch({ type: 'SET_IS_SCANNING', payload: false });
    }
  }, [state.rootHandle]);

  // Clear directory
  const clearDirectory = useCallback(async () => {
    await clearDirectoryHandle();
    dispatch({ type: 'CLEAR_ALL' });
    setAllFiles([]);
  }, []);

  // Set expanded directories
  const setExpandedDirs = useCallback((dirs: Set<string>) => {
    dispatch({ type: 'SET_EXPANDED_DIRS', payload: dirs });
    // Notify URL update callback
    urlUpdateCallback?.(state.currentFile?.path || null, dirs);
  }, [state.currentFile, urlUpdateCallback]);

  // Set URL update callback
  const setUrlUpdateCallbackFn = useCallback((callback: (file: string | null, expanded: Set<string>) => void) => {
    setUrlUpdateCallback(() => callback);
  }, []);

  const value = {
    ...state,
    selectDirectory,
    loadNodeChildren,
    openFile,
    search,
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

// Hook to use the context
export function useFileSystem() {
  const context = useContext(FileSystemContext);
  if (context === undefined) {
    throw new Error(ERROR_MESSAGES.CONTEXT_ERROR);
  }
  return context;
}
